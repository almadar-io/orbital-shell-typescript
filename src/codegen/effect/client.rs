//! Client-side effect transpilation: per-transition effect handlers, guard
//! threading, render-ui lookup, and binding-root scans.

use super::*;

use super::shared::{
    any_effect_leaf, effect_block_control_reads_root, unlowerable_expr_label, walk_effect_block,
    EffectBlockSink,
};
use crate::codegen::expr::BindingFlavor;
use orbital_core::effects::{effect_runs_on, RunsOn};
use std::collections::{BTreeMap, BTreeSet, HashSet};

/// Declared type of the per-transition `fields` staging variable (and its
/// `_fields` accumulator) inside `executeTransitionEffects` — the SAME wide
/// contract the reducer's `EVENT_SUCCESS.fields` action member already
/// declares (`trait_logic.rs`), not the entity's own narrow row type. Named
/// once and referenced at both the `let fields: …` declaration and every
/// `(set …)` / `(set-dynamic …)` merge-cast so no cast site depends on
/// `typeof fields` resolving correctly — a `readonly T[]` value (every
/// `array/map`/`array/sort`/… result, see `codegen/operator.rs`) never
/// "sufficiently overlaps" with `FieldValue`'s own MUTABLE array member, so
/// a cast back to the entity's row type (or anything built from it, e.g.
/// `typeof fields` when `fields` was seeded from an `EntityRow`) rejects it
/// as TS2352 — `EventPayloadValue` already includes `readonly
/// EventPayloadValue[]` as a first-class member, so this type accepts every
/// value `expr_to_client_ts` can produce with no cast-site special-casing
/// per field type.
pub(crate) const FIELDS_STAGING_TS_TYPE: &str = "Record<string, EventPayloadValue | undefined>";

use crate::codegen::effect::shared::string_coerce_ts as string_coerce_client;

/// `EffectBlockSink` for the event-transition path: renders `let`/`if`/`when`
/// as real TS control flow around `transpile_client_effect` leaves — the
/// shape `collect_client_effect_statements` drives via `walk_effect_block`.
struct ClientEffectSink<'a> {
    trait_name: Option<&'a str>,
    emit_fanout: Option<(&'a OirModule, &'a str)>,
    out: &'a mut Vec<String>,
}

impl EffectBlockSink for ClientEffectSink<'_> {
    fn on_let_binding(
        &mut self,
        backend: &TypeScriptBackend,
        name: &str,
        value: &OirExpr,
        indent: &str,
    ) {
        self.out.push(format!(
            "{indent}const {name} = {};\n",
            backend.expr_to_client_ts(value)
        ));
    }

    fn render_condition(
        &mut self,
        backend: &TypeScriptBackend,
        condition: &OirExpr,
        indent: &str,
    ) -> String {
        let _ = indent;
        backend.expr_to_client_ts(condition)
    }

    fn on_scope_open(&mut self, indent: &str) {
        self.out.push(format!("{indent}{{\n"));
    }

    fn on_scope_close(&mut self, indent: &str) {
        self.out.push(format!("{indent}}}\n"));
    }

    fn on_condition_open(&mut self, cond_ts: &str, indent: &str) {
        self.out.push(format!("{indent}if ({cond_ts}) {{\n"));
    }

    fn on_condition_else(&mut self, indent: &str) {
        self.out.push(format!("{indent}}} else {{\n"));
    }

    fn on_condition_close(&mut self, indent: &str) {
        self.out.push(format!("{indent}}}\n"));
    }

    fn on_effect(&mut self, backend: &TypeScriptBackend, effect: &OirEffect, indent: &str) {
        if let Some(stmt) =
            backend.transpile_client_effect(effect, indent, self.trait_name, self.emit_fanout)
        {
            self.out.push(stmt);
        }
    }

    fn on_unlowerable(&mut self, expr: &OirExpr, indent: &str) {
        self.out.push(format!(
            "{indent}throw new Error('orb: unlowered effect expression {}');\n",
            unlowerable_expr_label(expr)
        ));
    }
}

impl TypeScriptBackend {
    pub(crate) fn transpile_client_effect(
        &self,
        effect: &OirEffect,
        indent: &str,
        source_trait: Option<&str>,
        emit_fanout: Option<(&OirModule, &str)>,
    ) -> Option<String> {
        // A `runsOn: server` effect has no client body; the server leg runs it.
        if effect_runs_on(effect) == RunsOn::Server {
            return None;
        }
        match effect {
            OirEffect::Emit { event, payload } => {
                // Client-side emits must stamp `source.trait` so that sibling
                // coordinator traits' source-scoped listens
                // (`listens { EmitterTrait EVENT -> ... }`) can filter correctly.
                // Without this, every source-scoped listener saw
                // `event.source === undefined` and rejected the event, which
                // made the whole cascade silently drop on the compiled path.
                // Server-side emits already stamp source at backend.rs:2421;
                // this brings the client path into parity.
                let source_ts = match source_trait {
                    Some(t) => format!(", {{ trait: '{}' }}", t),
                    None => String::new(),
                };
                let payload_ts = payload.as_ref().map(|p| self.expr_to_client_ts(p));
                let mut out = self.client_effect_emitter.borrow().emit_event_bus(
                    event,
                    payload_ts.as_deref(),
                    &source_ts,
                    indent,
                );
                // Implicit (Shape-B) cross-trait relay fan-out — client-only
                // dispatch path only (`emit_fanout` is `None` everywhere
                // else). A bare emit here is otherwise unqualified and can
                // never match a sibling's `useUIEvents` subscription, which
                // is destination-scoped (`UI:{orbital}.{ownTrait}.{event}`).
                // Every sibling trait in the same orbital whose OWN
                // transition table is triggered by this event gets one
                // additional destination-qualified emit, landing exactly on
                // its existing subscription key — no new bus-listening
                // semantics, just resolving the same targets statically at
                // compile time instead of leaving them unreachable.
                if let (Some((module, orbital_name)), Some(src)) = (emit_fanout, source_trait) {
                    // Client-only dispatch: every emit is deferred until the
                    // dispatch wrapper has committed this transition's field
                    // writes (local + shared frame), so a listener that reads
                    // the frame sees the write — the same order the interpreter
                    // and the server leg guarantee. Only the DISPATCH is
                    // deferred: the payload is evaluated here, at the emit's
                    // own position in the effect sequence, because `fields`
                    // is rebound by every later `set` in the same transition
                    // (`(emit SAVE { content: @entity.draft }) (set @entity.draft "")`
                    // otherwise emits the cleared draft).
                    let deferred_payload = payload_ts.as_deref().map(|_| "_p");
                    let mut lines: Vec<String> = vec![self
                        .client_effect_emitter
                        .borrow()
                        .emit_event_bus(event, deferred_payload, &source_ts, "")
                        .trim_start()
                        .to_string()];
                    lines.push(format!(
                        "emitCascadeEvent(eventBus, '{orbital_name}', '{src}', {{ event: '{event}', payload: {payload}, source: {{ orbital: '{orbital_name}', trait: '{src}' }} }});",
                        payload = deferred_payload.unwrap_or("undefined"),
                    ));
                    for target in self.implicit_emit_targets(module, orbital_name, src, event) {
                        let qualified = format!("UI:{}.{}.{}", orbital_name, target, event);
                        lines.push(
                            self.client_effect_emitter
                                .borrow()
                                .emit_event_bus(&qualified, deferred_payload, &source_ts, "")
                                .trim_start()
                                .to_string(),
                        );
                    }
                    out = match payload_ts.as_deref() {
                        Some(p) => format!(
                            "{indent}_emits.push(((_p) => () => {{ {} }})({p}));",
                            lines.join(" ")
                        ),
                        None => format!("{indent}_emits.push(() => {{ {} }});", lines.join(" ")),
                    };
                }
                Some(out)
            }

            OirEffect::Navigate {
                path,
                params,
                crumb,
            } => {
                let payload_ts = params.as_ref().map(|p| self.expr_to_client_ts(p));
                let raw_path_ts = self.expr_to_client_ts(path);
                // A dynamic path (payload/entity read) types as
                // EventPayloadValue — coerce to string for the router's
                // `To` param. Literals/templates pass through untouched.
                let path_ts = crate::codegen::infer::string_coerce_for(path, &raw_path_ts);
                Some(match crumb {
                    Some(c) => {
                        let raw_crumb_ts = self.expr_to_client_ts(c);
                        // Same coercion as the path: a dynamic crumb read
                        // types as EventPayloadValue; the nav-stack API takes
                        // `string` ('' = no crumb, provider treats it as
                        // absent).
                        let crumb_ts = crate::codegen::infer::string_coerce_for(c, &raw_crumb_ts);
                        self.client_effect_emitter
                            .borrow()
                            .emit_navigate_with_crumb_and_payload(
                                &path_ts,
                                &crumb_ts,
                                payload_ts.as_deref(),
                                indent,
                            )
                    }
                    None => self
                        .client_effect_emitter
                        .borrow()
                        .emit_navigate_with_payload(&path_ts, payload_ts.as_deref(), indent),
                })
            }

            OirEffect::NavigateBack => Some(
                self.client_effect_emitter
                    .borrow()
                    .emit_navigate_back(indent),
            ),

            OirEffect::Set { target, value, .. } => {
                let value_ts = self.expr_to_client_ts(value);
                // Extract just the field name from the binding path (not the full "entity?.field" form)
                let field_name = target.path.join(".");
                let coerced_value = value_ts.clone();
                // Stage the write into the per-transition `_fields` accumulator
                // (folded into EVENT_SUCCESS so one transition = one reducer
                // dispatch), and ALSO update the local `fields` shadow so any
                // subsequent `@entity.X` read in the same transition body
                // observes the staged write. Matches the runtime mirror in
                // EffectExecutor.dispatch('set').
                // The trailing cast re-pins `fields`'s declared type after
                // the spread — named directly (`FIELDS_STAGING_TS_TYPE`),
                // not `typeof fields`: a cast target that re-derives from
                // the variable it's casting is only as good as that
                // variable's OWN declared type, and silently breaks again
                // if a future edit re-widens/narrows the `let fields`
                // declaration above without updating every cast site that
                // assumed its old type. Naming the type directly here needs
                // no such coordination.
                Some(format!(
                    "{indent}_fields['{name}'] = {value};\n{indent}fields = {{ ...(fields ?? {{}}), '{name}': _fields['{name}'] }} as {ty};",
                    indent = indent, name = field_name, value = coerced_value, ty = FIELDS_STAGING_TS_TYPE
                ))
            }

            OirEffect::Log { level, message } => {
                let msg_ts = self.expr_to_client_ts(message);
                let method = match level {
                    OirLogLevel::Trace | OirLogLevel::Debug => "debug",
                    OirLogLevel::Info => "info",
                    OirLogLevel::Warn => "warn",
                    OirLogLevel::Error => "error",
                };
                Some(format!("{}console.{}({});", indent, method, msg_ts))
            }

            // `runsOn: server`, returned above.
            OirEffect::Persist { .. }
            | OirEffect::PersistBatch { .. }
            | OirEffect::Fetch { .. }
            | OirEffect::CallService { .. }
            | OirEffect::Http { .. }
            | OirEffect::CancelCall { .. }
            | OirEffect::RandomBytes { .. }
            | OirEffect::Os { .. }
            | OirEffect::CredentialStatus { .. }
            | OirEffect::CredentialForget { .. }
            | OirEffect::OAuthAuthorize { .. }
            | OirEffect::OAuthConnectionStatus { .. }
            | OirEffect::OAuthConnectionForget { .. }
            | OirEffect::Swap { .. }
            | OirEffect::Atomic { .. }
            | OirEffect::FetchStream { .. }
            | OirEffect::OsWatchFiles { .. }
            | OirEffect::OsWatchProcess { .. }
            | OirEffect::OsWatchPort { .. }
            | OirEffect::OsWatchHttp { .. }
            | OirEffect::OsWatchCron { .. }
            | OirEffect::OsWatchSignal { .. }
            | OirEffect::OsWatchEnv { .. }
            | OirEffect::OsDebounce { .. } => None,

            // render-ui is handled declaratively via state-based JSX
            OirEffect::RenderUi { .. } => None,

            // Game effects — not transpiled on client (handled by game runtime)
            OirEffect::Spawn { .. } | OirEffect::Despawn { .. } => None,

            // Dynamic set — transpile similarly to set
            OirEffect::SetDynamic { target, value, .. } => {
                let target_ts = self.expr_to_client_ts(target);
                let value_ts = self.expr_to_client_ts(value);
                // Mirror the static-set pattern: stage into `_fields` AND
                // update the local `fields` shadow so subsequent reads in
                // the same transition body see the staged value. Cast
                // target named directly — see the `Set` arm's comment above
                // for why not `typeof fields`.
                Some(format!(
                    "{indent}_fields[{tgt}] = {val};\n{indent}fields = {{ ...(fields ?? {{}}), [{tgt}]: _fields[{tgt}] }} as {ty};",
                    indent = indent, tgt = target_ts, val = value_ts, ty = FIELDS_STAGING_TS_TYPE
                ))
            }

            // Resource operators — client-side stubs (ref/deref handled by EntityStore hooks)
            OirEffect::Ref { .. } => None, // Handled by useEntityRef hook, not per-transition
            OirEffect::Deref { .. } => None, // Handled inline in expressions
            OirEffect::Watch { .. } => None, // Handled by useEntityWatch hook, not per-transition

            OirEffect::SendServer { event, payload } => {
                let event_ts = self.expr_to_client_ts(event);
                let payload_ts = payload.as_ref().map(|p| self.expr_to_client_ts(p));
                let payload_arg = payload_ts.as_deref().unwrap_or("undefined");
                Some(format!(
                    "{}sendServerEvent({}, {});",
                    indent, event_ts, payload_arg
                ))
            }

            // Browser device effects (client host path) — async, user-gesture.
            // Each emits a self-invoking async IIFE that calls the real device
            // API and dispatches the `.lolo` completion events: success →
            // `eventBus.emit(success, { result })`, failure →
            // `eventBus.emit(failure, { error })`. Mirrors the JS runtime's
            // `runSubstrate` envelope (`{ result }` / `{ error }`) so the
            // compiled and interpreter paths agree. Bodies are built via
            // `push_str` so literal JS braces do not need `{{`/`}}` doubling.
            OirEffect::BrowserOpenFilePicker { options, emit } => {
                let opts_ts = options
                    .as_ref()
                    .map(|o| self.expr_to_client_ts(o))
                    .unwrap_or_else(|| "{}".to_string());
                let mut body = String::new();
                body.push_str(indent);
                // File System Access API is absent from the DOM lib — a typed
                // structural cast (not `any`) declares the surface we use, and
                // typing the handle also fixes the `__h` param inference.
                body.push_str("        const __picker = (window as Window & { showOpenFilePicker?: (opts?: object) => Promise<Array<{ getFile: () => Promise<File> }>> }).showOpenFilePicker;\n");
                body.push_str(indent);
                body.push_str("        if (!__picker) { throw new Error('File picker is not supported in this browser'); }\n");
                body.push_str(indent);
                body.push_str("        const __handles = await __picker.call(window, ");
                body.push_str(&opts_ts);
                body.push_str(");\n");
                body.push_str(indent);
                body.push_str("        const __files = await Promise.all(__handles.map(async (__h) => { const __f = await __h.getFile(); return { name: __f.name, size: __f.size, type: __f.type, lastModified: __f.lastModified }; }));\n");
                Some(self.browser_iife(indent, emit, source_trait, &body, "{ files: __files }"))
            }

            OirEffect::BrowserClipboardRead { emit } => {
                let mut body = String::new();
                body.push_str(indent);
                body.push_str("        const __text = await navigator.clipboard.readText();\n");
                Some(self.browser_iife(indent, emit, source_trait, &body, "{ text: __text }"))
            }

            OirEffect::BrowserClipboardWrite { text, emit } => {
                let raw_text_ts = self.expr_to_client_ts(text);
                // `navigator.clipboard.writeText` declares `data: string`; a
                // dynamic payload/entity read compiles to the wide
                // `EventPayloadValue` union, same as Navigate's path/crumb.
                let text_ts = string_coerce_client(&raw_text_ts);
                let mut body = String::new();
                body.push_str(indent);
                body.push_str("        const __text = ");
                body.push_str(&text_ts);
                body.push_str(";\n");
                body.push_str(indent);
                body.push_str("        await navigator.clipboard.writeText(__text);\n");
                Some(self.browser_iife(indent, emit, source_trait, &body, "{ text: __text }"))
            }

            OirEffect::BrowserGeolocationCurrent { options, emit } => {
                let opts_ts = options
                    .as_ref()
                    .map(|o| self.expr_to_client_ts(o))
                    .unwrap_or_else(|| "{}".to_string());
                let mut body = String::new();
                body.push_str(indent);
                body.push_str("        const __pos = await new Promise((__res, __rej) => navigator.geolocation.getCurrentPosition(__res, __rej, ");
                body.push_str(&opts_ts);
                body.push_str("));\n");
                Some(self.browser_iife(indent, emit, source_trait, &body, "{ latitude: __pos.coords.latitude, longitude: __pos.coords.longitude, accuracy: __pos.coords.accuracy }"))
            }

            OirEffect::BrowserPushSubscribe { emit } => {
                let mut body = String::new();
                body.push_str(indent);
                body.push_str(
                    "        const __keyRes = await fetch('/api/push/vapid-public-key');\n",
                );
                body.push_str(indent);
                body.push_str("        if (!__keyRes.ok) { throw new Error('Push is not configured on this host (no VAPID public key)'); }\n");
                body.push_str(indent);
                body.push_str("        const __pk = ((await __keyRes.json()) as { publicKey: string }).publicKey;\n");
                body.push_str(indent);
                body.push_str("        const __b64 = (__pk + '='.repeat((4 - (__pk.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');\n");
                body.push_str(indent);
                body.push_str("        const __raw = atob(__b64);\n");
                body.push_str(indent);
                body.push_str("        const __buf = new ArrayBuffer(__raw.length);\n");
                body.push_str(indent);
                body.push_str("        const __view = new Uint8Array(__buf);\n");
                body.push_str(indent);
                body.push_str("        for (let __i = 0; __i < __raw.length; __i++) { __view[__i] = __raw.charCodeAt(__i); }\n");
                body.push_str(indent);
                body.push_str("        const __reg = await navigator.serviceWorker.register('/almadar-push-sw.js');\n");
                body.push_str(indent);
                body.push_str("        const __sub = await __reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: __buf });\n");
                body.push_str(indent);
                body.push_str("        const __json = __sub.toJSON();\n");
                body.push_str(indent);
                body.push_str("        if (!__json.endpoint || !__json.keys?.p256dh || !__json.keys?.auth) { throw new Error('Push subscription resolved without endpoint/keys'); }\n");
                Some(self.browser_iife(indent, emit, source_trait, &body, "{ endpoint: __json.endpoint, p256dh: __json.keys.p256dh, auth: __json.keys.auth }"))
            }

            OirEffect::BrowserPageFacts { fields, key: Some(key), emit } => {
                let facts = self.client_page_facts_body(fields, indent);
                let key_ts = self.expr_to_client_ts(key);
                let source_ts = Self::source_stamp(source_trait);
                let emit_line = |event: &Option<String>, payload: &str| {
                    event.as_ref().map(|ev| format!("{indent}        eventBus.emit('{ev}', {payload}{source_ts});\n"))
                };
                let success = emit.as_ref().and_then(|c| emit_line(&c.success, "{ ...__facts, key: __key }"));
                let failure = emit.as_ref().and_then(|c| {
                    emit_line(
                        &c.failure,
                        "{ error: __err instanceof Error ? __err.message : String(__err), ...(__key !== undefined ? { key: __key } : {}) }",
                    )
                });
                let mut out = String::new();
                out.push_str(&format!("{indent}(async () => {{\n{indent}    let __key: string | undefined;\n{indent}    try {{\n"));
                out.push_str(&format!("{indent}        const __candidate = {key_ts};\n"));
                out.push_str(&format!("{indent}        if (typeof __candidate !== 'string' || __candidate === '') {{ throw new Error('browser/page-facts: key must be a non-empty string'); }}\n"));
                out.push_str(&format!("{indent}        __key = __candidate;\n"));
                out.push_str(&facts);
                out.push_str(&success.unwrap_or_default());
                out.push_str(&format!("{indent}    }} catch (__err) {{\n"));
                out.push_str(&failure.unwrap_or_default());
                out.push_str(&format!("{indent}    }}\n{indent}}})();"));
                Some(out)
            }

            OirEffect::BrowserPageFacts { fields, emit, .. } => {
                let body = self.client_page_facts_body(fields, indent);
                Some(self.browser_iife_flat(indent, emit, source_trait, &body, "__facts"))
            }

            // Delivered by the browser store's one http driver: a transition that sends a beacon is a browser leg
            // (`trait_browser_leg_events`), so the client holds no delivery code of its own.
            OirEffect::BrowserBeacon { .. } => None,

            // Custom effects — emit as comments for manual wiring
            OirEffect::Custom { name, args, .. } => {
                let args_ts: Vec<String> = args
                    .iter()
                    .map(|(k, v)| format!("{}: {}", k, self.expr_to_client_ts(v)))
                    .collect();
                Some(format!(
                    "{}// Custom effect: {}({{ {} }})",
                    indent,
                    name,
                    args_ts.join(", ")
                ))
            }
        }
    }

    /// Build the `, { trait: '…' }` source-stamp suffix for a client-side
    /// `eventBus.emit`, matching the `Emit` arm. Empty when there is no
    /// originating trait (e.g. test harness).
    fn source_stamp(source_trait: Option<&str>) -> String {
        match source_trait {
            Some(t) => format!(", {{ trait: '{}' }}", t),
            None => String::new(),
        }
    }

    /// The statements that read the requested page facts into `__facts`, in list order.
    fn client_page_facts_body(&self, fields: &[orbital_core::ir::PageFactField], indent: &str) -> String {
        let mut body = String::new();
        body.push_str(indent);
        body.push_str("        const __facts = { available: typeof window !== 'undefined' && typeof document !== 'undefined', hostname: '', referrer: '', screenWidth: null as number | null };\n");
        body.push_str(indent);
        body.push_str("        if (__facts.available) {\n");
        for field in fields {
            body.push_str(indent);
            body.push_str(match field.as_str() {
                "hostname" => "            __facts.hostname = window.location.hostname;\n",
                "referrer" => "            __facts.referrer = document.referrer;\n",
                _ => "            __facts.screenWidth = window.screen?.width ?? null;\n",
            });
        }
        body.push_str(indent);
        body.push_str("        }\n");
        body
    }

    /// Build the optional success/failure completion-emit statements for a
    /// browser device effect. Each returned line is already indented for the
    /// inside of the IIFE try/catch block and ends with `;` (no trailing
    /// newline). Mirrors the JS runtime `runSubstrate` envelope:
    /// success → `{ result: __result }`, failure → `{ error }`.
    ///
    /// Built via concatenation (not `format!`) so the literal JS braces in the
    /// object bodies do not need `{{`/`}}` doubling — that adjacency is what
    /// tripped the earlier `unmatched }` compile errors.
    fn device_emit_lines(
        &self,
        emit: &Option<OirEmitConfig>,
        source_ts: &str,
        indent: &str,
        flat: bool,
    ) -> (Option<String>, Option<String>) {
        let success = emit.as_ref().and_then(|c| c.success.as_ref()).map(|ev| {
            let mut s = String::new();
            s.push_str(indent);
            s.push_str("    eventBus.emit('");
            s.push_str(ev);
            s.push_str(if flat { "', { ...__result }" } else { "', { result: __result }" });
            s.push_str(source_ts);
            s.push_str(");");
            s
        });
        let failure = emit.as_ref().and_then(|c| c.failure.as_ref()).map(|ev| {
            let mut s = String::new();
            s.push_str(indent);
            s.push_str("    eventBus.emit('");
            s.push_str(ev);
            s.push_str("', { error: __err instanceof Error ? __err.message : String(__err) }");
            s.push_str(source_ts);
            s.push_str(");");
            s
        });
        (success, failure)
    }

    /// Assemble a self-invoking async IIFE for a browser device effect.
    /// `compute_body` is the fully-indented device-specific statements
    /// (each ending in `\n`) that compute the value assigned to `__result`;
    /// `result_expr` is the object literal assigned to `__result`. The
    /// success/failure completion events are emitted only when present in
    /// `emit`. Built via concatenation so literal JS braces stay literal.
    fn browser_iife(
        &self,
        indent: &str,
        emit: &Option<OirEmitConfig>,
        source_trait: Option<&str>,
        compute_body: &str,
        result_expr: &str,
    ) -> String {
        self.browser_iife_shaped(indent, emit, source_trait, compute_body, result_expr, false)
    }

    /// [`Self::browser_iife`] whose success event carries the result's fields flat, not wrapped in `{ result }`.
    fn browser_iife_flat(
        &self,
        indent: &str,
        emit: &Option<OirEmitConfig>,
        source_trait: Option<&str>,
        compute_body: &str,
        result_expr: &str,
    ) -> String {
        self.browser_iife_shaped(indent, emit, source_trait, compute_body, result_expr, true)
    }

    fn browser_iife_shaped(
        &self,
        indent: &str,
        emit: &Option<OirEmitConfig>,
        source_trait: Option<&str>,
        compute_body: &str,
        result_expr: &str,
        flat: bool,
    ) -> String {
        let source_ts = Self::source_stamp(source_trait);
        let (succ, fail) = self.device_emit_lines(emit, &source_ts, indent, flat);
        let mut out = String::new();
        out.push_str(indent);
        out.push_str("(async () => {\n");
        out.push_str(indent);
        out.push_str("    try {\n");
        out.push_str(compute_body);
        out.push_str(indent);
        out.push_str("        const __result = ");
        out.push_str(result_expr);
        out.push_str(";");
        if let Some(s) = succ {
            out.push('\n');
            out.push_str(&s);
        }
        out.push('\n');
        out.push_str(indent);
        out.push_str("    } catch (__err) {");
        if let Some(f) = fail {
            out.push('\n');
            out.push_str(&f);
        }
        out.push('\n');
        out.push_str(indent);
        out.push_str("    }\n");
        out.push_str(indent);
        out.push_str("})();");
        out
    }

    /// Check if a transition has any client-side effects that need transpilation.
    ///
    /// Descends via `any_effect_leaf` (not just top-level `do`/`let`) — a
    /// `(let … (do (set …)))` or `(if … (set …) …)` event effect is still a
    /// client effect (C-EVENT-TRANSITION-LET-EFFECTS-DROPPED and the
    /// resolved-`if`-drop this replaces). Mirrors `trait_has_render_ui_effect`.
    pub(crate) fn transition_has_client_effects(&self, effects: &[OirExpr]) -> bool {
        fn is_client_effect(effect: &OirEffect) -> bool {
            matches!(
                effect,
                OirEffect::Emit { .. }
                    | OirEffect::Navigate { .. }
                    | OirEffect::Set { .. }
                    | OirEffect::SetDynamic { .. }
                    | OirEffect::Log { .. }
                    | OirEffect::Custom { .. }
                    | OirEffect::SendServer { .. }
                    | OirEffect::BrowserOpenFilePicker { .. }
                    | OirEffect::BrowserClipboardRead { .. }
                    | OirEffect::BrowserClipboardWrite { .. }
                    | OirEffect::BrowserGeolocationCurrent { .. }
                    | OirEffect::BrowserPageFacts { .. }
                    | OirEffect::BrowserPushSubscribe { .. }
            )
        }
        effects
            .iter()
            .any(|e| any_effect_leaf(e, &is_client_effect))
    }

    /// Check if any client-side effect in a trait uses Navigate
    /// Deep scan: does any transition or tick expression in this trait call
    /// `function`? Descends the full tree via `OirExpr::calls_function`
    /// (including nested effects). Drives per-hook imports for operators whose
    /// emitted form is a shared `@almadar/core` helper call.
    pub(crate) fn trait_calls_function(&self, trait_def: &OirTrait, function: &str) -> bool {
        trait_def
            .transitions
            .iter()
            .flat_map(|t| t.effects.iter())
            .chain(trait_def.ticks.iter().flat_map(|t| t.effects.iter()))
            .any(|e| e.calls_function(function))
    }

    /// The `@almadar/core` value import a trait needs for pure language/XML forms
    /// pure forms (`behavior/apply` → `applyBehaviorOverrides` over core's schemas,
    /// `quasiquote` → `instantiateQuasiquote` + `toProgramData`), scanning
    /// guards as well as effects and ticks. Empty when it uses neither.
    pub(crate) fn language_trio_core_import(&self, trait_def: &OirTrait) -> String {
        let uses = |f: &str| {
            self.trait_calls_function(trait_def, f)
                || trait_def
                    .transitions
                    .iter()
                    .filter_map(|t| t.guard.as_ref())
                    .chain(trait_def.ticks.iter().filter_map(|t| t.guard.as_ref()))
                    .any(|g| g.calls_function(f))
        };
        let mut syms: std::collections::BTreeSet<&str> = std::collections::BTreeSet::new();
        if uses("behavior/apply") {
            syms.extend([
                "applyBehaviorOverrides",
                "BehaviorValueSchema",
                "JsonValueSchema",
                "toProgramData",
            ]);
        }
        if uses("quasiquote") {
            syms.extend(["instantiateQuasiquote", "toProgramData"]);
        }
        if uses("behavior/ref") {
            syms.insert("behaviorRef");
        }
        for dependencies in crate::codegen::operator::CORE_OPERATOR_IMPORTS {
            if uses(dependencies.operator) {
                syms.extend(dependencies.imports.iter().copied());
            }
        }
        if syms.is_empty() {
            String::new()
        } else {
            crate::codegen::handler_header::core_value_imports_clause(&syms)
        }
    }

    pub(crate) fn trait_has_navigate_effects(&self, trait_def: &OirTrait) -> bool {
        trait_def.transitions.iter().any(|t| {
            t.effects.iter().any(|e| {
                if let OirExpr::Effect { effect } = e {
                    matches!(effect.as_ref(), OirEffect::Navigate { .. })
                } else {
                    false
                }
            })
        })
    }

    /// Does this trait touch the navigation-stack API — a crumb-carrying
    /// navigate or a `navigate-back`? Gates the `useNavStack` hook in the
    /// generated logic hook (plain navigates sync the stack passively via
    /// the provider's location listener and need no hook).
    pub(crate) fn trait_has_navstack_effects(&self, trait_def: &OirTrait) -> bool {
        trait_def.transitions.iter().any(|t| {
            t.effects.iter().any(|e| {
                if let OirExpr::Effect { effect } = e {
                    matches!(
                        effect.as_ref(),
                        OirEffect::NavigateBack | OirEffect::Navigate { crumb: Some(_), .. }
                    )
                } else {
                    false
                }
            })
        })
    }

    pub(crate) fn trait_has_send_server_effects(&self, trait_def: &OirTrait) -> bool {
        trait_def.transitions.iter().any(|t| {
            t.effects.iter().any(|e| {
                if let OirExpr::Effect { effect } = e {
                    matches!(effect.as_ref(), OirEffect::SendServer { .. })
                } else {
                    false
                }
            })
        })
    }

    /// Does this trait have a `(render-ui ...)` effect anywhere — in a
    /// transition (the common case) or a tick (a trait that renders
    /// straight from its own tick body)? Classifies the "render trait" for
    /// `[shared]`-entity coalescing (`generate_shared_trait_logic_hook`):
    /// the sole trait whose `render-ui` paints the merged entity state.
    /// Unlike the sibling `trait_has_*_effects` checks above (which only
    /// scan top-level `t.effects` entries), this recurses through `do`/`let`
    /// wrappers — the same shape `collect_tick_effect` (tick.rs) already
    /// flattens for tick bodies — because a render-ui can be nested inside
    /// one (`(do (set @entity.X ...) (render-ui ...))`).
    pub(crate) fn trait_has_render_ui_effect(&self, trait_def: &OirTrait) -> bool {
        // A config-gated `(if @config.X (render-ui A) (render-ui B))`
        // (std-board's boardLook switch, std-browse's browseLook switch)
        // still renders — from EITHER branch — so `any_effect_leaf`'s
        // both-branches descent is exactly the check: a `[shared]`-entity
        // trait whose only render-ui sits behind such a switch must not be
        // treated as non-rendering.
        fn is_render_ui(effect: &OirEffect) -> bool {
            matches!(effect, OirEffect::RenderUi { .. })
        }
        trait_def
            .transitions
            .iter()
            .any(|t| t.effects.iter().any(|e| any_effect_leaf(e, &is_render_ui)))
            || trait_def
                .ticks
                .iter()
                .any(|t| t.effects.iter().any(|e| any_effect_leaf(e, &is_render_ui)))
    }

    /// Check if any client-side effect in a trait uses a specific binding root
    pub(crate) fn trait_client_effects_use_root(
        &self,
        trait_def: &OirTrait,
        target_root: &OirBindingRoot,
    ) -> bool {
        // Descend the whole effect tree (not just top-level `OirExpr::Effect`):
        // a `@user`/`@payload` read buried in a `let`/`do`/`if`/`Conditional`
        // is now emitted by `walk_effect_block`, so its `user`/`payloadObj`
        // declaration must be gated on the same descent or the branch
        // references an undeclared name (TS2304 `user` / TS2552 `payloadObj`).
        for trans in &trait_def.transitions {
            for effect_expr in &trans.effects {
                if any_effect_leaf(effect_expr, &|effect| {
                    self.client_effect_uses_root(effect, target_root)
                }) || effect_block_control_reads_root(effect_expr, target_root)
                {
                    return true;
                }
            }
        }
        false
    }

    /// Check whether any transition GUARD (the `when` clause) references the
    /// given binding root. Guards land inside the client-side `else if`
    /// condition (see the guard-threading change in `generate_transpiled_effect_handler`),
    /// so a `@user.role`-based guard needs `user` in scope at the callback's
    /// top — distinct from `trait_client_effects_use_root` which only scans
    /// effect bodies.
    pub(crate) fn trait_client_guards_use_root(
        &self,
        trait_def: &OirTrait,
        target_root: &OirBindingRoot,
    ) -> bool {
        for trans in &trait_def.transitions {
            if let Some(guard) = &trans.guard {
                if guard
                    .collect_bindings()
                    .iter()
                    .any(|b| b.root == *target_root)
                {
                    return true;
                }
            }
        }
        false
    }

    /// Check if a single client effect uses a specific binding root in EXPRESSIONS
    /// (not in Set target, since Set target is only used for field name extraction)
    pub(crate) fn client_effect_uses_root(
        &self,
        effect: &OirEffect,
        target_root: &OirBindingRoot,
    ) -> bool {
        let check_expr = |expr: &OirExpr| -> bool {
            expr.collect_bindings()
                .iter()
                .any(|b| b.root == *target_root)
        };

        match effect {
            OirEffect::Set { value, .. } => {
                // Only check the value expression — the target is used for field name only
                check_expr(value)
            }
            OirEffect::SetDynamic { target, value, .. } => check_expr(target) || check_expr(value),
            OirEffect::Emit { payload, .. } => payload.as_ref().is_some_and(&check_expr),
            OirEffect::Navigate {
                path,
                params,
                crumb,
            } => {
                check_expr(path)
                    || params.as_ref().is_some_and(&check_expr)
                    || crumb.as_ref().is_some_and(&check_expr)
            }
            OirEffect::Log { message, .. } => check_expr(message),
            OirEffect::Custom { args, .. } => args.values().any(check_expr),
            OirEffect::SendServer { event, payload } => {
                check_expr(event) || payload.as_ref().is_some_and(&check_expr)
            }
            OirEffect::BrowserOpenFilePicker { options, .. } => {
                options.as_ref().is_some_and(&check_expr)
            }
            OirEffect::BrowserClipboardRead { .. } | OirEffect::BrowserPushSubscribe { .. } => {
                false
            }
            OirEffect::BrowserClipboardWrite { text, .. } => check_expr(text),
            OirEffect::BrowserGeolocationCurrent { options, .. } => {
                options.as_ref().is_some_and(&check_expr)
            }
            OirEffect::BrowserPageFacts { .. } => false,
            OirEffect::BrowserBeacon { url, request, key, .. } => {
                check_expr(url) || check_expr(request) || key.as_ref().is_some_and(&check_expr)
            }
            _ => false,
        }
    }

    /// Generate the transpiled `executeTransitionEffects` function for a trait's logic hook.
    ///
    /// This replaces the runtime `pendingEffectsRef` + switch interpreter with
    /// compile-time transpiled TypeScript for each (fromState, event) transition.
    /// Collect transpiled statements for one transition-effect expression via
    /// `walk_effect_block` — `let`/`do` flatten, `if`/`when`/`Conditional`
    /// emit real TS control flow, so neither a `(let … (do (set …)))`
    /// (C-EVENT-TRANSITION-LET-EFFECTS-DROPPED) nor a resolved `if` vanishes
    /// into a no-op handler.
    fn collect_client_effect_statements(
        &self,
        expr: &OirExpr,
        indent: &str,
        trait_name: Option<&str>,
        emit_fanout: Option<(&OirModule, &str)>,
        out: &mut Vec<String>,
    ) {
        let mut sink = ClientEffectSink {
            trait_name,
            emit_fanout,
            out,
        };
        walk_effect_block(self, expr, indent, &mut sink);
    }

    /// The `guardHolds` import a hook needs when any of the trait's arms is guarded: each one
    /// runs through it (`generate_transpiled_effect_handler_impl`). Every hook generator uses this.
    pub(crate) fn guard_holds_import(trait_def: &OirTrait) -> &'static str {
        if trait_def.transitions.iter().any(|t| t.guard.is_some()) {
            "import { guardHolds } from '@almadar/core';\n"
        } else {
            ""
        }
    }

    /// Shared impl for the transpiled client-side effect handler. `resolve_new_state`
    /// is additive and OFF for every persisted-entity (server-backed) call site —
    /// output there is unchanged. When ON, the handler ALSO resolves the next
    /// machine state purely client-side, so it must consider every transition —
    /// not just ones with transpilable client effects — and stamp `_newState`
    /// from the matched transition's literal `to` state. Two consumers:
    /// (1) the `[shared]`-entity client-only dispatch path
    /// (`generate_shared_trait_logic_hook`) — no server round trip exists for
    /// `[shared]` entities to supply it; (2) the optimistic dispatch path for
    /// `[runtime]`-linked server-backed traits (`generate_trait_logic_hook`,
    /// T9) — the local commit can't wait on the server. `emit_fanout` is
    /// decoupled from `resolve_new_state`: only the truly serverless `[shared]`
    /// path relays bare emits to sibling traits' qualified subscriptions —
    /// the optimistic server-backed path leaves cascade delivery to the
    /// server's `emittedEvents` echo (bridge.rs), exactly as the server-gated
    /// path does today, so listeners never see an emit twice.
    pub(crate) fn generate_transpiled_effect_handler_impl(
        &self,
        trait_def: &OirTrait,
        module: &OirModule,
        resolve_new_state: bool,
        emit_fanout: bool,
    ) -> String {
        let mut code = String::new();
        let browser_leg_events =
            trait_def.browser_leg_events(&orbital_core::effects::Residence::of_module(module));

        // Collect transitions that have client-side effects
        let mut has_any_effects = false;
        for trans in &trait_def.transitions {
            if self.transition_has_client_effects(&trans.effects) {
                has_any_effects = true;
                break;
            }
        }
        let has_transitions = !trait_def.transitions.is_empty();
        let needs_handler = has_any_effects || (resolve_new_state && has_transitions);
        let reads_dispatch = crate::codegen::effect::shared::trait_reads_dispatch_scope(trait_def);
        let dispatch_param = if reads_dispatch {
            ", __dispatchIn?: DispatchScope"
        } else {
            ""
        };

        if !needs_handler {
            // No client effects to transpile — return empty handler.
            // Returns an empty `_fields` so the caller (dispatch in
            // backend.rs) can always merge the result into EVENT_SUCCESS
            // uniformly.
            code.push_str(
                "  // No client-side effects to transpile — all effects are server-side or declarative\n",
            );
            if resolve_new_state {
                // Keeps the full handler's 4-param shape (`liveData` included)
                // so every resolve_new_state caller — the [shared] dispatch AND
                // the T9 optimistic dispatch — can call it uniformly.
                code.push_str(&format!(
                    "  const executeTransitionEffects = useCallback((_fromState: string, _event: string, _liveData: Record<string, EntityRow[]>, _payload?: EventPayload{dispatch_param}): {{ fields: Record<string, EventPayloadValue | undefined>; newState: string | undefined; emits: Array<() => void> }} => {{\n",
                ));
                code.push_str(
                    "    // All effects handled server-side or via declarative render-ui\n",
                );
                code.push_str("    return { fields: {}, newState: undefined, emits: [] };\n");
            } else {
                code.push_str(&format!(
                    "  const executeTransitionEffects = useCallback((_fromState: string, _event: string, _payload?: EventPayload{dispatch_param}): Record<string, EventPayloadValue | undefined> => {{\n",
                ));
                code.push_str(
                    "    // All effects handled server-side or via declarative render-ui\n",
                );
                code.push_str("    return {};\n");
            }
            code.push_str("  }, []);\n\n");
            return code;
        }

        // Scan which binding roots are used in client effects
        let effects_use_entity =
            self.trait_client_effects_use_root(trait_def, &OirBindingRoot::Entity);
        // A transition GUARD (`when`) is compiled INTO this callback's condition
        // and reads payload via `payloadObj`, so a payload-using guard needs the
        // same `payload` param + `payloadObj` alias an effect would — not just
        // effect bodies (else: `TS2552 Cannot find name 'payloadObj'`).
        let effects_use_payload = self
            .trait_client_effects_use_root(trait_def, &OirBindingRoot::Payload)
            || self.trait_client_guards_use_root(trait_def, &OirBindingRoot::Payload);
        let effects_use_navigate = self.trait_has_navigate_effects(trait_def);
        let effects_use_set = trait_def.transitions.iter().any(|t| {
            t.effects.iter().any(|e| {
                any_effect_leaf(e, &|effect| {
                    matches!(effect, OirEffect::Set { .. } | OirEffect::SetDynamic { .. })
                })
            })
        });

        code.push_str("  // Transpiled client-side effects (Phase 4)\n");
        code.push_str(
            "  // Each (fromState, event) transition's client effects are compiled to TypeScript.\n",
        );
        let payload_param = if effects_use_payload {
            "payload?: EventPayload"
        } else {
            "_payload?: EventPayload"
        };
        let return_ty = if resolve_new_state {
            "{ fields: Record<string, EventPayloadValue | undefined>; newState: string | undefined; emits: Array<() => void> }"
        } else {
            "Record<string, EventPayloadValue | undefined>"
        };
        // `resolve_new_state` mode takes the live entity snapshot as a
        // PARAMETER (`liveData`, required — TS forbids a required param after
        // an optional one, so it sits before `payload?`) instead of closing
        // over the hook's outer `data`/`_initialFields`. There is no server
        // round trip to correct a stale read here, so the caller (the
        // `[shared]`-entity dispatch wrapper) must read the shared store
        // fresh at CALL time and pass it in — closing over hook-render-time
        // state would reintroduce the exact async-staleness class of bug
        // CL-GUARD/CL-FREEZE fixed in the JS runtime path
        // (`useTraitStateMachine.ts`'s `processEventQueued`), just at the
        // codegen level instead.
        let params = if resolve_new_state {
            format!(
                "fromState: string, event: string, liveData: Record<string, EntityRow[]>, {}{}",
                payload_param, dispatch_param
            )
        } else {
            format!(
                "fromState: string, event: string, {}{}",
                payload_param, dispatch_param
            )
        };
        code.push_str(&format!(
            "  const executeTransitionEffects = useCallback(({}): {} => {{\n",
            params, return_ty
        ));

        // Per-transition field accumulator. Every `(set @entity.X Y)`
        // writes here instead of dispatching SET_FIELD individually. The
        // accumulator is returned to the dispatch wrapper which folds it
        // into the single EVENT_SUCCESS reducer dispatch.
        code.push_str("    const _fields: Record<string, EventPayloadValue | undefined> = {};\n");
        if reads_dispatch {
            let payload_name = if effects_use_payload {
                "payload"
            } else {
                "_payload"
            };
            code.push_str(&format!(
                "    const __dispatch: DispatchScope = __dispatchIn ?? dispatchScopeOf(undefined, undefined, event, {payload_name});\n"
            ));
        }
        if resolve_new_state {
            code.push_str("    const _emits: Array<() => void> = [];\n");
        }
        // Client-only dispatch (`resolve_new_state`) has no server to supply
        // `newState` — the matched transition's literal `to` state is stamped
        // here as each branch below fires. Stays `undefined` when nothing
        // matches (fromState, event) — the caller treats that as "no
        // transition defined", mirroring the server's rejection.
        if resolve_new_state {
            code.push_str("    let _newState: string | undefined = undefined;\n");
            code.push_str("    let _arm: number | undefined = undefined;\n");
        }

        // Declare variables for client effects. `CLIENT_PAYLOAD_VAR` is the
        // single owner of the alias name — `binding_to_client_ts` emits the
        // same constant for `@payload`, so the declared and referenced names
        // can never drift (TS2552).
        if effects_use_payload {
            code.push_str(&format!(
                "    const {} = payload;\n",
                crate::codegen::expr::CLIENT_PAYLOAD_VAR,
            ));
        }
        // Declare entity alias — `@entity.<field>` bindings compile to
        // `entity?.[0]?.<field>`, so `entity` must be the linked entity's
        // collection (an array of that entity), not the whole data map.
        // Falls back to the whole map when no linked entity is declared.
        // Type as `EntityRow[]` (the runtime invariant) — narrowing to
        // the specific entity (`as Account[]`) trips TS2352 because
        // EntityRow's `Record<string, FieldValue | undefined>` index
        // signature is too wide for TS to accept a narrowing cast.
        let data_var = if resolve_new_state {
            "liveData"
        } else {
            "data"
        };
        match &trait_def.linked_entity {
            Some(linked_entity) => {
                let _ = entity_type_ref(linked_entity);
                code.push_str(&format!(
                    "    const entity: EntityRow[] = {data_var}['{name}'] ?? [];\n",
                    data_var = data_var,
                    name = linked_entity,
                ));
            }
            None => code.push_str(&format!("    const entity = {};\n", data_var)),
        }
        // Mutable working snapshot — every `(set @entity.X Y)` below updates
        // this so subsequent reads in the SAME transition body see the
        // staged write. Matches runtime's EffectExecutor.dispatch('set'),
        // which mirrors writes back into `bindings.entity`. Without this,
        // `(set @entity.i (+ @entity.i 1)) (set @entity.label (lookup @entity.i))`
        // reads the pre-increment `i` for the label lookup and stamps a
        // stale label — the bug behind the std-step-flow index/label drift.
        // `resolve_new_state` mode seeds from the freshly-passed `entity`
        // (itself sourced from `liveData` above) instead of the reducer-
        // cached `_initialFields` — same staleness reasoning as `liveData`.
        // Declared as the wide `Record<string, EventPayloadValue |
        // undefined>` (`FIELDS_STAGING_TS_TYPE`) — instead of letting the
        // initializer infer a narrower type. Without an explicit
        // annotation, `entity[0] ?? {}` infers `EntityRow` (`Record<string,
        // FieldValue | undefined>`), and a field whose value is a readonly
        // array (`array/map`/`array/sort`/… all return `readonly
        // EventPayloadValue[]`, see `codegen/operator.rs`) then fails the
        // merge-cast in the `set`/`set-dynamic` arms below — `FieldValue`'s
        // own array member is mutable, so a readonly array never
        // "sufficiently overlaps" with it (TS2352). See
        // `FIELDS_STAGING_TS_TYPE`'s doc for why the wide type dodges this
        // for every value `expr_to_client_ts` can produce.
        if resolve_new_state {
            // `entity: EntityRow[]` — `FieldValue` is a subtype of
            // `EventPayloadValue`, so this widens by plain assignment, no
            // cast needed.
            code.push_str(&format!(
                "    let fields: {FIELDS_STAGING_TS_TYPE} = entity[0] ?? {{}};\n"
            ));
        } else {
            // Read through the per-render-synced ref, NOT the render-time
            // `_initialFields` closure: the useCallback deps don't include
            // `fields`, so tick-driven progress between renders was rolled
            // back by event dispatches reading a stale snapshot
            // (C-SHELL-TRANSITION-STALE-FIELDS — flappy's tickCount reset).
            // `internalStateRef.current.fields: Partial<LinkedEntity>` —
            // a plain-object relation field (no index signature) isn't
            // implicitly assignable to a `Record<string, …>` target, so
            // this widening needs an explicit cast (comparable, not
            // assignable — TS accepts it because every LinkedEntity field
            // type is itself EventPayloadValue-compatible).
            code.push_str(&format!(
                "    let fields: {FIELDS_STAGING_TS_TYPE} = (internalStateRef.current.fields ?? {{}}) as {FIELDS_STAGING_TS_TYPE};\n"
            ));
        }
        // `user` (when referenced via @user.X) is destructured from `useUser()`
        // at the outer function-component scope (see `uses_user` block in
        // backend.rs); the callback closes over it.
        if effects_use_payload {
            code.push('\n');
        }
        code.push('\n');

        let mut first_branch = true;
        for (arm, trans) in trait_def.transitions.iter().enumerate() {
            // In server-backed mode, a transition with no transpilable client
            // effects contributes nothing (the server alone resolves its
            // state) — skip it, exactly as before. In `resolve_new_state`
            // mode there is no server, so EVERY transition needs a branch
            // purely to stamp `_newState`, even one with zero client effects
            // (e.g. a bare `A -> B on EVENT` with no `set`/`emit`/etc).
            if !resolve_new_state && !self.transition_has_client_effects(&trans.effects) {
                continue;
            }

            // Collect transpiled effect statements for this transition.
            // Fan-out is a parameter, NOT coupled to `resolve_new_state`:
            // the `[shared]` client-only path needs it (no server echo
            // exists); the optimistic server-backed path must NOT have it
            // (the server's emittedEvents echo already delivers the cascade —
            // a local fan-out would double-fire listeners).
            // A browser-leg event's emits come back on the leg's echo, like a
            // server leg's.
            let emit_fanout = if emit_fanout && !browser_leg_events.contains(&trans.event) {
                Some((module, trait_def.orbital_name.as_str()))
            } else {
                None
            };
            let mut effect_statements: Vec<String> = Vec::new();
            self.in_transition(&trans.to, crate::backend::TransitionPhase::Effect, || {
                for effect_expr in &trans.effects {
                    self.collect_client_effect_statements(
                        effect_expr,
                        "        ",
                        Some(&trait_def.name),
                        emit_fanout,
                        &mut effect_statements,
                    );
                }
            });

            if !resolve_new_state && effect_statements.is_empty() {
                continue;
            }

            // Generate the from-states for this transition
            let from_states = match &trans.from {
                OirTransitionFrom::Single(s) => vec![s.clone()],
                OirTransitionFrom::Multiple(states) => states.clone(),
                OirTransitionFrom::Any => trait_def.states.iter().map(|s| s.name.clone()).collect(),
            };

            // Build condition: fromState === 'X' && event === 'Y'
            let state_conditions: Vec<String> = from_states
                .iter()
                .map(|s| format!("fromState === '{}'", s))
                .collect();
            let state_cond = if state_conditions.len() == 1 {
                state_conditions[0].clone()
            } else {
                format!("({})", state_conditions.join(" || "))
            };

            let prefix = if first_branch { "    if" } else { " else if" };
            // Thread the transition's `when` guard into the client-side
            // condition. Without this, two transitions sharing the same
            // (fromState, event) collapse to identical `else if` branches and
            // only the first ever fires — corrupting state when the server
            // chose the guarded sibling (e.g. std-step-flow's
            // `ADVANCE -> running when (not isLastStep)` vs
            // `ADVANCE -> approved when isLastStep`).
            // A guard that throws blocks its arm like a false guard (`@almadar/core`
            // `guardHolds` — the server's and the JS runtime's rule too); the error is logged.
            let guard_ts = trans.guard.as_ref().map(|g| {
                self.in_transition(&trans.to, crate::backend::TransitionPhase::Guard, || {
                    format!(
                        " && guardHolds(() => Boolean({}), (error) => console.error(`[guard] {}.{} -> {} threw:`, error.message))",
                        self.expr_to_client_ts(g),
                        trait_def.name,
                        trans.event,
                        trans.to
                    )
                })
            });
            code.push_str(&format!(
                "{} ({} && event === '{}'{}) {{\n",
                prefix,
                state_cond,
                trans.event,
                guard_ts.unwrap_or_default()
            ));

            // Add comment showing the transition
            code.push_str(&format!(
                "      // {} → {} (on {})\n",
                from_states.join("|"),
                trans.to,
                trans.event
            ));

            for stmt in &effect_statements {
                code.push_str(&format!("{}\n", stmt));
            }
            if resolve_new_state {
                code.push_str(&format!("      _newState = '{}';\n", trans.to));
                code.push_str(&format!("      _arm = {arm};\n"));
            }

            code.push_str("    }");
            first_branch = false;
        }

        if !first_branch {
            code.push('\n');
        }

        // Return the accumulated field updates so dispatch can fold them
        // into EVENT_SUCCESS in one reducer commit.
        if resolve_new_state {
            code.push_str("    return { fields: _fields, newState: _newState, emits: _emits, arm: _arm };\n");
        } else {
            code.push_str("    return _fields;\n");
        }

        // Build dependency array based on actual usage
        let mut deps = vec!["eventBus".to_string()];
        if effects_use_navigate {
            deps.push("navigate".to_string());
        }
        if self.trait_has_navstack_effects(trait_def) {
            deps.push("navStack".to_string());
        }
        if effects_use_entity && !resolve_new_state {
            // `resolve_new_state` mode reads the live entity via the
            // `liveData` parameter, not the closed-over outer `data` — no
            // dependency-array entry needed (nothing to go stale).
            deps.push("data".to_string());
        }
        if self.trait_has_send_server_effects(trait_def) {
            deps.push("sendServerEvent".to_string());
        }
        // dispatchReducer no longer a dep — (set) writes to the local
        // _fields accumulator and the caller dispatches once.
        let _ = effects_use_set;
        code.push_str(&format!("  }}, [{}]);\n\n", deps.join(", ")));

        code
    }

    /// Emit a static `getRenderUiSlots(fromState, event)` helper used by
    /// dispatch to (a) gate `lastPayload` / `lastEvent` updates — the
    /// trait-wide "did SOMETHING render-bearing fire" check pre-existing
    /// callers still want — and (b), the §98 fix, tell the reducer WHICH
    /// slots this specific `(fromState, event)` transition writes with real
    /// content vs. clears with a bare `(render-ui <slot> null)`. The View's
    /// JSX gates each slot on `slotWriter['<slot>']`, a per-slot mirror of
    /// the interpreter's `SlotManager` — a render-ui is a persistent write,
    /// live until another transition writes or clears that same slot, never
    /// gated on the trait's current state.
    pub(crate) fn generate_render_ui_lookup(&self, trait_def: &OirTrait) -> String {
        use std::collections::{BTreeMap, BTreeSet};
        let slot_ty = format!("{}Slot", trait_def.name);
        #[allow(clippy::type_complexity)]
        let mut by_from: BTreeMap<
            String,
            BTreeMap<String, (BTreeSet<String>, BTreeSet<String>)>,
        > = BTreeMap::new();
        let mut by_arm: BTreeMap<usize, (BTreeSet<String>, BTreeSet<String>)> = BTreeMap::new();
        for entry in self.collect_transition_slot_renders(trait_def) {
            let (arm_write, arm_clear) = by_arm.entry(entry.arm).or_default();
            if entry.is_clear {
                arm_clear.insert(entry.slot.clone());
            } else {
                arm_write.insert(entry.slot.clone());
            }
            for from in &entry.from_states {
                let (write, clear) = by_from
                    .entry(from.clone())
                    .or_default()
                    .entry(entry.event.clone())
                    .or_default();
                if entry.is_clear {
                    clear.insert(entry.slot.clone());
                } else {
                    write.insert(entry.slot.clone());
                }
            }
        }

        let mut code = String::new();
        code.push_str(&format!(
            "  const getRenderUiSlots = useCallback((fromState: string, event: string, arm?: number): {{ write: {slot_ty}[]; clear: {slot_ty}[] }} => {{\n"
        ));
        // The arm that fired, when the client resolved it: only that arm's renders write or clear.
        if !by_arm.is_empty() {
            code.push_str("    if (arm !== undefined) {\n");
            code.push_str("      switch (arm) {\n");
            for (arm, (write, clear)) in &by_arm {
                let write_list: Vec<String> = write.iter().map(|s| format!("'{}'", s)).collect();
                let clear_list: Vec<String> = clear.iter().map(|s| format!("'{}'", s)).collect();
                code.push_str(&format!(
                    "        case {}: return {{ write: [{}] as {slot_ty}[], clear: [{}] as {slot_ty}[] }};\n",
                    arm, write_list.join(", "), clear_list.join(", ")
                ));
            }
            code.push_str("        default: return { write: [], clear: [] };\n");
            code.push_str("      }\n");
            code.push_str("    }\n");
        }
        if by_from.is_empty() {
            code.push_str("    return { write: [], clear: [] };\n");
        } else {
            code.push_str("    switch (fromState) {\n");
            for (from, events) in &by_from {
                code.push_str(&format!("      case '{}':\n", from));
                code.push_str("        switch (event) {\n");
                for (event, (write, clear)) in events {
                    let write_list: Vec<String> =
                        write.iter().map(|s| format!("'{}'", s)).collect();
                    let clear_list: Vec<String> =
                        clear.iter().map(|s| format!("'{}'", s)).collect();
                    code.push_str(&format!(
                        "          case '{}': return {{ write: [{}] as {slot_ty}[], clear: [{}] as {slot_ty}[] }};\n",
                        event, write_list.join(", "), clear_list.join(", ")
                    ));
                }
                code.push_str("          default: return { write: [], clear: [] };\n");
                code.push_str("        }\n");
            }
            code.push_str("      default:\n");
            code.push_str("        return { write: [], clear: [] };\n");
            code.push_str("    }\n");
        }
        code.push_str("  }, []);\n\n");
        code
    }

    /// Action creators: one per declared event, each calling `dispatch`.
    /// Shared by `generate_trait_logic_hook` (ordinary, server-backed) and
    /// `generate_shared_trait_logic_hook` (`[shared]`-entity, client-only) —
    /// both dispatch signatures are `(event: string, payload?: EventPayload)
    /// => Promise<EventResponse>`, so the action-creator shape is identical.
    /// Extracted so the two hooks can never silently diverge here.
    pub(crate) fn generate_actions_block(
        &self,
        trait_def: &OirTrait,
        actions_type: &str,
    ) -> String {
        let mut code = String::new();
        let name = &trait_def.name;
        code.push_str("  // Action creators (typed per-event)\n");
        if trait_def.events.is_empty() {
            code.push_str(&format!("  const actions: {} = {{}};\n\n", actions_type));
        } else {
            code.push_str(&format!("  const actions: {} = {{\n", actions_type));
            for event in &trait_def.events {
                let action_key = &event.key;
                let has_payload = event
                    .payload_schema
                    .as_ref()
                    .map(|s| !s.is_empty())
                    .unwrap_or(false);
                if has_payload {
                    code.push_str(&format!(
                        "    '{}': (payload?: {name}EventPayloadMap['{key}']) => dispatch('{key}', payload),\n",
                        action_key,
                        name = name,
                        key = event.key
                    ));
                } else {
                    // Event declares no payload_schema (maps to `void` in the
                    // EventPayloadMap). Emit a zero-arg action that calls
                    // dispatch without a payload. TypeScript rejects passing
                    // a `void` value into an `EventPayload | undefined` param.
                    code.push_str(&format!(
                        "    '{}': () => dispatch('{key}'),\n",
                        action_key,
                        key = event.key
                    ));
                }
            }
            code.push_str("  };\n\n");
        }
        code
    }

    /// Subscribe the trait's `enqueueEvent` to the bus for every event it can
    /// actually dispatch (transition triggers only — pure emit-only events
    /// stay out, see the inline comment). Shared by both hook shapes for the
    /// same reason as `generate_actions_block`.
    pub(crate) fn generate_ui_events_subscription(&self, trait_def: &OirTrait) -> String {
        // Event bridging. Only subscribe to events this trait can actually
        // dispatch — i.e., events that appear as transition triggers. Pure
        // emit-only events (declared in `emits` but never used as a
        // transition's `event`) must NOT enter useUIEvents' validEvents
        // list: the client bridge re-broadcasts emitted events on the bus
        // after a transition (so cross-trait listeners fire), and if
        // useUIEvents sees them as dispatchable, it calls `dispatch(E)` →
        // state machine has no transition for E → "No transition defined"
        // error and the cascade stalls (symptom: Persistor emits
        // ITEM_DELETED, its own useUIEvents hears the echo, tries to
        // dispatch ITEM_DELETED, fails, downstream refetch never runs).
        let trigger_events: std::collections::HashSet<&str> = trait_def
            .transitions
            .iter()
            .map(|t| t.event.as_str())
            .collect();
        let event_keys: Vec<_> = trait_def
            .events
            .iter()
            .filter(|e| trigger_events.contains(e.key.as_str()))
            .map(|e| format!("'{}'", e.key))
            .collect();
        // Pass the fully-qualified scope `Orbital.Trait` so the hook
        // subscribes to `UI:Orbital.Trait.Event` — gap #13 unification.
        // Bus traffic is qualified at every producer site (Phase 4a/b/c/g);
        // the bare-key fallback was removed when `useUIEvents` collapsed
        // to a single qualified subscription per validEvent.
        format!(
            "  useUIEvents(enqueueEvent, '{}.{}', [{}] as const, eventBus);\n\n",
            trait_def.orbital_name,
            trait_def.name,
            event_keys.join(", ")
        )
    }

    /// Auto-dispatch `INIT` on mount when the trait declares one. Shared by
    /// both hook shapes.
    pub(crate) fn generate_auto_init_effect(&self, trait_def: &OirTrait) -> String {
        let mut code = String::new();
        let has_init_event = trait_def.events.iter().any(|e| e.key == "INIT");
        if has_init_event {
            code.push_str("  // Auto-init on mount\n");
            code.push_str("  useEffect(() => {\n");
            // Precedence mirrors the JS runtime's navigateTo merge
            // (navigation.tsx): route params first, navigate-state payload
            // overrides them, entityId last.
            code.push_str("    const __rp = Object.fromEntries(Object.entries(config?.routeParams ?? {}).filter(([, v]) => v !== undefined));\n");
            code.push_str("    const __init = { ...__rp, ...(config?.initPayload ?? {}), ...(config?.entityId !== undefined ? { entityId: config.entityId } : {}) };\n");
            code.push_str(
                "    dispatch('INIT', Object.keys(__init).length > 0 ? __init : undefined);\n",
            );
            code.push_str("  // eslint-disable-next-line react-hooks/exhaustive-deps\n");
            code.push_str("  }, []);\n\n");
        }
        code
    }

    /// Sibling traits in the same orbital whose own transition table is
    /// triggered by `event`: each subscribes through its destination-scoped
    /// `useUIEvents` key (`UI:{orbital}.{sibling}.{event}`), which a bare
    /// client-side emit can never reach. `listens` edges are NOT resolved
    /// here — they subscribe to the source-qualified key (`listener_bus_key`),
    /// which the caller publishes once through `emitCascadeEvent`.
    pub(crate) fn implicit_emit_targets(
        &self,
        module: &OirModule,
        orbital_name: &str,
        source_trait: &str,
        event: &str,
    ) -> Vec<String> {
        module
            .traits
            .iter()
            .filter(|t| t.orbital_name == orbital_name && t.name != source_trait)
            .filter(|t| t.transitions.iter().any(|tr| tr.event == event))
            // A trigger a sourced listen feeds hears only that source (the kernel delivers an emit to
            // declared listeners alone); that listen also covers the case where the source is this emitter.
            .filter(|t| !t.listeners.iter().any(|l| l.triggers == event))
            .map(|t| t.name.clone())
            .collect()
    }

    /// Qualified bus key a `listens` edge subscribes to. Sole owner of the
    /// expression: the §60 racy-edge pre-pass keys its table with this, so a
    /// stored key can never drift from the key actually subscribed.
    pub(crate) fn listener_bus_key(
        &self,
        trait_def: &OirTrait,
        listener: &orbital_core::ir::OirListener,
    ) -> String {
        match (&listener.source_orbital, &listener.source_trait) {
            (Some(orbital), Some(trait_name)) => {
                format!("UI:{}.{}.{}", orbital, trait_name, listener.event_pattern)
            }
            (None, Some(trait_name)) => format!(
                "UI:{}.{}.{}",
                trait_def.orbital_name, trait_name, listener.event_pattern
            ),
            _ => format!("UI:{}", listener.event_pattern),
        }
    }

    /// Traits embedded by every `render-ui` ANYWHERE in an effect expression.
    ///
    /// A transition's render is frequently a conditional rather than a bare
    /// effect — `std-browse`'s `BrowseItemLoaded` arm is an `(if browseLook …)`
    /// chain selecting one of six body trees — so a top-level-only scan sees
    /// no render at all. Each branch still mounts its children, so the racy
    /// analysis has to consider all of them.
    fn collect_embedded_traits_in_expr(&self, expr: &OirExpr, out: &mut HashSet<String>) {
        match expr {
            OirExpr::Effect { effect } => {
                if let OirEffect::RenderUi { pattern, .. } = effect.as_ref() {
                    orbital_core::ir::collect_trait_refs_from_pattern(
                        pattern,
                        &|s| self.parse_trait_binding(s),
                        out,
                    );
                }
            }
            OirExpr::Conditional {
                condition,
                then_branch,
                else_branch,
            } => {
                self.collect_embedded_traits_in_expr(condition, out);
                self.collect_embedded_traits_in_expr(then_branch, out);
                self.collect_embedded_traits_in_expr(else_branch, out);
            }
            OirExpr::Call { args, .. } => {
                for arg in args {
                    self.collect_embedded_traits_in_expr(arg, out);
                }
            }
            OirExpr::Array { items } => {
                for item in items {
                    self.collect_embedded_traits_in_expr(item, out);
                }
            }
            OirExpr::Object { fields } => {
                for value in fields.values() {
                    self.collect_embedded_traits_in_expr(value, out);
                }
            }
            OirExpr::BinaryOp { left, right, .. } => {
                self.collect_embedded_traits_in_expr(left, out);
                self.collect_embedded_traits_in_expr(right, out);
            }
            OirExpr::UnaryOp { operand, .. } => self.collect_embedded_traits_in_expr(operand, out),
            OirExpr::Map { source, body, .. } => {
                self.collect_embedded_traits_in_expr(source, out);
                self.collect_embedded_traits_in_expr(body, out);
            }
            OirExpr::Filter {
                source, predicate, ..
            } => {
                self.collect_embedded_traits_in_expr(source, out);
                self.collect_embedded_traits_in_expr(predicate, out);
            }
            OirExpr::Reduce {
                source,
                initial,
                body,
                ..
            } => {
                self.collect_embedded_traits_in_expr(source, out);
                self.collect_embedded_traits_in_expr(initial, out);
                self.collect_embedded_traits_in_expr(body, out);
            }
            OirExpr::Lambda { body, .. } => self.collect_embedded_traits_in_expr(body, out),
            OirExpr::Null
            | OirExpr::Bool { .. }
            | OirExpr::Number { .. }
            | OirExpr::String { .. }
            | OirExpr::Binding { .. } => {}
        }
    }

    /// §60 — the module's mount-racy `listens` edges: qualified bus key → the
    /// listening traits that subscribe to it from inside a view the very same
    /// event mounts.
    ///
    /// An edge (source S, event E, target T) is racy when T is embedded in a
    /// render tree S produces ON E. T's subscription is emitted inside T's own
    /// component effect, so it cannot exist when the delivery fires. The
    /// runtime path is immune: it subscribes every page-bound trait once at
    /// page level (`almadar-ui/runtime/OrbPreview.tsx` `TraitInitializer`),
    /// and its views are an EFFECT of the transition rather than a
    /// precondition for it.
    pub(crate) fn compute_racy_listens(
        &self,
        module: &OirModule,
    ) -> BTreeMap<String, BTreeSet<String>> {
        let mut racy: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for trait_def in &module.traits {
            for listener in &trait_def.listeners {
                let Some(src_trait_name) = listener.source_trait.as_deref() else {
                    continue;
                };
                // Resolve the source WITHIN its own orbital first.
                // `resolve_trait_ref` is id-first and module-wide, and two
                // orbitals composing the same atom carry that atom's trait id
                // on their listeners — so the plain call returns whichever
                // composition appears first in `module.traits` (the Author
                // browse list resolving to the Note one). Name-within-orbital
                // is unambiguous; the module-wide call stays the fallback.
                let source_orbital = listener
                    .source_orbital
                    .as_deref()
                    .unwrap_or(&trait_def.orbital_name);
                let Some(source) = module
                    .traits
                    .iter()
                    .find(|t| t.name == src_trait_name && t.orbital_name == source_orbital)
                    .or_else(|| {
                        module
                            .resolve_trait_ref(listener.source_trait_id.as_deref(), src_trait_name)
                    })
                else {
                    continue;
                };
                // An embed token names a sibling by its authored name
                // (`@trait.MasterListView`); the composed declaration may
                // carry another (`NoteOrbitalMasterListView`). Pin the
                // SOURCE trait's side-map so `parse_trait_binding` resolves
                // the token the same way every generator does at trait entry
                // — without this the comparison below never matches a
                // composed trait.
                let prior_embed_names = self.current_trait_embed_names.snapshot();
                self.current_trait_embed_names
                    .set(Self::build_trait_embed_names(source, module));
                let mut embedded: HashSet<String> = HashSet::new();
                for trans in &source.transitions {
                    if trans.event != listener.event_pattern {
                        continue;
                    }
                    for effect in &trans.effects {
                        self.collect_embedded_traits_in_expr(effect, &mut embedded);
                    }
                }
                self.current_trait_embed_names.set(prior_embed_names);
                if embedded.contains(&trait_def.name) {
                    racy.entry(self.listener_bus_key(trait_def, listener))
                        .or_default()
                        .insert(trait_def.name.clone());
                }
            }
        }
        racy
    }

    /// G-ORB-055 — every `listens` edge into a trait that takes server round
    /// trips, keyed by the bus key its hook subscribes to. The client drives
    /// each hop through the listener's hook; with no hook mounted, the bridge
    /// posts the delivery to the listener's orbital route instead (the twin of
    /// the runtime client's off-page leg). Client-only listeners (LOLO §7) are
    /// left out: no host holds their state.
    pub(crate) fn compute_off_page_listens(
        &self,
        module: &OirModule,
    ) -> BTreeMap<String, Vec<crate::backend::OffPageListen>> {
        let dispatch_scope = self.dispatch_scope.snapshot();
        let mut table: BTreeMap<String, Vec<crate::backend::OffPageListen>> = BTreeMap::new();
        let residence = orbital_core::effects::Residence::of_module(module);
        for trait_def in &module.traits {
            let entity_def = trait_def.linked_entity.as_ref().and_then(|ename| {
                module.resolve_entity_ref(trait_def.linked_entity_id.as_deref(), ename)
            });
            if matches!(
                trait_def.dispatch_mode(entity_def, &residence),
                orbital_core::ir::OirDispatchMode::HybridClientOnly
            ) {
                continue;
            }
            let Some(initial) = trait_def.initial_state() else {
                continue;
            };
            let mut self_events: Vec<String> = Vec::new();
            for t in &trait_def.transitions {
                if matches!(t.event.as_str(), "INIT" | "LOAD" | "$MOUNT" | "$UNMOUNT") {
                    continue;
                }
                if !self_events.contains(&t.event) {
                    self_events.push(t.event.clone());
                }
            }
            for listener in &trait_def.listeners {
                let project = match &listener.payload_mapping {
                    Some(mapping) => {
                        let mut keys: Vec<&String> = mapping.keys().collect();
                        keys.sort();
                        let fields: Vec<String> = keys
                            .iter()
                            .map(|k| {
                                format!(
                                    "{}: {}",
                                    k,
                                    self.expr_to_ts_flavored(
                                        &mapping[*k],
                                        BindingFlavor::ListenerPayload
                                    )
                                )
                            })
                            .collect();
                        format!("({{ {} }} as EventPayload)", fields.join(", "))
                    }
                    None => "event.payload".to_string(),
                };
                let when = listener.guard.as_ref().map(|guard| {
                    let expr = self.expr_to_ts_flavored(guard, BindingFlavor::ListenerPayload);
                    if dispatch_scope {
                        format!("(event: BusEvent, fromState: string, __dispatch: DispatchScope): boolean => Boolean({})", expr)
                    } else {
                        format!("(event: BusEvent): boolean => Boolean({})", expr)
                    }
                });
                table
                    .entry(self.listener_bus_key(trait_def, listener))
                    .or_default()
                    .push(crate::backend::OffPageListen {
                        orbital: trait_def.orbital_name.clone(),
                        trait_name: trait_def.name.clone(),
                        event: listener.event_pattern.clone(),
                        triggers: listener.triggers.clone(),
                        initial: initial.name.clone(),
                        project,
                        when,
                        self_events: self_events.clone(),
                    });
            }
        }
        table
    }

    /// Whether this trait receives relayed deliveries (G-ORB-055): its hook
    /// marks itself mounted so the bridge only relays when it is not.
    pub(crate) fn trait_is_relay_target(&self, trait_def: &OirTrait) -> bool {
        self.off_page_listens
            .borrow()
            .values()
            .any(|edges| edges.iter().any(|e| e.trait_name == trait_def.name))
    }

    /// Whether any of this trait's `listens` edges is mount-racy (§60) — i.e.
    /// whether its generated hook needs `__subscribeListens` from the bridge.
    pub(crate) fn trait_has_racy_listener(&self, trait_def: &OirTrait) -> bool {
        let racy = self.racy_listens.borrow();
        if racy.is_empty() {
            return false;
        }
        trait_def.listeners.iter().any(|listener| {
            racy.get(&self.listener_bus_key(trait_def, listener))
                .is_some_and(|targets| targets.contains(&trait_def.name))
        })
    }

    /// Cross-trait `listens { Source.EVENT -> TRIGGER }` subscriptions.
    /// Source-scoped wiring: each listener subscribes to the qualified
    /// `UI:Orbital.Trait.Event` bus key the source emits (gap #13) and
    /// enqueues its `triggers` event on THIS trait's own queue. Shared by
    /// both hook shapes — a `[shared]`-entity trait cross-listening to a
    /// sibling is exactly as valid as an ordinary trait doing so, and the
    /// bus (`useEventBus`) is the same cross-component singleton either way.
    pub(crate) fn generate_cross_trait_listeners(
        &self,
        trait_def: &OirTrait,
        module: &OirModule,
    ) -> String {
        let mut code = String::new();
        if trait_def.listeners.is_empty() {
            return code;
        }
        // Per-listener unsub variable name. The event name alone isn't
        // unique because two source-scoped listens can subscribe to the
        // same event from different source traits; fold the source into
        // the identifier so TS doesn't see redeclarations. The source alone
        // still isn't unique either — a fan-out (multiple `listens` lines
        // sharing one source event but triggering different targets, e.g.
        // `SRC.EVENT -> A` and `SRC.EVENT -> B` on the same trait) collides
        // on this name too, so the target is folded in as well. A numeric
        // suffix below covers the fully-degenerate remaining case (two
        // listeners identical in source, event AND target).
        let unsub_base_name = |listener: &orbital_core::ir::OirListener| -> String {
            let event_part = to_camel_case(
                &listener
                    .event_pattern
                    .to_lowercase()
                    .replace(['-', '.', ':'], "_"),
            );
            let source_suffix = match (&listener.source_orbital, &listener.source_trait) {
                (Some(o), Some(t)) => format!(
                    "_from_{}_{}",
                    to_camel_case(&o.to_lowercase()),
                    to_camel_case(&t.to_lowercase())
                ),
                (None, Some(t)) => format!("_from_{}", to_camel_case(&t.to_lowercase())),
                _ if listener.source_any => "_any".to_string(),
                _ => String::new(),
            };
            let target_suffix = format!(
                "_to_{}",
                to_camel_case(
                    &listener
                        .triggers
                        .to_lowercase()
                        .replace(['-', '.', ':'], "_")
                )
            );
            format!("unsub_{}{}{}", event_part, source_suffix, target_suffix)
        };
        // Precomputed once, in listener order, so the subscribe loop and the
        // cleanup loop below (two separate iterations over the same list)
        // agree on the same name per listener.
        let mut seen_unsub_names: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        let unsub_names: Vec<String> = trait_def
            .listeners
            .iter()
            .map(|listener| {
                let base = unsub_base_name(listener);
                let count = seen_unsub_names.entry(base.clone()).or_insert(0);
                *count += 1;
                if *count == 1 {
                    base
                } else {
                    format!("{}_{}", base, count)
                }
            })
            .collect();
        code.push_str("  // Cross-trait event listeners (gap #13: qualified bus keys)\n");
        code.push_str("  useEffect(() => {\n");
        let relay_target = self.trait_is_relay_target(trait_def);
        if relay_target {
            code.push_str(&format!(
                "    const __unmarkMounted = __markTraitMounted('{}');\n",
                trait_def.name
            ));
        }
        for (listener_idx, listener) in trait_def.listeners.iter().enumerate() {
            let source_comment = match (&listener.source_orbital, &listener.source_trait) {
                (Some(o), Some(t)) => format!(" (from {}.{})", o, t),
                (None, Some(t)) => format!(" (from {})", t),
                _ if listener.source_any => " (from *)".to_string(),
                _ => String::new(),
            };
            code.push_str(&format!(
                "    // Listen for '{}'{} → trigger '{}'\n",
                listener.event_pattern, source_comment, listener.triggers
            ));

            let bus_key = self.listener_bus_key(trait_def, listener);

            let unsub_name = &unsub_names[listener_idx];
            // §60 — a mount-racy edge subscribes through the generated bridge
            // helper instead of the bus directly: the emit that should feed
            // this trait is the same emit that MOUNTS it, so a plain
            // `eventBus.on` in this component's effect always registers after
            // the delivery. `__subscribeListens` hands over the one held
            // delivery (if any) and then subscribes normally.
            let racy = self
                .racy_listens
                .borrow()
                .get(&bus_key)
                .is_some_and(|targets| targets.contains(&trait_def.name));
            if racy {
                code.push_str(&format!(
                    "    const {} = __subscribeListens(eventBus, '{}', '{}', (event: BusEvent) => {{\n",
                    unsub_name, bus_key, trait_def.name
                ));
            } else {
                code.push_str(&format!(
                    "    const {} = eventBus.on('{}', (event: BusEvent) => {{\n",
                    unsub_name, bus_key
                ));
            }
            // Cross-trait listeners normally react to the BRIDGE-confirmed
            // echo (`fromBridge: true`) only, because the click-time
            // qualified emit also fires and would double-trigger us
            // alongside the source trait's useUIEvents dispatch loop.
            //
            // BUT — if the source trait has no transition matching the
            // emitted event (it's a pure `external` emit, like a UI form
            // declaring `emits { CREATE_PAYMENT -> external }` with no
            // local handler), no server roundtrip happens and no echo
            // ever fires. Gating on fromBridge in that case swallows
            // every dispatch. Drop the gate when the source trait has
            // no transition for the listened event.
            let source_has_transition = match &listener.source_trait {
                Some(src_trait_name) => module
                    .resolve_trait_ref(listener.source_trait_id.as_deref(), src_trait_name)
                    .map(|t| {
                        t.transitions
                            .iter()
                            .any(|tr| tr.event == listener.event_pattern)
                    })
                    .unwrap_or(false),
                None => true,
            };
            if source_has_transition {
                code.push_str("      if (!event.source || !(event.source as { fromBridge?: boolean }).fromBridge) {\n");
                code.push_str("        return;\n");
                code.push_str("      }\n");
            }
            // Listen refinement surface: `when` gates delivery, `with{}`
            // REPLACES the payload with the projection — both payload-only,
            // matching the interpreter (`runtime/listener.rs`).
            let dispatch_scope = self.dispatch_scope.snapshot();
            let via = if dispatch_scope {
                let listen_when = listener.guard.as_ref().map_or(String::new(), |guard| {
                    format!(
                        ", listenWhen: (fromState: string, __dispatch: DispatchScope) => ({})",
                        self.expr_to_ts_flavored(guard, BindingFlavor::ListenerPayload)
                    )
                });
                format!(
                    ", {{ delivery: {{ event: '{}', ...(event.payload !== undefined ? {{ payload: event.payload }} : {{}}), source: event.source ?? {{}} }}, ctx: currentDispatch() ?? beginDispatch(){} }}",
                    listener.event_pattern, listen_when
                )
            } else {
                if let Some(guard) = &listener.guard {
                    code.push_str(&format!(
                        "      if (!({})) return;\n",
                        self.expr_to_ts_flavored(guard, BindingFlavor::ListenerPayload)
                    ));
                }
                String::new()
            };
            // One physical emit reaches this trait once per trigger, whatever
            // routes carry it (`claimDelivery`, shared with `useUIEvents`).
            code.push_str(&format!(
                "      if (!claimDelivery(event.source, '{}.{}', '{}')) return;\n",
                trait_def.orbital_name, trait_def.name, listener.triggers
            ));
            if let Some(mapping) = &listener.payload_mapping {
                // Sorted for deterministic emission from the HashMap.
                let mut keys: Vec<&String> = mapping.keys().collect();
                keys.sort();
                let fields: Vec<String> = keys
                    .iter()
                    .map(|k| {
                        format!(
                            "{}: {}",
                            k,
                            self.expr_to_ts_flavored(&mapping[*k], BindingFlavor::ListenerPayload)
                        )
                    })
                    .collect();
                code.push_str(&format!(
                    "      enqueueEvent('{}', {{ {} }} as EventPayload{});\n",
                    listener.triggers,
                    fields.join(", "),
                    via
                ));
            } else {
                code.push_str(&format!(
                    "      enqueueEvent('{}', event.payload{});\n",
                    listener.triggers, via
                ));
            }
            code.push_str("    });\n");
        }
        code.push_str("    return () => {\n");
        if relay_target {
            code.push_str("      __unmarkMounted();\n");
        }
        for unsub_name in &unsub_names {
            code.push_str(&format!(
                "      if (typeof {} === 'function') {}();\n",
                unsub_name, unsub_name
            ));
        }
        code.push_str("    };\n");
        code.push_str("  // eslint-disable-next-line react-hooks/exhaustive-deps\n");
        code.push_str("  }, [eventBus, dispatch]);\n\n");
        code
    }
}

#[cfg(test)]
mod string_coerce_client_tests {
    use super::string_coerce_client;

    // C1-E3 item (3): std-builder's `navigator.clipboard.writeText(text)`
    // TS2345 — a dynamic payload/entity read compiles to the wide
    // `EventPayloadValue | undefined` union, not `string`. Pin the SAME
    // coercion Navigate's path/crumb already used (now the one shared
    // owner for clipboard write too).
    #[test]
    fn wraps_a_dynamic_read_but_passes_a_literal_through() {
        assert_eq!(
            string_coerce_client("payload?.data?.title"),
            "String(payload?.data?.title ?? '')"
        );
        assert_eq!(string_coerce_client("\"static text\""), "\"static text\"");
        assert_eq!(string_coerce_client("'static text'"), "'static text'");
        assert_eq!(string_coerce_client("`templated ${x}`"), "`templated ${x}`");
    }
}

#[cfg(test)]
mod resolve_new_state_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{
        OirBinding, OirEffect, OirExpr, OirModule, OirState, OirTrait, OirTransition,
    };

    fn ordinary_trait_with_one_client_effect() -> OirTrait {
        let transition =
            OirTransition::new("idle", "done", "GO").with_effects(vec![OirExpr::effect(
                OirEffect::set(
                    OirBinding::parse("@entity.status").unwrap(),
                    OirExpr::string("done"),
                ),
            )]);
        let mut tr = OirTrait::new("Ordinary");
        tr.linked_entity = Some("Thing".to_string());
        tr.states.push(OirState::initial("idle"));
        tr.states.push(OirState::new("done"));
        tr.transitions.push(transition);
        tr
    }

    /// `resolve_new_state=false, emit_fanout=false` (the persisted-entity
    /// server-backed call site) must never emit `_newState` tracking —
    /// additive-only guarantee for Phase B of C-SHARED-TRAIT-NO-EVENT-DISPATCH.
    /// Persisted-entity traits still let the server alone resolve `newState`
    /// (T9 gates optimistic local resolution to `[runtime]`-linked traits);
    /// threading a client-side resolution in here too would be dead code, not
    /// a bug, but its ABSENCE is exactly what proves the persisted path's
    /// output is unchanged by these features.
    #[test]
    fn ordinary_call_site_emits_no_new_state_tracking() {
        let backend = TypeScriptBackend::new();
        let tr = ordinary_trait_with_one_client_effect();
        let module = OirModule::new("TestApp", "0.1.0");
        let ts = backend.generate_transpiled_effect_handler_impl(&tr, &module, false, false);

        assert!(
            !ts.contains("_newState"),
            "ordinary path must stay newState-free:\n{ts}"
        );
        assert!(
            ts.contains("): Record<string, EventPayloadValue | undefined> => {"),
            "ordinary path's return type must stay the bare Record, unchanged:\n{ts}"
        );
        assert!(
            ts.contains("return _fields;"),
            "ordinary path must still return the bare accumulator:\n{ts}"
        );
    }

    /// `resolve_new_state=true` (the `[shared]`-entity dispatch path) must
    /// consider a transition even when it has zero transpilable client
    /// effects — there is no server to resolve `newState` for that case, so
    /// a bare `A -> B on EVENT` with no `set`/`emit` still needs a branch.
    #[test]
    fn resolve_new_state_covers_effect_less_transitions_too() {
        let mut tr = OirTrait::new("BareTransition");
        tr.linked_entity = Some("Thing".to_string());
        tr.states.push(OirState::initial("idle"));
        tr.states.push(OirState::new("done"));
        tr.transitions
            .push(OirTransition::new("idle", "done", "GO"));

        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let ts = backend.generate_transpiled_effect_handler_impl(&tr, &module, true, true);

        assert!(
            ts.contains("_newState = 'done';"),
            "an effect-less transition must still stamp _newState in resolve_new_state mode:\n{ts}"
        );
        assert!(
            ts.contains("return { fields: _fields, newState: _newState, emits: _emits, arm: _arm };"),
            "resolve_new_state mode's return shape must carry newState:\n{ts}"
        );
    }

    /// The `fields` staging variable must declare the wide
    /// `FIELDS_STAGING_TS_TYPE` up front, and every `set` merge-cast must
    /// name that same type directly — never `as typeof fields`. A `set`
    /// whose value's OIR type lowers to a readonly array (`array/map`,
    /// `array/sort`, …) fails an `as typeof fields` cast when `fields` was
    /// seeded from an `EntityRow` (TS2352: `FieldValue`'s own array member
    /// is mutable, so a readonly array never "sufficiently overlaps" with
    /// it) — see `codegen/effect/client.rs` module docs for
    /// `FIELDS_STAGING_TS_TYPE`. Regression test for that defect.
    #[test]
    fn fields_staging_variable_and_set_cast_use_the_wide_named_type_not_typeof_fields() {
        let backend = TypeScriptBackend::new();
        let tr = ordinary_trait_with_one_client_effect();
        let module = OirModule::new("TestApp", "0.1.0");

        for (resolve_new_state, emit_fanout) in [(false, false), (true, true)] {
            let ts = backend.generate_transpiled_effect_handler_impl(
                &tr,
                &module,
                resolve_new_state,
                emit_fanout,
            );
            assert!(
                ts.contains("let fields: Record<string, EventPayloadValue | undefined>"),
                "fields must declare the wide staging type explicitly \
                 (resolve_new_state={resolve_new_state}):\n{ts}"
            );
            assert!(
                ts.contains("} as Record<string, EventPayloadValue | undefined>;"),
                "the set merge-cast must name the wide type directly \
                 (resolve_new_state={resolve_new_state}):\n{ts}"
            );
            assert!(
                !ts.contains("as typeof fields"),
                "no cast may depend on `typeof fields` resolving correctly \
                 (resolve_new_state={resolve_new_state}):\n{ts}"
            );
        }
    }
}

// ------------------------------------------------------------------
// Wave C1: the resolver lowers a 3-arg `(if c a b)` to `OirExpr::Conditional`
// while `when`/2-arg `if` stay `Call` — a resolved conditional in effect
// position must never be silently dropped, and any node this walker truly
// cannot lower must diagnose loudly instead.
// ------------------------------------------------------------------
#[cfg(test)]
mod conditional_effect_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{
        OirBinding, OirEffect, OirExpr, OirModule, OirState, OirTrait, OirTransition,
    };

    fn bind(s: &str) -> OirExpr {
        OirExpr::binding(OirBinding::parse(s).expect("binding"))
    }

    #[test]
    fn resolved_conditional_renders_if_else_with_let_and_multiple_effects() {
        let then_branch = OirExpr::call(
            "let",
            vec![
                OirExpr::array(vec![OirExpr::array(vec![
                    OirExpr::string("x"),
                    OirExpr::number(1.0),
                ])]),
                OirExpr::call(
                    "do",
                    vec![
                        OirExpr::effect(OirEffect::set(
                            OirBinding::parse("@entity.a").unwrap(),
                            OirExpr::string("A"),
                        )),
                        OirExpr::effect(OirEffect::emit("PING")),
                    ],
                ),
            ],
        );
        let else_branch = OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.a").unwrap(),
            OirExpr::string("B"),
        ));
        let conditional = OirExpr::if_then_else(bind("@entity.flag"), then_branch, else_branch);

        let transition = OirTransition::new("idle", "idle", "GO").with_effects(vec![conditional]);
        let mut tr = OirTrait::new("Cond");
        tr.linked_entity = Some("Thing".to_string());
        tr.states.push(OirState::initial("idle"));
        tr.transitions.push(transition);

        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let ts = backend.generate_transpiled_effect_handler_impl(&tr, &module, false, false);

        assert!(
            ts.contains("if ("),
            "resolved Conditional must emit an if:\n{ts}"
        );
        assert!(
            ts.contains("const let__x = 1;"),
            "let-binding inside the then-branch must be emitted:\n{ts}"
        );
        assert!(
            ts.contains("_fields['a'] = \"A\";"),
            "then-branch set must be emitted:\n{ts}"
        );
        assert!(
            ts.contains("_fields['a'] = \"B\";"),
            "else-branch set must be emitted:\n{ts}"
        );
        assert!(ts.contains("'PING'"), "nested emit must be emitted:\n{ts}");
        assert!(
            ts.contains("} else {"),
            "else branch must be emitted:\n{ts}"
        );
    }

    #[test]
    fn when_call_form_emits_if_with_no_else() {
        let when_expr = OirExpr::call(
            "when",
            vec![
                bind("@entity.flag"),
                OirExpr::effect(OirEffect::set(
                    OirBinding::parse("@entity.a").unwrap(),
                    OirExpr::string("A"),
                )),
            ],
        );
        let transition = OirTransition::new("idle", "idle", "GO").with_effects(vec![when_expr]);
        let mut tr = OirTrait::new("When");
        tr.linked_entity = Some("Thing".to_string());
        tr.states.push(OirState::initial("idle"));
        tr.transitions.push(transition);

        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let ts = backend.generate_transpiled_effect_handler_impl(&tr, &module, false, false);

        assert!(ts.contains("if ("), "when must emit an if:\n{ts}");
        assert!(
            !ts.contains("} else {"),
            "a 2-arg when must never emit an else:\n{ts}"
        );
    }

    /// A transition whose ONLY client effect sits inside a `Conditional`
    /// must still classify as client-effect-bearing — otherwise the whole
    /// handler branch for it is skipped and the conditional never reaches
    /// codegen at all.
    #[test]
    fn transition_has_client_effects_true_for_effect_inside_conditional() {
        let conditional = OirExpr::if_then_else(
            bind("@entity.flag"),
            OirExpr::effect(OirEffect::set(
                OirBinding::parse("@entity.a").unwrap(),
                OirExpr::string("A"),
            )),
            OirExpr::null(),
        );

        let backend = TypeScriptBackend::new();
        assert!(backend.transition_has_client_effects(&[conditional]));
    }

    /// A literal in effect position is "no effect" (`(if c (emit X) null)`, std-frogger's
    /// `(if c (emit MOVE …) true)`) — the kernel runs nothing for it, so the compiled
    /// handler must not throw on it either.
    #[test]
    fn literal_branch_in_effect_position_is_a_no_op_not_a_throw() {
        for literal in [
            OirExpr::null(),
            OirExpr::bool(true),
            OirExpr::bool(false),
            OirExpr::number(0.0),
            OirExpr::string(""),
        ] {
            let conditional = OirExpr::if_then_else(
                bind("@entity.flag"),
                OirExpr::effect(OirEffect::set(
                    OirBinding::parse("@entity.a").unwrap(),
                    OirExpr::string("A"),
                )),
                literal.clone(),
            );
            let transition =
                OirTransition::new("idle", "idle", "GO").with_effects(vec![conditional]);
            let mut tr = OirTrait::new("LiteralBranch");
            tr.linked_entity = Some("Thing".to_string());
            tr.states.push(OirState::initial("idle"));
            tr.transitions.push(transition);

            let ts = TypeScriptBackend::new().generate_transpiled_effect_handler_impl(
                &tr,
                &OirModule::new("TestApp", "0.1.0"),
                true,
                false,
            );

            assert!(
                !ts.contains("unlowered effect expression"),
                "{literal:?} branch must not throw:\n{ts}"
            );
            assert!(
                ts.contains("'A'") || ts.contains("\"A\""),
                "the then-branch set must still be emitted:\n{ts}"
            );
        }
    }

    /// A control form this walker cannot lower must diagnose loudly — never
    /// silently drop the effect.
    #[test]
    fn unlowerable_effect_expression_emits_a_throw_not_a_silent_drop() {
        let unlowerable = OirExpr::call(
            "array/map",
            vec![bind("@entity.items"), OirExpr::string("noop")],
        );
        let transition = OirTransition::new("idle", "idle", "GO").with_effects(vec![unlowerable]);
        let mut tr = OirTrait::new("Unlowerable");
        tr.linked_entity = Some("Thing".to_string());
        tr.states.push(OirState::initial("idle"));
        tr.transitions.push(transition);

        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        // resolve_new_state=true forces a branch even though
        // transition_has_client_effects can't classify a bare `array/map`
        // Call as a client effect (no Effect leaf under it) — this is the
        // easiest way to force `collect_client_effect_statements` to walk
        // the unlowerable node in this handler shape.
        let ts = backend.generate_transpiled_effect_handler_impl(&tr, &module, true, false);

        assert!(
            ts.contains("throw new Error('orb: unlowered effect expression array/map');"),
            "an unlowerable node must diagnose, not vanish:\n{ts}"
        );
    }
}

#[cfg(test)]
mod implicit_emit_fanout_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{OirEffect, OirExpr, OirModule, OirState, OirTrait, OirTransition};

    /// `(emit SAVE { content: @entity.draft }) (set @entity.draft "")` —
    /// the emit's payload must be evaluated at the emit's own position in
    /// the effect sequence, not inside the deferred dispatch closure, since
    /// the later `set` rebinds `fields` before that closure runs (the
    /// compiled chat composer persisted every message with `content: ""`).
    #[test]
    fn deferred_emit_binds_payload_before_a_later_set_rebinds_fields() {
        use orbital_core::ir::OirBinding;

        let mut module = OirModule::new("Chat", "0.1.0");
        let mut persistor = OirTrait::new("Persistor");
        persistor.orbital_name = "Chat".to_string();
        persistor.linked_entity = Some("Message".to_string());
        persistor.states.push(OirState::initial("idle"));
        persistor
            .transitions
            .push(OirTransition::new("idle", "idle", "SAVE"));
        module.traits.push(persistor);

        let mut composer = OirTrait::new("Composer");
        composer.orbital_name = "Chat".to_string();
        composer.linked_entity = Some("Message".to_string());
        composer.states.push(OirState::initial("ready"));
        let mut payload = orbital_core::ir::OirFields::new();
        payload.insert(
            "content".to_string(),
            OirExpr::binding(OirBinding::parse("@entity.draft").unwrap()),
        );
        composer.transitions.push(
            OirTransition::new("ready", "ready", "SEND").with_effects(vec![
                OirExpr::effect(OirEffect::emit_with_payload(
                    "SAVE",
                    OirExpr::object(payload),
                )),
                OirExpr::effect(OirEffect::set(
                    OirBinding::parse("@entity.draft").unwrap(),
                    OirExpr::string(""),
                )),
            ]),
        );
        module.traits.push(composer.clone());

        let backend = TypeScriptBackend::new();
        let ts = backend.generate_transpiled_effect_handler_impl(&composer, &module, true, true);

        let emit_at = ts.find("_emits.push(").expect("deferred emit present");
        let set_at = ts
            .find("_fields['draft'] = \"\";")
            .expect("later set present");
        assert!(emit_at < set_at, "source order must be preserved:\n{ts}");
        assert!(
            ts.contains(
                "_emits.push(((_p) => () => { eventBus.emit('SAVE', _p, { trait: 'Composer' });"
            ),
            "the payload must be bound eagerly and the closure must read the bound value:\n{ts}"
        );
        assert!(
            ts.contains("payload: _p, source: { orbital: 'Chat', trait: 'Composer' } });"),
            "the cascade envelope must carry the same bound payload:\n{ts}"
        );
        assert!(
            ts.contains("eventBus.emit('UI:Chat.Persistor.SAVE', _p, { trait: 'Composer' });"),
            "the sibling fan-out must carry the same bound payload:\n{ts}"
        );
        assert!(
            ts.contains("})({ content: fields?.draft }));"),
            "the payload expression is evaluated once, at the emit's position:\n{ts}"
        );
    }

    /// Two shared-entity siblings in one orbital: `PongPlay` bare-emits
    /// `PADDLE_MOVE` (no local transition for it — `PADDLE_MOVE -> external`),
    /// `PongMechanic` declares Shape-B `listens { PADDLE_MOVE {...} }`, which
    /// surfaces in the OIR as a regular `PADDLE_MOVE`-triggered transition on
    /// `PongMechanic` (Shape-B never populates `OirTrait.listeners`).
    fn play_and_mechanic_module() -> (OirModule, OirTrait) {
        let mut module = OirModule::new("Pong", "0.1.0");

        let mut mechanic = OirTrait::new("PongMechanic");
        mechanic.orbital_name = "Pong".to_string();
        mechanic.linked_entity = Some("PongGame".to_string());
        mechanic.states.push(OirState::initial("playing"));
        mechanic
            .transitions
            .push(OirTransition::new("playing", "playing", "PADDLE_MOVE"));
        module.traits.push(mechanic);

        let mut play = OirTrait::new("PongPlay");
        play.orbital_name = "Pong".to_string();
        play.linked_entity = Some("PongGame".to_string());
        play.states.push(OirState::initial("idle"));
        let emit_transition =
            OirTransition::new("idle", "idle", "LEFT_DOWN").with_effects(vec![OirExpr::effect(
                OirEffect::emit_with_payload("PADDLE_MOVE", OirExpr::string("down")),
            )]);
        play.transitions.push(emit_transition);
        module.traits.push(play.clone());

        (module, play)
    }

    /// A bare `(emit PADDLE_MOVE ...)` on `PongPlay`, in the client-only
    /// dispatch path (`resolve_new_state=true`), must ALSO emit a
    /// destination-qualified line targeting `PongMechanic`'s existing
    /// `useUIEvents` subscription key — otherwise the event is dropped on
    /// the floor with zero listeners (the bug this fix closes).
    #[test]
    fn sibling_transition_trigger_gets_qualified_fanout() {
        let (module, play) = play_and_mechanic_module();
        let backend = TypeScriptBackend::new();
        let ts = backend.generate_transpiled_effect_handler_impl(&play, &module, true, true);

        assert!(
            ts.contains("eventBus.emit('PADDLE_MOVE'"),
            "the original bare emit must stay unchanged:\n{ts}"
        );
        assert!(
            ts.contains("eventBus.emit('UI:Pong.PongMechanic.PADDLE_MOVE'"),
            "must additionally emit a destination-qualified line for the sibling whose \
             transition table is triggered by PADDLE_MOVE:\n{ts}"
        );
    }

    /// The far more common `listens { Source.EVENT -> LocalTrigger }` remap
    /// shape (§84, `Almadar_Compiler_Gaps.md`): the sibling's own transition
    /// table has NO entry named `event` — only `OirTrait.listeners` records
    /// the cross-trait wire, under a DIFFERENT local trigger name. Before
    /// the §84 fix, `implicit_emit_targets` only checked `transitions`, so
    /// this sibling was invisible and the bare emit was permanently
    /// stranded (the exact shape that dropped `ChatComposer.CHANNEL_SELECTED
    /// -> INIT` on the compiled path).
    #[test]
    fn sibling_listens_remap_gets_qualified_fanout() {
        use orbital_core::ir::OirListener;

        let mut module = OirModule::new("Pong", "0.1.0");

        let mut mechanic = OirTrait::new("PongMechanic");
        mechanic.orbital_name = "Pong".to_string();
        mechanic.linked_entity = Some("PongGame".to_string());
        mechanic.states.push(OirState::initial("idle"));
        mechanic
            .transitions
            .push(OirTransition::new("idle", "idle", "RESYNC"));
        let mut listener = OirListener::new("PADDLE_MOVE", "RESYNC");
        listener.source_trait = Some("PongPlay".to_string());
        mechanic.listeners.push(listener);
        module.traits.push(mechanic);

        let mut play = OirTrait::new("PongPlay");
        play.orbital_name = "Pong".to_string();
        play.linked_entity = Some("PongGame".to_string());
        play.states.push(OirState::initial("idle"));
        let emit_transition =
            OirTransition::new("idle", "idle", "LEFT_DOWN").with_effects(vec![OirExpr::effect(
                OirEffect::emit_with_payload("PADDLE_MOVE", OirExpr::string("down")),
            )]);
        play.transitions.push(emit_transition);
        module.traits.push(play.clone());

        let backend = TypeScriptBackend::new();
        let ts = backend.generate_transpiled_effect_handler_impl(&play, &module, true, true);

        assert!(
            ts.contains("eventBus.emit('PADDLE_MOVE'"),
            "the original bare emit must stay unchanged:\n{ts}"
        );
        assert!(
            ts.contains("emitCascadeEvent(eventBus, 'Pong', 'PongPlay', { event: 'PADDLE_MOVE', payload: "),
            "must publish the source-qualified key the sibling's listens {{ PongPlay.PADDLE_MOVE -> RESYNC }} subscribes to:\n{ts}"
        );
        assert!(
            !ts.contains("eventBus.emit('UI:Pong.PongMechanic.PADDLE_MOVE'"),
            "a listens edge is source-keyed; no destination-scoped relay line for it:\n{ts}"
        );
    }

    /// Two tours composing one atom, each wired to its OWN transport by a
    /// sourced listen (`OwnTransport.LEARN_STEP -> LEARN_STEP`). Transport A's
    /// emit must reach only its listener: tour B's `LEARN_STEP` trigger is
    /// owned by its listen from transport B, so no direct line targets it.
    #[test]
    fn sibling_whose_trigger_is_owned_by_another_sources_listen_gets_no_fanout() {
        use orbital_core::ir::OirListener;

        let mut module = OirModule::new("Home", "0.1.0");
        let tour = |name: &str, transport: &str| {
            let mut t = OirTrait::new(name);
            t.orbital_name = "Home".to_string();
            t.states.push(OirState::initial("idle"));
            t.transitions
                .push(OirTransition::new("idle", "idle", "LEARN_STEP"));
            let mut l = OirListener::new("LEARN_STEP", "LEARN_STEP");
            l.source_trait = Some(transport.to_string());
            t.listeners.push(l);
            t
        };
        module.traits.push(tour("TourA", "TransportA"));
        module.traits.push(tour("TourB", "TransportB"));

        let mut transport_a = OirTrait::new("TransportA");
        transport_a.orbital_name = "Home".to_string();
        transport_a.states.push(OirState::initial("idle"));
        transport_a.transitions.push(
            OirTransition::new("idle", "idle", "STEP")
                .with_effects(vec![OirExpr::effect(OirEffect::emit("LEARN_STEP"))]),
        );
        module.traits.push(transport_a.clone());

        let backend = TypeScriptBackend::new();
        let ts = backend.generate_transpiled_effect_handler_impl(&transport_a, &module, true, true);

        assert!(
            ts.contains("emitCascadeEvent(eventBus, 'Home', 'TransportA', { event: 'LEARN_STEP'"),
            "the listen edge is served by the source-qualified cascade key:\n{ts}"
        );
        assert!(
            !ts.contains("UI:Home.TourB.LEARN_STEP"),
            "TourB hears LEARN_STEP only from TransportB:\n{ts}"
        );
        assert!(
            !ts.contains("UI:Home.TourA.LEARN_STEP"),
            "TourA is reached by its listen, not a destination line:\n{ts}"
        );
    }

    /// An emit whose event no sibling trait declares a transition for must
    /// NOT grow a fan-out line — only the original bare emit.
    #[test]
    fn emit_with_no_sibling_listener_stays_bare() {
        let mut module = OirModule::new("Pong", "0.1.0");
        let mut play = OirTrait::new("PongPlay");
        play.orbital_name = "Pong".to_string();
        play.linked_entity = Some("PongGame".to_string());
        play.states.push(OirState::initial("idle"));
        let emit_transition = OirTransition::new("idle", "idle", "SCORE_FX")
            .with_effects(vec![OirExpr::effect(OirEffect::emit("SCORE_FX"))]);
        play.transitions.push(emit_transition);
        module.traits.push(play.clone());

        let backend = TypeScriptBackend::new();
        let ts = backend.generate_transpiled_effect_handler_impl(&play, &module, true, true);

        assert!(
            ts.contains("eventBus.emit('SCORE_FX'"),
            "the bare emit must still be present:\n{ts}"
        );
        assert!(
            !ts.contains("UI:Pong.PongPlay.SCORE_FX") && !ts.contains("UI:Pong."),
            "no sibling declares a SCORE_FX-triggered transition — no qualified fan-out line \
             should be emitted:\n{ts}"
        );
    }

    /// `resolve_new_state=false` (the ordinary, server-backed hook's call
    /// site — `emit_fanout` stays `None` there) must produce byte-identical
    /// `eventBus.emit(...)` output to before this change: exactly one line,
    /// never a qualified fan-out line, even when a sibling trait in the same
    /// module happens to declare a matching transition.
    #[test]
    fn ordinary_call_site_never_fans_out() {
        let (module, play) = play_and_mechanic_module();
        let backend = TypeScriptBackend::new();
        let ts = backend.generate_transpiled_effect_handler_impl(&play, &module, false, false);

        let emit_count = ts.matches("eventBus.emit(").count();
        assert_eq!(
            emit_count, 1,
            "resolve_new_state=false must emit exactly the one bare line, no fan-out:\n{ts}"
        );
        assert!(
            !ts.contains("UI:Pong.PongMechanic.PADDLE_MOVE"),
            "ordinary path must never qualify-fan-out even when a sibling transition exists:\n{ts}"
        );
    }
}

/// §60 — mount-racy `listens` edges (C-EMBEDDED-LISTENER-MOUNTS-AFTER-ITS-TRIGGER).
///
/// These build a POPULATED `OirModule`, unlike `listener_refinement_tests`
/// below, which passes an empty one — so they also give the `fromBridge` gate
/// (`source_has_transition`) its first coverage.
#[cfg(test)]
mod racy_listens_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{
        OirEffect, OirExpr, OirListener, OirModule, OirPattern, OirState, OirTrait, OirTransition,
        OirValue,
    };

    /// `render-ui main { children: [@trait.<embedded>] }`.
    fn render_embedding(embedded: &str) -> OirExpr {
        let mut pattern = OirPattern::new("stack");
        pattern.config.insert(
            "children".to_string(),
            OirValue::Array(vec![OirValue::String(format!("@trait.{}", embedded))]),
        );
        OirExpr::Effect {
            effect: Box::new(OirEffect::RenderUi {
                slot: "main".to_string(),
                pattern,
            }),
        }
    }

    /// Source trait: `loading --EVENT--> browsing` whose render embeds `embedded`
    /// (when `embed_on_trigger`), plus a second `OTHER` transition that never does.
    fn source_trait(event: &str, embedded: &str, embed_on_trigger: bool) -> OirTrait {
        let mut tr = OirTrait::new("BrowseSource");
        tr.orbital_name = "ShelfOrbital".to_string();
        tr.states.push(OirState::initial("loading"));
        tr.states.push(OirState::new("browsing"));

        let mut on_trigger = OirTransition::new("loading", "browsing", event);
        if embed_on_trigger {
            on_trigger.effects.push(render_embedding(embedded));
        }
        tr.transitions.push(on_trigger);

        let mut other = OirTransition::new("browsing", "browsing", "OTHER");
        if !embed_on_trigger {
            other.effects.push(render_embedding(embedded));
        }
        tr.transitions.push(other);
        tr
    }

    /// Target trait listening for the source's event.
    fn target_trait(event: &str) -> OirTrait {
        let mut tr = OirTrait::new("ShelfListView");
        tr.orbital_name = "ShelfOrbital".to_string();
        tr.states.push(OirState::initial("idle"));
        let mut li = OirListener::new(event, "ListLoaded");
        li.source_trait = Some("BrowseSource".to_string());
        tr.listeners.push(li);
        tr
    }

    fn module_with(embed_on_trigger: bool) -> (OirModule, OirTrait) {
        let event = "ItemsLoaded";
        let target = target_trait(event);
        let mut module = OirModule::new("Shelf", "0.1");
        module
            .traits
            .push(source_trait(event, &target.name, embed_on_trigger));
        module.traits.push(target.clone());
        (module, target)
    }

    fn backend_for(module: &OirModule) -> TypeScriptBackend {
        let backend = TypeScriptBackend::new();
        backend
            .racy_listens
            .set(backend.compute_racy_listens(module));
        backend
    }

    fn backend_with_relays(module: &OirModule) -> TypeScriptBackend {
        let backend = backend_for(module);
        backend
            .off_page_listens
            .set(backend.compute_off_page_listens(module));
        backend
    }

    /// G-ORB-055: the client drives every `listens` hop, so an edge into a
    /// trait that takes server round trips is relayable when its hook is not
    /// mounted — keyed on the same bus key the hook subscribes to.
    #[test]
    fn off_page_table_carries_server_listener_edges() {
        let (module, _) = module_with(false);
        let table = backend_with_relays(&module).off_page_listens.snapshot();
        let edges = table
            .get("UI:ShelfOrbital.BrowseSource.ItemsLoaded")
            .expect("edge keyed on the subscribed bus key");
        assert_eq!(
            edges
                .iter()
                .map(|e| (
                    e.orbital.as_str(),
                    e.trait_name.as_str(),
                    e.triggers.as_str(),
                    e.initial.as_str()
                ))
                .collect::<Vec<_>>(),
            vec![("ShelfOrbital", "ShelfListView", "ListLoaded", "idle")]
        );
    }

    /// Control: a client-only listener (LOLO §7) is never relayed — no host
    /// holds its state, so a post would run it nowhere it is seen.
    #[test]
    fn client_only_listener_is_not_relayed() {
        let (mut module, _) = module_with(false);
        for t in &mut module.traits {
            if t.name == "ShelfListView" {
                t.local = true;
            }
        }
        assert!(backend_with_relays(&module)
            .off_page_listens
            .snapshot()
            .is_empty());
    }

    /// Both fromBridge emit sites relay, and the post addresses the listener.
    #[test]
    fn bridge_relays_off_page_emits_at_both_confirmed_sites() {
        let (module, _) = module_with(false);
        let bridge = backend_with_relays(&module)
            .generate_orbital_bridge_hook()
            .content;
        assert!(bridge.contains("const __OFF_PAGE_LISTENS"), "{bridge}");
        assert!(
            bridge.contains("export function __markTraitMounted("),
            "{bridge}"
        );
        assert!(
            bridge.contains("__relayOffPage(eventBus, key, ev.payload, source);")
                && bridge.contains("__relayOffPage(eventBus, echoKey, payload, echoSource);"),
            "both fromBridge emit sites must relay:\n{bridge}"
        );
        assert!(bridge.contains("targetTrait: edge.trait"), "{bridge}");
    }

    /// An unmounted listener's own continuations (a persist success it
    /// transitions on) have no hook to drive them either: the relay carries
    /// the events the target trait handles, and re-posts those it emits.
    #[test]
    fn relay_carries_the_targets_own_continuations() {
        let (mut module, _) = module_with(false);
        for t in &mut module.traits {
            if t.name == "ShelfListView" {
                t.transitions
                    .push(OirTransition::new("idle", "idle", "ListLoaded"));
                t.transitions
                    .push(OirTransition::new("idle", "idle", "Saved"));
            }
        }
        let backend = backend_with_relays(&module);
        let table = backend.off_page_listens.snapshot();
        let edge = &table["UI:ShelfOrbital.BrowseSource.ItemsLoaded"][0];
        assert_eq!(
            edge.self_events,
            vec!["ListLoaded".to_string(), "Saved".to_string()]
        );
        let bridge = backend.generate_orbital_bridge_hook().content;
        assert!(
            bridge.contains("selfEvents: ['ListLoaded', 'Saved']"),
            "{bridge}"
        );
        assert!(
            bridge.contains("edge.selfEvents.includes(ev.event)"),
            "{bridge}"
        );
        // The stateless host needs the listener's state and row, as a hook sends them.
        assert!(
            bridge.contains(
                "traits: [{ trait: edge.trait, from: __offPageStates.get(edge.trait) ?? edge.initial }]"
            ),
            "{bridge}"
        );
        assert!(
            bridge.contains("__offPageStates.set(edge.trait, next)"),
            "{bridge}"
        );
    }

    /// Control: no relayable edge leaves the bridge byte-identical.
    #[test]
    fn no_relayable_edge_leaves_the_bridge_unchanged() {
        let module = OirModule::new("Shelf", "0.1");
        let bridge = backend_with_relays(&module)
            .generate_orbital_bridge_hook()
            .content;
        assert!(
            !bridge.contains("__OFF_PAGE_LISTENS") && !bridge.contains("__relayOffPage"),
            "{bridge}"
        );
    }

    /// A relay target's hook marks itself mounted, so the bridge only posts
    /// for listeners with no hook on the page.
    #[test]
    fn a_relay_target_marks_itself_mounted() {
        let (module, target) = module_with(false);
        let ts = backend_with_relays(&module).generate_cross_trait_listeners(&target, &module);
        assert!(ts.contains("__markTraitMounted('ShelfListView')"), "{ts}");
    }

    /// The defining case: the emit that should FEED the target is the same emit
    /// that MOUNTS it, so it must subscribe through the bridge's hold.
    #[test]
    fn target_embedded_in_its_own_triggers_render_is_racy() {
        let (module, target) = module_with(true);
        let backend = backend_for(&module);

        let racy = backend.racy_listens.snapshot();
        assert_eq!(
            racy.get("UI:ShelfOrbital.BrowseSource.ItemsLoaded")
                .map(|t| t.iter().cloned().collect::<Vec<_>>()),
            Some(vec!["ShelfListView".to_string()]),
            "racy table must key on the SUBSCRIBED bus key:\n{racy:?}"
        );

        let ts = backend.generate_cross_trait_listeners(&target, &module);
        assert!(
            ts.contains(
                "__subscribeListens(eventBus, 'UI:ShelfOrbital.BrowseSource.ItemsLoaded', 'ShelfListView'"
            ),
            "a racy edge must subscribe through the bridge hold:\n{ts}"
        );
        assert!(
            !ts.contains("eventBus.on('UI:ShelfOrbital.BrowseSource.ItemsLoaded'"),
            "a racy edge must not ALSO subscribe raw:\n{ts}"
        );
        assert!(
            backend.trait_has_racy_listener(&target),
            "the hook must import __subscribeListens for this trait"
        );
    }

    /// Embedded in a DIFFERENT transition's render — the target is already
    /// mounted when the trigger fires, so today's raw subscribe is correct and
    /// its output must not move.
    #[test]
    fn target_embedded_in_another_transitions_render_is_not_racy() {
        let (module, target) = module_with(false);
        let backend = backend_for(&module);

        assert!(
            backend.racy_listens.snapshot().is_empty(),
            "only the trigger's OWN render tree makes an edge racy"
        );

        let ts = backend.generate_cross_trait_listeners(&target, &module);
        assert!(
            ts.contains("eventBus.on('UI:ShelfOrbital.BrowseSource.ItemsLoaded'"),
            "a non-racy edge keeps the direct bus subscribe:\n{ts}"
        );
        assert!(
            !ts.contains("__subscribeListens"),
            "a non-racy edge must be byte-identical to today:\n{ts}"
        );
        assert!(!backend.trait_has_racy_listener(&target));
    }

    /// First coverage of the `fromBridge` gate: it is emitted when the source
    /// HAS a transition for the event (a server round-trip echoes it), and
    /// dropped when it does not (a pure `external` emit never echoes).
    #[test]
    fn frombridge_gate_follows_the_sources_transition() {
        let (module, target) = module_with(true);
        let backend = backend_for(&module);
        let ts = backend.generate_cross_trait_listeners(&target, &module);
        assert!(
            ts.contains("fromBridge"),
            "source has a transition for the event → gate must be emitted:\n{ts}"
        );

        // Same edge, but the source declares no transition for it.
        let mut sourceless = OirModule::new("Shelf", "0.1");
        let mut src = OirTrait::new("BrowseSource");
        src.orbital_name = "ShelfOrbital".to_string();
        src.states.push(OirState::initial("loading"));
        sourceless.traits.push(src);
        sourceless.traits.push(target.clone());
        let backend = backend_for(&sourceless);
        let ts = backend.generate_cross_trait_listeners(&target, &sourceless);
        assert!(
            !ts.contains("fromBridge"),
            "no source transition → no echo → the gate would swallow every dispatch:\n{ts}"
        );
    }

    /// The bridge emits the hold store only when the module actually has a
    /// racy edge; otherwise its output is exactly today's.
    #[test]
    fn bridge_emits_the_hold_store_only_when_needed() {
        let (module, _) = module_with(true);
        let bridge = backend_for(&module).generate_orbital_bridge_hook().content;
        assert!(bridge.contains("const __RACY_LISTENS"), "{bridge}");
        assert!(
            bridge.contains("'UI:ShelfOrbital.BrowseSource.ItemsLoaded': ['ShelfListView'],"),
            "table must carry the racy edge:\n{bridge}"
        );
        assert!(
            bridge.contains("export function __subscribeListens("),
            "{bridge}"
        );
        assert!(
            bridge.contains("__holdForUnmountedListeners(key, ev.payload, source);")
                && bridge.contains("__holdForUnmountedListeners(echoKey, payload, echoSource);"),
            "both fromBridge emit sites must record:\n{bridge}"
        );

        let (module, _) = module_with(false);
        let bridge = backend_for(&module).generate_orbital_bridge_hook().content;
        assert!(
            !bridge.contains("__RACY_LISTENS") && !bridge.contains("__subscribeListens"),
            "no racy edge → the bridge must be unchanged:\n{bridge}"
        );
        assert!(
            bridge.contains("eventBus.emit(`UI:${evOrbital}.${evTrait}.${ev.event}`, ev.payload,"),
            "the untouched bridge keeps its inline emit:\n{bridge}"
        );
    }

    /// A transition's render is often a CONDITIONAL, not a bare effect —
    /// `std-browse`'s `BrowseItemLoaded` arm is an `(if browseLook …)` chain
    /// picking one of six body trees. A top-level-only scan sees no render at
    /// all and silently classifies every browse list as non-racy.
    #[test]
    fn render_nested_in_a_conditional_still_counts() {
        let event = "ItemsLoaded";
        let target = target_trait(event);

        let mut src = OirTrait::new("BrowseSource");
        src.orbital_name = "ShelfOrbital".to_string();
        src.states.push(OirState::initial("loading"));
        src.states.push(OirState::new("browsing"));
        let mut trans = OirTransition::new("loading", "browsing", event);
        trans.effects.push(OirExpr::Conditional {
            condition: Box::new(OirExpr::bool(true)),
            then_branch: Box::new(render_embedding("SomethingElse")),
            else_branch: Box::new(OirExpr::Conditional {
                condition: Box::new(OirExpr::bool(false)),
                then_branch: Box::new(render_embedding(&target.name)),
                else_branch: Box::new(OirExpr::Null),
            }),
        });
        src.transitions.push(trans);

        let mut module = OirModule::new("Shelf", "0.1");
        module.traits.push(src);
        module.traits.push(target.clone());
        let backend = backend_for(&module);

        assert!(
            backend
                .racy_listens
                .snapshot()
                .get("UI:ShelfOrbital.BrowseSource.ItemsLoaded")
                .is_some_and(|t| t.contains("ShelfListView")),
            "a render nested in an (if) chain still mounts its children"
        );
    }

    /// Two orbitals composing the SAME atom carry that atom's trait id on
    /// their listeners, so the module-wide id-first `resolve_trait_ref` returns
    /// whichever composition comes first — the second orbital's edge would be
    /// analysed against the first orbital's render tree and lost.
    #[test]
    fn source_resolves_within_its_own_orbital_despite_a_shared_atom_id() {
        let event = "ItemsLoaded";
        let shared_atom_id = "atom-browse-source";

        let mut module = OirModule::new("Shelf", "0.1");
        let mut targets = Vec::new();
        for orbital in ["FirstOrbital", "SecondOrbital"] {
            let mut src = source_trait(event, &format!("{orbital}ListView"), true);
            src.orbital_name = orbital.to_string();
            src.id = Some(shared_atom_id.to_string());
            module.traits.push(src);

            let mut target = OirTrait::new(format!("{orbital}ListView"));
            target.orbital_name = orbital.to_string();
            target.states.push(OirState::initial("idle"));
            let mut li = OirListener::new(event, "ListLoaded");
            li.source_trait = Some("BrowseSource".to_string());
            li.source_orbital = Some(orbital.to_string());
            li.source_trait_id = Some(shared_atom_id.to_string());
            target.listeners.push(li);
            module.traits.push(target.clone());
            targets.push(target);
        }

        let racy = backend_for(&module).racy_listens.snapshot();
        for orbital in ["FirstOrbital", "SecondOrbital"] {
            assert!(
                racy.get(&format!("UI:{orbital}.BrowseSource.ItemsLoaded"))
                    .is_some_and(|t| t.contains(&format!("{orbital}ListView"))),
                "{orbital}'s edge must resolve against ITS OWN source:\n{racy:?}"
            );
        }
    }

    /// `cascadeReceived` parity: a trait with a `listens` edge records what it
    /// received (post-execution, like the runtime path); one without keeps `[]`.
    #[test]
    fn cascade_received_is_populated_only_for_listening_traits() {
        let (module, target) = module_with(true);
        let backend = backend_for(&module);

        let hook = backend.generate_trait_logic_hook(&target, &module).content;
        assert!(
            hook.contains(
                "const __CASCADE_EVENTS = new Set<string>(['ItemsLoaded', 'ListLoaded']);"
            ),
            "the set mirrors the runtime's `l.event === e || l.triggers === e`:\n{hook}"
        );
        assert!(
            hook.contains("cascadeReceived: cascadeReceivedRef.current,"),
            "snapshot must expose the live record:\n{hook}"
        );
        assert!(
            hook.contains("if (__CASCADE_EVENTS.has(event)) {"),
            "record must sit in the executed branch:\n{hook}"
        );

        let source = module.traits[0].clone();
        let hook = backend.generate_trait_logic_hook(&source, &module).content;
        assert!(
            hook.contains("cascadeReceived: [],") && !hook.contains("__CASCADE_EVENTS"),
            "a trait with no listens edge can never receive a cascade:\n{hook}"
        );
    }
}

#[cfg(test)]
mod listener_refinement_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{OirBinding, OirExpr, OirListener, OirModule, OirState, OirTrait};

    fn trait_with_listener(listener: OirListener) -> OirTrait {
        let mut tr = OirTrait::new("LookupRung");
        tr.linked_entity = Some("KeyLookup".to_string());
        tr.states.push(OirState::initial("idle"));
        tr.listeners.push(listener);
        tr
    }

    /// `with{}` must REPLACE the delivered payload with the projection —
    /// payload bindings resolved against `event.payload`, keys sorted for
    /// deterministic output, and the plain path untouched.
    #[test]
    fn payload_mapping_projects_the_delivered_payload() {
        let mut li = OirListener::new("EXACT_UNMATCHED", "LOOKUP");
        li.source_trait = Some("ExactRung".to_string());
        let mut mapping = orbital_core::ir::OirFields::new();
        mapping.insert(
            "candidate".to_string(),
            OirExpr::binding(OirBinding::parse("@payload.candidate").unwrap()),
        );
        mapping.insert(
            "accepted".to_string(),
            OirExpr::Call {
                function: "object/get".to_string(),
                args: vec![
                    OirExpr::binding(OirBinding::parse("@payload.request").unwrap()),
                    OirExpr::string("accepted"),
                ],
            },
        );
        li.payload_mapping = Some(mapping);

        let backend = TypeScriptBackend::new();
        let ts = backend
            .generate_cross_trait_listeners(&trait_with_listener(li), &OirModule::new("T", "0.1"));

        assert!(
            ts.contains("enqueueEvent('LOOKUP', {"),
            "mapped listener must enqueue the projection, not event.payload:\n{ts}"
        );
        assert!(
            !ts.contains("enqueueEvent('LOOKUP', event.payload)"),
            "with{{}} must REPLACE the payload:\n{ts}"
        );
        assert!(
            ts.contains("(event.payload as EventPayload | undefined)?.candidate"),
            "payload bindings must resolve against event.payload:\n{ts}"
        );
        // Sorted keys: accepted before candidate.
        let a = ts.find("accepted:").expect("accepted field");
        let c = ts.find("candidate:").expect("candidate field");
        assert!(a < c, "mapping keys must emit sorted:\n{ts}");
    }

    /// `when` gates delivery payload-only: `@payload` resolves, `@entity`
    /// is `undefined` — matching the interpreter's payload-only context so
    /// a guard can never pass compiled and fail interpreted.
    #[test]
    fn listen_guard_gates_delivery_payload_only() {
        let mut li = OirListener::new("SCORED", "RECORD");
        li.guard = Some(OirExpr::gt(
            OirExpr::binding(OirBinding::parse("@payload.score").unwrap()),
            OirExpr::binding(OirBinding::parse("@entity.threshold").unwrap()),
        ));

        let backend = TypeScriptBackend::new();
        let ts = backend
            .generate_cross_trait_listeners(&trait_with_listener(li), &OirModule::new("T", "0.1"));

        assert!(ts.contains("if (!("), "guard must gate delivery:\n{ts}");
        assert!(
            ts.contains("(event.payload as EventPayload | undefined)?.score"),
            "guard payload binding must resolve against event.payload:\n{ts}"
        );
        assert!(
            ts.contains("undefined") && !ts.contains("entity?.threshold"),
            "non-payload roots must be undefined in listener scope:\n{ts}"
        );
        // Unrefined delivery still forwards the source payload.
        assert!(
            ts.contains("enqueueEvent('RECORD', event.payload)"),
            "a guard without with{{}} must still deliver the source payload:\n{ts}"
        );
    }

    /// A listener with neither `when` nor `with{}` must emit byte-identical
    /// plain forwarding.
    #[test]
    fn unrefined_listener_output_is_unchanged() {
        let mut li = OirListener::new("KEY_MISS", "COMPARE");
        li.source_trait = Some("LookupRung".to_string());

        let backend = TypeScriptBackend::new();
        let ts = backend
            .generate_cross_trait_listeners(&trait_with_listener(li), &OirModule::new("T", "0.1"));

        assert!(
            ts.contains("enqueueEvent('COMPARE', event.payload);"),
            "plain listeners must forward the payload untouched:\n{ts}"
        );
        assert!(
            !ts.contains("as EventPayload)"),
            "no projection emitted:\n{ts}"
        );
    }
}

/// A trait fanning one source event out to several of its own targets
/// (`SRC.EVENT -> A` and `SRC.EVENT -> B` as separate `listens` lines on the
/// same trait) is a supported, load-bearing shape on the JS runtime — the
/// generated hook must give each subscription its own unsub identifier
/// instead of two `const`s with the same name (a hard esbuild/tsc syntax
/// error, not merely unused-var noise).
#[cfg(test)]
mod fanout_listener_unsub_name_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{OirListener, OirModule, OirState, OirTrait};

    fn trait_with_listeners(listeners: Vec<OirListener>) -> OirTrait {
        let mut tr = OirTrait::new("FanoutSink");
        tr.linked_entity = Some("FanoutSink".to_string());
        tr.states.push(OirState::initial("idle"));
        tr.listeners = listeners;
        tr
    }

    #[test]
    fn same_source_event_different_targets_get_distinct_unsub_names() {
        let mut to_a = OirListener::new("REQUESTED", "SET_FIELD");
        to_a.source_trait = Some("Source".to_string());
        let mut to_b = OirListener::new("REQUESTED", "EXEC");
        to_b.source_trait = Some("Source".to_string());

        let backend = TypeScriptBackend::new();
        let ts = backend.generate_cross_trait_listeners(
            &trait_with_listeners(vec![to_a, to_b]),
            &OirModule::new("T", "0.1"),
        );

        let const_count = ts.matches("const unsub_").count();
        let unique_names: std::collections::HashSet<&str> = ts
            .lines()
            .filter_map(|l| l.trim().strip_prefix("const "))
            .filter_map(|l| l.split(" = ").next())
            .collect();
        assert_eq!(
            const_count,
            unique_names.len(),
            "two listens sharing a source event but different targets must not redeclare the same unsub const:\n{ts}"
        );
        assert!(
            ts.contains("enqueueEvent('SET_FIELD'") && ts.contains("enqueueEvent('EXEC'"),
            "both fan-out targets must still be wired:\n{ts}"
        );
    }

    #[test]
    fn fully_identical_listeners_still_get_distinct_unsub_names() {
        let mut a = OirListener::new("REQUESTED", "EXEC");
        a.source_trait = Some("Source".to_string());
        let mut b = OirListener::new("REQUESTED", "EXEC");
        b.source_trait = Some("Source".to_string());

        let backend = TypeScriptBackend::new();
        let ts = backend.generate_cross_trait_listeners(
            &trait_with_listeners(vec![a, b]),
            &OirModule::new("T", "0.1"),
        );

        let const_count = ts.matches("const unsub_").count();
        let unique_names: std::collections::HashSet<&str> = ts
            .lines()
            .filter_map(|l| l.trim().strip_prefix("const "))
            .filter_map(|l| l.split(" = ").next())
            .collect();
        assert_eq!(
            const_count,
            unique_names.len(),
            "even a fully duplicate listener pair must not redeclare the same unsub const:\n{ts}"
        );
    }
}

#[cfg(test)]
mod let_scope_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{
        OirBinding, OirEffect, OirExpr, OirModule, OirState, OirTrait, OirTransition,
    };

    fn let_set(name: &str, value: f64, field: &str) -> OirExpr {
        OirExpr::call(
            "let",
            vec![
                OirExpr::array(vec![OirExpr::array(vec![
                    OirExpr::string(name),
                    OirExpr::number(value),
                ])]),
                OirExpr::effect(OirEffect::set(
                    OirBinding::parse(&format!("@entity.{field}")).unwrap(),
                    OirExpr::binding(OirBinding::parse(&format!("@{name}")).unwrap()),
                )),
            ],
        )
    }

    fn handler(effects: Vec<OirExpr>) -> String {
        let mut tr = OirTrait::new("Scoped");
        tr.linked_entity = Some("Thing".to_string());
        tr.states.push(OirState::initial("idle"));
        tr.transitions
            .push(OirTransition::new("idle", "idle", "GO").with_effects(effects));
        TypeScriptBackend::new().generate_transpiled_effect_handler_impl(
            &tr,
            &OirModule::new("T", "0.1.0"),
            false,
            false,
        )
    }

    /// A `set` keeps the value's own type: `createdAt` is a declared field like any other
    /// (ISO string), never coerced to a `Date` by its name.
    #[test]
    fn a_set_into_created_at_keeps_the_value_unwrapped() {
        let set = |field: &str| {
            OirExpr::effect(OirEffect::set(
                OirBinding::parse(&format!("@entity.{field}")).unwrap(),
                OirExpr::binding(OirBinding::parse("@payload.stamp").unwrap()),
            ))
        };
        let ts = handler(vec![set("createdAt"), set("updatedAt")]);
        assert!(!ts.contains("new Date("), "{ts}");
    }

    /// Two `let`s binding the same name in one transition are two scopes, as in both evaluators.
    #[test]
    fn sequential_lets_with_the_same_name_get_their_own_block_scopes() {
        let ts = handler(vec![let_set("c", 1.0, "a"), let_set("c", 2.0, "b")]);
        let first = ts.find("const let__c = 1;").expect(&ts);
        let second = ts.find("const let__c = 2;").expect(&ts);
        let between = &ts[first..second];
        assert!(
            between.contains("}\n"),
            "the first let's scope must close before the second opens:\n{ts}"
        );
        let opens = ts.matches("{\n").count();
        let closes = ts.matches("}\n").count();
        assert!(
            opens >= 2 && closes >= 2,
            "each let opens and closes a block:\n{ts}"
        );
    }

    #[test]
    fn control_a_single_let_still_binds_and_uses_its_value() {
        let ts = handler(vec![let_set("c", 1.0, "a")]);
        assert!(ts.contains("const let__c = 1;"), "{ts}");
        assert!(ts.contains("_fields['a'] = let__c;"), "{ts}");
    }

    /// std-learn-generate binds `fields` in a `let`: the binding must not shadow the shell's own
    /// `fields` mirror, or the next `set @entity.X` assigns to a const and `@entity.X` reads the let.
    #[test]
    fn a_let_named_like_a_shell_local_never_shadows_it() {
        let lett = OirExpr::call(
            "let",
            vec![
                OirExpr::array(vec![OirExpr::array(vec![
                    OirExpr::string("fields"),
                    OirExpr::binding(OirBinding::parse("@payload.list").unwrap()),
                ])]),
                OirExpr::call(
                    "do",
                    vec![
                        set_a_from("fields"),
                        OirExpr::effect(OirEffect::set(
                            OirBinding::parse("@entity.b").unwrap(),
                            OirExpr::binding(OirBinding::parse("@entity.a").unwrap()),
                        )),
                    ],
                ),
            ],
        );
        let ts = handler(vec![lett]);
        assert!(!ts.contains("const fields ="), "{ts}");
        assert!(ts.contains("const let__fields = payloadObj?.list"), "{ts}");
        assert!(ts.contains("_fields['a'] = let__fields;"), "{ts}");
        assert!(
            ts.contains("_fields['b'] = fields?.a"),
            "the entity read stays on the shell mirror:\n{ts}"
        );
    }

    /// A let name is in scope only inside its body: a same-named read after it is not renamed.
    #[test]
    fn control_a_let_name_is_renamed_only_inside_its_body() {
        let after = OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.b").unwrap(),
            OirExpr::call(
                "array/len",
                vec![OirExpr::binding(OirBinding::parse("@entity.a").unwrap())],
            ),
        ));
        let ts = handler(vec![let_set("c", 1.0, "a"), after]);
        assert!(ts.contains("const let__c = 1;"), "{ts}");
        assert!(ts.contains("_fields['a'] = let__c;"), "{ts}");
        assert!(!ts.contains("let__fields"), "{ts}");
    }

    fn set_a_from(name: &str) -> OirExpr {
        OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.a").unwrap(),
            OirExpr::binding(OirBinding::parse(&format!("@{name}")).unwrap()),
        ))
    }

    /// std-graphs binds `rows` from `@payload.data` in a `let`: the payload alias must be
    /// declared even when no effect leaf reads `@payload` (TS2552 `payloadObj`).
    #[test]
    fn a_payload_read_in_a_let_value_declares_the_payload_alias() {
        let lett = OirExpr::call(
            "let",
            vec![
                OirExpr::array(vec![OirExpr::array(vec![
                    OirExpr::string("rows"),
                    OirExpr::binding(OirBinding::parse("@payload.data").unwrap()),
                ])]),
                set_a_from("rows"),
            ],
        );
        let ts = handler(vec![lett]);
        assert!(ts.contains("payloadObj?.data"), "{ts}");
        assert!(ts.contains("const payloadObj"), "{ts}");
    }

    #[test]
    fn a_payload_read_in_an_effect_if_condition_declares_the_payload_alias() {
        let cond = OirExpr::call(
            "if",
            vec![
                OirExpr::binding(OirBinding::parse("@payload.ok").unwrap()),
                set_a_from("entity.b"),
            ],
        );
        let ts = handler(vec![cond]);
        assert!(ts.contains("payloadObj?.ok"), "{ts}");
        assert!(ts.contains("const payloadObj"), "{ts}");
    }

    #[test]
    fn control_a_let_without_payload_declares_no_alias() {
        let ts = handler(vec![let_set("c", 1.0, "a")]);
        assert!(!ts.contains("payloadObj"), "{ts}");
    }
}

#[cfg(test)]
mod at_most_once_delivery_tests {
    use super::*;
    use orbital_core::ir::{OirListener, OirModule, OirState, OirTransition};

    fn tour_module(listen_trigger: &str) -> (OirModule, OirTrait) {
        let mut transport = OirTrait::new("TourTransport");
        transport.orbital_name = "Demo".to_string();
        transport.states.push(OirState::initial("idle"));
        let mut tour = OirTrait::new("Tour");
        tour.orbital_name = "Demo".to_string();
        tour.states.push(OirState::initial("idle"));
        tour.transitions
            .push(OirTransition::new("idle", "idle", "LEARN_STEP"));
        let mut listen = OirListener::new("LEARN_STEP", listen_trigger);
        listen.source_trait = Some("TourTransport".to_string());
        tour.listeners.push(listen);
        let mut module = OirModule::new("Demo", "0.1");
        module.traits.push(transport);
        module.traits.push(tour.clone());
        (module, tour)
    }

    /// The tour hears a transport tick on its listen route AND on its own key
    /// (the embed chain bubbles the emit there); both are one physical emit.
    #[test]
    fn a_listen_claims_its_delivery_before_enqueueing() {
        let (module, tour) = tour_module("LEARN_STEP");
        let ts = TypeScriptBackend::new().generate_cross_trait_listeners(&tour, &module);
        let claim = ts
            .find("if (!claimDelivery(event.source, 'Demo.Tour', 'LEARN_STEP')) return;")
            .unwrap_or_else(|| panic!("listen must claim:\n{ts}"));
        let enqueue = ts.find("enqueueEvent('LEARN_STEP'").expect("enqueue");
        assert!(claim < enqueue, "{ts}");
    }

    /// An explicit listen already delivers the event; the implicit sibling
    /// relay must not deliver it a second time.
    #[test]
    fn the_implicit_relay_skips_a_trait_that_listens_for_the_same_event() {
        let (module, _) = tour_module("LEARN_STEP");
        let targets = TypeScriptBackend::new().implicit_emit_targets(
            &module,
            "Demo",
            "TourTransport",
            "LEARN_STEP",
        );
        assert!(targets.is_empty(), "{targets:?}");
    }

    /// Control: a listen that triggers a DIFFERENT event leaves the relay to
    /// the same-name transition in place (the interpreter delivers both).
    #[test]
    fn control_a_listen_triggering_another_event_keeps_the_relay() {
        let (module, _) = tour_module("STEP_HEARD");
        let targets = TypeScriptBackend::new().implicit_emit_targets(
            &module,
            "Demo",
            "TourTransport",
            "LEARN_STEP",
        );
        assert_eq!(targets, vec!["Tour".to_string()]);
    }
}

#[cfg(test)]
mod render_slots_by_arm_tests {
    use crate::backend::TypeScriptBackend;
    use orbital_core::ir::{OirEffect, OirExpr, OirPattern, OirState, OirTrait, OirTransition};

    /// std-checkout: `NEXT` from `step1` either advances (renders nothing) or refuses with a
    /// toast. Only the refusing arm writes the toast; the advancing arm must not.
    #[test]
    fn a_slot_is_written_only_by_the_arm_that_rendered_into_it() {
        let mut tr = OirTrait::new("Rules");
        tr.orbital_name = "Shop".to_string();
        tr.states.push(OirState::initial("step1"));
        tr.states.push(OirState::new("step2"));
        tr.transitions.push(OirTransition::new("step1", "step2", "NEXT"));
        tr.transitions.push(OirTransition::new("step1", "step1", "NEXT").with_effects(vec![OirExpr::Effect {
            effect: Box::new(OirEffect::RenderUi { slot: "toast".to_string(), pattern: OirPattern::new("alert") }),
        }]));
        let lookup = TypeScriptBackend::new().generate_render_ui_lookup(&tr);
        assert!(lookup.contains("(fromState: string, event: string, arm?: number)"), "{lookup}");
        assert!(lookup.contains("case 1: return { write: ['toast'] as RulesSlot[], clear: [] as RulesSlot[] };"), "{lookup}");
        assert!(
            lookup.contains("if (arm !== undefined) {") && lookup.contains("default: return { write: [], clear: [] };"),
            "an arm that rendered nothing writes nothing:\n{lookup}"
        );
        assert!(
            lookup.contains("case 'NEXT': return { write: ['toast'] as RulesSlot[], clear: [] as RulesSlot[] };"),
            "control: without the arm (a server-resolved transition) the (state, event) table stays:\n{lookup}"
        );
    }
}
