//! TypeScript Backend Implementation
//!
//! Generates TypeScript code from Orbital IR for both client (React) and server (Express).
//!
//! Output structure matches KFlow shell convention:
//! - packages/shared/src/types/entities.ts - Entity interfaces
//! - packages/shared/src/schemas/entities.ts - Zod schemas
//! - packages/client/src/hooks/useOrbitalBridge.ts - Event bus + server bridge (Phase 5)
//! - packages/client/src/hooks/traits/use{Trait}.tsx - Trait hooks with compiled UI
//! - packages/client/src/features/{page}/*.tsx - Page components
//! - packages/server/src/routes/features/{entity}/ - Entity routes (handlers.ts, routes.ts)

pub(crate) use orbital_core_base::generate::{Backend, GeneratedFile, GeneratedOutput};
pub(crate) use orbital_core_base::ir::{
    OirBindingRoot, OirCardinality, OirConstraint, OirDispatchMode, OirEffect, OirEntity, OirEvent,
    OirExpr, OirModule, OirPage, OirPattern, OirPersistOp, OirPersistence, OirTrait, OirTransition,
    OirTransitionFrom, OirType, OirValue,
};
pub(crate) use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

pub(crate) use crate::codegen::{
    generate_all_themes_config_ts, generate_env_manifest, generate_service_clients,
    generate_theme_css, is_operator_name, theme_font_imports, ts_member_name,
};
pub(crate) use orbital_core_base::schema::SExpression;

pub(crate) use crate::pattern_registry::get_component_mapping;

/// One relayable `listens` edge (G-ORB-055): its listener, the trigger it
/// fires, its initial state (an unmounted listener holds no state of its own),
/// and its `with {}` projection / `when` guard as TS source.
#[derive(Clone, Debug)]
pub struct OffPageListen {
    pub orbital: String,
    pub trait_name: String,
    pub event: String,
    pub triggers: String,
    pub initial: String,
    pub project: String,
    pub when: Option<String>,
    /// Events the listener itself transitions on: an unmounted listener's own
    /// continuations (a persist success) are re-posted to it by the relay.
    pub self_events: Vec<String>,
}

/// Single-threaded interior-mutability cell for codegen scratch state.
///
/// Wraps a [`RefCell`] but is declared `Sync` so the enclosing
/// [`TypeScriptBackend`] can still satisfy the `Backend: Send + Sync`
/// bound. The `unsafe impl` is sound because codegen is single-threaded:
/// the backend is built and driven on one thread per `generate` call and
/// is never shared concurrently, so the `RefCell` is never accessed from
/// two threads. This replaces the former `std::sync::Mutex` fields, whose
/// locking was pure overhead given that invariant.
#[derive(Debug, Default)]
pub struct CodegenCell<T>(std::cell::RefCell<T>);

// SAFETY: codegen runs single-threaded; the wrapped `RefCell` is never
// touched from more than one thread, so exposing it as `Sync` cannot
// introduce a data race. Required only to keep `Backend: Send + Sync`.
unsafe impl<T: Send> Sync for CodegenCell<T> {}

impl<T> CodegenCell<T> {
    pub(crate) fn new(value: T) -> Self {
        Self(std::cell::RefCell::new(value))
    }

    /// Replace the stored value, mirroring `*mutex.lock() = value`.
    pub(crate) fn set(&self, value: T) {
        *self.0.borrow_mut() = value;
    }

    /// Borrow the stored value, mirroring `mutex.lock()` for read access.
    pub(crate) fn borrow(&self) -> std::cell::Ref<'_, T> {
        self.0.borrow()
    }
}

impl CodegenCell<Vec<Vec<(Option<String>, String)>>> {
    fn push(&self, scope: Vec<(Option<String>, String)>) {
        self.0.borrow_mut().push(scope);
    }

    fn pop(&self) {
        self.0.borrow_mut().pop();
    }
}

impl TypeScriptBackend {
    /// The preferred identifier of a `let`-bound name.
    pub(crate) fn let_ident(name: &str) -> String {
        format!("let__{name}")
    }

    pub(crate) fn with_local_scope<R>(&self, f: impl FnOnce() -> R) -> R {
        self.local_scopes.push(Vec::new());
        let out = f();
        self.local_scopes.pop();
        out
    }

    fn fresh_local_ident(&self, preferred: &str, shadowed: Option<&str>) -> String {
        let scopes = self.local_scopes.borrow();
        let scope_count = scopes.len();
        let reserved: BTreeSet<&str> = scopes
            .iter()
            .enumerate()
            .flat_map(|(index, scope)| {
                scope.iter().filter(move |(authored, _)| {
                    shadowed.is_none()
                        || index + 1 == scope_count
                        || authored.as_deref() != shadowed
                })
            })
            .map(|(_, emitted)| emitted.as_str())
            .chain(
                crate::codegen::operator::CORE_OPERATOR_IMPORTS
                    .iter()
                    .flat_map(|dependencies| dependencies.imports.iter().copied()),
            )
            .collect();
        if !reserved.contains(preferred) {
            return preferred.to_string();
        }
        for suffix in 1usize.. {
            let candidate = format!("{preferred}__{suffix}");
            if !reserved.contains(candidate.as_str()) {
                return candidate;
            }
        }
        unreachable!()
    }

    pub(crate) fn bind_local(&self, authored: &str, is_let: bool) -> String {
        self.bind_local_after(authored, is_let, |_| {})
    }

    pub(crate) fn bind_local_after(
        &self,
        authored: &str,
        is_let: bool,
        initialize: impl FnOnce(&str),
    ) -> String {
        let preferred = if is_let {
            Self::let_ident(authored)
        } else {
            authored.to_string()
        };
        let emitted = self.fresh_local_ident(&preferred, (!is_let).then_some(authored));
        initialize(&emitted);
        self.local_scopes
            .0
            .borrow_mut()
            .last_mut()
            .expect("local binding requires a scope")
            .push((Some(authored.to_string()), emitted.clone()));
        emitted
    }

    /// Compile declarations and references against the same assigned identifiers.
    pub(crate) fn with_locals<R>(
        &self,
        names: &[String],
        is_let: bool,
        f: impl FnOnce() -> R,
    ) -> R {
        self.with_locals_assigned(names, is_let, |_| f())
    }

    pub(crate) fn with_locals_assigned<R>(
        &self,
        names: &[String],
        is_let: bool,
        f: impl FnOnce(&[String]) -> R,
    ) -> R {
        self.with_local_scope(|| {
            let emitted = names
                .iter()
                .map(|name| self.bind_local(name, is_let))
                .collect::<Vec<_>>();
            f(&emitted)
        })
    }

    pub(crate) fn reserve_identifier<'a>(&self, identifier: &'a str) -> &'a str {
        if let Some(scope) = self.local_scopes.0.borrow_mut().last_mut() {
            scope.push((None, identifier.to_string()));
        }
        identifier
    }

    pub(crate) fn with_operand_locals<R>(
        &self,
        operands: &[OirExpr],
        flavor: crate::codegen::expr::BindingFlavor,
        bound: &[String],
        f: impl FnOnce() -> R,
    ) -> R {
        self.with_local_scope(|| {
            for operand in operands {
                self.reserve_expr_free_identifiers(operand, flavor, bound);
            }
            f()
        })
    }

    pub(crate) fn with_generated_locals<R>(
        &self,
        preferred: &[&str],
        f: impl FnOnce(&[String]) -> R,
    ) -> R {
        self.with_local_scope(|| {
            let mut names = Vec::new();
            for name in preferred {
                let emitted = self.fresh_local_ident(name, None);
                self.local_scopes
                    .0
                    .borrow_mut()
                    .last_mut()
                    .unwrap()
                    .push((None, emitted.clone()));
                names.push(emitted);
            }
            f(&names)
        })
    }

    /// The identifier a local read compiles to: the innermost binder of `name` decides.
    pub(crate) fn local_ident(&self, name: &str) -> String {
        self.bound_local_ident(name)
            .unwrap_or_else(|| name.to_string())
    }

    pub(crate) fn bound_local_ident(&self, name: &str) -> Option<String> {
        let scopes = self.local_scopes.borrow();
        scopes.iter().rev().find_map(|scope| {
            scope
                .iter()
                .rev()
                .find(|(authored, _)| authored.as_deref() == Some(name))
                .map(|(_, emitted)| emitted.clone())
        })
    }
}

impl<T: Default> CodegenCell<T> {
    /// Take the stored value, leaving the default behind.
    pub(crate) fn take(&self) -> T {
        std::mem::take(&mut *self.0.borrow_mut())
    }
}

impl<T: Clone> CodegenCell<T> {
    /// Clone the stored value, mirroring `mutex.lock().clone()`.
    pub(crate) fn snapshot(&self) -> T {
        self.0.borrow().clone()
    }
}

/// Whether a transition's guard or its effects are being compiled: effects read the committed state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionPhase {
    Guard,
    Effect,
}

/// The transition whose guard or effects are being compiled (`@toState`, post-commit `state`).
#[derive(Debug, Clone)]
pub struct TransitionScope {
    pub to: String,
    pub phase: TransitionPhase,
}

/// A project-specific component mapping loaded from patterns.json
#[derive(Debug, Clone)]
pub struct ExtraComponentMapping {
    /// React component name (e.g., "SignatureCapture")
    pub component: String,
    /// Pattern category (e.g., "form", "display")
    pub category: String,
}

/// Server framework choice for backend code generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ServerFramework {
    /// Generate Express.js server code (default, backward-compatible)
    #[default]
    Express,
    /// Generate Hono server code
    Hono,
}

/// Who runs the generated app's execution steps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum HostMode {
    /// The generated per-event handlers and hooks (default).
    #[default]
    Generated,
    /// `@almadar/kernel` runs every step; only the host glue is generated.
    Kernel,
}

/// TypeScript code generation backend
pub struct TypeScriptBackend {
    /// Use strict TypeScript mode
    pub strict: bool,
    /// Generate JSDoc comments
    pub jsdoc: bool,
    /// Target: "client", "server", or "full"
    pub target: String,
    /// Extra component mappings from project patterns.json (pattern_type → mapping)
    pub extra_mappings: Option<HashMap<String, ExtraComponentMapping>>,
    /// Schema language code (e.g. "en", "ar", "sl") — drives i18n locale/direction in generated App.tsx
    pub schema_language: String,
    /// When true, inject structured logging (createLogger calls) into generated hooks and handlers
    pub dev_logs: bool,
    /// Server framework for backend code generation (Express or Hono)
    pub server_framework: ServerFramework,
    /// Whether the generated handlers and hooks, or the embedded kernel, run the app.
    pub host: HostMode,
    /// The resolved schema, bundled into the client for its browser-store legs.
    pub browser_schema: Option<orbital_core_base::schema::types::OrbitalSchema>,
    /// Gap #13 — current `Orbital.Trait` scope used to qualify event-string
    /// codegen in render-ui props. Set in `generate_trait_component` before
    /// pattern emission, cleared after. `None` outside a trait View. Held in
    /// a [`CodegenCell`] (single-threaded interior mutability) so the backend
    /// still satisfies the `Backend: Send + Sync` bound. Public so external
    /// constructors can leave it at the default `None` via
    /// `..TypeScriptBackend::default()`; consumers should never set this directly.
    pub current_trait_scope: CodegenCell<Option<String>>,
    /// Set while a transition's guard or effects compile; `None` elsewhere (ticks, renders).
    pub current_transition: CodegenCell<Option<TransitionScope>>,
    /// Authored-to-emitted bindings, innermost last; `None` reserves a generated or operand identifier.
    pub local_scopes: CodegenCell<Vec<Vec<(Option<String>, String)>>>,
    /// Gap #13 sibling — resolves an `is_event_name_prop` value to the scope
    /// that actually owns it, for embedded/hoisted chrome whose bare event
    /// belongs to whatever trait embeds it, not to itself (an embedded
    /// `ButtonRender`'s `action` config names an event ChatRoom reacts to —
    /// the runtime's embed routing delivers it to the HOST, never to a
    /// subscription on the embedded trait's own bus key). Ordered
    /// innermost-first: `(event set, scope)` for the current trait, then for
    /// its `host_trait`, then that trait's host, and so on. `qualify_event`
    /// picks the first entry whose event set contains the value; an
    /// unresolved value (system events like `NOTIFY`, or a value that's
    /// genuinely nobody's declared transition) falls through to
    /// `current_trait_scope` unchanged. Set alongside `current_trait_scope`;
    /// same lifecycle, same [`CodegenCell`] pattern.
    pub current_event_scope_chain: CodegenCell<Vec<(HashSet<String>, String)>>,
    /// Phase E (element-type inference) — the module's entity catalog,
    /// populated at `generate_internal` start so every `CodegenContext`
    /// construction can hand it to `infer_array_element_type_ts` for
    /// `@<EntityName>` source resolution and Reference dereferencing.
    /// Same [`CodegenCell`] pattern as `current_trait_scope`.
    pub entity_catalog: CodegenCell<HashMap<String, orbital_core_base::ir::OirEntity>>,
    /// Phase E — trait-scoped linked-entity name. Set in
    /// `generate_trait_component`, `generate_server_handlers`, and the
    /// per-trait hook codegen before each `compile_sexpr*` call. Read
    /// into `CodegenContext.linked_entity_name` so `@entity` source
    /// inference resolves to the right entity.
    pub current_linked_entity: CodegenCell<Option<String>>,
    /// V4 identity — dual-carry id sibling of [`current_linked_entity`]. Set
    /// alongside it from `trait_def.linked_entity_id`. Deep effect-codegen join
    /// sites read this to resolve `@entity` to its entity by id (id-first,
    /// name-fallback) so a call-site entity rename never breaks the join.
    pub current_linked_entity_id: CodegenCell<Option<String>>,
    /// V4 leverage-ids — sibling of [`current_linked_entity_id`] for
    /// NON-linked entity tokens (positional `persist`/`fetch`/`ref`/`deref`/
    /// `swap` args). Carries the current trait's `entity_ref_ids` side-map
    /// (entity token NAME → entity id). Set alongside `current_linked_entity_id`
    /// at every trait/handler entry. Entity token codegen sites read this to
    /// resolve a token to its entity by id (id-first, name-fallback), so a
    /// call-site entity rename never breaks the collection/type join. `None`
    /// or a missing key → byte-identical to the pre-flip name-only path.
    pub current_entity_ref_ids: CodegenCell<Option<orbital_core_base::ir::OirIdMap>>,
    /// V4 leverage-ids — `@trait.X` render-embed resolution. Precomputed at
    /// trait entry from the current trait's `trait_embed_ids` side-map (embed
    /// token NAME → trait id) by resolving each id to the CURRENT declaration
    /// name via [`OirModule::resolve_trait_ref`] — so the map is embed token
    /// NAME → current display name. `parse_trait_binding` reads it to emit
    /// `<CurrentNameView />` for a renamed sibling. Absent/missing key →
    /// byte-identical to today's raw-token path.
    pub current_trait_embed_names: CodegenCell<Option<HashMap<String, String>>>,
    /// Phase E — current event's narrowed payload schema. Set in each
    /// per-event handler codegen block so `@payload.<F>` source
    /// inference resolves to real types.
    pub current_payload_schema: CodegenCell<Option<orbital_core_base::ir::OirTypeMap>>,
    /// The current trait's declared config knob types (see `CodegenContext::current_config_schema`).
    pub current_config_schema: CodegenCell<Option<orbital_core_base::ir::OirTypeMap>>,
    /// Extra JSX attributes for the NEXT pattern root emitted by
    /// `generate_pattern_from_registry` (taken on entry, so nested children
    /// never see them). Set for a compiled self-overlay modal branch so its
    /// root takes the slot presence (`isOpen` / `onExited`).
    pub pending_root_props: CodegenCell<Option<Vec<String>>>,
    /// Target-specific client effect emitter (Navigate + EventBus arms).
    /// Defaults to `WebClientEffectEmitter`; swap for a mobile impl to
    /// produce React-Navigation + native-bus output from the same codegen.
    pub client_effect_emitter: CodegenCell<Box<dyn crate::codegen::target::ClientEffectEmitter>>,
    /// Call-site payload capture map: child-trait name → `[(config knob,
    /// payload field path)]`. Populated at `generate_internal` start by
    /// scanning every trait's config-field defaults for the
    /// `@callsitePayload.<field>` binding. When a parent trait's render effect
    /// embeds `<XView />`, the emit site reads this to pass
    /// `config={{ <knob>: lastPayload?.<field> }}` — resolving the capture
    /// against the COMPOSING View's event payload, per the call-site semantics.
    // (knob, payload field, knob's declared TS type — the emit asserts the
    // wide payload read down to the member type so the child's Config prop
    // typechecks; "EventPayloadValue" when the knob is undeclared)
    pub trait_callsite_captures: CodegenCell<HashMap<String, Vec<(String, String, String)>>>,
    /// Trait names with a NESTED `@callsitePayload.<path>` reference that no
    /// whole-value pair in `trait_callsite_captures` covers — inside an
    /// s-expression config default/value (`(if (= @callsitePayload.data.status
    /// "resolved") …)`), or inside a transition's/tick's effect body (the
    /// already-lowered `OirBinding{root: Local("callsitePayload")}` form —
    /// see `trait_effects_reference_callsite_payload`). For a flagged trait,
    /// `embedded_view_config_attr` additionally forwards the WHOLE composing
    /// payload (`callsitePayload: lastPayload`) so the child can read any
    /// depth back via `config?.callsitePayload?.<path>`
    /// (`compile_callsite_payload_ref`, codegen/expr.rs) instead of the
    /// single typed knob a pair provides.
    pub trait_callsite_payload_flagged: CodegenCell<HashSet<String>>,
    /// Trait name → its config knobs whose value is a call-site capture (any
    /// `@callsitePayload.<path>` inside). The inline phase keeps these as
    /// `@config.<knob>` in the child body; the server, which has no composing
    /// payload, compiles the captured value itself (absent payload) instead
    /// of the `undefined` every other leftover `@config` gets.
    pub trait_callsite_knob_values: CodegenCell<HashMap<String, orbital_core_base::ir::OirObject>>,
    /// §60 — mount-racy `listens` edges: qualified bus key → listening trait
    /// names. An edge is racy when the listening trait is embedded in a render
    /// tree produced by a transition of the SOURCE trait on the trigger event
    /// itself, so the emit that should feed it is the same emit that mounts it
    /// — the subscription cannot exist yet. The generated bridge holds such a
    /// delivery until its known subscriber mounts. `BTreeMap`/`BTreeSet` keep
    /// the emitted table order-stable.
    pub racy_listens: CodegenCell<BTreeMap<String, BTreeSet<String>>>,
    /// Some trait reads `@event`/`@prevEvents`/`@prevStates`: hooks carry the dispatch through the bus.
    pub dispatch_scope: CodegenCell<bool>,
    /// G-ORB-055 — `listens` edges into traits that take server round trips,
    /// keyed by the bus key their hooks subscribe to. The bridge posts such a
    /// delivery to the listener's orbital route when no hook for it is mounted.
    pub off_page_listens: CodegenCell<BTreeMap<String, Vec<OffPageListen>>>,
    /// Some trait dispatches to the server; without one the bridge opens no SSE stream.
    pub app_has_server_leg: CodegenCell<bool>,
    /// `Trait\u{0}EVENT` keys whose leg runs against the browser store.
    pub browser_legs: CodegenCell<BTreeSet<String>>,
    /// The program calls a browser-only service: the browser store answers it.
    pub browser_services: CodegenCell<bool>,
    /// The program runs a keyless `http` in the browser: the browser store sends it with the browser's `fetch`.
    pub browser_http: CodegenCell<bool>,
    /// The program's declared locales, whose catalogs the browser store translates with.
    pub browser_locales: CodegenCell<Vec<String>>,
    /// `(module, name)` value imports the trait view being generated needs: rich-prop decoders and
    /// `toPayloadValue` (G-CROSS-131). Taken when the view is assembled.
    pub view_value_imports: CodegenCell<BTreeSet<(String, String)>>,
}

/// Every `@callsitePayload.<field>` path referenced ANYWHERE inside an
/// `OirValue` tree (an s-expression default is a nested array/object, not
/// just a top-level string — `orbital_core::schema::callsite_payload_path`
/// only matches a bare string, so a caller must walk first). One owner,
/// shared by the capture-scan's nested-reference flag above and
/// `sexpr_default_is_resolvable` (`backend/client/trait_logic.rs`, reached
/// via that module's `use crate::backend::*;`).
pub(crate) fn nested_callsite_payload_fields(v: &OirValue, out: &mut Vec<String>) {
    match v {
        OirValue::String(s) => {
            if let Some(field) = orbital_core_base::schema::callsite_payload_path(s) {
                out.push(field.to_string());
            }
        }
        OirValue::Array(a) => a
            .iter()
            .for_each(|x| nested_callsite_payload_fields(x, out)),
        OirValue::Object(o) => o
            .values()
            .for_each(|x| nested_callsite_payload_fields(x, out)),
        _ => {}
    }
}

/// Whether ANY transition's or tick's effect body inside `trait_def`
/// contains an `@callsitePayload.<path>` reference. Effect/tick bodies
/// compile through the typed `OirExpr`/`OirBinding` tree — by resolve time
/// an `@callsitePayload.X` there is already lowered to
/// `OirBinding { root: OirBindingRoot::Local("callsitePayload"), path }`,
/// not the raw `OirValue::String` `nested_callsite_payload_fields` walks —
/// so this walks the serialized JSON instead (mirrors `config_read_keys`'s
/// established technique, `backend/shared.rs`): the externally-tagged serde
/// shape for a newtype enum variant renders `OirBindingRoot::Local(name)` as
/// `{"local": name}`, uniform across every effect/expr node kind without a
/// typed visitor per `OirExpr` variant.
fn trait_effects_reference_callsite_payload(trait_def: &OirTrait) -> bool {
    fn walk(v: &serde_json::Value) -> bool {
        match v {
            serde_json::Value::String(s) => {
                orbital_core_base::schema::callsite_payload_path(s).is_some()
            }
            serde_json::Value::Object(map) => {
                let is_local_callsite = map
                    .get("root")
                    .and_then(|r| r.as_object())
                    .and_then(|r| r.get("local"))
                    .and_then(|l| l.as_str())
                    == Some("callsitePayload");
                is_local_callsite || map.values().any(walk)
            }
            serde_json::Value::Array(items) => items.iter().any(walk),
            _ => false,
        }
    }
    serde_json::to_value(&trait_def.transitions).is_ok_and(|v| walk(&v))
        || serde_json::to_value(&trait_def.ticks).is_ok_and(|v| walk(&v))
}

impl Default for TypeScriptBackend {
    fn default() -> Self {
        Self {
            strict: true,
            jsdoc: true,
            target: "full".to_string(),
            extra_mappings: None,
            schema_language: "en".to_string(),
            dev_logs: false,
            server_framework: ServerFramework::default(),
            host: HostMode::default(),
            browser_schema: None,
            current_trait_scope: CodegenCell::new(None),
            current_transition: CodegenCell::new(None),
            local_scopes: CodegenCell::new(Vec::new()),
            current_event_scope_chain: CodegenCell::new(Vec::new()),
            entity_catalog: CodegenCell::new(HashMap::new()),
            current_linked_entity: CodegenCell::new(None),
            current_linked_entity_id: CodegenCell::new(None),
            current_entity_ref_ids: CodegenCell::new(None),
            current_trait_embed_names: CodegenCell::new(None),
            current_payload_schema: CodegenCell::new(None),
            current_config_schema: CodegenCell::new(None),
            pending_root_props: CodegenCell::new(None),
            client_effect_emitter: CodegenCell::new(Box::new(
                crate::codegen::target::WebClientEffectEmitter,
            )),
            trait_callsite_captures: CodegenCell::new(HashMap::new()),
            trait_callsite_payload_flagged: CodegenCell::new(HashSet::new()),
            trait_callsite_knob_values: CodegenCell::new(HashMap::new()),
            racy_listens: CodegenCell::new(BTreeMap::new()),
            dispatch_scope: CodegenCell::new(false),
            off_page_listens: CodegenCell::new(BTreeMap::new()),
            app_has_server_leg: CodegenCell::new(false),
            browser_legs: CodegenCell::new(BTreeSet::new()),
            browser_services: CodegenCell::new(false),
            browser_http: CodegenCell::new(false),
            browser_locales: CodegenCell::new(Vec::new()),
            view_value_imports: CodegenCell::new(BTreeSet::new()),
        }
    }
}

/// File type for internal tracking
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) enum GeneratedFileType {
    Entity,
    Trait,
    Page,
    Route,
    Hook,
    Handler,
    Test,
    Barrel,
    Config,
}

/// Internal generated file with type info
pub(crate) struct InternalFile {
    pub(crate) path: String,
    pub(crate) content: String,
    #[allow(dead_code)]
    pub(crate) file_type: GeneratedFileType,
}

impl InternalFile {
    pub(crate) fn new(
        path: impl Into<String>,
        content: impl Into<String>,
        file_type: GeneratedFileType,
    ) -> Self {
        Self {
            path: path.into(),
            content: content.into(),
            file_type,
        }
    }

    pub(crate) fn into_generated_file(self) -> GeneratedFile {
        GeneratedFile::new(self.path, self.content)
    }
}

impl TypeScriptBackend {
    /// Compile `f` with `to`/`phase` as the current transition, restoring the previous scope after.
    pub(crate) fn in_transition<R>(
        &self,
        to: &str,
        phase: TransitionPhase,
        f: impl FnOnce() -> R,
    ) -> R {
        let previous = self.current_transition.snapshot();
        self.current_transition.set(Some(TransitionScope {
            to: to.to_string(),
            phase,
        }));
        let out = f();
        self.current_transition.set(previous);
        out
    }

    pub fn new() -> Self {
        Self::default()
    }

    /// Mobile entry point — render a single pattern via a `ComponentRenderer`.
    ///
    /// Web callers use `WebComponentRenderer`; a React-Native shell supplies
    /// its own impl.  The backend's expr/binding/type codegen is reused
    /// unchanged regardless of which renderer is provided.
    pub fn render_pattern_with(
        &self,
        renderer: &dyn crate::codegen::target::ComponentRenderer,
        pattern_type: &str,
        config: &orbital_core_base::ir::OirObject,
        linked_entity: Option<&str>,
        entity_field_types: Option<&HashMap<String, EntityFieldInfo>>,
    ) -> String {
        renderer.render_component(
            self,
            pattern_type,
            config,
            linked_entity,
            entity_field_types,
        )
    }

    /// Mobile entry point — generate the target-agnostic logic-hook source for
    /// one trait.  Returns the file path and source content; the caller writes
    /// them at whatever location the shell convention requires.
    pub fn trait_logic_hook_source(
        &self,
        trait_def: &OirTrait,
        module: &OirModule,
    ) -> (String, String) {
        let f = self.generate_trait_logic_hook(trait_def, module);
        (f.path, f.content)
    }

    /// Mobile entry point — shared event protocol types (EventResponse, per-trait
    /// event payload maps).  Returns the file content; the caller places it at the
    /// target path (`packages/shared/src/types/events.ts`).
    pub fn shared_event_types_source(&self, module: &OirModule) -> String {
        self.generate_shared_event_types(module).content
    }

    /// Generate all TypeScript code from an OIR module (internal)
    fn generate_internal(&self, module: &OirModule) -> Vec<InternalFile> {
        let mut files = Vec::new();

        // Dedup entities by name. `[runtime]` entities are now allowed to
        // share a name across orbitals (they're per-orbital singletons with
        // no persistence collection — see `orbital-core/src/ir/validation.rs`
        // for the runtime-exemption rationale). Codegen emits one declaration
        // per distinct entity name, so collapse duplicates here once instead
        // of in every per-entity generator.
        let entities_dedup: Vec<OirEntity> = module.distinct_entities();
        let entities = &entities_dedup[..];

        // Phase E plumbing — populate the backend's entity catalog so
        // every CodegenContext built later in this run can hand it to
        // `infer_array_element_type_ts` for `@<EntityName>` source
        // resolution and `Reference { entity }` dereferencing. Replaced
        // (not merged) so each module's run starts clean.
        {
            let mut catalog = HashMap::new();
            for e in entities {
                catalog.insert(e.name.clone(), e.clone());
            }
            self.entity_catalog.set(catalog);
        }

        // Call-site payload capture map — child-trait name → [(knob, field)].
        // A trait config-field default of `@callsitePayload.<field>` means the
        // knob's value is captured from the COMPOSING effect's event payload;
        // the `<XView />` emit site injects `config={{ knob: lastPayload?.field }}`.
        {
            let mut captures: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
            for t in &module.traits {
                let mut pairs: Vec<(String, String, String)> = Vec::new();
                // The capture lands on the folded declared-config default
                // (the knob's value); a call-site-only knob lands on `config`.
                // Scan both, preferring the declared default.
                for source in [t.declared_config_defaults.as_ref(), t.config.as_ref()] {
                    let Some(cfg) = source else { continue };
                    for (knob, value) in cfg {
                        if pairs.iter().any(|(k, _, _)| k == knob) {
                            continue;
                        }
                        if let OirValue::String(s) = value {
                            if let Some(field) = orbital_core_base::schema::callsite_payload_path(s) {
                                let ts_type = t
                                    .declared_config_schema
                                    .as_ref()
                                    .and_then(|schema| schema.get(knob))
                                    .map(|f| {
                                        self.map_type_with_enum(&f.field_type, f.values.as_ref())
                                    })
                                    .unwrap_or_else(|| "EventPayloadValue".to_string());
                                pairs.push((knob.clone(), field.to_string(), ts_type));
                            }
                        }
                    }
                }
                if !pairs.is_empty() {
                    pairs.sort();
                    captures.insert(t.name.clone(), pairs);
                }
            }

            // Nested-reference flag (see the field doc on
            // `trait_callsite_payload_flagged`): a trait needs the whole
            // composing payload forwarded when some `@callsitePayload.<path>`
            // reference exists that the pairs above — top-level WHOLE-value
            // matches only — don't cover. Effect/tick bodies never produce a
            // pair at all (pairs only ever come from a config default/value),
            // so any occurrence there flags unconditionally.
            let mut flagged: HashSet<String> = HashSet::new();
            for t in &module.traits {
                if trait_effects_reference_callsite_payload(t) {
                    flagged.insert(t.name.clone());
                    continue;
                }
                let mut needed: Vec<String> = Vec::new();
                for source in [t.declared_config_defaults.as_ref(), t.config.as_ref()] {
                    let Some(cfg) = source else { continue };
                    for v in cfg.values() {
                        nested_callsite_payload_fields(v, &mut needed);
                    }
                }
                let pairs = captures.get(&t.name);
                let uncovered = needed
                    .iter()
                    .any(|f| !pairs.is_some_and(|p| p.iter().any(|(_, pf, _)| pf == f)));
                if uncovered {
                    flagged.insert(t.name.clone());
                }
            }
            self.trait_callsite_payload_flagged.set(flagged);

            let mut knob_values: HashMap<String, orbital_core_base::ir::OirObject> = HashMap::new();
            for t in &module.traits {
                // The call-site value wins over the declared default.
                for source in [t.declared_config_defaults.as_ref(), t.config.as_ref()] {
                    let Some(cfg) = source else { continue };
                    for (knob, v) in cfg {
                        let mut paths = Vec::new();
                        nested_callsite_payload_fields(v, &mut paths);
                        if !paths.is_empty() {
                            knob_values
                                .entry(t.name.clone())
                                .or_default()
                                .insert(knob.clone(), v.clone());
                        }
                    }
                }
            }
            self.trait_callsite_knob_values.set(knob_values);

            self.trait_callsite_captures.set(captures);
        }

        // §60 — mount-racy `listens` edges. An edge (source S, event E,
        // target T) is racy when T is embedded in a render tree S produces
        // ON E: the emit that should feed T is the same emit that mounts it,
        // and T's subscription is emitted inside T's own component, so it
        // cannot exist yet. The runtime path is immune because it subscribes
        // every page-bound trait once at page level; the compiled path holds
        // the one delivery in the bridge until T mounts.
        self.racy_listens.set(self.compute_racy_listens(module));
        self.dispatch_scope
            .set(crate::codegen::effect::shared::module_reads_dispatch_scope(
                module,
            ));
        self.off_page_listens
            .set(self.compute_off_page_listens(module));
        self.app_has_server_leg
            .set(self.compute_app_has_server_leg(module));
        self.browser_legs.set(Self::compute_browser_legs(module));
        self.browser_services
            .set(!module.browser_services.is_empty());
        self.browser_http.set(Self::module_runs_client_http(module));
        self.browser_locales.set(module.locales.clone());

        // 1. Generate shared package - entity types + event response types + package.json
        files.push(self.generate_shared_entities(entities, &module.named_types));
        files.push(self.generate_shared_schemas(entities, &module.named_types));
        // Event protocol types — generated for both backends. Express has always
        // emitted these; Hono used to inline EventRequest/EventResponse/EmittedEvent
        // into useOrbitalBridge.tsx and skip the shared file, but the per-trait
        // server handlers still need `import type { EmittedEvent } from '@app/shared'`
        // when cascade emit effects run, so Hono now also emits the shared file.
        // The inlined client-side definitions stay (harmless duplication; the
        // useOrbitalBridge hook is self-contained).
        files.push(self.generate_shared_event_types(module));
        // Per-trait Config interfaces derived from each atom's `config {}`
        // block. Emitted for both backends so client code can consume them.
        files.push(self.generate_shared_trait_configs(module));
        // Shared index: Hono version omits events.ts re-export
        match (self.host, self.server_framework) {
            (HostMode::Kernel, _) => {
                files.push(self.generate_shared_index_kernel());
                files.extend(self.generate_kernel_program());
            }
            (HostMode::Generated, ServerFramework::Hono) => files.push(self.generate_shared_index_hono()),
            (HostMode::Generated, ServerFramework::Express) => files.push(self.generate_shared_index()),
        }
        match self.server_framework {
            ServerFramework::Hono => files.push(self.generate_shared_package_json_hono()),
            ServerFramework::Express => files.push(self.generate_shared_package_json()),
        }

        // Build the module's embedded-trait set ONCE — flat set of trait
        // names that are referenced via `@trait.X` by some sibling
        // layout's render-ui anywhere in this module. Used by:
        //   - `generate_trait_component` to skip the standalone
        //     `<UISlotComponent>` wrap (iframe semantics: the inlined
        //     view at the `@trait.X` site owns the rendering).
        //   - `generate_page_feature` to skip emitting a standalone
        //     `<{Name}View />` on the page when the layout's view
        //     already inlines that view internally — without the
        //     skip the page double-renders the atom.
        // Mirrors `collectEmbeddedTraits` in
        // `packages/almadar-ui/runtime/embedded-traits.ts`.
        let embedded_traits = orbital_core_base::ir::build_embedded_trait_set(module);

        // 2. Generate client trait hooks (logic) + components (presentation)
        if self.host == HostMode::Kernel {
            if self.target == "client" || self.target == "full" {
                files.extend(self.generate_kernel_client(module));
            }
        } else if self.target == "client" || self.target == "full" {
            for trait_def in &module.traits {
                // Logic hook + Presentation component (idiomatic React)
                files.push(self.generate_trait_logic_hook(trait_def, module));
                files.push(self.generate_trait_component(trait_def, module, &embedded_traits));
                // Re-export bridge: use{Trait}.tsx → use{Trait}Logic.tsx
                // Overwrites legacy monolithic hooks that may exist from older compiler versions
                let bridge_code = format!(
                    "/**\n * Re-export bridge from logic hook.\n * @generated from schema\n */\nexport * from './use{}Logic';\n",
                    trait_def.name
                );
                files.push(InternalFile::new(
                    format!("packages/client/src/hooks/traits/use{}.tsx", trait_def.name),
                    bridge_code,
                    GeneratedFileType::Hook,
                ));
            }
            files.push(self.generate_traits_index(&module.traits));
            files.push(self.generate_components_index(&module.traits));
            // Generate orbital bridge hook (Phase 5: replaces server bridge)
            match self.server_framework {
                ServerFramework::Hono => files.push(self.generate_orbital_bridge_hook_hono()),
                ServerFramework::Express => files.push(self.generate_orbital_bridge_hook()),
            }
            if self.dispatch_scope.snapshot() {
                files.push(self.generate_dispatch_context());
            }
            files.extend(self.generate_browser_schema_file(module));
            files.extend(Self::generate_browser_services_file(module));
            files.extend(Self::generate_browser_http_file(module));
        }

        // 3. Generate client pages/features
        if self.host == HostMode::Generated && (self.target == "client" || self.target == "full") {
            for page in &module.pages {
                files.extend(self.generate_page_feature(page, module, &embedded_traits));
            }
            // Generate App.tsx with routes
            files.push(self.generate_app_tsx(module));
        }

        // 4. Generate server event handlers (NOT CRUD routes)
        // All data operations go through trait event handlers with guard enforcement
        if self.host == HostMode::Kernel {
            if self.target == "server" || self.target == "full" {
                files.extend(self.generate_kernel_server());
                if let Some(f) = self.generate_access_policies(entities) {
                    files.push(f);
                }
                files.push(self.generate_sse_module(entities, false));
                files.push(self.generate_viewer_module(entities, ServerFramework::Express));
            }
        } else if self.target == "server" || self.target == "full" {
            let server_ticks = server::ticks::module_has_server_ticks(module);
            match self.server_framework {
                ServerFramework::Hono => {
                    for trait_def in &module.traits {
                        files.extend(self.generate_trait_event_handlers_hono(trait_def, module));
                    }
                    files.push(self.generate_orbital_events_route_hono(module));
                    files.push(
                        self.generate_event_routes_registration_hono(&module.traits, server_ticks),
                    );
                    files.push(self.generate_server_event_listeners_hono(&module.traits));
                    files.push(self.generate_seed_mock_data_hono(entities));
                    if let Some(f) = self.generate_access_policies(entities) {
                        files.push(f);
                    }
                    files.push(self.generate_sse_module_hono(entities, server_ticks));
                    files.push(self.generate_viewer_module(entities, ServerFramework::Hono));
                    files.extend(self.generate_server_i18n_module(&module.locales));
                    files.extend(self.generate_server_ticks_modules(module));
                }
                ServerFramework::Express => {
                    for trait_def in &module.traits {
                        files.extend(self.generate_trait_event_handlers(trait_def, module));
                    }
                    files.push(self.generate_orbital_events_route(module));
                    files.push(
                        self.generate_event_routes_registration(&module.traits, server_ticks),
                    );
                    // Phase 7: Generate server-side event listener registrations
                    files.push(self.generate_server_event_listeners(&module.traits));
                    // Generate mock data seeding based on schema entities
                    files.push(self.generate_seed_mock_data(entities));
                    if let Some(f) = self.generate_access_policies(entities) {
                        files.push(f);
                    }
                    files.push(self.generate_sse_module(entities, server_ticks));
                    files.push(self.generate_viewer_module(entities, ServerFramework::Express));
                    files.extend(self.generate_server_i18n_module(&module.locales));
                    files.extend(self.generate_server_ticks_modules(module));
                }
            }
        }

        // 5. Generate tests for generated code (mode-aware)
        let test_files = if self.host == HostMode::Kernel {
            Vec::new()
        } else {
            crate::generators::generate_tests(module)
        };
        for test_file in test_files {
            // Filter tests based on target mode
            let is_client_test = test_file.path.contains("packages/client/")
                || test_file.path.contains("packages/shared/");
            let is_server_test = test_file.path.contains("packages/server/");

            let should_include = match self.target.as_str() {
                "client" => is_client_test,
                "server" => is_server_test,
                _ => true, // "full" includes all
            };

            if should_include {
                files.push(InternalFile::new(
                    test_file.path,
                    test_file.content,
                    GeneratedFileType::Test,
                ));
            }
        }

        // 6. Generate theme CSS and config (client-side)
        if (self.target == "client" || self.target == "full") && !module.themes.is_empty() {
            // Generate CSS file for each theme (in src/themes/ to match shell structure)
            for theme in &module.themes {
                let css = generate_theme_css(theme);
                files.push(InternalFile::new(
                    format!("packages/client/src/themes/{}.css", theme.name),
                    css,
                    GeneratedFileType::Config,
                ));
            }

            // Generate consolidated theme config
            let config =
                generate_all_themes_config_ts(&module.themes, module.default_theme.as_deref());
            files.push(InternalFile::new(
                "packages/client/src/generated/theme-config.ts",
                config,
                GeneratedFileType::Config,
            ));

            // Generate CSS imports file for easy inclusion
            let mut imports_css = String::new();
            imports_css.push_str("/* Generated theme imports - add to index.css */\n\n");
            for url in theme_font_imports(&module.themes) {
                imports_css.push_str(&format!("@import url(\"{}\");\n", url));
            }
            for theme in &module.themes {
                imports_css.push_str(&format!("@import '../themes/{}.css';\n", theme.name));
            }
            files.push(InternalFile::new(
                "packages/client/src/generated/theme-imports.css",
                imports_css,
                GeneratedFileType::Config,
            ));

            // Generate main.tsx with theme provider wired up
            let default_theme = &module.themes[0].name;
            files.push(InternalFile::new(
                "packages/client/src/main.tsx",
                self.generate_main_tsx_with_theme(default_theme),
                GeneratedFileType::Config,
            ));

            // Generate index.css with theme imports
            files.push(InternalFile::new(
                "packages/client/src/index.css",
                self.generate_index_css_with_themes(&module.themes),
                GeneratedFileType::Config,
            ));
        }

        // 7. Generate service clients (server-side, as services run on server).
        // Always emitted so the template server can unconditionally import
        // `invokedServices` for the boot-time credential check.
        if self.target == "server" || self.target == "full" {
            let invoked_services = crate::codegen::collect_invoked_services(module);
            files.push(InternalFile::new(
                "packages/server/src/services/clients.ts",
                generate_service_clients(
                    &module.services,
                    &invoked_services,
                    crate::codegen::handler_header::module_has_http_effects(module).then_some(module.egress.as_slice()),
                    &module.program_credentials,
                ),
                GeneratedFileType::Config,
            ));
            // Where the orbital-events route lends the running app to service
            // calls, as the caller (`llm call-tools`).
            if self.host == HostMode::Generated {
                files.push(InternalFile::new(
                    "packages/server/src/services/host.ts",
                    crate::codegen::generate_service_host(),
                    GeneratedFileType::Config,
                ));
            }

            // Inbound deliveries (`/api/hooks/<name>`, EXEC-INBOUND-1) — always
            // emitted so the template server imports it unconditionally.
            files.push(if self.host == HostMode::Kernel {
                InternalFile::new(
                    "packages/server/src/inbound.ts",
                    "/**\n * Inbound deliveries: answered by the kernel host (EXEC-INBOUND-1).\n *\n * @generated by Orbital Compiler (kernel host)\n */\n\nexport { deliverInbound } from './kernel-host.js';\n",
                    GeneratedFileType::Route,
                )
            } else {
                self.generate_inbound_module(module)
            });

            // Credential manifest for the services this schema invokes:
            // a server-scoped .env.example plus the SECRETS.md deploy manifest.
            if let Some((env_example, secrets_md)) = generate_env_manifest(module) {
                files.push(InternalFile::new(
                    "packages/server/.env.example",
                    env_example,
                    GeneratedFileType::Config,
                ));
                files.push(InternalFile::new(
                    "SECRETS.md",
                    secrets_md,
                    GeneratedFileType::Config,
                ));
            }

            // 8. Generate substrate-config.ts when llm/ operators are used.
            // getSubstrateService() is owned by @almadar/server (re-exported
            // by @almadar/server-hono) — not generated here. Only getLLMClient()
            // is self-contained (imports LLMClient from @almadar/llm).
            let has_llm_ops = module.traits.iter().any(|t| {
                t.transitions.iter().any(|tr| {
                    tr.effects.iter().any(|e| {
                        if let OirExpr::Effect { effect } = e {
                            if let OirEffect::Custom { name, .. } = effect.as_ref() {
                                name.starts_with("llm/")
                            } else {
                                false
                            }
                        } else {
                            false
                        }
                    })
                })
            });
            if has_llm_ops {
                files.push(InternalFile::new(
                    "packages/server/src/substrate-config.ts".to_string(),
                    r#"/**
 * Substrate Configuration
 * Generated by Orbital Compiler — present when llm/ operators are used.
 * Pure TypeScript, no Orb runtime.
 *
 * getSubstrateService() is NOT here — it lives in @almadar/server
 * (re-exported by @almadar/server-hono). The host app must call
 * setSubstrateService() at startup.
 */

import { LLMClient } from '@almadar/llm';

let llmClient: LLMClient | null = null;
export function getLLMClient(): LLMClient {
  if (!llmClient) {
    llmClient = new LLMClient({
      provider: (process.env.LLM_PROVIDER ?? 'deepseek') as 'anthropic' | 'deepseek' | 'openrouter',
      model: process.env.LLM_MODEL ?? 'deepseek-chat',
    });
  }
  return llmClient;
}
export function setLLMClient(client: LLMClient): void { llmClient = client; }
"#
                    .to_string(),
                    GeneratedFileType::Config,
                ));
            }

            // packages/server/package.json (Hono only — the Express
            // template's static copy already declares every `@almadar/*`
            // package its handlers import). Last, so the scan sees every
            // `packages/server/` file this compile emitted.
            if self.server_framework == ServerFramework::Hono {
                let server_package_json = self.generate_server_package_json_hono(&files);
                files.push(server_package_json);
            }
        }

        files
    }

    /// Generate main.tsx with unified ThemeProvider wired up to the orbital's theme
    fn generate_main_tsx_with_theme(&self, default_theme: &str) -> String {
        format!(
            r#"/**
 * Application Entry Point
 * Generated by Orbital Compiler
 *
 * Theme '{}' is configured from the orbital schema.
 * Uses unified ThemeProvider with data-theme="name-light/dark" attribute.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import {{ OrbitalProvider }} from '@almadar/ui/providers';
import {{ THEMES, DEFAULT_THEME, DEFAULT_MODE }} from './generated/theme-config';
import {{ App }} from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OrbitalProvider themes={{THEMES}} defaultTheme={{DEFAULT_THEME}} defaultMode={{DEFAULT_MODE}}>
      <App />
    </OrbitalProvider>
  </React.StrictMode>
);
"#,
            default_theme
        )
    }

    /// Generate index.css with theme imports included
    ///
    /// Uses the unified theme system where each theme defines complete variables
    /// for both light and dark modes via `[data-theme="name-light"]` and `[data-theme="name-dark"]`.
    /// No :root fallback needed - ThemeProvider always sets data-theme.
    fn generate_index_css_with_themes(&self, themes: &[orbital_core_base::schema::types::ThemeDefinition]) -> String {
        let mut css = String::new();

        css.push_str("/**\n");
        css.push_str(" * Application Styles\n");
        css.push_str(" * Generated by Orbital Compiler\n");
        css.push_str(" *\n");
        css.push_str(" * Themes use unified data-theme attribute:\n");
        css.push_str(" *   data-theme=\"themename-light\" or data-theme=\"themename-dark\"\n");
        css.push_str(" */\n\n");

        // Web fonts the themes declare — `@import` must lead the stylesheet.
        for url in theme_font_imports(themes) {
            css.push_str(&format!("@import url(\"{}\");\n", url));
        }

        // The runtime playground's theme entry: base, every built-in preset, and the foundation
        // rules. A sub-frame's `data-theme` (a tour's `demoTheme`) then resolves as it does there.
        css.push_str("@import '@almadar/ui/themes/index.css';\n\n");

        // Include orbital-generated themes
        if !themes.is_empty() {
            css.push_str("/* Custom themes from orbital schema */\n");
            for theme in themes {
                css.push_str(&format!("@import './themes/{}.css';\n", theme.name));
            }
            css.push('\n');
        }

        css.push_str("@tailwind base;\n");
        css.push_str("@tailwind components;\n");
        css.push_str("@tailwind utilities;\n");

        // Body styles: apply theme variables to the page
        css.push_str("\n/* Apply theme to body */\n");
        css.push_str("body {\n");
        css.push_str("  margin: 0;\n");
        css.push_str("  min-height: 100vh;\n");
        css.push_str("  background-color: var(--color-background);\n");
        css.push_str("  color: var(--color-foreground);\n");
        css.push_str("  font-family: var(--font-family, system-ui, -apple-system, sans-serif);\n");
        css.push_str("}\n\n");
        css.push_str("#root {\n");
        css.push_str("  min-height: 100vh;\n");
        css.push_str("}\n");

        css
    }
}

/// Implement the compiler's Backend trait
impl Backend for TypeScriptBackend {
    fn generate(&self, module: &OirModule) -> GeneratedOutput {
        let internal_files = self.generate_internal(module);
        GeneratedOutput {
            files: internal_files
                .into_iter()
                .map(|f| f.into_generated_file())
                .collect(),
            warnings: self.kernel_host_warnings(),
        }
    }

    fn generate_with_mode(
        &self,
        module: &OirModule,
        mode: orbital_core_base::generate::ShellMode,
    ) -> GeneratedOutput {
        use orbital_core_base::generate::ShellMode;

        // Create a new backend with the appropriate target based on mode
        let target = match mode {
            ShellMode::Full => "full",
            ShellMode::Client => "client",
            ShellMode::Server => "server",
        };

        let mode_backend = TypeScriptBackend {
            strict: self.strict,
            jsdoc: self.jsdoc,
            target: target.to_string(),
            extra_mappings: self.extra_mappings.clone(),
            schema_language: self.schema_language.clone(),
            dev_logs: self.dev_logs,
            server_framework: self.server_framework,
            host: self.host,
            browser_schema: self.browser_schema.clone(),
            current_trait_scope: CodegenCell::new(None),
            current_transition: CodegenCell::new(None),
            local_scopes: CodegenCell::new(Vec::new()),
            current_event_scope_chain: CodegenCell::new(Vec::new()),
            entity_catalog: CodegenCell::new(HashMap::new()),
            current_linked_entity: CodegenCell::new(None),
            current_linked_entity_id: CodegenCell::new(None),
            current_entity_ref_ids: CodegenCell::new(None),
            current_trait_embed_names: CodegenCell::new(None),
            current_payload_schema: CodegenCell::new(None),
            current_config_schema: CodegenCell::new(None),
            pending_root_props: CodegenCell::new(None),
            client_effect_emitter: CodegenCell::new(Box::new(
                crate::codegen::target::WebClientEffectEmitter,
            )),
            trait_callsite_captures: CodegenCell::new(HashMap::new()),
            trait_callsite_payload_flagged: CodegenCell::new(HashSet::new()),
            trait_callsite_knob_values: CodegenCell::new(HashMap::new()),
            racy_listens: CodegenCell::new(BTreeMap::new()),
            dispatch_scope: CodegenCell::new(false),
            off_page_listens: CodegenCell::new(BTreeMap::new()),
            app_has_server_leg: CodegenCell::new(false),
            browser_legs: CodegenCell::new(BTreeSet::new()),
            browser_services: CodegenCell::new(false),
            browser_http: CodegenCell::new(false),
            browser_locales: CodegenCell::new(Vec::new()),
            view_value_imports: CodegenCell::new(BTreeSet::new()),
        };

        // Use the mode-aware backend to generate
        mode_backend.generate(module)
    }

    fn name(&self) -> &'static str {
        "typescript"
    }

    /// Browser legs run the resolved schema in-process, so the client needs it.
    fn supports_browser_stored_entities(&self) -> bool {
        self.browser_schema.is_some()
    }
}

// ============================================================================
// Submodules (module-split of the former monolithic backend.rs).
// Public API is preserved: TypeScriptBackend, ExtraComponentMapping,
// ServerFramework are re-exported below so `pub use backend::{...}` in lib.rs
// keeps resolving. Inherent methods live in these submodules' `impl
// TypeScriptBackend` blocks and resolve via the type regardless of module.
// ============================================================================
mod client;
pub mod kernel_host;
mod pages;
pub(crate) mod server;
mod shared;
mod types;
pub(crate) use types::{array_element_ts, map_type_ts, oir_type_uses_sexpr, TsTypeMode};
mod utils;

// Free helpers / case converters used across submodules.
pub(crate) use utils::*;
// Shared entity/schema helpers used by client codegen + the pattern registry.
pub use shared::EntityFieldInfo;
pub(crate) use shared::{oir_cardinality_to_relation_str, oir_type_to_form_type, ZodRefMode};
pub use types::classify_oir_type;

#[cfg(test)]
mod tests {
    use super::*;
    use orbital_core_base::ir::OirField;

    #[test]
    fn test_to_camel_case() {
        assert_eq!(to_camel_case("TaskLifecycle"), "taskLifecycle");
        assert_eq!(to_camel_case("Task"), "task");
    }

    #[test]
    fn test_to_lowercase_nosep() {
        assert_eq!(to_lowercase_nosep("TasksPage"), "taskspage");
        assert_eq!(to_lowercase_nosep("ProjectDetailPage"), "projectdetailpage");
    }

    #[test]
    fn test_to_kebab_case() {
        assert_eq!(to_kebab_case("Task"), "task");
        assert_eq!(to_kebab_case("MenuItem"), "menu-item");
        // Acronyms should stay together
        assert_eq!(to_kebab_case("TaskCRUD"), "task-crud");
        assert_eq!(to_kebab_case("XMLParser"), "xml-parser");
        assert_eq!(to_kebab_case("HTTPSConnection"), "https-connection");
        assert_eq!(to_kebab_case("UserAPI"), "user-api");
        assert_eq!(to_kebab_case("IOHandler"), "io-handler");
        // Edge cases
        assert_eq!(to_kebab_case("ID"), "id");
        assert_eq!(to_kebab_case("HTMLElement"), "html-element");
    }

    #[test]
    fn test_type_mapping() {
        let backend = TypeScriptBackend::new();
        assert_eq!(backend.map_type(&OirType::String), "string");
        assert_eq!(backend.map_type(&OirType::Number), "number");
        assert_eq!(backend.map_type(&OirType::Boolean), "boolean");
    }

    // ---------------------------------------------------------------------
    // Characterization matrix for the `OirType → TS` walk (now the shared
    // `orbital_core::render_type` + `TsRenderer`). Pins the EXACT string for
    // every arm × every disturbable axis — Declared vs Inferred, the aliased
    // and payload wrappers, and the enum-sidecar union — so a future edit to
    // the walker or a backend leaf can't silently collapse a mode (the
    // CG-SWEEP-1 Inferred→Declared regression class). Every value below is the
    // pre-refactor output; the trait migration must keep it byte-identical.
    // ---------------------------------------------------------------------

    fn ev(vals: &[&str]) -> Vec<String> {
        vals.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn char_declared_leaves() {
        let b = TypeScriptBackend::new();
        let d = |t: &OirType| b.map_type_with_enum(t, None);
        assert_eq!(d(&OirType::String), "string");
        assert_eq!(d(&OirType::Number), "number");
        assert_eq!(d(&OirType::Integer), "number");
        assert_eq!(d(&OirType::Boolean), "boolean");
        // Honest at-rest domains (C-COMPILED-PATH-RED §25): dates are ISO
        // strings or epoch-ms numbers; a relation field stores the row's id.
        assert_eq!(d(&OirType::Date), "string | number");
        assert_eq!(d(&OirType::DateTime), "string | number");
        assert_eq!(d(&OirType::Bytes), "string");
        assert_eq!(d(&OirType::String), "string");
        assert_eq!(d(&OirType::Json), "Record<string, FieldValue | undefined>");
        assert_eq!(d(&OirType::Trait), "TraitFieldRef");
        assert_eq!(d(&OirType::SExpr), "SExpr");
        assert_eq!(d(&OirType::Node), "PatternValue");
        assert_eq!(d(&OirType::array(OirType::Node)), "PatternValue[]");
        assert_eq!(d(&OirType::enum_type("Status")), "string");
        assert_eq!(d(&OirType::reference("User")), "string");
    }

    #[test]
    fn char_declared_enum_sidecar_union() {
        let b = TypeScriptBackend::new();
        // A lolo `format:` union lowers to String + enum_values → literal union.
        assert_eq!(
            b.map_type_with_enum(&OirType::String, Some(&ev(&["active", "done"]))),
            "'active' | 'done'"
        );
        // Enum variant with the sidecar renders the same union.
        assert_eq!(
            b.map_type_with_enum(&OirType::enum_type("Status"), Some(&ev(&["a", "b"]))),
            "'a' | 'b'"
        );
    }

    #[test]
    fn char_declared_recursive() {
        let b = TypeScriptBackend::new();
        let d = |t: &OirType| b.map_type_with_enum(t, None);
        assert_eq!(d(&OirType::array(OirType::Number)), "number[]");
        assert_eq!(
            d(&OirType::map(OirType::String, OirType::Number)),
            "Record<string, number>"
        );
        assert_eq!(d(&OirType::optional(OirType::Number)), "number | null");
        assert_eq!(
            d(&OirType::optional(OirType::optional(OirType::Integer))),
            "number | null"
        );
    }

    #[test]
    fn char_declared_struct_honors_optional_and_enum() {
        let b = TypeScriptBackend::new();
        let st = OirType::Struct {
            fields: vec![
                OirField::new("title", OirType::String),
                OirField::optional("count", OirType::Number),
            ],
        };
        assert_eq!(
            b.map_type_with_enum(&st, None),
            "{ title: string; count?: number }"
        );
        let mut enum_field = OirField::new("kind", OirType::String);
        enum_field.enum_values = Some(ev(&["x", "y"]));
        let st2 = OirType::Struct {
            fields: vec![enum_field],
        };
        assert_eq!(b.map_type_with_enum(&st2, None), "{ kind: 'x' | 'y' }");
    }

    #[test]
    fn char_inferred_mode_diverges_from_declared() {
        let mut catalog = std::collections::HashMap::new();
        catalog.insert("User".to_string(), orbital_core_base::ir::OirEntity::new("User"));
        let inf = |t: &OirType| map_type_ts(t, None, Some(&catalog), TsTypeMode::Inferred);
        // The axes a mode-collapse would flatten:
        assert_eq!(inf(&OirType::Date), "Date | string | number");
        assert_eq!(inf(&OirType::DateTime), "Date | string | number");
        assert_eq!(inf(&OirType::Trait), "string");
        assert_eq!(inf(&OirType::Json), "EntityRow");
        assert_eq!(inf(&OirType::array(OirType::Number)), "readonly number[]");
        assert_eq!(
            inf(&OirType::optional(OirType::Number)),
            "number | undefined"
        );
        // Reference: known in catalog stays bare; unknown widens to EntityRow.
        assert_eq!(inf(&OirType::reference("User")), "User");
        assert_eq!(inf(&OirType::reference("Ghost")), "EntityRow");
        // No catalog → every reference widens.
        assert_eq!(
            map_type_ts(
                &OirType::reference("User"),
                None,
                None,
                TsTypeMode::Inferred
            ),
            "EntityRow"
        );
        // Enum sidecar still becomes a union in Inferred mode (was collapsed
        // to `string` before CG-SWEEP-1).
        assert_eq!(
            map_type_ts(
                &OirType::String,
                Some(&ev(&["a", "b"])),
                Some(&catalog),
                TsTypeMode::Inferred
            ),
            "'a' | 'b'"
        );
    }

    /// The contract `resolve_orbital_ref_type_arm` (orbital-compiler's
    /// `payload_field_to_oir_type`) relies on when it hands a declared
    /// entity's payload field a `Reference` instead of a flattened struct
    /// (std-notes' `NoteTagNotesOverlay`, C-COMPILED-PATH-RED §derivative):
    /// a `Reference` to an entity the catalog carries renders in Inferred
    /// mode as the entity's own bare interface name (assignable to
    /// `readonly EntityRow[]`, and importable by name), while an ANONYMOUS
    /// struct — no entity identity to reference — still expands inline.
    /// Pinning both together documents why the compiler must not flatten a
    /// known entity into a struct: doing so would make this test's second
    /// half fire for the FIRST case too.
    #[test]
    fn char_inferred_reference_to_declared_entity_stays_bare_while_anonymous_struct_expands() {
        let mut catalog = std::collections::HashMap::new();
        catalog.insert("Note".to_string(), orbital_core_base::ir::OirEntity::new("Note"));
        let inf = |t: &OirType| map_type_ts(t, None, Some(&catalog), TsTypeMode::Inferred);

        // A declared entity: bare name, not an inline literal.
        assert_eq!(
            inf(&OirType::array(OirType::reference("Note"))),
            "readonly Note[]"
        );

        // An anonymous struct carries no entity identity to reference — it
        // must keep expanding inline, or a genuinely shapeless payload field
        // loses its field-level typing.
        let anon_struct = OirType::Struct {
            fields: vec![
                OirField::new("id", OirType::String),
                OirField::optional("authorId", OirType::reference("Note")),
            ],
        };
        assert_eq!(
            inf(&OirType::array(anon_struct)),
            "readonly { id: string; authorId?: Note }[]"
        );
    }

    #[test]
    fn char_aliased_wrapper_only_rewrites_references() {
        let b = TypeScriptBackend::new();
        let a = |t: &OirType| b.map_type_aliased_with_enum(t, None);
        // Collision names get the `<Name>Entity` alias; others stay bare.
        assert_eq!(a(&OirType::reference("Response")), "ResponseEntity");
        assert_eq!(a(&OirType::reference("User")), "User");
        assert_eq!(
            a(&OirType::array(OirType::reference("Response"))),
            "ResponseEntity[]"
        );
        assert_eq!(
            a(&OirType::optional(OirType::reference("Response"))),
            "ResponseEntity | null"
        );
        // Non-reference arms are alias-invariant (Declared behavior).
        assert_eq!(a(&OirType::String), "string");
        assert_eq!(a(&OirType::Date), "string | number");
    }

    #[test]
    fn char_payload_wrapper_date_optional_and_unenumed_struct() {
        let b = TypeScriptBackend::new();
        // Payload dates accept the live `Date` too.
        assert_eq!(
            b.payload_struct_ts(&OirType::Date),
            "Date | string | number"
        );
        assert_eq!(b.payload_struct_ts(&OirType::Number), "number");
        // Payload unwraps optionality with no `| null` suffix.
        assert_eq!(
            b.payload_struct_ts(&OirType::optional(OirType::Number)),
            "number"
        );
        // A payload reference carries the ROW, not an id — so it must NOT
        // render as `string`. That is the entity relation-FIELD rule (a
        // relation stores an id at rest), and it leaked into payload positions
        // because both share the renderer: an event declaring
        // `{ row : BoardView }` emitted `row: string` in `events.ts` while a
        // row object arrived on the bus, and it typechecked — while
        // `handlers.ts` rendered the same OirType as the entity type, so the
        // two generated files disagreed. This assertion previously encoded the
        // bug (`== "string"`), which is why nothing caught the regression.
        assert_eq!(
            b.payload_struct_ts(&OirType::reference("User")),
            "EntityRow"
        );
        assert_eq!(b.payload_struct_ts(&OirType::Trait), "TraitFieldRef");
        assert_eq!(b.payload_struct_ts(&OirType::Node), "PatternValue");
        // Payload structs DROP the per-field enum sidecar (never emitted unions).
        let mut enum_field = OirField::new("kind", OirType::String);
        enum_field.enum_values = Some(ev(&["x", "y"]));
        let st = OirType::Struct {
            fields: vec![enum_field],
        };
        assert_eq!(b.payload_struct_ts(&st), "{ kind: string }");
    }

    // ---------------------------------------------------------------------
    // Zod mapping: one `map_type_to_zod_with_refs`, framework-switched on the
    // Reference arm via `ZodRefMode` (Pillar C dedup of Hono's
    // `map_oir_type_to_zod`).
    // ---------------------------------------------------------------------

    #[test]
    fn test_zod_ref_mode_schema_vs_idstring() {
        let backend = TypeScriptBackend::new();
        let r = OirType::Reference {
            entity: "Task".to_string(),
        };
        // §161: a declared relation field STORES THE ID (ledger §138/§147,
        // `orbital-core`'s `TargetTypeRenderer::reference` default — the TS
        // type position for this same field is `string`). Entity-schema
        // context previously validated it as the embedded row
        // (`z.lazy(() => taskSchema)`), disagreeing with both the TS
        // interface and the persist-effect default-binding codegen (a
        // `set`/default to `@user.id` writes a plain string) — every
        // create/update through a relation field with a default 400'd
        // ("Expected object, received string"). Both ref modes now agree
        // on the one thing the field is ever populated with.
        assert_eq!(
            backend.map_type_to_zod_with_refs(&r, None, ZodRefMode::Schema),
            "z.string()"
        );
        // Event-payload context: plain string id (matches the old Hono
        // `map_oir_type_to_zod` Reference arm).
        assert_eq!(
            backend.map_type_to_zod_with_refs(&r, None, ZodRefMode::IdString),
            "z.string()"
        );
        // The convenience entry delegates to Schema mode.
        assert_eq!(backend.map_type_to_zod(&r, None), "z.string()");
    }

    #[test]
    fn test_zod_payload_scalars_match_old_hono() {
        let backend = TypeScriptBackend::new();
        let m = ZodRefMode::IdString;
        assert_eq!(
            backend.map_type_to_zod_with_refs(&OirType::String, None, m),
            "z.string()"
        );
        assert_eq!(
            backend.map_type_to_zod_with_refs(&OirType::Number, None, m),
            "z.number()"
        );
        assert_eq!(
            backend.map_type_to_zod_with_refs(&OirType::Boolean, None, m),
            "z.boolean()"
        );
        assert_eq!(
            backend.map_type_to_zod_with_refs(&OirType::Date, None, m),
            "z.string()"
        );
        assert_eq!(
            backend.map_type_to_zod_with_refs(&OirType::Bytes, None, m),
            "z.string()"
        );
        assert_eq!(
            backend.map_type_to_zod_with_refs(&OirType::Json, None, m),
            "z.record(FieldValueSchema.optional())"
        );
        assert_eq!(
            backend.map_type_to_zod_with_refs(
                &OirType::Array {
                    inner: Box::new(OirType::String)
                },
                None,
                m
            ),
            "z.array(z.string())"
        );
        // Top-level enum at payload level has no values → z.string() (unchanged).
        assert_eq!(
            backend.map_type_to_zod_with_refs(
                &OirType::Enum {
                    name: "Status".to_string()
                },
                None,
                m
            ),
            "z.string()"
        );
        // A trait field: local embed, stored trait value, or null.
        assert_eq!(
            backend.map_type_to_zod_with_refs(&OirType::Trait, None, m),
            "TraitFieldValueSchema"
        );
        assert_eq!(
            backend.map_type_to_zod_with_refs(&OirType::SExpr, None, m),
            "SExprSchema"
        );
    }

    #[test]
    fn test_zod_payload_struct_nested_enum_upgrades() {
        // Intended Hono enum-degradation fix: a struct field that carries
        // concrete enum_values now validates as `z.enum([...])` instead of the
        // old blanket `z.string()`. The values are inline literals — safe at
        // the inline payload site (no external symbol).
        let backend = TypeScriptBackend::new();
        let mut enum_field = OirField::new(
            "status",
            OirType::Enum {
                name: "Status".to_string(),
            },
        );
        enum_field.enum_values = Some(vec!["open".to_string(), "closed".to_string()]);
        enum_field.required = true;
        let struct_ty = OirType::Struct {
            fields: vec![enum_field],
        };
        assert_eq!(
            backend.map_type_to_zod_with_refs(&struct_ty, None, ZodRefMode::IdString),
            "z.object({ status: z.enum(['open', 'closed']) })"
        );
    }

    // ---------------------------------------------------------------------
    // emit: config — compiled-path codegen tests (Stage 5 of the close-the-
    // circuit plan). Each test verifies the JS generated for a server-side
    // effect includes `getServerEventBus().emit('EVENT_NAME', ...)` whenever
    // the author configured `emit:`.
    // ---------------------------------------------------------------------

    // ---------------------------------------------------------------------
    // Bridge hook: one `generate_orbital_bridge_hook_impl(framework)`. Hono
    // imports the protocol types from `@app/shared` (no inline subset) and
    // gains the orbital-qualified cascade re-emit (Pillar C).
    // ---------------------------------------------------------------------

    #[test]
    fn test_state_dispatch_switch_default_case_per_framework() {
        use orbital_core_base::ir::{OirModule, OirState, OirTrait, OirTransition};
        let backend = TypeScriptBackend::new();
        let mut trait_def = OirTrait::new("CartItemCrud");
        trait_def.states = vec![
            OirState {
                name: "idle".into(),
                is_initial: true,
                is_final: false,
                description: None,
                time_bound_ms: None,
            },
            OirState {
                name: "saving".into(),
                is_initial: false,
                is_final: false,
                description: None,
                time_bound_ms: None,
            },
        ];
        let module = OirModule::new("ShopApp", "1.0.0");
        let trans = OirTransition::new("idle", "saving", "SAVE");
        let transitions: Vec<&OirTransition> = vec![&trans];

        let express = backend.generate_state_dispatch_switch(
            "SAVE",
            &transitions,
            &trait_def,
            &module,
            ServerFramework::Express,
        );
        let hono = backend.generate_state_dispatch_switch(
            "SAVE",
            &transitions,
            &trait_def,
            &module,
            ServerFramework::Hono,
        );

        // Both dispatch on `switch (state)` with a `case 'idle'`.
        for body in [&express, &hono] {
            assert!(body.contains("switch (state) {"));
            assert!(body.contains("case 'idle':"));
        }
        // The `default:` return literal is the only per-framework divergence:
        // Express multi-line, Hono inline (preserving prior byte output).
        assert!(express.contains("    default:\n      return {\n        success: false,\n"));
        assert!(express.contains("`Cannot process SAVE from state ${state}`,\n"));
        assert!(hono.contains(
            "    default:\n      return { success: false, transitioned: false, states: {}, emittedEvents: [], error: `Cannot process SAVE from state ${state}` };\n"
        ));
        // The case scaffold (switch/case/braces) is framework-agnostic; only the
        // transition body (which already lives in the framework-switched
        // `generate_transition_body_impl`) and the `default:` literal differ. So
        // both bodies share the same case prefix up to the transition body.
        let case_prefix = "  switch (state) {\n    case 'idle':\n    {\n";
        assert!(express.starts_with(case_prefix));
        assert!(hono.starts_with(case_prefix));
    }

    #[test]
    fn test_bridge_hook_unified_express_and_hono() {
        let backend = TypeScriptBackend::new();
        backend.app_has_server_leg.set(true);
        let express = backend
            .generate_orbital_bridge_hook_impl(ServerFramework::Express)
            .content;
        let hono = backend
            .generate_orbital_bridge_hook_impl(ServerFramework::Hono)
            .content;

        // Both: orbital-qualified config + protocol types from @app/shared
        // (no inline `export interface EventRequest`).
        for body in [&express, &hono] {
            assert!(
                body.contains("orbitalName: string;"),
                "config carries orbitalName"
            );
            assert!(
                body.contains(
                    "import type { EventResponse, EmittedEvent, BusBroadcastItem } from '@app/shared';"
                ),
                "protocol types imported from @app/shared"
            );
            assert!(
                !body.contains("export interface EventRequest {"),
                "no inline protocol-type definitions"
            );
            // The orbital-qualified cascade re-emit (the Hono bug-fix).
            assert!(
                body.contains("eventBus.emit(`UI:${evOrbital}.${evTrait}.${ev.event}`"),
                "qualified cascade re-emit present"
            );
            // Hono's buggy bare-key fallback must be gone in both.
            assert!(
                !body.contains("eventBus.emit(ev.event, ev.payload);"),
                "no bare-key cascade fallback"
            );
            // §91 — one cascade per SSE item, keyed by the item's own source.
            assert!(
                body.contains("emitCascadeEvent(_sseBus, item.source.orbital, item.source.trait, { event: item.event, payload: item.payload, source: item.source });"),
                "single source-keyed SSE cascade"
            );
            assert!(
                !body.contains("_sseHandlers")
                    && body.contains("export function emitCascadeEvent("),
                "no per-hook SSE handler set; cascade exported for client-only emits"
            );
        }

        // The two differ only by the doc-header @generated marker.
        assert!(express.contains("@generated by Orbital Compiler (Phase 5)"));
        assert!(hono.contains("@generated by Orbital Compiler (Hono backend)"));
        let express_norm = express.replace("(Phase 5)", "(MARKER)");
        let hono_norm = hono.replace("(Hono backend)", "(MARKER)");
        assert_eq!(
            express_norm, hono_norm,
            "Express and Hono bridge output identical except the @generated marker"
        );
    }

    // ---------------------------------------------------------------------
    // Live-push (Almadar_Live_Push.md): per-tab clientId + SSE subscribe leg
    // on the client bridge; SSE broadcast channel on the server.
    // ---------------------------------------------------------------------

    #[test]
    fn bridge_imports_entity_row_with_no_racy_listens() {
        // Bug: `fields?: EntityRow` is emitted unconditionally in the bridge
        // body, but the empty-racy-listens branch of `core_imports_clause`
        // omitted `EntityRow`, so every app without racy listens failed
        // `tsc --noEmit` with TS2304 on `useOrbitalBridge.ts`.
        let backend = TypeScriptBackend::new();
        for framework in [ServerFramework::Express, ServerFramework::Hono] {
            let body = backend.generate_orbital_bridge_hook_impl(framework).content;
            assert!(
                body.contains(
                    "import type { EntityRow, EventPayload, EventPayloadValue } from '@almadar/core';"
                ),
                "EntityRow imported even with no racy listens, got:\n{}",
                body
            );
        }
    }

    #[test]
    fn bridge_stamps_client_id_on_every_dispatch() {
        let backend = TypeScriptBackend::new();
        for framework in [ServerFramework::Express, ServerFramework::Hono] {
            let body = backend.generate_orbital_bridge_hook_impl(framework).content;
            assert!(
                body.contains("crypto.randomUUID()"),
                "one clientId generated per tab"
            );
            assert!(
                body.contains(
                    "body: JSON.stringify({ event, payload, clientId: _clientId, traits: [{ trait: traitName, from: currentState }], entityByTrait: fields ? { [traitName]: fields } : undefined }),"
                ),
                "clientId stamped on every dispatch"
            );
        }
    }

    #[test]
    fn bridge_subscribes_to_sse_and_reuses_cascade_re_emit() {
        let backend = TypeScriptBackend::new();
        backend.app_has_server_leg.set(true);
        for framework in [ServerFramework::Express, ServerFramework::Hono] {
            let body = backend.generate_orbital_bridge_hook_impl(framework).content;
            assert!(
                body.contains("typeof EventSource === 'undefined'"),
                "browser-guarded EventSource subscribe leg"
            );
            assert!(
                body.contains("new EventSource(`${API_BASE}/api/events?clientId=${_clientId}`)"),
                "subscribes with the same clientId used to stamp dispatches"
            );
            assert!(
                body.contains(".type !== 'bus' || _sseBus === null) return;"),
                "ignores non-bus SSE messages"
            );
            // The SSE leg and the in-response emittedEvents loop both call
            // the SAME `emitCascadeEvent` — no duplicated re-emit logic.
            let call_count = body
                .matches("emitCascadeEvent(eventBus, orbitalName, traitName,")
                .count()
                + body
                    .matches("emitCascadeEvent(_sseBus, item.source.orbital, item.source.trait,")
                    .count();
            assert_eq!(
                call_count, 2,
                "expected exactly 2 call sites (response cascade + SSE leg) sharing one function, got:\n{}",
                body
            );
            // §61: ONE stream per app. `useOrbitalBridge` runs once per trait
            // logic hook, so a per-hook `new EventSource` opened ~21 streams on
            // a ~20-trait page and starved the browser's ~6-connection limit.
            assert_eq!(
                body.matches("new EventSource(").count(),
                1,
                "exactly one EventSource construction — the module singleton, not one per hook, got:\n{}",
                body
            );
            assert!(
                body.contains("_sseSubscribers += 1;") && body.contains("_openSseOnce();"),
                "each hook refcounts the shared stream instead of opening its own"
            );
            assert!(
                body.contains("if (_sseSubscribers === 0 && _sse !== null) { _sse.close(); _sse = null; _sseBus = null; }"),
                "the shared stream closes when its last subscriber leaves"
            );
        }
    }

    #[test]
    fn sse_module_mounts_route_and_broadcast_for_both_frameworks() {
        let backend = TypeScriptBackend::new();

        let express = backend.generate_sse_module(&[], false);
        assert_eq!(express.path, "packages/server/src/sse.ts");
        assert!(express
            .content
            .contains("import type { Express, Request, Response } from 'express';"));
        assert!(express
            .content
            .contains("export function registerSseRoute(app: Express): void {"));
        assert!(express.content.contains("app.get('/api/events'"));
        assert!(express.content.contains(
            "export function broadcastBusEvent(originClientId: string | undefined, item: BusBroadcastItem): void {"
        ));
        // Origin exclusion: never write back to the dispatching tab's own connection.
        assert!(express.content.contains(
            "if (conn.clientId !== undefined && conn.clientId === originClientId) continue;"
        ));
        assert!(express.content.contains("req.on('close', () => {"));
        // A running call's live message reaches only the requesting tab.
        assert!(express.content.contains(
            "export function pushToOrigin(originClientId: string | undefined, item: BusBroadcastItem): void {"
        ));
        assert!(express
            .content
            .contains("if (originClientId === undefined) return;"));
        assert!(express
            .content
            .contains("if (conn.clientId === originClientId) conn.res.write(frame);"));

        let hono = backend.generate_sse_module_hono(&[], false);
        assert_eq!(hono.path, "packages/server/src/sse.ts");
        assert!(hono.content.contains("streamSSE"));
        assert!(hono
            .content
            .contains("export function registerSseRoute(app: Hono<AppEnv>): void {"));
        assert!(hono.content.contains("app.get('/api/events'"));
        assert!(hono.content.contains(
            "export function broadcastBusEvent(originClientId: string | undefined, item: BusBroadcastItem): void {"
        ));
        assert!(hono.content.contains("stream.onAbort(() => {"));
        assert!(hono.content.contains("if (conn.clientId === originClientId) void conn.stream.writeSSE({ data: JSON.stringify(item) });"));
    }

    /// §88: a persist effect on an entity declaring `@read` broadcasts an
    /// `entityType`-tagged item; `broadcastBusEvent` must look up that
    /// entity's `*_READ_POLICY` and skip a connection whose viewer fails
    /// `applyRowAccess` on the row — otherwise every persisted row of a
    /// policied entity reached every open tab, bypassing the same `@read`
    /// scoping the request/response path already enforces.
    #[test]
    fn sse_module_scopes_broadcast_by_read_policy_for_both_frameworks() {
        let backend = TypeScriptBackend::new();
        let mut note = OirEntity::new("Note");
        note.read_policy = Some(OirExpr::Bool { value: true });
        let entities = vec![note];

        for (name, ts) in [
            (
                "Express",
                backend.generate_sse_module(&entities, false).content,
            ),
            (
                "Hono",
                backend.generate_sse_module_hono(&entities, false).content,
            ),
        ] {
            assert!(
                ts.contains("import { NOTE_READ_POLICY } from './access-policies.js';"),
                "{name} sse.ts must import the entity's declared read policy, got:\n{ts}"
            );
            assert!(
                ts.contains("'Note': NOTE_READ_POLICY,"),
                "{name} sse.ts must map the entity name to its policy const, got:\n{ts}"
            );
            assert!(
                ts.contains("user?: UserContext;"),
                "{name} SseConnection must store the viewer's UserContext, got:\n{ts}"
            );
            assert!(
                ts.contains(
                    "applyRowAccess([row], policy, undefined, { user: conn.user, now }).length === 0"
                ),
                "{name} broadcastBusEvent must scope by the per-connection viewer, got:\n{ts}"
            );
            let stamp = ts
                .find("  const now = Date.now();\n")
                .unwrap_or_else(|| panic!("{name}: one stamp per broadcast:\n{ts}"));
            assert!(
                stamp < ts.find("for (const conn of connections)").unwrap(),
                "{name}: every viewer is judged against the same stamp:\n{ts}"
            );
        }
    }

    /// A module with NO declared `@read` anywhere must emit byte-identical
    /// output to before this fix — no `./access-policies.js` import (that
    /// file doesn't even exist when nothing declares a policy) and no
    /// per-connection scoping code.
    #[test]
    fn sse_module_omits_policy_scoping_when_nothing_is_policied() {
        let backend = TypeScriptBackend::new();
        let ts = backend.generate_sse_module(&[], false).content;
        assert!(!ts.contains("access-policies.js"));
        assert!(!ts.contains("applyRowAccess"));
        assert!(!ts.contains("READ_POLICY_BY_ENTITY"));
        assert!(!ts.contains("const now"));
    }

    #[test]
    fn routes_registration_mounts_sse_route_for_both_frameworks() {
        use orbital_core_base::ir::OirTrait;
        let backend = TypeScriptBackend::new();
        let traits: Vec<OirTrait> = vec![];

        let express = backend.generate_event_routes_registration(&traits, false);
        assert!(express
            .content
            .contains("import { registerSseRoute } from './sse.js';"));
        assert!(express.content.contains("registerSseRoute(app);"));

        let hono = backend.generate_event_routes_registration_hono(&traits, false);
        assert!(hono
            .content
            .contains("import { registerSseRoute } from './sse.js';"));
        assert!(hono.content.contains("registerSseRoute(app);"));
    }

    #[test]
    fn test_generate_shared_entities_with_descriptions() {
        let backend = TypeScriptBackend::new();
        let entities = vec![OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "User".to_string(),
            description: Some("Represents a user account".to_string()),
            collection: "users".to_string(),
            persistence: OirPersistence::Persistent,
            fields: vec![OirField::new("id", OirType::String), {
                let mut f = OirField::new("email", OirType::String);
                f.description = Some("User's email address".to_string());
                f.constraints = vec![OirConstraint::Email];
                f
            }],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        }];
        let file = backend.generate_shared_entities(&entities, &Default::default());
        let content = file.into_generated_file().content;
        assert!(
            content.contains("Represents a user account"),
            "Entity description should appear in JSDoc"
        );
        assert!(
            content.contains("User's email address"),
            "Field description should appear in JSDoc"
        );
    }

    #[test]
    fn test_generate_shared_schemas_with_constraints() {
        let backend = TypeScriptBackend::new();
        let entities = vec![OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "User".to_string(),
            description: None,
            collection: "users".to_string(),
            persistence: OirPersistence::Persistent,
            fields: vec![
                OirField::new("id", OirType::String),
                {
                    let mut f = OirField::new("email", OirType::String);
                    f.constraints = vec![
                        OirConstraint::Email,
                        OirConstraint::MaxLength { value: 255 },
                    ];
                    f
                },
                {
                    let mut f = OirField::new("age", OirType::Number);
                    f.constraints = vec![
                        OirConstraint::Min { value: 0.0 },
                        OirConstraint::Max { value: 150.0 },
                    ];
                    f
                },
            ],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        }];
        let file = backend.generate_shared_schemas(&entities, &Default::default());
        let content = file.into_generated_file().content;
        assert!(
            content.contains(".email()"),
            "Should contain .email() constraint"
        );
        assert!(
            content.contains(".max(255)"),
            "Should contain .max(255) constraint"
        );
        assert!(
            content.contains(".min(0)"),
            "Should contain .min(0) constraint"
        );
        assert!(
            content.contains(".max(150)"),
            "Should contain .max(150) constraint"
        );
    }

    /// `field.required = false` (no `!` in the `.lolo`) wraps `field_type` in
    /// `OirType::Optional` (`OirField::optional`) — `map_type_to_zod` must
    /// unwrap that BEFORE `apply_constraints_to_zod` chains `.email()`/
    /// `.regex()`/etc. onto the base type, or the constraint lands on
    /// `ZodOptional<ZodString>` (`.optional()` already baked in), which zod
    /// doesn't expose those methods on — `z.string().optional().email()` is
    /// not valid zod chaining (TS2339). The single correct `.optional()` is
    /// the one this loop appends itself, after constraints.
    #[test]
    fn test_generate_shared_schemas_optional_field_with_constraint() {
        let backend = TypeScriptBackend::new();
        let entities = vec![OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "ServiceEmail".to_string(),
            description: None,
            collection: "service_emails".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String), {
                let mut f = OirField::optional("htmlBody", OirType::String);
                f.constraints = vec![OirConstraint::Email];
                f
            }],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        }];
        let file = backend.generate_shared_schemas(&entities, &Default::default());
        let content = file.into_generated_file().content;
        assert!(
            content.contains("htmlBody: z.string().email().optional()"),
            "constraint must chain before the single .optional(), got: {}",
            content
        );
        assert!(
            !content.contains(".optional().email()"),
            "must never chain a refinement method onto an already-optional zod type, got: {}",
            content
        );
    }

    #[test]
    fn test_generate_shared_schemas_update_schema() {
        let backend = TypeScriptBackend::new();
        let entities = vec![OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Task".to_string(),
            description: None,
            collection: "tasks".to_string(),
            persistence: OirPersistence::Persistent,
            fields: vec![
                OirField::new("id", OirType::String),
                OirField::new("title", OirType::String),
            ],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        }];
        let file = backend.generate_shared_schemas(&entities, &Default::default());
        let content = file.into_generated_file().content;
        assert!(
            content.contains("taskUpdateSchema = taskInputSchema.partial()"),
            "Should generate UpdateSchema"
        );
    }

    #[test]
    fn test_input_schema_omits_timestamps() {
        let backend = TypeScriptBackend::new();
        let entities = vec![OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Task".to_string(),
            description: None,
            collection: "tasks".to_string(),
            persistence: OirPersistence::Persistent,
            fields: vec![
                OirField::new("id", OirType::String),
                OirField::new("title", OirType::String),
                OirField::new("createdAt", OirType::DateTime),
                OirField::new("updatedAt", OirType::DateTime),
            ],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        }];
        let file = backend.generate_shared_schemas(&entities, &Default::default());
        let content = file.into_generated_file().content;
        assert!(
            content.contains("createdAt: true"),
            "InputSchema should omit createdAt"
        );
        assert!(
            content.contains("updatedAt: true"),
            "InputSchema should omit updatedAt"
        );
    }

    #[test]
    fn test_capitalize_first_for_field_alias() {
        assert_eq!(capitalize_first("type"), "Type");
        assert_eq!(capitalize_first("unitType"), "UnitType");
        assert_eq!(capitalize_first("status"), "Status");
    }

    // ========================================================================
    // @trait.X binding → compiled-path codegen
    //
    // Stage 4 of the `@trait.X` binding plan (docs/Almadar_Std_Gaps.md §3.8).
    // The compiled path emits a direct view-component reference
    // (`<{TraitName}View />`) at the embed position instead of routing
    // through the slot manager. Tests verify:
    //   1. `parse_trait_binding` accepts the canonical form and rejects
    //      the forms the validator turns away.
    //   2. `generate_pattern_from_registry` emits `<XView />` inline when
    //      a pattern's `children:` array contains `@trait.X`.
    //   3. `collect_nested_pattern_imports` picks up the matching
    //      `@/components/traits/XView` import so the generated file
    //      header includes it.
    // ========================================================================
}

/// The compiled client loads the same theme stylesheet entry as the runtime playground
/// (`@almadar/ui/themes/index.css`: base, every preset, foundation), so a sub-frame's
/// `data-theme` (a tour's `demoTheme`) resolves on both paths.
#[cfg(test)]
mod index_css_theme_parity_tests {
    use super::TypeScriptBackend;

    #[test]
    fn the_client_imports_every_built_in_theme() {
        let css = TypeScriptBackend::new().generate_index_css_with_themes(&[]);
        assert!(
            css.contains("@import '@almadar/ui/themes/index.css';"),
            "{css}"
        );
        assert!(
            !css.contains("_foundation.css"),
            "the entry already includes the foundation: {css}"
        );
    }

    #[test]
    fn control_the_program_s_own_themes_still_follow_the_built_ins() {
        let theme: orbital_core_base::schema::types::ThemeDefinition =
            serde_json::from_value(serde_json::json!({ "name": "sunset", "tokens": {} }))
                .expect("theme");
        let css = TypeScriptBackend::new().generate_index_css_with_themes(&[theme]);
        let built_ins = css
            .find("@import '@almadar/ui/themes/index.css';")
            .expect(&css);
        let own = css.find("@import './themes/sunset.css';").expect(&css);
        assert!(built_ins < own, "{css}");
    }
}
