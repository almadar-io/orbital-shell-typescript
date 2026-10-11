//! Expression + binding compilation.
//!
//! Shared between Express (`backend.rs`) and Hono (`backend_hono.rs`).
//! Covers the three binding resolution flavours:
//!
//! - `binding_to_ts` / `expr_to_ts`: client-side trait-mirrored entity
//!   (treats `@entity.field` as `fields?.field` — the trait's reducer
//!   mirror populated by `set @entity.X` effects). Earlier versions
//!   resolved this to `entity?.[0]?.field`, picking the first row of
//!   the linked collection regardless of which row the trait was
//!   actually operating on. That heuristic produced silent wrong-data
//!   renders (e.g. delete confirmation showing row[0] while deleting
//!   the actually-targeted row) and is banned per the codebase's
//!   no-heuristics rule. Bare `@entity` still resolves to the
//!   collection variable for back-compat with array iteration.
//! - `binding_to_ts_server` / `expr_to_ts_server`: server-side single-record
//!   entity (treats `@entity.field` as `entity?.field` since handlers get
//!   the row from `getById()`).
//! - `binding_to_client_ts` / `expr_to_client_ts`: client logic hook
//!   context (`@payload` → `payloadObj`, `@config` → `config`).
//!
//! Plus `binding_string_to_ts` (resolves `@path.to.field` string literals
//! in render-ui configs) and `value_to_string` (OirValue → TS literal).
//!
//! §A7 adds a fourth flavour, `binding_to_ts_server_render` /
//! `BindingFlavor::ServerRenderUi`: the compiled server's `clientEffects`
//! tuple builder (`client_effect_tuple_ts`, `pattern_value_to_ts_server`).
//! Same single-record `@entity`/cast-chain `@payload` resolution as
//! `binding_to_ts_server`, except `@trait`/`@pages`/`@currentTheme` round-
//! trip as the literal `@`-string instead of `undefined` — those roots are
//! client-resolved, not server-unreachable, in a render-ui/navigate context
//! (mirrors the kernel's `resolve_effect_bindings` / `BindingContext::
//! resolve_value`, whose only client-exempt root is the same one).
//!
//! Extracted from `backend.rs` as Phase 3e.4 of the DRY refactor.

use orbital_core::ir::{
    OirBinaryOp, OirBinding, OirBindingRoot, OirEffect, OirExpr, OirPattern, OirValue,
};

use crate::backend::{escape_js_string, TypeScriptBackend};
use crate::codegen::ts_ident::ts_member_name;

/// Single-owner payload identifier per emission scope. Every site that
/// resolves `@payload` (a resolver) or declares the binding (a scope
/// constructor) reads one of these — never an inline literal — so the
/// declared name and the referenced name can never drift apart (TS2552).
///
/// - `CLIENT_PAYLOAD_VAR`: the logic-hook `executeTransitionEffects`
///   callback scope. The scope constructor aliases `const payloadObj =
///   payload;` so `binding_to_client_ts` reads can resolve it.
/// - `RENDER_PAYLOAD_VAR`: the View component scope. `lastPayload` is
///   destructured from the hook return, always in scope, so
///   `binding_string_to_ts` reads it directly with no extra alias.
pub(crate) const CLIENT_PAYLOAD_VAR: &str = "payloadObj";
pub(crate) const RENDER_PAYLOAD_VAR: &str = "lastPayload";

/// Typed parameter list for an OirExpr `Lambda`. A body that reads the
/// array-operator index `@index` (lowered to `Local("index")`) without
/// declaring it as a param gets a typed `index` appended so the
/// `.map((el, index) => …)` call site lines up (TS2304).
///
/// `annotate_first` controls param-0 typing. Pass `true` for lambdas emitted
/// into a position with NO contextual type — a `filter` stored in a config
/// object literal `[{ filter: (row) => … }]` — so param 0 gets `EntityRow`
/// (the index-signature row type) instead of falling to implicit-any
/// (TS7006). Pass `false` for the chain-style array-operator args
/// (`(object/entries …).map(fn)`) where the source already produces a typed
/// array (e.g. `[string, T[]][]` from `Object.entries`) and TS infers the
/// param contextually — annotating there would mis-type the tuple (TS2345).
/// Later declared params are always left as-authored — their type depends on
/// the operator (`object/mapValues` key, `reduce` accumulator).
fn lambda_param_decl(params: &[String], body: &OirExpr, first_param_type: Option<&str>) -> String {
    let references_free_index = !params.iter().any(|p| p == "index")
        && body
            .collect_bindings()
            .iter()
            .any(|b| matches!(&b.root, OirBindingRoot::Local(n) if n == "index"));
    let mut decl: Vec<String> = params
        .iter()
        .enumerate()
        .map(|(i, p)| {
            if i == 0 {
                if let Some(ty) = first_param_type {
                    return format!("{}: {}", p, ty);
                }
                p.clone()
            } else {
                p.clone()
            }
        })
        .collect();
    if references_free_index {
        decl.push("index: number".to_string());
    }
    decl.join(", ")
}

/// Binding-resolution flavour for the shared `expr_to_ts_flavored` core.
///
/// The three historical expression compilers (`expr_to_ts`,
/// `expr_to_ts_server`, `expr_to_client_ts`) were byte-for-byte identical
/// except for which `binding_to_ts*` resolver they used, which recursion they
/// made, and two small per-flavour quirks captured here:
///
/// - `Server` does NOT wrap `Concat` operands in `String(... ?? '')` (the
///   server path emitted a bare `(l + r)`); `Client`/`General` do.
/// - `Client` rewrites `(agent/X)` expression-effects to safe stubs (no
///   client-side LLM client); `General`/`Server` fall back to `effect_to_ts`.
/// - `Guard` resolves bindings against the transition-handler scope
///   (`entity`/`payload`-cast, NOT render's `fields?.`) and rewrites
///   `(agent/X)` expression-effects to inline `await getDataService()…`
///   reads — the former `compile_guard_to_ts` emitter, folded in so guards
///   share the one expression core.
/// - `Render` resolves bindings via the render-ui resolver `binding_string_to_ts`
///   (`@entity.f`→`fields?.f`, `@payload.f`→`lastPayload?.f`, `@Entity`→
///   `(data['Entity'] ?? [])`) by round-tripping the `OirBinding` through its
///   `@`-string `Display`. Used to emit operator-valued render-ui props through
///   this one core. (`binding_string_to_ts` is the Pillar-D consolidation
///   target this flavor is the seam for.)
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum BindingFlavor {
    General,
    Server,
    Client,
    Guard,
    Render,
    /// Listen `with{}` / `when` scope: payload-only, resolved against the
    /// bus event in the cross-trait listener hook. Mirrors the interpreter's
    /// payload-only context (`orbital-core/src/runtime/listener.rs`) — every
    /// non-payload root is `undefined` on BOTH paths, never a silent skew.
    ListenerPayload,
    /// §A7: the compiled server's `clientEffects` tuple (render-ui config /
    /// navigate path+params) — `Server`'s single-record entity/payload
    /// resolution, but `@trait`/`@pages`/`@currentTheme` round-trip literal
    /// for the client instead of `Server`'s `undefined` (see module doc).
    ServerRenderUi,
}

impl TypeScriptBackend {
    /// Convert OirValue to string
    pub(crate) fn value_to_string(&self, value: &OirValue) -> String {
        match value {
            OirValue::String(s) => {
                // Check if this is a binding (starts with @)
                if s.starts_with('@') {
                    self.binding_string_to_ts(s)
                } else {
                    s.clone()
                }
            }
            OirValue::Number(n) => n.to_string(),
            OirValue::Bool(b) => b.to_string(),
            OirValue::Null => "null".to_string(),
            OirValue::Array(arr) => {
                let items: Vec<String> = arr.iter().map(|v| self.value_to_string(v)).collect();
                format!("[{}]", items.join(", "))
            }
            OirValue::Object(obj) => {
                let pairs: Vec<String> = obj
                    .iter()
                    .map(|(k, v)| format!("{}: {}", ts_member_name(k), self.value_to_string(v)))
                    .collect();
                format!("{{{}}}", pairs.join(", "))
            }
        }
    }

    /// Compile a fn-form lambda (`OirExpr::Call("fn", [param_name, body])`)
    /// WITHOUT a type annotation on the param. The fn handler in operator.rs
    /// uses the surrounding operator's element type for the annotation; that's
    /// wrong when the source is a `Call` whose JS-typed return shape (tuples,
    /// records) doesn't match the default. Letting TS infer contextually from
    /// the consumer's `.map`/`.filter` signature produces the correct narrow
    /// type. Falls back to the normal `expr_to_ts` path when args don't fit
    /// the fn shape.
    pub(crate) fn compile_unannotated_fn_lambda(&self, expr: &OirExpr) -> String {
        if let OirExpr::Lambda { params, body } = expr {
            let param_decl = lambda_param_decl(params, body, None);
            let body = self.expr_to_ts(body);
            let wrapped_body = if body.trim_start().starts_with('{') {
                format!("({})", body)
            } else {
                body
            };
            return format!("(({}) => {})", param_decl, wrapped_body);
        }
        self.expr_to_ts(expr)
    }

    /// Client-emit variant of `compile_unannotated_fn_lambda` — recurses via
    /// `expr_to_client_ts` so nested @entity / @payload bindings lower with
    /// the client-side resolution (`fields?.X`, `lastPayload?.X`).
    pub(crate) fn compile_unannotated_fn_lambda_client(&self, expr: &OirExpr) -> String {
        if let OirExpr::Lambda { params, body } = expr {
            let param_decl = lambda_param_decl(params, body, None);
            let body = self.expr_to_client_ts(body);
            let wrapped_body = if body.trim_start().starts_with('{') {
                format!("({})", body)
            } else {
                body
            };
            return format!("(({}) => {})", param_decl, wrapped_body);
        }
        self.expr_to_client_ts(expr)
    }

    /// Server-emit variant — recurses via `expr_to_ts_server` so `@entity.X`
    /// resolves to the single-record server form.
    pub(crate) fn compile_unannotated_fn_lambda_server(&self, expr: &OirExpr) -> String {
        if let OirExpr::Lambda { params, body } = expr {
            let param_decl = lambda_param_decl(params, body, None);
            let body = self.expr_to_ts_server(body);
            let wrapped_body = if body.trim_start().starts_with('{') {
                format!("({})", body)
            } else {
                body
            };
            return format!("(({}) => {})", param_decl, wrapped_body);
        }
        self.expr_to_ts_server(expr)
    }

    /// Compile a `@callsitePayload.<path>` reference — the CHILD trait's own
    /// render or effect body reading a value captured at the composing call
    /// site (`embedded_view_config_attr`). `full_path` is every segment
    /// AFTER the `callsitePayload` root (`["data", "status"]` for
    /// `@callsitePayload.data.status`). Shared by both binding-resolution
    /// flavours (`binding_string_to_ts`'s raw string path below,
    /// `binding_to_client_ts`'s typed `OirBinding` path) — one owner so the
    /// pair-match + fallback logic cannot drift between them.
    ///
    /// - A `trait_callsite_captures` pair whose captured field EQUALS
    ///   `full_path`'s dotted join, or is a dotted PREFIX of it, resolves
    ///   through that pair's typed knob (`config?.<knob>`) — a prefix match
    ///   means the reference reaches deeper than what the embed site
    ///   captured verbatim (the SAME captured literal, just read further
    ///   in); any remaining segments are appended as a widened optional
    ///   chain (the `(… as EventPayload | undefined)?.seg` pattern the
    ///   `@payload` arm below uses for its own deeper hops) so the read
    ///   typechecks regardless of the knob's own declared member type.
    /// - No pair, but the trait is `trait_callsite_payload_flagged`: the
    ///   whole composing payload was forwarded
    ///   (`callsitePayload: lastPayload`), typed `EventPayload | undefined`
    ///   on the child's Config — read directly for the first hop, then the
    ///   same per-hop widening for the rest.
    /// - Neither: the composing site never supplies it; `undefined` is
    ///   honest.
    fn compile_callsite_payload_ref(&self, full_path: &[&str]) -> String {
        if full_path.is_empty() {
            return "undefined".to_string();
        }
        let Some(trait_name) = self
            .current_trait_scope
            .snapshot()
            .and_then(|scope| scope.rsplit('.').next().map(|s| s.to_string()))
        else {
            return "undefined".to_string();
        };
        let field_dotted = full_path.join(".");
        let pair_hit: Option<(String, Vec<String>)> = self
            .trait_callsite_captures
            .borrow()
            .get(&trait_name)
            .and_then(|pairs| {
                pairs.iter().find_map(|(knob, field, _ty)| {
                    if field_dotted == *field {
                        Some((knob.clone(), Vec::new()))
                    } else if let Some(rest) = field_dotted.strip_prefix(&format!("{field}.")) {
                        Some((knob.clone(), rest.split('.').map(String::from).collect()))
                    } else {
                        None
                    }
                })
            });
        if let Some((knob, tail)) = pair_hit {
            let mut chain = format!("config?.{}", knob);
            for seg in &tail {
                chain = format!("({} as EventPayload | undefined)?.{}", chain, seg);
            }
            return chain;
        }
        if self
            .trait_callsite_payload_flagged
            .borrow()
            .contains(&trait_name)
        {
            let mut chain = format!("config?.callsitePayload?.{}", full_path[0]);
            for seg in &full_path[1..] {
                chain = format!("({} as EventPayload | undefined)?.{}", chain, seg);
            }
            return chain;
        }
        "undefined".to_string()
    }

    /// Note: In render-ui context, @payload maps to lastPayload (stored from last event dispatch)
    /// since payload is only available in the dispatch function, not in the UI rendering context.
    /// The lastPayload stores the event payload from the most recent dispatch.
    pub(crate) fn binding_string_to_ts(&self, s: &str) -> String {
        if !s.starts_with('@') {
            return s.to_string();
        }

        // Safety: reject concatenated bindings (e.g., "@entity.price @entity.currency")
        // These produce broken JSX if we try to resolve them.
        if s.contains(' ') {
            // Use only the first binding, ignore the rest
            let first_binding = s.split(' ').next().unwrap_or(s);
            return self.binding_string_to_ts(first_binding);
        }

        let s = &s[1..]; // Remove @
        let parts: Vec<&str> = s.split('.').collect();

        if parts.is_empty() {
            return "undefined".to_string();
        }

        // `@now` reads the dispatch's one stamp, bound as `now` in every generated scope.
        if parts.len() == 1 && parts[0] == "now" {
            return "now".to_string();
        }

        // `@locale` is the view's `useTranslate()` locale (render-time only).
        if parts.len() == 1 && parts[0] == "locale" {
            return "__locale".to_string();
        }

        // @payload.row, @payload.item, @payload.data — direct payload access
        if parts.len() >= 2 && parts[0] == "payload" && matches!(parts[1], "row" | "item" | "data")
        {
            if parts.len() == 2 {
                return format!("{}?.{}", RENDER_PAYLOAD_VAR, parts[1]);
            }
            // `.length` only typechecks on string / array branches of the
            // `EventPayloadValue` union. Without the cast, `?.length` errors
            // against the wide payload type. The `?.` chain still short-
            // circuits to undefined at runtime, so behavior is unchanged.
            if parts.last() == Some(&"length") {
                let prefix = parts[1..parts.len() - 1].join("?.");
                return format!(
                    "({}?.{} as {{ readonly length: number }} | undefined)?.length",
                    RENDER_PAYLOAD_VAR, prefix
                );
            }
            // Each hop past `lastPayload?.<root>` reads a property off the
            // wide `EventPayloadValue` union — re-widen per hop or the
            // access is ill-typed (TS2339). Runtime behavior unchanged: the
            // `?.` chain still short-circuits to undefined.
            let mut chain = format!("{}?.{}", RENDER_PAYLOAD_VAR, parts[1]);
            for part in &parts[2..] {
                chain = format!("({} as EventPayload | undefined)?.{}", chain, part);
            }
            return chain;
        }

        // Map root to JS variable.
        // `entity` bare → the linked-collection array (kept for any
        // array-iteration use). `entity.<field>` → `fields?.<field>` —
        // the trait's reducer mirror populated by `set @entity.X`
        // effects. The View destructures `fields` from the logic
        // hook (backend.rs); when no `set @entity.X` has run, `fields`
        // is `{}` and the binding evaluates to undefined → empty
        // render, surfacing the binding gap loudly instead of silently
        // showing row[0]. Special-cased here because the path-joining
        // below would otherwise prepend "fields?" with the full
        // remaining path, which is what we want.
        let root = match parts[0] {
            "entity" => {
                if parts.len() > 1 {
                    let remaining = parts[1..].join("?.");
                    return format!("fields?.{}", remaining);
                }
                "entity"
            }
            "_item" => "item", // Item-scoped binding for data-list/data-grid render-prop children (legacy)
            "payload" => RENDER_PAYLOAD_VAR, // Event payload stored in reducer
            "state" => "state",
            "config" => "config",
            "user" => "user",
            // `@trait.<Name>` as a config VALUE (`hud: @trait.PongHud`) is a
            // render-time TraitFieldRef the CLIENT resolves via TraitFrame —
            // preserve the literal string (matching the literal-preserving
            // pattern-prop path); the previous fallthrough emitted a bare
            // `trait?.<Name>` read of an undeclared identifier
            // (C-TRAITFIELDREF-CONFIG-VALUE-CRASH — crashed every arcade
            // game's shell view on mount).
            "trait" => {
                return format!("\"@{}\"", parts.join("."));
            }
            // `@callsitePayload.<path>` in the CHILD's own render: the value
            // was captured at the composing call site and passed down as the
            // capturing config knob (`embedded_view_config_attr`) — read it
            // back through `config?.<knob>`, or, for a NESTED reference no
            // knob covers, through the forwarded whole payload
            // (`compile_callsite_payload_ref`). Bare `callsitePayload` does
            // not exist in the generated scope (TS2552).
            "callsitePayload" => {
                return self.compile_callsite_payload_ref(&parts[1..]);
            }
            _ => {
                // PascalCase roots (e.g., @Task, @Order) — resolve to data collection
                // Lowercase single-char roots (lambda vars) — pass through as-is
                if parts[0].chars().next().is_some_and(|c| c.is_uppercase()) {
                    // @EntityName.field -> (data['EntityName'] ?? [])?.[0]?.field
                    // This is a shorthand for accessing the first entity in the collection
                    if parts.len() == 1 {
                        return format!("(data['{}'] ?? [])", parts[0]);
                    } else {
                        let remaining = parts[1..].join("?.");
                        return format!("(data['{}'] ?? [])?.[0]?.{}", parts[0], remaining);
                    }
                }
                // Lambda variable or unknown — pass through
                parts[0]
            }
        };

        if parts.len() == 1 {
            root.to_string()
        } else {
            // Always use optional chaining at the first hop. `config` is
            // sometimes optional (when the trait has no declared
            // defaults: `mergedConfig = config` → `config?: <T>Config` on
            // the hook return) and sometimes required (defaults exist).
            // `?.` is safe in both cases — on the non-optional path it's
            // a no-op for TS, and on the optional path it correctly
            // narrows. Field-level non-optionality for defaulted config
            // fields still holds via the generated `<T>Config` interface
            // marking those fields required, so `config?.articles[0]`
            // returns the entry directly (no further `?.` needed before
            // the indexed access).
            let first_hop = "?.";
            // Path segments may contain literal index access (`articles[0]`)
            // — keep those un-chained (`[0]` not `?.[0]`) so index access
            // resolves to `T` not `T | undefined`. The tsconfig that
            // consumes generated code does not enable
            // `noUncheckedIndexedAccess`, and an out-of-bounds access
            // surfaces loudly via TypeError, matching the lolo author's
            // intent of "this index exists" (e.g. `articles[0]` after
            // declaring 3 articles in the default).
            format!("{}{}{}", root, first_hop, parts[1..].join("?."))
        }
    }

    /// Convert OirExpr to TypeScript code (client render-time / general
    /// binding resolution). Thin wrapper over `expr_to_ts_flavored`.
    pub fn expr_to_ts(&self, expr: &OirExpr) -> String {
        self.expr_to_ts_flavored(expr, BindingFlavor::General)
    }

    /// Server-side expression-to-TypeScript conversion.
    ///
    /// Identical to `expr_to_ts` except `@entity.field` compiles to `entity?.field`
    /// (single object from getById) instead of `entity?.[0]?.field` (client array).
    pub(crate) fn expr_to_ts_server(&self, expr: &OirExpr) -> String {
        self.expr_to_ts_flavored(expr, BindingFlavor::Server)
    }

    /// Shared expression compiler. The `flavor` selects binding resolution
    /// (`binding_to_ts` / `_server` / `_client`), the fn-lambda recursion, the
    /// `Concat` `String()`-wrap (off for `Server`), and the `(agent/X)`
    /// expression-effect stubbing (on for `Client`).
    pub(crate) fn expr_to_ts_flavored(&self, expr: &OirExpr, flavor: BindingFlavor) -> String {
        let recur = |e: &OirExpr| self.expr_to_ts_flavored(e, flavor);
        // The `Client` flavour historically delegated the higher-order
        // `Map`/`Filter`/`Reduce` arms to the GENERAL compiler (its old
        // `_ => self.expr_to_ts(expr)` fallback), so those sub-expressions
        // resolved `@payload` via the typed `(payload as EventPayload …)`
        // form rather than client `payloadObj`. Preserve that by downgrading
        // Client→General for these arms only.
        let recur_complex = |e: &OirExpr| {
            let f = if flavor == BindingFlavor::Client {
                BindingFlavor::General
            } else {
                flavor
            };
            self.expr_to_ts_flavored(e, f)
        };
        match expr {
            OirExpr::Null => "null".to_string(),
            OirExpr::Bool { value } => value.to_string(),
            OirExpr::Number { value } => value.to_string(),
            OirExpr::String { value } => format!("\"{}\"", escape_js_string(value)),
            OirExpr::Array { items } => {
                let ts_items: Vec<String> = items.iter().map(&recur).collect();
                format!("[{}]", ts_items.join(", "))
            }
            OirExpr::Object { fields } => {
                let ts_fields: Vec<String> = fields
                    .iter()
                    .map(|(k, v)| {
                        // A lambda STORED as an object value (e.g. a `filter`
                        // knob in a config object literal `[{ filter: (row) =>
                        // … }]`) is never immediately applied, so it gets no
                        // contextual type — annotate param 0 (`EntityRow`) to
                        // avoid implicit-any TS7006. A lambda passed DIRECTLY to
                        // `.map`/`.filter` (the Lambda arm below) is left
                        // unannotated so TS infers the element type from the
                        // source array (annotating there mis-types config-object
                        // and tuple sources — TS2345).
                        if let OirExpr::Lambda { params, body } = v {
                            let pd = lambda_param_decl(params, body, Some("EntityRow"));
                            let b = recur(body);
                            let b = if b.trim_start().starts_with('{') {
                                format!("({})", b)
                            } else {
                                b
                            };
                            format!("{}: ({}) => {}", ts_member_name(k), pd, b)
                        } else if let OirExpr::String { value } = v {
                            // String literals in object literals must not widen
                            // to `string`: pattern-descriptor arrays (drawables,
                            // menu options, …) are assigned to discriminated
                            // unions (DrawableNode[]) where widening breaks
                            // assignability (TS2322).
                            format!(
                                "{}: \"{}\" as const",
                                ts_member_name(k),
                                escape_js_string(value)
                            )
                        } else {
                            format!("{}: {}", ts_member_name(k), recur(v))
                        }
                    })
                    .collect();
                format!("{{ {} }}", ts_fields.join(", "))
            }
            OirExpr::Lambda { params, body } => {
                // `ServerRenderUi` compiles a lambda inline inside a
                // pattern-config object literal (`renderItem: (item) =>
                // …`) that flows into a `ClientEffectTuple` array element —
                // a UNION-typed position TS does not contextually type
                // through, unlike a direct `.map(callback)`/typed-variable
                // assignment (the other `lambda_param_decl` call sites,
                // which stay contextually-inferred on purpose), so the
                // param is otherwise implicit-`any` (TS7006). `EntityRow`
                // — the SAME annotation the one other "per-item shape is
                // ambiguous" caller above already uses — is the one owner
                // for this: unlike `unknown`, it stays assignable into the
                // body's own `getNestedValue(item, …)` operator calls
                // (which want `EntityRow | EventPayload | FieldValue |
                // EventPayloadValue | …`, not `unknown` — TS2345) as well
                // as into the `(item as EventPayload | undefined)?.field`
                // casts other bodies use.
                let first_param_type =
                    matches!(flavor, BindingFlavor::ServerRenderUi).then_some("EntityRow");
                let param_decl = lambda_param_decl(params, body, first_param_type);
                let body_ts = recur(body);
                let wrapped = if body_ts.trim_start().starts_with('{') {
                    format!("({})", body_ts)
                } else {
                    body_ts
                };
                format!("({}) => {}", param_decl, wrapped)
            }
            OirExpr::Binding { binding } => match flavor {
                BindingFlavor::General => self.binding_to_ts(binding),
                BindingFlavor::Server => self.binding_to_ts_server(binding),
                BindingFlavor::Client => self.binding_to_client_ts(binding),
                BindingFlavor::Guard => self.binding_to_ts_guard(binding),
                // Reuse the render-ui string resolver via the binding's
                // canonical `@`-string round-trip (Display ↔ parse).
                BindingFlavor::Render => self.binding_string_to_ts(&binding.to_string()),
                BindingFlavor::ListenerPayload => self.binding_to_ts_listener_payload(binding),
                BindingFlavor::ServerRenderUi => self.binding_to_ts_server_render(binding),
            },
            OirExpr::BinaryOp { op, left, right } => {
                let l = recur(left);
                let r = recur(right);
                let op_str = match op {
                    OirBinaryOp::Add => "+",
                    OirBinaryOp::Sub => "-",
                    OirBinaryOp::Mul => "*",
                    OirBinaryOp::Div => "/",
                    OirBinaryOp::Mod => "%",
                    OirBinaryOp::Eq => "===",
                    OirBinaryOp::Ne => "!==",
                    OirBinaryOp::Lt => "<",
                    OirBinaryOp::Gt => ">",
                    OirBinaryOp::Le => "<=",
                    OirBinaryOp::Ge => ">=",
                    OirBinaryOp::And => "&&",
                    OirBinaryOp::Or => "||",
                    OirBinaryOp::Concat => "+",
                };
                let is_arithmetic = matches!(
                    op,
                    OirBinaryOp::Add
                        | OirBinaryOp::Sub
                        | OirBinaryOp::Mul
                        | OirBinaryOp::Div
                        | OirBinaryOp::Mod
                );
                // Numeric comparison ops (`< > <= >=`) also need the
                // `?? 0` wrap on binding operands — TS strict mode
                // rejects `optionalNumber < optionalNumber` with
                // TS18048 "possibly undefined". Same Number coercion
                // as arithmetic so a missing field compares as 0.
                let is_numeric_cmp = matches!(
                    op,
                    OirBinaryOp::Lt | OirBinaryOp::Gt | OirBinaryOp::Le | OirBinaryOp::Ge
                );
                // `Server` historically emitted a bare `(l + r)` for Concat
                // (no `String(... ?? '')` wrap); the client/general views
                // wrap. Gate the concat-wrap branch on the flavour to keep
                // each path byte-identical to its pre-merge output.
                let is_concat =
                    matches!(op, OirBinaryOp::Concat) && flavor != BindingFlavor::Server;
                // A `Binding` operand is genuinely optional (`x?.y`); so is an
                // `object/get` `Call` node — its own codegen is honestly
                // `FieldValue | undefined` (`codegen/operator.rs`), the same
                // shape a raw binding read has. Every OTHER operator call
                // (`array/len`, `time/parse`, …) already returns a definite
                // non-nullish value, and wrapping one in `?? 0`/`String(…
                // ?? '')` would make the coalesce unreachable (TS2869) — so
                // this stays keyed on the ONE operator whose return type this
                // session widened, never a blanket `Call` match.
                fn is_wide_optional_source(e: &OirExpr) -> bool {
                    matches!(e, OirExpr::Binding { .. })
                        || matches!(e, OirExpr::Call { function, .. } if function == "object/get")
                }
                if is_arithmetic || is_numeric_cmp {
                    let l_safe = if is_wide_optional_source(left.as_ref()) {
                        format!("+({} ?? 0)", l)
                    } else {
                        l
                    };
                    let r_safe = if is_wide_optional_source(right.as_ref()) {
                        format!("+({} ?? 0)", r)
                    } else {
                        r
                    };
                    format!("({} {} {})", l_safe, op_str, r_safe)
                } else if is_concat {
                    let l_safe = if is_wide_optional_source(left.as_ref()) {
                        crate::codegen::effect::shared::string_coerce_ts(&l)
                    } else {
                        l
                    };
                    let r_safe = if is_wide_optional_source(right.as_ref()) {
                        crate::codegen::effect::shared::string_coerce_ts(&r)
                    } else {
                        r
                    };
                    format!("({} {} {})", l_safe, op_str, r_safe)
                } else if matches!(op, OirBinaryOp::And | OirBinaryOp::Or) {
                    // Short-circuit fold And/Or once EITHER side has already
                    // compiled to the literal `"true"`/`"false"` string — the
                    // common case is an Eq/Ne fold just below collapsing one
                    // operand of `(and (= @config.openOn "init") ...)` to
                    // `"false"` once `openOn` is inlined to a call-site value
                    // that isn't "init". Left unfolded, `(false && rest)`
                    // reaches `generate_state_dispatch_switch`'s dead-arm
                    // prune, which only matches the guard's FULL string
                    // against the bare literal `"false"` — a compound `&&`/
                    // `||` slips past it, gets emitted as a live but
                    // provably-unreachable branch, and unreachable code is
                    // exactly where tsc stops applying control-flow
                    // narrowing (an `if (entity)` guard inside it no longer
                    // narrows `entity`, surfacing as spurious TS18047/TS2339
                    // under strict null checks). Folding here — the same
                    // boolean-algebra identity for `&&`/`||`, not a pattern
                    // keyed on any guard's shape — keeps a guard's compiled
                    // truth value decidable by simple substring comparison
                    // wherever it ends up, same as a bare Eq/Ne fold.
                    match op {
                        OirBinaryOp::And => {
                            if l == "false" || r == "false" {
                                "false".to_string()
                            } else if l == "true" {
                                r
                            } else if r == "true" {
                                l
                            } else {
                                format!("({} {} {})", l, op_str, r)
                            }
                        }
                        OirBinaryOp::Or => {
                            if l == "true" || r == "true" {
                                "true".to_string()
                            } else if l == "false" {
                                r
                            } else if r == "false" {
                                l
                            } else {
                                format!("({} {} {})", l, op_str, r)
                            }
                        }
                        _ => unreachable!("guarded by the outer matches!"),
                    }
                } else {
                    // Constant-fold literal-vs-literal Eq/Ne. The inline phase
                    // substitutes `@config.X` with the call-site literal, so
                    // `(if (= @config.aggregation "sum") ...)` arrives here as
                    // `Eq("count", "sum")` for a `count`-mode call site.
                    // Emitting `("count" === "sum")` directly trips TS2367
                    // (no-overlap comparison). Folding here yields literal
                    // `true`/`false`, which the surrounding `if` then prunes
                    // away cleanly. Mirrors guard.rs's same-purpose fold.
                    let folded = match (op, left.as_ref(), right.as_ref()) {
                        (
                            OirBinaryOp::Eq,
                            OirExpr::String { value: a },
                            OirExpr::String { value: b },
                        ) => Some((a == b).to_string()),
                        (
                            OirBinaryOp::Ne,
                            OirExpr::String { value: a },
                            OirExpr::String { value: b },
                        ) => Some((a != b).to_string()),
                        (
                            OirBinaryOp::Eq,
                            OirExpr::Number { value: a },
                            OirExpr::Number { value: b },
                        ) => Some(((a - b).abs() < f64::EPSILON).to_string()),
                        (
                            OirBinaryOp::Ne,
                            OirExpr::Number { value: a },
                            OirExpr::Number { value: b },
                        ) => Some(((a - b).abs() >= f64::EPSILON).to_string()),
                        (
                            OirBinaryOp::Eq,
                            OirExpr::Bool { value: a },
                            OirExpr::Bool { value: b },
                        ) => Some((a == b).to_string()),
                        (
                            OirBinaryOp::Ne,
                            OirExpr::Bool { value: a },
                            OirExpr::Bool { value: b },
                        ) => Some((a != b).to_string()),
                        _ => None,
                    };
                    folded.unwrap_or_else(|| format!("({} {} {})", l, op_str, r))
                }
            }
            OirExpr::UnaryOp { op, operand } => {
                let o = recur(operand);
                match op {
                    orbital_core::ir::OirUnaryOp::Not => format!("!{}", o),
                    orbital_core::ir::OirUnaryOp::Neg => format!("-{}", o),
                }
            }
            OirExpr::Conditional {
                condition,
                then_branch,
                else_branch,
            } => {
                // A literal condition (or one a comparison folded to a literal) picks its branch
                // here: `(true ? a : b)` / `("x" ? a : b)` is TS2872, and a `??` over it TS2869.
                let literal = match condition.as_ref() {
                    OirExpr::String { value } => Some(!value.is_empty()),
                    OirExpr::Number { value } => Some(*value != 0.0),
                    OirExpr::Bool { value } => Some(*value),
                    OirExpr::Null => Some(false),
                    _ => None,
                };
                let c = recur(condition);
                match literal.or(match c.as_str() {
                    "true" => Some(true),
                    "false" => Some(false),
                    _ => None,
                }) {
                    Some(true) => recur(then_branch),
                    Some(false) => recur(else_branch),
                    None => format!("({} ? {} : {})", c, recur(then_branch), recur(else_branch)),
                }
            }
            OirExpr::Call { function, args } => {
                // `(let ((name value)…) body)` in a VALUE/GUARD position →
                // an IIFE returning the body, with each binding as a `const`.
                // (The effect/statement context handles `let` separately in
                // tick.rs.) Body references to the bound names already render
                // as bare identifiers, so the consts are in scope.
                if function == "let" && args.len() == 2 {
                    if let OirExpr::Array { items } = &args[0] {
                        let mut decls: Vec<String> = Vec::new();
                        for pair in items {
                            if let OirExpr::Array { items: kv } = pair {
                                if kv.len() == 2 {
                                    if let OirExpr::String { value: name } = &kv[0] {
                                        decls.push(format!("const {} = {};", name, recur(&kv[1])));
                                    }
                                }
                            }
                        }
                        if !decls.is_empty() {
                            return format!(
                                "(() => {{ {} return {}; }})()",
                                decls.join(" "),
                                recur(&args[1])
                            );
                        }
                    }
                }
                // Static unroll: `(array/map LITERAL fn-form)` where the
                // source is a JSON-literal array and the lambda is a
                // single-param fn-form gets iterated at codegen time. Each
                // iteration's body is fully specialized via parameter
                // substitution, so per-item SExpression-shaped fields
                // (e.g. a `filter` that's itself an fn-form) bake into
                // pure TS callbacks instead of leaving runtime path-walks
                // that would TypeError when used as `.filter`/`.map`
                // callbacks. See `try_static_map_substitutions` for the
                // substitution rules.
                if (function == "array/map" || function == "map") && args.len() >= 2 {
                    if let Some(substituted) = try_static_map_substitutions(args) {
                        let compiled: Vec<String> = substituted.iter().map(&recur).collect();
                        return format!("[{}]", compiled.join(", "));
                    }
                }
                // Chain-style emit: when the source of `array/map` or
                // `array/filter` is itself a `Call` (e.g.
                // `(array/map (object/entries (array/groupBy …)) …)`),
                // the source's own codegen already produces a typed
                // array. Applying the wide `as readonly EntityRow[]`
                // cast on top would mis-type the chain — Object.entries
                // returns `[string, T[]][]`, not EntityRow[]. Emit
                // `(<inner>).<method>(<unannotated-lambda>)` directly so
                // TS infers the param type contextually from the source.
                // The wide cast still applies when the source is a
                // Binding (@payload.X, @entity.X) — those resolve to
                // opaque payload/field types that genuinely need the cast.
                if (function == "array/map"
                    || function == "map"
                    || function == "array/filter"
                    || function == "filter")
                    && args.len() == 2
                    && matches!(&args[0], OirExpr::Call { .. })
                {
                    let inner = recur(&args[0]);
                    let lambda = match flavor {
                        BindingFlavor::General
                        | BindingFlavor::Guard
                        | BindingFlavor::Render
                        | BindingFlavor::ListenerPayload => {
                            self.compile_unannotated_fn_lambda(&args[1])
                        }
                        BindingFlavor::Server | BindingFlavor::ServerRenderUi => {
                            self.compile_unannotated_fn_lambda_server(&args[1])
                        }
                        BindingFlavor::Client => {
                            self.compile_unannotated_fn_lambda_client(&args[1])
                        }
                    };
                    let method = if function.starts_with("array/filter") || function == "filter" {
                        "filter"
                    } else {
                        "map"
                    };
                    // The chain trust ("a Call source already emits a typed
                    // array") holds only for an operator the registry declares
                    // as returning an array. Anything else (`array/reduce`'s
                    // accumulator, an `object/get` field value) is the wide
                    // `EventPayloadValue`: wrap it in the nullable-cast so the
                    // `.filter`/`.map` target is concretely an array (TS2339 on
                    // the method, TS7006 on the lambda param otherwise).
                    let inner_returns_array = matches!(
                        &args[0],
                        OirExpr::Call { function: f, .. }
                            if crate::codegen::infer::operator_returns_array(f)
                    );
                    if !inner_returns_array {
                        return format!(
                            "(({} as readonly EventPayloadValue[] | undefined) ?? []).{}({})",
                            inner, method, lambda
                        );
                    }
                    return format!("({}).{}({})", inner, method, lambda);
                }
                let ts_args: Vec<String> = args.iter().map(recur).collect();
                // Phase E: infer the source array's element type from
                // args[0] so operator.rs templates can emit typed
                // lambda params + source casts instead of `: any` /
                // `readonly any[]`. Inference is None for opaque sources
                // (the templates then keep the wide `any` fallback).
                let elem_ts = if !args.is_empty() {
                    let ctx = self.build_codegen_ctx(None, None, None);
                    crate::codegen::infer::infer_oirexpr_element_type_ts(&args[0], &ctx)
                        .or_else(|| lambda_reads_param_fields(args.get(1)).then(|| "EntityRow".to_string()))
                        // An empty literal walked by a callback has no elements to contradict rows.
                        .or_else(|| {
                            (matches!(args.first(), Some(OirExpr::Array { items }) if items.is_empty())
                                && matches!(args.get(1), Some(OirExpr::Lambda { .. })))
                            .then(|| "EntityRow".to_string())
                        })
                } else {
                    None
                };
                let facts: Vec<crate::codegen::infer::ArgFacts> =
                    args.iter().map(crate::codegen::infer::arg_facts).collect();
                // A bare `[]` is `never[]` to tsc; give an empty literal receiver its element type.
                let mut ts_args = ts_args;
                // A server-render callback over a source cast to its known element type is
                // typed contextually by that source; the `EntityRow` annotation (for a lambda
                // in an untyped config position) would reject a struct element (TS2345).
                if matches!(flavor, BindingFlavor::ServerRenderUi)
                    && elem_ts.is_some()
                    && matches!(args.get(1), Some(OirExpr::Lambda { .. }))
                    && !matches!(args.first(), Some(OirExpr::Array { items }) if items.is_empty())
                {
                    ts_args[1] = self.compile_unannotated_fn_lambda_server(&args[1]);
                }
                if let (Some(OirExpr::Array { items }), Some(elem)) = (args.first(), elem_ts.as_deref()) {
                    if items.is_empty() {
                        ts_args[0] = format!("([] as readonly {}[])", elem);
                    }
                }
                self.call_to_ts_typed(function, &ts_args, &facts, elem_ts.as_deref())
            }
            OirExpr::Map {
                source,
                variable,
                body,
            } => {
                format!(
                    "{}.map({} => {})",
                    recur_complex(source),
                    variable,
                    recur_complex(body)
                )
            }
            OirExpr::Filter {
                source,
                variable,
                predicate,
            } => {
                format!(
                    "{}.filter({} => {})",
                    recur_complex(source),
                    variable,
                    recur_complex(predicate)
                )
            }
            OirExpr::Reduce {
                source,
                variable,
                accumulator,
                initial,
                body,
            } => {
                format!(
                    "{}.reduce(({}, {}) => {}, {})",
                    recur_complex(source),
                    accumulator,
                    variable,
                    recur_complex(body),
                    recur_complex(initial)
                )
            }
            OirExpr::Effect { effect } => {
                if flavor == BindingFlavor::Guard {
                    return "true".to_string();
                }
                self.effect_to_ts(effect)
            }
        }
    }

    /// `@event` / `@prevEvents` / `@prevStates` read the dispatch scope; `@fromState` is the incoming
    /// state and `@toState` the transition's target (Runtime Spec Clauses 3.3, 5.5).
    pub(crate) fn dispatch_root_ts(&self, binding: &OirBinding, from_state: &str) -> String {
        match &binding.root {
            OirBindingRoot::Event => binding
                .path
                .iter()
                .fold("__dispatch.event".to_string(), |expr, seg| {
                    format!("({expr} as EventPayload | undefined)?.{seg}")
                }),
            OirBindingRoot::PrevEvents => "__dispatch.prevEvents".to_string(),
            OirBindingRoot::PrevStates => "__dispatch.prevStates".to_string(),
            OirBindingRoot::ToState => match &*self.current_transition.borrow() {
                Some(scope) => format!("'{}'", escape_js_string(&scope.to)),
                None => from_state.to_string(),
            },
            _ => from_state.to_string(),
        }
    }

    /// Inside a transition's effects `state` is the committed target (Runtime Spec Clause 3.3).
    fn post_commit_state_ts(&self, binding: &OirBinding) -> Option<String> {
        if binding.root != OirBindingRoot::State {
            return None;
        }
        match &*self.current_transition.borrow() {
            Some(scope) if scope.phase == crate::backend::TransitionPhase::Effect => {
                Some(format!("'{}'", escape_js_string(&scope.to)))
            }
            _ => None,
        }
    }

    pub(crate) fn binding_to_ts(&self, binding: &OirBinding) -> String {
        if let Some(committed) = self.post_commit_state_ts(binding) {
            return committed;
        }
        let root = match &binding.root {
            OirBindingRoot::Event
            | OirBindingRoot::PrevEvents
            | OirBindingRoot::PrevStates
            | OirBindingRoot::FromState
            | OirBindingRoot::ToState => return self.dispatch_root_ts(binding, "state"),
            // The view's `useTranslate()` locale (render-time only).
            OirBindingRoot::Locale => return "__locale".to_string(),
            // `entity` bare → the linked-collection array. `entity.<field>`
            // → `fields?.<field>` — the trait's reducer mirror populated by
            // `set @entity.X` effects. See the module-level docstring for
            // the rationale (no-heuristics rule; row[0] fallback removed).
            OirBindingRoot::Entity => {
                if binding.path.is_empty() {
                    "entity".to_string()
                } else {
                    let path = binding.path.join("?.");
                    return format!("fields?.{}", path);
                }
            }
            // Deep payload access threads through `EventPayload`. The payload
            // type for a transition is the narrowed payload interface, which
            // doesn't always declare nested keys (`row`, `result`, ...) the
            // author wrote in the lolo. Casting to `EventPayload` opens the
            // index signature; intermediate segments re-cast to
            // `EventPayload | undefined` so chained `?.` access compiles —
            // `EventPayloadValue`'s primitive branches reject `?.X`. The
            // outer call-site cast (e.g. `as typeof entity['X']` in `set`)
            // narrows the final `EventPayloadValue | undefined` to the
            // expected field type. No `any` anywhere in the chain.
            OirBindingRoot::Payload => {
                if binding.path.is_empty() {
                    return "payload".to_string();
                }
                if binding.path.len() == 1 {
                    return format!("(payload as EventPayload | undefined)?.{}", binding.path[0]);
                }
                let mut expr =
                    format!("(payload as EventPayload | undefined)?.{}", binding.path[0]);
                for seg in &binding.path[1..] {
                    expr = format!("({} as EventPayload | undefined)?.{}", expr, seg);
                }
                return expr;
            }
            OirBindingRoot::State => "state".to_string(),
            // Config is fully inlined before server-side codegen — measured zero
            // reachable sites across the corpus (config-only atoms included). It
            // previously fell through to `user`, so a validator miss would have
            // read a viewer field where a config value was meant
            // (C-SERVER-CONFIG-BINDING-COMPILES-TO-USER). Emit `undefined` like
            // the `Trait(_)` arm below: evaluate cleanly, never cross-wire.
            OirBindingRoot::Config => return self.captured_knob_server_ts(binding),
            OirBindingRoot::User => "user".to_string(),
            OirBindingRoot::Trait(_) | OirBindingRoot::Pages | OirBindingRoot::CurrentTheme => {
                // `@trait.X` is a client-only render-time binding; it should
                // never reach this server-side TS expression compiler. If it
                // does (validator miss), emit `undefined` so the expression
                // evaluates cleanly instead of producing invalid JS.
                return "undefined".to_string();
            }
            OirBindingRoot::Local(name) => {
                if name == "now" {
                    return "now".to_string();
                }
                // @context.field → user?.field (context is an alias for user)
                if name == "context" {
                    "user".to_string()
                }
                // @EntityName.field → entity?.[0]?.field (PascalCase = entity type reference, array)
                else if name.chars().next().is_some_and(|c| c.is_uppercase()) {
                    if binding.path.is_empty() {
                        "entity".to_string()
                    } else {
                        "entity?.[0]".to_string()
                    }
                } else {
                    // Lambda param over an opaque payload collection: widen
                    // through the `(x as EventPayload | undefined)?.seg` chain
                    // (same as the guard flavor and the Payload arm above) —
                    // a bare `row?.field` is TS2339 on the wide
                    // `EventPayloadValue` element union
                    // (C-COMPILED-PATH-RED §25).
                    if !binding.path.is_empty() {
                        let mut expr = format!(
                            "({} as EventPayload | undefined)?.{}",
                            name, binding.path[0]
                        );
                        for seg in &binding.path[1..] {
                            expr = format!("({} as EventPayload | undefined)?.{}", expr, seg);
                        }
                        return expr;
                    }
                    name.clone()
                }
            }
        };

        if binding.path.is_empty() {
            root
        } else {
            format!("{}?.{}", root, binding.path.join("?."))
        }
    }

    /// Server-side binding-to-TypeScript conversion.
    ///
    /// On the server, `entity` is a single object from `getById()`, not an array.
    /// This avoids the `entity?.[0]` indexing that `binding_to_ts` uses for
    /// client-side array-backed entity stores.
    /// Compile a guard expression to TS — a thin alias for the shared
    /// expression core with the guard binding/effect flavour. (Was the
    /// standalone `compile_guard_to_ts` emitter in the deleted `guard.rs`.)
    pub(crate) fn compile_guard_to_ts(&self, expr: &OirExpr) -> String {
        self.expr_to_ts_flavored(expr, BindingFlavor::Guard)
    }

    /// Binding resolver for the guard/transition-handler scope: `@entity`→
    /// `entity`, `@payload.x`→`(payload as EventPayload | undefined)?.x`,
    /// `@config`/`@trait`→`undefined` (inlined or render-only). Distinct from
    /// the render resolver `binding_to_ts` (`fields?.x`).
    pub(crate) fn binding_to_ts_guard(&self, binding: &OirBinding) -> String {
        if let Some(committed) = self.post_commit_state_ts(binding) {
            return committed;
        }
        let root = match &binding.root {
            OirBindingRoot::Event
            | OirBindingRoot::PrevEvents
            | OirBindingRoot::PrevStates
            | OirBindingRoot::FromState
            | OirBindingRoot::ToState => return self.dispatch_root_ts(binding, "state"),
            OirBindingRoot::User => "user",
            OirBindingRoot::Payload => {
                if binding.path.is_empty() {
                    "payload"
                } else if binding.path.len() == 1 {
                    return format!("(payload as EventPayload | undefined)?.{}", binding.path[0]);
                } else {
                    let mut expr =
                        format!("(payload as EventPayload | undefined)?.{}", binding.path[0]);
                    for seg in &binding.path[1..] {
                        expr = format!("({} as EventPayload | undefined)?.{}", expr, seg);
                    }
                    return expr;
                }
            }
            OirBindingRoot::Entity => "entity",
            OirBindingRoot::State => "state",
            // `@config.X` is normally inlined to a literal before codegen
            // (Phase 3.A). A residual `@config`/`@trait` binding → `undefined`
            // so the guard short-circuits cleanly (never reads `user`).
            OirBindingRoot::Config => return self.captured_knob_server_ts(binding),
            OirBindingRoot::Trait(_) | OirBindingRoot::Pages | OirBindingRoot::CurrentTheme | OirBindingRoot::Locale => {
                return "undefined".to_string()
            }
            OirBindingRoot::Local(name) => {
                if name == "now" {
                    return "now".to_string();
                }
                if name == "context" {
                    "user"
                } else if name.chars().next().is_some_and(|c| c.is_uppercase()) {
                    "entity"
                } else {
                    // Lambda param over an opaque payload collection: the
                    // element type is the wide `EventPayloadValue` union
                    // (operator.rs `array_arg` cast), on which a bare
                    // `row?.field` read is TS2339 (property access on the
                    // string/number arms). Widen through the same
                    // `(x as EventPayload | undefined)?.seg` chain the
                    // payload arm uses (C-COMPILED-PATH-RED §25).
                    if !binding.path.is_empty() {
                        let mut expr = format!(
                            "({} as EventPayload | undefined)?.{}",
                            name, binding.path[0]
                        );
                        for seg in &binding.path[1..] {
                            expr = format!("({} as EventPayload | undefined)?.{}", expr, seg);
                        }
                        return expr;
                    }
                    name
                }
            }
        };

        if binding.path.is_empty() {
            root.to_string()
        } else {
            format!("{}?.{}", root, binding.path.join("?."))
        }
    }

    /// Payload-only resolver for listen `with{}` / `when` — the compiled twin
    /// of the interpreter's payload-only listener context. Resolves against
    /// the hook callback's `event` (`BusEvent`) directly, so no local
    /// `payload` variable has to be declared (and lint on it dodged) when a
    /// mapping never reads the payload. `@entity`/`@config`/`@state`/`@user`
    /// are `undefined` here on BOTH paths — a mapping must not work compiled
    /// and silently yield nothing interpreted, or vice versa.
    pub(crate) fn binding_to_ts_listener_payload(&self, binding: &OirBinding) -> String {
        match &binding.root {
            // A listens `when` runs before any transition is chosen: no target state.
            OirBindingRoot::ToState => "undefined".to_string(),
            OirBindingRoot::Event
            | OirBindingRoot::PrevEvents
            | OirBindingRoot::PrevStates
            | OirBindingRoot::FromState => self.dispatch_root_ts(binding, "fromState"),
            OirBindingRoot::Payload => {
                if binding.path.is_empty() {
                    return "event.payload".to_string();
                }
                let mut expr = format!(
                    "(event.payload as EventPayload | undefined)?.{}",
                    binding.path[0]
                );
                for seg in &binding.path[1..] {
                    expr = format!("({} as EventPayload | undefined)?.{}", expr, seg);
                }
                expr
            }
            OirBindingRoot::Local(name) => {
                if name == "now" {
                    return "now".to_string();
                }
                // Lambda parameters inside a mapping expression render bare.
                if name.chars().next().is_some_and(|c| c.is_lowercase()) {
                    if binding.path.is_empty() {
                        name.clone()
                    } else {
                        format!("{}?.{}", name, binding.path.join("?."))
                    }
                } else {
                    "undefined".to_string()
                }
            }
            _ => "undefined".to_string(),
        }
    }

    /// A leftover `@config.<knob>` on the server. Config is inlined before
    /// server codegen except a call-site-captured knob, which the inline phase
    /// keeps on purpose (`trait_callsite_knob_values`); the server has no
    /// composing payload, so it compiles the captured value against an absent
    /// payload — the client's fallback. Anything else stays `undefined`.
    fn captured_knob_server_ts(&self, binding: &OirBinding) -> String {
        let captured = self
            .current_trait_scope
            .snapshot()
            .and_then(|scope| scope.rsplit('.').next().map(str::to_string))
            .and_then(|name| {
                let knob = binding.path.first()?;
                self.trait_callsite_knob_values
                    .borrow()
                    .get(&name)?
                    .get(knob)
                    .cloned()
            });
        match captured {
            Some(value) if binding.path.len() == 1 => self.pattern_value_to_ts_server(&value),
            _ => "undefined".to_string(),
        }
    }

    /// `@locale` on the server of a program with `locales`: the request's viewer
    /// locale (`currentLocale()`, generated `i18n.ts`), per the event-request contract.
    fn server_locale_ts(&self, binding: &OirBinding) -> Option<String> {
        (matches!(binding.root, OirBindingRoot::Locale)
            && binding.path.is_empty()
            && !self.browser_locales.snapshot().is_empty())
        .then(|| "currentLocale()".to_string())
    }

    pub(crate) fn binding_to_ts_server(&self, binding: &OirBinding) -> String {
        if let Some(locale) = self.server_locale_ts(binding) {
            return locale;
        }
        if let Some(committed) = self.post_commit_state_ts(binding) {
            return committed;
        }
        let root = match &binding.root {
            OirBindingRoot::Event
            | OirBindingRoot::PrevEvents
            | OirBindingRoot::PrevStates
            | OirBindingRoot::FromState
            | OirBindingRoot::ToState => return self.dispatch_root_ts(binding, "state"),
            OirBindingRoot::Entity => "entity".to_string(),
            OirBindingRoot::Payload => {
                if binding.path.is_empty() {
                    return "payload".to_string();
                }
                if binding.path.len() == 1 {
                    return format!("(payload as EventPayload | undefined)?.{}", binding.path[0]);
                }
                let mut expr =
                    format!("(payload as EventPayload | undefined)?.{}", binding.path[0]);
                for seg in &binding.path[1..] {
                    expr = format!("({} as EventPayload | undefined)?.{}", expr, seg);
                }
                return expr;
            }
            OirBindingRoot::State => "state".to_string(),
            // Config is fully inlined before server-side codegen — measured zero
            // reachable sites across the corpus (config-only atoms included). It
            // previously fell through to `user`, so a validator miss would have
            // read a viewer field where a config value was meant
            // (C-SERVER-CONFIG-BINDING-COMPILES-TO-USER). Emit `undefined` like
            // the `Trait(_)` arm below: evaluate cleanly, never cross-wire.
            OirBindingRoot::Config => return self.captured_knob_server_ts(binding),
            OirBindingRoot::User => "user".to_string(),
            OirBindingRoot::Trait(_) | OirBindingRoot::Pages | OirBindingRoot::CurrentTheme | OirBindingRoot::Locale => {
                // Client-only binding; see `binding_to_ts` above for reasoning.
                return "undefined".to_string();
            }
            OirBindingRoot::Local(name) if name == "callsitePayload" => {
                // The server never has a composing payload: read it as absent.
                let mut expr = "(undefined as EventPayload | undefined)".to_string();
                for (i, seg) in binding.path.iter().enumerate() {
                    expr = if i == 0 {
                        format!("{expr}?.{seg}")
                    } else {
                        format!("({expr} as EventPayload | undefined)?.{seg}")
                    };
                }
                return expr;
            }
            OirBindingRoot::Local(name) => {
                if name == "now" {
                    return "now".to_string();
                }
                if name == "context" {
                    "user".to_string()
                } else if name.chars().next().is_some_and(|c| c.is_uppercase()) {
                    "entity".to_string()
                } else {
                    // Lambda param member reads widen through the EventPayload
                    // chain — same reasoning as the guard/server arms above
                    // (C-COMPILED-PATH-RED §25).
                    if !binding.path.is_empty() {
                        let mut expr = format!(
                            "({} as EventPayload | undefined)?.{}",
                            name, binding.path[0]
                        );
                        for seg in &binding.path[1..] {
                            expr = format!("({} as EventPayload | undefined)?.{}", expr, seg);
                        }
                        return expr;
                    }
                    name.clone()
                }
            }
        };

        if binding.path.is_empty() {
            root
        } else {
            format!("{}?.{}", root, binding.path.join("?."))
        }
    }

    /// §A7: server twin of `binding_to_ts_server` for the compiled server's
    /// `clientEffects` tuple (render-ui pattern `config`, navigate `path`/
    /// `params`). Identical entity/payload/state/user/local resolution;
    /// differs only on the render-resolved, client-owned roots — `@trait`,
    /// `@pages`, `@currentTheme` round-trip as the literal `@`-string
    /// (matching the kernel's `resolve_effect_bindings`, whose
    /// `BindingContext` has no slot for any of the three, so
    /// `interpolate_embedded`'s "leave the token as-is" rule is what a
    /// non-React client actually receives) instead of
    /// `binding_to_ts_server`'s `undefined` (that function's callers are
    /// `set`/`persist` targets, where those roots are genuinely
    /// unreachable — a different call site, a different correct answer).
    pub(crate) fn binding_to_ts_server_render(&self, binding: &OirBinding) -> String {
        if let Some(locale) = self.server_locale_ts(binding) {
            return locale;
        }
        if matches!(
            binding.root,
            OirBindingRoot::Trait(_) | OirBindingRoot::Pages | OirBindingRoot::CurrentTheme | OirBindingRoot::Locale
        ) {
            return format!("\"{}\"", escape_js_string(&binding.to_string()));
        }
        self.binding_to_ts_server(binding)
    }

    /// §A7: an `OirPattern.config` / `Navigate.params` leaf `OirValue` → TS,
    /// server-flavored. Server twin of `value_to_jsx_expr`: a plain string
    /// is a JS string literal; an `@`-binding string resolves through
    /// `binding_to_ts_server_render`; an operator-headed array (`["if",
    /// cond, then, else]`, `["str/concat", …]`, …) lowers through the ONE
    /// sexpr-resolve pipeline (`try_compile_sexpr_prop_server`, the same
    /// `oirvalue_to_sexpr` + `resolve_sexpr_standalone` machinery the client
    /// render-prop compiler uses, server-flavored); any other array is a
    /// plain data literal recursed per item — never sexpr-resolved, or a
    /// bare data array (`navItems`) would misread its first string element
    /// as a call head.
    pub(crate) fn pattern_value_to_ts_server(&self, value: &OirValue) -> String {
        match value {
            OirValue::String(s) => {
                if s.starts_with('@') {
                    match OirBinding::parse(s) {
                        // §A7 wire cast: every pattern's generated `AnyPatternConfig`
                        // prop type is `<declared> | SExpr` (`pattern-types.ts` appends
                        // `SExpr` to EVERY prop unconditionally, since any prop may
                        // carry a live S-expression at runtime) — a live `@`-binding
                        // resolves server-side to `EventPayloadValue`, which is
                        // structurally comparable to (but not a plain-assignable
                        // subtype of) `SExpr`, so the raw accessor is honestly TS2322
                        // against the generated interface. `SExpr` is a strict
                        // supertype-compatible cast target here (every
                        // `EventPayloadValue` branch except `Date`/`undefined` is
                        // already a valid `SExpr`), so `as SExpr` — never `as unknown
                        // as` — is the correct, general narrowing for ANY pattern
                        // prop, keyed on nothing pattern-specific.
                        Some(binding) => {
                            let compiled = self.binding_to_ts_server_render(&binding);
                            // An unresolved `@config.<knob>` binding compiles
                            // to the bare literal `undefined` (no default,
                            // no call-site override — see `codegen/effect/
                            // server.rs`'s `Set` arm comment on the same
                            // fallback). `undefined` and `SExpr` share no
                            // members, so `as SExpr` on the literal itself
                            // is TS2352 — leave it as plain `undefined`,
                            // valid wherever the destination prop is
                            // optional (every prop reaching this codegen).
                            if compiled == "undefined" {
                                compiled
                            } else {
                                format!("({}) as SExpr", compiled)
                            }
                        }
                        None => format!("\"{}\"", escape_js_string(s)),
                    }
                } else {
                    format!("\"{}\"", escape_js_string(s))
                }
            }
            OirValue::Number(n) => n.to_string(),
            OirValue::Bool(b) => b.to_string(),
            OirValue::Null => "null".to_string(),
            OirValue::Array(arr) => {
                if let Some(compiled) = self.try_compile_sexpr_prop_server(arr) {
                    return compiled;
                }
                let items: Vec<String> = arr
                    .iter()
                    .map(|v| self.pattern_value_to_ts_server(v))
                    .collect();
                format!("[{}]", items.join(", "))
            }
            OirValue::Object(obj) => {
                // `OirValue::Object` is a `HashMap` — sort keys so repeated
                // codegen runs are byte-identical (HashMap iteration order
                // is unspecified across runs).
                let mut keys: Vec<&String> = obj.keys().collect();
                keys.sort();
                let pairs: Vec<String> = keys
                    .into_iter()
                    .map(|k| {
                        format!(
                            "{}: {}",
                            ts_member_name(k),
                            self.pattern_value_to_ts_server(&obj[k])
                        )
                    })
                    .collect();
                format!("{{ {} }}", pairs.join(", "))
            }
        }
    }

    /// §A7: flatten an `OirPattern` (`pattern_type` + `config`) into the
    /// `{ type: '<pattern_type>', ...config }` object literal the wire
    /// tuple's `PatternConfig` expects — the raw OIR effect representation
    /// already carries `type` as a sibling of the other config keys; the
    /// Rust struct just splits it out, so this re-flattens it.
    fn render_ui_pattern_config_ts_server(&self, pattern: &OirPattern) -> String {
        let mut keys: Vec<&String> = pattern.config.keys().collect();
        keys.sort();
        let mut entries = vec![format!(
            "type: \"{}\"",
            escape_js_string(&pattern.pattern_type)
        )];
        for k in keys {
            entries.push(format!(
                "{}: {}",
                ts_member_name(k),
                self.pattern_value_to_ts_server(&pattern.config[k])
            ));
        }
        format!("{{ {} }}", entries.join(", "))
    }

    /// §A7: one `ClientEffectTuple` (`@almadar/core`) for a render-ui /
    /// navigate / navigate-back effect — the compiled server's twin of the
    /// kernel's `resolve_effect_bindings`. `None` for every other effect
    /// kind; the caller (`generate_transition_body_impl`) filters a
    /// transition's declared effects through this and drops the `None`s.
    /// `(render-ui <slot> null)` lowers to the `pattern_type == "clear"`
    /// sentinel (`resolve_render_ui_effect`) — reproduced here as the
    /// arity-3 `null`-config tuple, never the flattened `{ type: "clear" }`
    /// object. `navigate`'s optional `crumb` is NOT threaded onto the wire
    /// tuple (out of §A7's stated scope — the arity-4 crumb form stays
    /// interpreter-only for now).
    pub(crate) fn client_effect_tuple_ts(&self, effect: &OirEffect) -> Option<String> {
        match effect {
            OirEffect::RenderUi { slot, pattern } => {
                let slot_ts = format!("'{}'", escape_js_string(slot));
                if pattern.pattern_type == "clear" {
                    Some(format!("['render-ui', {}, null]", slot_ts))
                } else {
                    Some(format!(
                        "['render-ui', {}, {}]",
                        slot_ts,
                        self.render_ui_pattern_config_ts_server(pattern)
                    ))
                }
            }
            OirEffect::Navigate { path, params, .. } => {
                // `ClientNavigateTuple`'s 2nd slot is a plain `string` (never
                // optional) and its optional 3rd slot is `Record<string,
                // string> | undefined` — both narrower than a live
                // `@`-binding's `EventPayloadValue`-typed accessor.
                // `String(x ?? '')` (the same coercion
                // `narrow_wide_accessor_to_prop_type`'s `has_string` arm
                // uses) guarantees a real `string` for the path even when
                // it's already one (e.g. a `.join('')` concat — idempotent).
                // The params object literal's per-key values are the same
                // `EventPayloadValue` shape, so the whole literal is cast to
                // the tuple's own declared record type in one assertion. A
                // literal path string is already a real `string` — `?? ''`
                // on a provably-non-nullish operand is TS2869, so the
                // coercion applies only to a non-literal (binding/concat)
                // path expression.
                let path_ts = crate::codegen::infer::string_coerce_for(
                    path,
                    &self.expr_to_ts_flavored(path, BindingFlavor::ServerRenderUi),
                );
                match params {
                    Some(p) => Some(format!(
                        "['navigate', {}, ({}) as Record<string, string> | undefined]",
                        path_ts,
                        self.expr_to_ts_flavored(p, BindingFlavor::ServerRenderUi)
                    )),
                    None => Some(format!("['navigate', {}]", path_ts)),
                }
            }
            OirEffect::NavigateBack => Some("['navigate-back']".to_string()),
            _ => None,
        }
    }

    // ========================================================================
    // Phase 4: Client-Side S-Expression Transpilation
    // ========================================================================

    /// Resolve an OirBinding for client-side context.
    ///
    /// Client-side bindings differ from server-side:
    /// - @entity → `entity` (collection variable in the logic hook)
    /// - @entity.field → `fields?.field` (the reducer mirror populated by
    ///   `set @entity.X` effects). Earlier versions emitted
    ///   `entity?.[0]?.field`; see the module-level docstring for why
    ///   that heuristic was removed.
    /// - @payload → `payloadObj` (the payload parameter cast to Record)
    /// - @state → `state` (the machineState destructured from reducer)
    /// - @config → `config` (hook config parameter)
    /// - @user → `user` (user context, if available)
    pub(crate) fn binding_to_client_ts(&self, binding: &OirBinding) -> String {
        if let Some(committed) = self.post_commit_state_ts(binding) {
            return committed;
        }
        let root = match &binding.root {
            OirBindingRoot::Event
            | OirBindingRoot::PrevEvents
            | OirBindingRoot::PrevStates
            | OirBindingRoot::FromState
            | OirBindingRoot::ToState => return self.dispatch_root_ts(binding, "fromState"),
            // `entity` bare → the linked-collection array. `entity.<field>`
            // → `fields?.<field>` — the trait's reducer mirror populated by
            // `set @entity.X` effects.
            OirBindingRoot::Entity => {
                if binding.path.is_empty() {
                    "entity".to_string()
                } else {
                    let path = binding.path.join("?.");
                    return format!("fields?.{}", path);
                }
            }
            OirBindingRoot::Payload => CLIENT_PAYLOAD_VAR.to_string(),
            OirBindingRoot::State => "state".to_string(),
            OirBindingRoot::Config => "config".to_string(),
            OirBindingRoot::User => "user".to_string(),
            OirBindingRoot::Trait(_) | OirBindingRoot::Pages | OirBindingRoot::CurrentTheme | OirBindingRoot::Locale => {
                // `@trait.X` is a render-time client binding resolved by
                // `<TraitFrame>`, not by this S-expression compiler. If it
                // reaches here (validator miss), emit `undefined` to keep
                // the generated JS syntactically valid.
                return "undefined".to_string();
            }
            OirBindingRoot::Local(name) => {
                if name == "now" {
                    return "now".to_string();
                }
                // `@callsitePayload.<path>` inside the CHILD trait's own
                // render/effect body: the value was captured at the
                // composing call site and passed down as the capturing
                // config knob (see `embedded_view_config_attr`) — read it
                // back through `config?.<knob>`, or, for a NESTED reference
                // no knob covers, through the forwarded whole payload
                // (`compile_callsite_payload_ref`). A bare `callsitePayload`
                // identifier does not exist in the generated scope (TS2552).
                if name == "callsitePayload" {
                    let full_path: Vec<&str> = binding.path.iter().map(String::as_str).collect();
                    return self.compile_callsite_payload_ref(&full_path);
                }
                // @context.field → user?.field (context is an alias for user)
                if name == "context" {
                    "user".to_string()
                }
                // @EntityName.field → entity?.[0]?.field (PascalCase = entity type reference, array)
                else if name.chars().next().is_some_and(|c| c.is_uppercase()) {
                    if binding.path.is_empty() {
                        "entity".to_string()
                    } else {
                        "entity?.[0]".to_string()
                    }
                } else {
                    // Lambda param over an opaque payload collection
                    // (`(array/find @payload.data (fn row (= @row.staffAccount
                    // @user.id)))`): widen through the `(x as EventPayload |
                    // undefined)?.seg` chain — same treatment
                    // `binding_to_ts` already gives this exact shape (its
                    // General/Render-flavor twin); a bare `row?.field` is
                    // TS2339 on the wide `EventPayloadValue` element union
                    // this client logic-hook flavor left uncovered
                    // (C-COMPILED-PATH-RED §25).
                    if !binding.path.is_empty() {
                        let mut expr = format!(
                            "({} as EventPayload | undefined)?.{}",
                            name, binding.path[0]
                        );
                        for seg in &binding.path[1..] {
                            expr = format!("({} as EventPayload | undefined)?.{}", expr, seg);
                        }
                        return expr;
                    }
                    name.clone()
                }
            }
        };

        if binding.path.is_empty() {
            return root;
        }

        // For `@payload.X.Y...` multi-level paths, cast intermediate segments
        // to `EventPayload | undefined` so chained optional access works.
        // `EventPayload[key]` is `EventPayloadValue` — a union whose non-
        // object alternatives don't support further `.field` access, but
        // structured sub-payloads are always `EventPayload` at runtime.
        let is_payload = matches!(binding.root, OirBindingRoot::Payload);
        if !is_payload || binding.path.len() <= 1 {
            return format!("{}?.{}", root, binding.path.join("?."));
        }

        let mut expr = root;
        for (i, segment) in binding.path.iter().enumerate() {
            if i == 0 {
                expr = format!("{}?.{}", expr, segment);
            } else {
                expr = format!("({} as EventPayload | undefined)?.{}", expr, segment);
            }
        }
        expr
    }

    /// Compile an OirExpr to TypeScript for client-side context.
    ///
    /// Uses client-side binding resolution (@payload → payloadObj, etc.).
    /// Thin wrapper over `expr_to_ts_flavored`.
    pub(crate) fn expr_to_client_ts(&self, expr: &OirExpr) -> String {
        self.expr_to_ts_flavored(expr, BindingFlavor::Client)
    }
}

// ============================================================================
// Static `array/map` unrolling
// ============================================================================
//
// When the source array is a JSON-literal AND the lambda is a single-param
// fn-form, iterate at codegen time and produce a literal array of fully-
// specialized bodies. Each iteration's body is rewritten so per-item
// references resolve to the literal value:
//
//   `@<param>`                     → the whole item
//   `@<param>.<path>`              → walked into the item
//   `(object/get @<param> "k" d)`  → item.k (or `d` if missing)
//
// Why this matters for std-stats: each metric's `filter` field can itself
// be a fn-form SExpression. Without unroll, `(object/get @metric "filter")`
// resolves at runtime to the SExpression value — and `.filter(arrayValue)`
// TypeErrors. After unroll, the metric is fully known at codegen time, so
// the filter SExpression bakes into the body as a static fn-form, which
// the existing codegen compiles into a real `(row) => ...` JS callback.

/// Returns `Some(body-per-item-substituted)` when the args fit the
/// static-unroll shape; `None` to fall through to runtime `.map(...)`.
fn try_static_map_substitutions(args: &[OirExpr]) -> Option<Vec<OirExpr>> {
    if args.len() < 2 {
        return None;
    }
    let items = match &args[0] {
        OirExpr::Array { items } => items,
        _ => return None,
    };
    let (param_name, body) = match &args[1] {
        OirExpr::Call {
            function,
            args: lambda_args,
        } => {
            if function != "fn" && function != "lambda" {
                return None;
            }
            if lambda_args.len() < 2 {
                return None;
            }
            let pname = match &lambda_args[0] {
                OirExpr::String { value } => value.clone(),
                _ => return None,
            };
            (pname, &lambda_args[1])
        }
        _ => return None,
    };
    Some(
        items
            .iter()
            .enumerate()
            .map(|(idx, item)| substitute_oir_param(body, &param_name, item, idx))
            .collect(),
    )
}

/// Walk `body` and replace every reference to `@<param>` with the
/// literal value at the corresponding path on `item`. `@index` is replaced
/// with the literal loop position so an unrolled `array/map` body that reads
/// `@index` resolves (parity with the runtime `.map((item, index) => …)`
/// path). Recurses through every OirExpr variant — bindings, calls, objects,
/// arrays, conditionals, binary/unary ops, and the higher-order
/// Map/Filter/Reduce shapes.
fn substitute_oir_param(body: &OirExpr, param: &str, item: &OirExpr, index: usize) -> OirExpr {
    match body {
        OirExpr::Binding { binding } => {
            // Local-rooted bindings are how `@<localName>` (set by the
            // caller-bound lambda parameter) lower into OIR. Trait/payload/
            // entity/state/config roots aren't the lambda parameter and
            // pass through unchanged.
            if let OirBindingRoot::Local(name) = &binding.root {
                // `@index` is the reserved implicit position binding — bake
                // the literal index so the unrolled body has no free `index`.
                if name == "index" && binding.path.is_empty() && param != "index" {
                    return OirExpr::Number {
                        value: index as f64,
                    };
                }
                if name == param {
                    return walk_oir_path(item, &binding.path);
                }
            }
            body.clone()
        }
        OirExpr::Call { function, args } => {
            // Recognize `(object/get @<param> "key" default?)` and rewrite
            // to the value at `key` on the literal item. This is the
            // canonical metric-config lookup pattern (every field on
            // std-stats's metric uses `(object/get @metric "X" default)`).
            if function == "object/get" && args.len() >= 2 {
                if let OirExpr::Binding { binding } = &args[0] {
                    if matches!(&binding.root, OirBindingRoot::Local(n) if n == param)
                        && binding.path.is_empty()
                    {
                        if let OirExpr::String { value: key } = &args[1] {
                            if let OirExpr::Object { fields } = item {
                                if let Some(found) = fields.get(key) {
                                    return found.clone();
                                }
                            }
                            if args.len() >= 3 {
                                return args[2].clone();
                            }
                            return OirExpr::Null;
                        }
                    }
                }
            }
            OirExpr::Call {
                function: function.clone(),
                args: args
                    .iter()
                    .map(|a| substitute_oir_param(a, param, item, index))
                    .collect(),
            }
        }
        OirExpr::BinaryOp { op, left, right } => OirExpr::BinaryOp {
            op: *op,
            left: Box::new(substitute_oir_param(left, param, item, index)),
            right: Box::new(substitute_oir_param(right, param, item, index)),
        },
        OirExpr::UnaryOp { op, operand } => OirExpr::UnaryOp {
            op: *op,
            operand: Box::new(substitute_oir_param(operand, param, item, index)),
        },
        OirExpr::Conditional {
            condition,
            then_branch,
            else_branch,
        } => OirExpr::Conditional {
            condition: Box::new(substitute_oir_param(condition, param, item, index)),
            then_branch: Box::new(substitute_oir_param(then_branch, param, item, index)),
            else_branch: Box::new(substitute_oir_param(else_branch, param, item, index)),
        },
        OirExpr::Array { items } => OirExpr::Array {
            items: items
                .iter()
                .map(|i| substitute_oir_param(i, param, item, index))
                .collect(),
        },
        OirExpr::Object { fields } => {
            let mut out = std::collections::HashMap::with_capacity(fields.len());
            for (k, v) in fields {
                out.insert(k.clone(), substitute_oir_param(v, param, item, index));
            }
            OirExpr::Object { fields: out }
        }
        OirExpr::Map {
            source,
            variable,
            body: inner,
        } => OirExpr::Map {
            source: Box::new(substitute_oir_param(source, param, item, index)),
            variable: variable.clone(),
            body: Box::new(if variable == param {
                // Inner lambda shadows the outer parameter — leave its
                // body untouched so lexical scoping holds.
                (**inner).clone()
            } else {
                substitute_oir_param(inner, param, item, index)
            }),
        },
        OirExpr::Filter {
            source,
            variable,
            predicate,
        } => OirExpr::Filter {
            source: Box::new(substitute_oir_param(source, param, item, index)),
            variable: variable.clone(),
            predicate: Box::new(if variable == param {
                (**predicate).clone()
            } else {
                substitute_oir_param(predicate, param, item, index)
            }),
        },
        OirExpr::Reduce {
            source,
            variable,
            accumulator,
            initial,
            body: inner,
        } => OirExpr::Reduce {
            source: Box::new(substitute_oir_param(source, param, item, index)),
            variable: variable.clone(),
            accumulator: accumulator.clone(),
            initial: Box::new(substitute_oir_param(initial, param, item, index)),
            body: Box::new(if variable == param || accumulator == param {
                (**inner).clone()
            } else {
                substitute_oir_param(inner, param, item, index)
            }),
        },
        // Literals + Effect: no parameter references possible
        _ => body.clone(),
    }
}

/// Walk a path of segments into a literal `OirExpr` value. Numeric
/// segments index into arrays; string segments index into objects.
/// Returns `Null` whenever the path can't be followed.
fn walk_oir_path(value: &OirExpr, path: &[String]) -> OirExpr {
    let mut cur = value.clone();
    for seg in path {
        cur = match cur {
            OirExpr::Object { fields } => fields.get(seg).cloned().unwrap_or(OirExpr::Null),
            OirExpr::Array { items } => match seg.parse::<usize>() {
                Ok(idx) => items.get(idx).cloned().unwrap_or(OirExpr::Null),
                Err(_) => OirExpr::Null,
            },
            _ => OirExpr::Null,
        };
    }
    cur
}

/// Whether `arg` is a lambda whose body reads a field off its first parameter
/// (`(fn u (== @u.id …))`) — its source elements must then be objects.
fn lambda_reads_param_fields(arg: Option<&OirExpr>) -> bool {
    let Some(OirExpr::Lambda { params, body }) = arg else {
        return false;
    };
    let Some(param) = params.first() else {
        return false;
    };
    body.collect_bindings()
        .iter()
        .any(|b| matches!(&b.root, OirBindingRoot::Local(name) if name == param) && !b.path.is_empty())
}

#[cfg(test)]
mod static_unroll_tests {
    use super::*;
    use std::collections::HashMap;

    fn s(v: &str) -> OirExpr {
        OirExpr::String {
            value: v.to_string(),
        }
    }

    fn obj(pairs: &[(&str, OirExpr)]) -> OirExpr {
        let mut fields = HashMap::new();
        for (k, v) in pairs {
            fields.insert((*k).to_string(), v.clone());
        }
        OirExpr::Object { fields }
    }

    fn local(name: &str, path: Vec<&str>) -> OirExpr {
        OirExpr::Binding {
            binding: OirBinding {
                root: OirBindingRoot::Local(name.to_string()),
                path: path.into_iter().map(String::from).collect(),
            },
        }
    }

    fn fn_form(param: &str, body: OirExpr) -> OirExpr {
        OirExpr::Call {
            function: "fn".to_string(),
            args: vec![s(param), body],
        }
    }

    /// Object-literal keys that are not identifier-safe (`{`, `}`, `^`, `0`)
    /// must be quoted — a config `Map` keyed by keyboard characters emitted
    /// `{: "paragraph-back" as const` (TS1136) on the compiled path while the
    /// runtime path accepted the same program. One helper, every member position.
    #[test]
    fn object_literal_quotes_non_identifier_keys() {
        let b = TypeScriptBackend::new();
        let e = obj(&[
            ("{", s("paragraph-back")),
            ("^", s("first-nonblank")),
            ("$", s("line-end")),
            ("h", s("left")),
            ("0", s("line-start")),
        ]);
        let ts = b.expr_to_ts(&e);
        assert!(ts.contains("\"{\": \"paragraph-back\" as const"), "{ts}");
        assert!(ts.contains("\"^\": \"first-nonblank\" as const"), "{ts}");
        assert!(ts.contains("$: \"line-end\" as const"), "{ts}");
        assert!(ts.contains("h: \"left\" as const"), "{ts}");
        assert!(ts.contains("\"0\": \"line-start\" as const"), "{ts}");
        let mut vals = HashMap::new();
        vals.insert(
            "}".to_string(),
            OirValue::String("paragraph-forward".to_string()),
        );
        assert_eq!(
            b.value_to_string(&OirValue::Object(vals)),
            "{\"}\": paragraph-forward}"
        );
    }

    /// A call-site-captured knob (`value={(array/len ?data)}` on an inline
    /// embed → `@config.value` = `(array/len @callsitePayload.data)`) is the one
    /// config binding the inline phase leaves in the child body. The server
    /// render of the child has no composing payload, so it must compile the
    /// captured value against an absent payload (the client's fallback), not
    /// `undefined` — a required prop then fails `tsc` (TS2322).
    #[test]
    fn server_render_compiles_a_captured_knob_against_an_absent_payload() {
        let b = TypeScriptBackend::new();
        let mut knobs = HashMap::new();
        knobs.insert(
            "value".to_string(),
            OirValue::Array(vec![
                OirValue::String("array/len".into()),
                OirValue::String("@callsitePayload.data".into()),
            ]),
        );
        b.trait_callsite_knob_values
            .set(HashMap::from([("Child".to_string(), knobs)]));
        b.current_trait_scope.set(Some("Orb.Child".to_string()));
        let ts = b.pattern_value_to_ts_server(&OirValue::String("@config.value".into()));
        assert_ne!(
            ts, "undefined",
            "a captured knob must not compile to undefined"
        );
        assert!(
            ts.contains("(undefined as EventPayload | undefined)?.data"),
            "{ts}"
        );
        assert!(
            !ts.contains("callsitePayload"),
            "no callsitePayload identifier exists server-side: {ts}"
        );

        // Control: a knob that is not a capture keeps the inlined-config rule.
        let other = b.pattern_value_to_ts_server(&OirValue::String("@config.label".into()));
        assert_eq!(other, "undefined");

        // Edge: another trait's capture does not leak into this one.
        b.current_trait_scope.set(Some("Orb.Sibling".to_string()));
        assert_eq!(
            b.pattern_value_to_ts_server(&OirValue::String("@config.value".into())),
            "undefined"
        );
    }

    /// Deep `@payload.<root>.<field>` render bindings must re-widen each hop
    /// past the root — `lastPayload?.data` types as `EventPayloadValue`, so a
    /// raw `?.blocksJson` on it is TS2339 in the emitted app.
    #[test]
    fn deep_payload_binding_widens_each_hop() {
        let b = TypeScriptBackend::new();
        let ts = b.binding_string_to_ts("@payload.data.blocksJson");
        assert_eq!(
            ts,
            "(lastPayload?.data as EventPayload | undefined)?.blocksJson"
        );
        assert_eq!(b.binding_string_to_ts("@payload.data"), "lastPayload?.data");
    }

    #[test]
    fn substitutes_dotted_local_binding() {
        let body = local("metric", vec!["label"]);
        let item = obj(&[("label", s("Total"))]);
        let result = substitute_oir_param(&body, "metric", &item, 0);
        assert!(matches!(result, OirExpr::String { value } if value == "Total"));
    }

    #[test]
    fn substitutes_object_get_with_default() {
        let body = OirExpr::Call {
            function: "object/get".to_string(),
            args: vec![local("metric", vec![]), s("missing"), s("fallback")],
        };
        let item = obj(&[("label", s("Total"))]);
        let result = substitute_oir_param(&body, "metric", &item, 0);
        assert!(matches!(result, OirExpr::String { value } if value == "fallback"));
    }

    #[test]
    fn substitutes_object_get_finds_field() {
        let body = OirExpr::Call {
            function: "object/get".to_string(),
            args: vec![local("metric", vec![]), s("aggregation"), s("count")],
        };
        let item = obj(&[("aggregation", s("sum"))]);
        let result = substitute_oir_param(&body, "metric", &item, 0);
        assert!(matches!(result, OirExpr::String { value } if value == "sum"));
    }

    #[test]
    fn substitutes_filter_sexpression_into_body() {
        // Body: (array/filter @payload.data (object/get @metric "filter" true))
        // Item:  { filter: ["fn", "row", ["=", "@row.status", "active"]] }
        let filter_form = fn_form(
            "row",
            OirExpr::eq(
                OirExpr::Binding {
                    binding: OirBinding {
                        root: OirBindingRoot::Local("row".to_string()),
                        path: vec!["status".to_string()],
                    },
                },
                s("active"),
            ),
        );
        let item = obj(&[("filter", filter_form.clone())]);
        let body = OirExpr::Call {
            function: "array/filter".to_string(),
            args: vec![
                OirExpr::Binding {
                    binding: OirBinding {
                        root: OirBindingRoot::Payload,
                        path: vec!["data".to_string()],
                    },
                },
                OirExpr::Call {
                    function: "object/get".to_string(),
                    args: vec![
                        local("metric", vec![]),
                        s("filter"),
                        OirExpr::Bool { value: true },
                    ],
                },
            ],
        };
        let result = substitute_oir_param(&body, "metric", &item, 0);
        // After substitution the (object/get) call becomes the literal fn-form.
        if let OirExpr::Call { function, args } = result {
            assert_eq!(function, "array/filter");
            assert_eq!(args.len(), 2);
            // args[1] should be the substituted fn-form, not an `object/get` call
            assert!(matches!(&args[1], OirExpr::Call { function, .. } if function == "fn"));
        } else {
            panic!("expected Call, got {result:?}");
        }
    }

    #[test]
    fn try_static_map_returns_substituted_per_item() {
        let metrics = OirExpr::Array {
            items: vec![obj(&[("label", s("A"))]), obj(&[("label", s("B"))])],
        };
        let lambda = fn_form("metric", local("metric", vec!["label"]));
        let result = try_static_map_substitutions(&[metrics, lambda]).expect("should unroll");
        assert_eq!(result.len(), 2);
        assert!(matches!(&result[0], OirExpr::String { value } if value == "A"));
        assert!(matches!(&result[1], OirExpr::String { value } if value == "B"));
    }

    #[test]
    fn try_static_map_falls_through_for_non_literal_source() {
        // Source is an `array/sort` call, not a literal — must not unroll.
        let source = OirExpr::Call {
            function: "array/sort".to_string(),
            args: vec![OirExpr::Binding {
                binding: OirBinding {
                    root: OirBindingRoot::Entity,
                    path: vec!["items".to_string()],
                },
            }],
        };
        let lambda = fn_form("item", local("item", vec!["name"]));
        assert!(try_static_map_substitutions(&[source, lambda]).is_none());
    }

    #[test]
    fn try_static_map_falls_through_for_non_fn_lambda() {
        // Bare expression as second arg (no fn-form). Runtime path handles it.
        let metrics = OirExpr::Array {
            items: vec![OirExpr::Number { value: 1.0 }],
        };
        let lambda = OirExpr::BinaryOp {
            op: OirBinaryOp::Add,
            left: Box::new(OirExpr::Number { value: 1.0 }),
            right: Box::new(OirExpr::Number { value: 2.0 }),
        };
        assert!(try_static_map_substitutions(&[metrics, lambda]).is_none());
    }

    #[test]
    fn shadowing_leaves_inner_lambda_body_untouched() {
        // Outer lambda binds `metric`. Inner Map binds `metric` too —
        // its body must NOT be substituted (lexical scoping).
        let inner_map = OirExpr::Map {
            source: OirExpr::Array { items: vec![] }.into(),
            variable: "metric".to_string(),
            body: Box::new(local("metric", vec!["x"])),
        };
        let item = obj(&[("y", s("outer"))]);
        let result = substitute_oir_param(&inner_map, "metric", &item, 0);
        // The inner body should still reference `metric` (not substituted)
        if let OirExpr::Map { body, .. } = result {
            assert!(matches!(
                body.as_ref(),
                OirExpr::Binding { binding } if matches!(&binding.root, OirBindingRoot::Local(n) if n == "metric")
            ));
        } else {
            panic!("expected Map");
        }
    }
}

#[cfg(test)]
mod flavor_tests {
    use super::*;
    use crate::backend::TypeScriptBackend;

    fn entity_binding(path: &str) -> OirExpr {
        OirExpr::Binding {
            binding: OirBinding {
                root: OirBindingRoot::Entity,
                path: vec![path.to_string()],
            },
        }
    }

    fn payload_binding(path: &str) -> OirExpr {
        OirExpr::Binding {
            binding: OirBinding {
                root: OirBindingRoot::Payload,
                path: vec![path.to_string()],
            },
        }
    }

    // @entity.field resolves differently per flavour: client/general → the
    // `fields?` reducer mirror, server → the single `entity?` record.
    #[test]
    fn entity_field_resolution_per_flavor() {
        let b = TypeScriptBackend::new();
        let e = entity_binding("name");
        assert_eq!(b.expr_to_ts(&e), "fields?.name");
        assert_eq!(b.expr_to_client_ts(&e), "fields?.name");
        assert_eq!(b.expr_to_ts_server(&e), "entity?.name");
    }

    // @payload.x → typed `(payload as EventPayload | undefined)?.x` on
    // general/server, `payloadObj?.x` on client.
    #[test]
    fn payload_resolution_per_flavor() {
        let b = TypeScriptBackend::new();
        let p = payload_binding("amount");
        assert_eq!(
            b.expr_to_ts(&p),
            "(payload as EventPayload | undefined)?.amount"
        );
        assert_eq!(b.expr_to_client_ts(&p), "payloadObj?.amount");
    }

    // Concat wraps binding operands in `String(... ?? '')` on client/general
    // but NOT on server (preserved pre-merge quirk).
    #[test]
    fn concat_string_wrap_off_for_server() {
        let b = TypeScriptBackend::new();
        let concat = OirExpr::BinaryOp {
            op: OirBinaryOp::Concat,
            left: Box::new(entity_binding("first")),
            right: Box::new(entity_binding("last")),
        };
        assert_eq!(
            b.expr_to_ts(&concat),
            "(String(fields?.first ?? '') + String(fields?.last ?? ''))"
        );
        // Server: no String() wrap, bare entity record reads.
        assert_eq!(
            b.expr_to_ts_server(&concat),
            "(entity?.first + entity?.last)"
        );
    }

    // The Client flavour downgrades the higher-order Filter arm to GENERAL
    // resolution, so a @payload predicate resolves to `lastPayload`, not
    // `payloadObj` — exactly the pre-merge `_ => self.expr_to_ts(expr)` path.
    #[test]
    fn client_filter_arm_uses_general_payload_resolution() {
        let b = TypeScriptBackend::new();
        let filter = OirExpr::Filter {
            source: Box::new(entity_binding("items")),
            variable: "row".to_string(),
            predicate: Box::new(payload_binding("flag")),
        };
        let client = b.expr_to_client_ts(&filter);
        assert!(
            client.contains("(payload as EventPayload | undefined)?.flag"),
            "client Filter arm must keep general (typed payload) resolution, got: {client}"
        );
        assert!(
            !client.contains("payloadObj"),
            "client Filter arm must not use payloadObj (would mean it used client resolution), got: {client}"
        );
    }

    /// std-gem-rush: `(array/find @entity.units (fn u (== @u.id "hero")))` over an untyped
    /// source. A lambda that reads fields off its parameter needs object elements (`u?.id`
    /// on `EventPayloadValue` is TS2339); one using the parameter whole keeps the unknown
    /// element type.
    #[test]
    fn a_lambda_reading_param_fields_gets_object_elements() {
        let b = TypeScriptBackend::new();
        let local = |name: &str, path: &[&str]| OirExpr::Binding {
            binding: OirBinding { root: OirBindingRoot::Local(name.to_string()), path: path.iter().map(|p| p.to_string()).collect() },
        };
        let src = OirExpr::Binding { binding: OirBinding::parse("@payload.units").unwrap() };
        for op in ["array/find", "array/some", "array/every", "array/findIndex"] {
            let call = OirExpr::call(
                op,
                vec![src.clone(), OirExpr::lambda(vec!["u".to_string()], OirExpr::eq(local("u", &["id"]), OirExpr::string("hero")))],
            );
            let ts = b.expr_to_client_ts(&call);
            assert!(ts.contains("as readonly EntityRow[] | undefined) ?? [])"), "{op}: {ts}");
        }
        let whole = OirExpr::call(
            "array/some",
            vec![src, OirExpr::lambda(vec!["n".to_string()], OirExpr::eq(local("n", &[]), OirExpr::number(3.0)))],
        );
        assert!(b.expr_to_client_ts(&whole).contains("as readonly EventPayloadValue[] | undefined) ?? [])"), "control");
    }

    /// std-board's `cardActions: []` inlines as a bare `[]`, which TS types
    /// `never[]`: the actions map then fails `a?.label` (TS2339). An empty
    /// literal has no elements, so it takes the widest row type.
    #[test]
    fn an_empty_literal_receiver_is_typed_as_rows() {
        let b = TypeScriptBackend::new();
        let local = |name: &str, path: &[&str]| OirExpr::Binding {
            binding: OirBinding { root: OirBindingRoot::Local(name.to_string()), path: path.iter().map(|p| p.to_string()).collect() },
        };
        let filtered = OirExpr::call(
            "array/filter",
            vec![OirExpr::Array { items: vec![] }, OirExpr::lambda(vec!["action".to_string()], OirExpr::Bool { value: true })],
        );
        let ts = b.expr_to_client_ts(&OirExpr::call("array/map", vec![filtered, OirExpr::lambda(vec!["a".to_string()], local("a", &["label"]))]));
        assert!(ts.contains("as readonly EntityRow[]"), "{ts}");
        let full = OirExpr::call(
            "array/filter",
            vec![OirExpr::Array { items: vec![OirExpr::number(1.0)] }, OirExpr::lambda(vec!["n".to_string()], OirExpr::Bool { value: true })],
        );
        assert!(!b.expr_to_client_ts(&full).contains("EntityRow"), "control: a non-empty literal keeps its own type");
    }

    /// std-role-gate: `(array/includes @config.roles @user.role)` with `roles: []` inlined. An
    /// empty literal with no callback has no row elements: the string needle is not cast to a row.
    #[test]
    fn an_empty_literal_without_a_callback_is_not_typed_as_rows() {
        let b = TypeScriptBackend::new();
        let call = OirExpr::call(
            "array/includes",
            vec![OirExpr::Array { items: vec![] }, OirExpr::string("admin")],
        );
        let ts = b.expr_to_client_ts(&call);
        assert!(!ts.contains("as EntityRow"), "{ts}");
    }

    /// std-app-layout's `(if (== @config.logoSrc "") null {…})` with a literal knob folds its
    /// condition to `true`; emitting `(true ? a : b)` is TS2872 and makes a `??` after it TS2869.
    #[test]
    fn a_condition_that_folds_to_a_literal_emits_only_its_branch() {
        let b = TypeScriptBackend::new();
        let cond = |l: &str, r: &str| OirExpr::Conditional {
            condition: Box::new(OirExpr::eq(OirExpr::string(l), OirExpr::string(r))),
            then_branch: Box::new(OirExpr::string("yes")),
            else_branch: Box::new(OirExpr::string("no")),
        };
        assert_eq!(b.expr_to_client_ts(&cond("", "")), "\"yes\"");
        assert_eq!(b.expr_to_client_ts(&cond("a", "")), "\"no\"");
    }

    /// std-app-layout's `(if @config.viewerName {…} null)` with a literal name compiles its
    /// condition to the string itself: `("Maya Hart" ? a : b)` is TS2872.
    #[test]
    fn a_literal_condition_picks_its_branch_by_truthiness() {
        let b = TypeScriptBackend::new();
        let cond = |c: OirExpr| OirExpr::Conditional {
            condition: Box::new(c),
            then_branch: Box::new(OirExpr::string("yes")),
            else_branch: Box::new(OirExpr::string("no")),
        };
        assert_eq!(b.expr_to_client_ts(&cond(OirExpr::string("Maya Hart"))), "\"yes\"");
        assert_eq!(b.expr_to_client_ts(&cond(OirExpr::string(""))), "\"no\"");
        assert_eq!(b.expr_to_client_ts(&cond(OirExpr::number(0.0))), "\"no\"");
        assert_eq!(b.expr_to_client_ts(&cond(OirExpr::null())), "\"no\"");
    }

    /// std-pong: `(math/min (math/max x r) (- 600 r))`. The arithmetic operand is never
    /// nullish, so its `Number(… ?? 0)` coercion takes no fallback (TS2869); a binding
    /// operand keeps it.
    #[test]
    fn a_never_nullish_operand_takes_no_fallback() {
        let b = TypeScriptBackend::new();
        let r = OirExpr::Binding { binding: OirBinding { root: OirBindingRoot::Local("r".to_string()), path: vec![] } };
        let call = OirExpr::call("math/min", vec![r.clone(), OirExpr::sub(OirExpr::number(600.0), r.clone())]);
        let ts = b.expr_to_client_ts(&call);
        assert!(ts.contains("Number(r ?? 0)"), "control: a binding operand keeps its fallback: {ts}");
        assert!(!ts.contains(") ?? 0)"), "the arithmetic operand takes no fallback: {ts}");

        let entries = OirExpr::call("object/entries", vec![OirExpr::object(std::collections::HashMap::from([("a".to_string(), OirExpr::number(1.0))]))]);
        let ts = b.expr_to_client_ts(&entries);
        assert!(!ts.contains("?? {}"), "an object literal takes no fallback: {ts}");

        let t = OirExpr::call(
            "i18n/t",
            vec![OirExpr::string("home:count"), OirExpr::object(std::collections::HashMap::from([("n".to_string(), OirExpr::number(1.0))]))],
        );
        let ts = b.expr_to_client_ts(&t);
        assert!(!ts.contains("?? {}"), "i18n params given as an object literal take no fallback: {ts}");
        let t = OirExpr::call("i18n/t", vec![OirExpr::string("home:count"), r.clone()]);
        assert!(b.expr_to_client_ts(&t).contains("?? {}"), "control: a binding keeps its fallback");
    }

    /// orb.almadar.io's nav: `(array/map (object/get @entry "children" []) (fn child …))`.
    /// `object/get` returns a field value, not an array (its registry `returnType` is
    /// `any`), so the chain target needs the nullable-array cast — a bare `.map` on it
    /// is TS2339 on `.map` and TS7006 on `child` (~3,400 errors in the site client).
    #[test]
    fn chain_map_over_a_non_array_call_wraps_nullable_cast() {
        let b = TypeScriptBackend::new();
        let local = |name: &str| OirExpr::Binding {
            binding: OirBinding { root: OirBindingRoot::Local(name.to_string()), path: vec![] },
        };
        let source = OirExpr::call("object/get", vec![local("entry"), OirExpr::string("children"), OirExpr::array(vec![])]);
        let map_call = OirExpr::call("array/map", vec![source, OirExpr::lambda(vec!["child".to_string()], local("child"))]);
        let ts = b.expr_to_client_ts(&map_call);
        assert!(ts.contains("as readonly EventPayloadValue[] | undefined) ?? []).map("), "got: {ts}");

        let over_keys = OirExpr::call(
            "array/map",
            vec![OirExpr::call("object/keys", vec![local("entry")]), OirExpr::lambda(vec!["k".to_string()], local("k"))],
        );
        let ts = b.expr_to_client_ts(&over_keys);
        assert!(!ts.contains("EventPayloadValue[]"), "control: an array-returning source keeps the bare chain: {ts}");
    }

    // Chain-style emit over an `array/reduce` source: the reduce produces the
    // wide `EventPayloadValue` (accumulator), so the `.filter`/`.map` target
    // must be wrapped in the nullable-cast — otherwise TS2339 on the method
    // and TS7006 on the unannotated lambda param (snake food respawn).
    #[test]
    fn chain_filter_over_reduce_wraps_nullable_cast() {
        let b = TypeScriptBackend::new();
        let local_binding = |name: &str| OirExpr::Binding {
            binding: OirBinding {
                root: OirBindingRoot::Local(name.to_string()),
                path: vec![],
            },
        };
        let reduce_call = OirExpr::call(
            "array/reduce",
            vec![
                OirExpr::call("array/range", vec![OirExpr::number(3.0)]),
                OirExpr::array(vec![]),
                OirExpr::lambda(
                    vec!["acc".to_string(), "i".to_string()],
                    local_binding("acc"),
                ),
            ],
        );
        let filter_call = OirExpr::call(
            "array/filter",
            vec![
                reduce_call,
                OirExpr::lambda(vec!["cell".to_string()], local_binding("cell")),
            ],
        );
        let ts = b.expr_to_client_ts(&filter_call);
        assert!(
            ts.contains("as readonly EventPayloadValue[] | undefined) ?? []).filter("),
            "filter over reduce must wrap the nullable-cast, got: {ts}"
        );
        // A non-reduce Call source keeps the bare chain emit.
        let filter_over_entries = OirExpr::call(
            "array/filter",
            vec![
                OirExpr::call("object/entries", vec![entity_binding("row")]),
                OirExpr::lambda(vec!["cell".to_string()], local_binding("cell")),
            ],
        );
        let ts = b.expr_to_client_ts(&filter_over_entries);
        assert!(
            !ts.contains("?? []).filter("),
            "non-reduce chain source must stay bare, got: {ts}"
        );
    }
}

#[cfg(test)]
mod guard_lambda_tests {
    use super::*;
    use orbital_core::ir::{OirBinding, OirBindingRoot};

    fn payload(path: &str) -> OirExpr {
        OirExpr::binding(OirBinding {
            root: OirBindingRoot::Payload,
            path: vec![path.to_string()],
        })
    }
    fn local(name: &str) -> OirExpr {
        OirExpr::binding(OirBinding {
            root: OirBindingRoot::Local(name.to_string()),
            path: vec![],
        })
    }
    fn entity(field: &str) -> OirExpr {
        OirExpr::binding(OirBinding {
            root: OirBindingRoot::Entity,
            path: vec![field.to_string()],
        })
    }

    // Regression for G-LOLO-GUARD-LAMBDA-DROP: a `(fn row …)` predicate inside
    // `array/filter` in a guard must survive codegen (the lambda must not fold
    // to `true`). Now exercises the unified `expr_to_ts_flavored(.., Guard)`.
    #[test]
    fn guard_array_filter_keeps_lambda_predicate() {
        let backend = TypeScriptBackend::new();
        let lambda = OirExpr::lambda(
            vec!["row".to_string()],
            OirExpr::eq(local("row"), entity("parentId")),
        );
        let filter = OirExpr::call("array/filter", vec![payload("data"), lambda]);
        let ts = backend.compile_guard_to_ts(&filter);
        assert!(ts.contains(".filter("), "filter dropped: {ts}");
        assert!(ts.contains("(row) =>"), "lambda param lost: {ts}");
        assert!(
            !ts.contains(".filter(true)"),
            "predicate folded to true: {ts}"
        );
    }

    #[test]
    fn guard_array_some_keeps_lambda_predicate() {
        let backend = TypeScriptBackend::new();
        let lambda = OirExpr::lambda(
            vec!["t".to_string()],
            OirExpr::eq(local("t"), payload("from")),
        );
        let some = OirExpr::call("array/some", vec![payload("data"), lambda]);
        let ts = backend.compile_guard_to_ts(&some);
        assert!(
            !ts.contains(".some(true)"),
            "array/some predicate dropped to .some(true): {ts}"
        );
        assert!(
            ts.contains("(t) =>"),
            "lambda predicate missing in some: {ts}"
        );
    }

    // Guard binding scope: `@entity.f`→`entity?.f` (handler scope), NOT
    // render's `fields?.f`. Guards against accidental render-resolver use.
    #[test]
    fn guard_entity_binding_uses_handler_scope() {
        let backend = TypeScriptBackend::new();
        let ts = backend.compile_guard_to_ts(&entity("status"));
        assert_eq!(
            ts, "entity?.status",
            "guard entity binding must be handler-scope, got: {ts}"
        );
    }
}
