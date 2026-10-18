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
    OirBindingRoot, OirCardinality, OirConstraint, OirDispatchMode, OirEffect, OirEntity,
    OirExpr, OirModule, OirPersistence, OirTrait,
    OirTransitionFrom, OirType, OirValue,
};
pub(crate) use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

pub(crate) use crate::codegen::{
    generate_all_themes_config_ts, generate_env_manifest, generate_service_clients,
    generate_theme_css, is_operator_name, theme_font_imports, ts_member_name,
};
pub(crate) use orbital_core_base::schema::SExpression;


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

    /// Generate the kernel-hosted TypeScript app from an OIR module (internal): the host glue around
    /// `@almadar/kernel`, the shared types and the resolved program.
    fn generate_internal(&self, module: &OirModule) -> Vec<InternalFile> {
        let mut files = Vec::new();

        // Dedup entities by name: `[runtime]` entities may share a name across orbitals (they are
        // per-orbital singletons with no persistence collection), and codegen emits one declaration
        // per distinct name.
        let entities_dedup: Vec<OirEntity> = module.distinct_entities();
        let entities = &entities_dedup[..];
        {
            let mut catalog = HashMap::new();
            for e in entities {
                catalog.insert(e.name.clone(), e.clone());
            }
            self.entity_catalog.set(catalog);
        }

        files.push(self.generate_shared_entities(entities, &module.named_types));
        files.push(self.generate_shared_schemas(entities, &module.named_types));
        files.push(self.generate_shared_event_types(module));
        files.push(self.generate_shared_trait_configs(module));
        files.push(self.generate_shared_index_kernel());
        files.extend(self.generate_kernel_program());
        match self.server_framework {
            ServerFramework::Hono => files.push(self.generate_shared_package_json_hono()),
            ServerFramework::Express => files.push(self.generate_shared_package_json()),
        }

        if self.target == "client" || self.target == "full" {
            files.extend(self.generate_kernel_client(module));
        }

        if self.target == "server" || self.target == "full" {
            files.extend(self.generate_kernel_server());
            if let Some(f) = self.generate_access_policies(entities) {
                files.push(f);
            }
            match self.server_framework {
                ServerFramework::Express => files.push(self.generate_sse_module(entities, false)),
                ServerFramework::Hono => files.push(self.generate_sse_module_hono(entities, false)),
            }
            files.push(self.generate_viewer_module(entities, self.server_framework));
        }

        // Theme CSS and config (client-side)
        if (self.target == "client" || self.target == "full") && !module.themes.is_empty() {
            for theme in &module.themes {
                let css = generate_theme_css(theme);
                files.push(InternalFile::new(
                    format!("packages/client/src/themes/{}.css", theme.name),
                    css,
                    GeneratedFileType::Config,
                ));
            }
            let config =
                generate_all_themes_config_ts(&module.themes, module.default_theme.as_deref());
            files.push(InternalFile::new(
                "packages/client/src/generated/theme-config.ts",
                config,
                GeneratedFileType::Config,
            ));
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
            let default_theme = &module.themes[0].name;
            files.push(InternalFile::new(
                "packages/client/src/main.tsx",
                self.generate_main_tsx_with_theme(default_theme),
                GeneratedFileType::Config,
            ));
            files.push(InternalFile::new(
                "packages/client/src/index.css",
                self.generate_index_css_with_themes(&module.themes),
                GeneratedFileType::Config,
            ));
        }

        if self.target == "server" || self.target == "full" {
            // Service clients: the template server imports `invokedServices` for its boot-time credential check.
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
            // Inbound deliveries (`/api/hooks/<name>`, EXEC-INBOUND-1) are answered by the kernel host.
            files.push(InternalFile::new(
                "packages/server/src/inbound.ts",
                "/**\n * Inbound deliveries: answered by the kernel host (EXEC-INBOUND-1).\n *\n * @generated by Orbital Compiler (kernel host)\n */\n\nexport { deliverInbound } from './kernel-host.js';\n",
                GeneratedFileType::Route,
            ));
            // Credential manifest for the services this schema invokes.
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
            // packages/server/package.json (Hono only: the Express template's static copy declares
            // every `@almadar/*` package the kernel host imports). Last, so the scan sees every
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
pub(crate) mod client;
mod hono_manifests;
pub mod kernel_host;
pub(crate) mod server;
mod shared;
mod types;
pub(crate) use types::{array_element_ts, map_type_ts, TsTypeMode};
mod utils;

// Free helpers / case converters used across submodules.
pub(crate) use utils::*;
// Shared entity/schema helpers used by client codegen + the pattern registry.
pub use shared::EntityFieldInfo;
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
