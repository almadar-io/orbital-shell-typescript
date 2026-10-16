use crate::backend::*;
use orbital_core_base::ir::OirConfigFieldType;

/// A config default is an UNRESOLVED S-expression call form — `(if …)`,
/// `(array/map …)`, `(and …)`, … — rather than a literal value when its
/// `OirValue` is an array whose first element is a known operator name
/// (`is_operator_name`, already used by the pattern-prop compiler for the
/// identical ambiguity). `sexpr_to_value` (orbital-compiler resolve.rs)
/// never disambiguates call-form from literal-array when lowering a
/// default — both become a bare `OirValue::Array` — so this is inherently
/// the G44 class of ambiguity, and needs G44's OWN two-tier resolution
/// (`resolve.rs`'s own `resolve_sexpr` comment: "Prevents G44 (…) without
/// misclassifying `str/concat`, `agent/generate`, etc."):
///   - A NAMESPACED (`array/map`, `str/concat`) or purely SYMBOLIC (`=`,
///     `==`, `!`) operator name is virtually never a legitimate literal
///     data value (`std-marketing-campaign` `data: (array/map
///     @callsitePayload.data (fn item {…}))`) — always a call, regardless
///     of the field's own declared type.
///   - A BARE single-word bare bare name (`path`, `sum`, `map`, `filter`, …
///     — `is_operator_name`'s keyword/short-name arms and single-word
///     canonical-registry entries) is exactly where a literal data value
///     CAN collide (`fields: [path, method, status, target, rateLimit]` —
///     a literal field-NAME list on an array-typed knob, where `path` also
///     happens to be a real bare operator, "build a dot-separated path
///     string" — structural detection alone false-positived it into a
///     call, emitting an UNSUPPORTED-operator marker and hard-failing
///     std-api-gateway's compile). For this tier ONLY, additionally
///     require the field's declared type NOT already be an array — the
///     one signal available (mirrors the pre-existing "array default on
///     non-array type" evidence `generate_trait_config_block`'s OTHER
///     derive_from_default arms already use). A field with no declared
///     type on record (`schema_field: None`) is treated as non-array —
///     conservative in the SAME direction (misses a bare-name call rather
///     than misreads a literal), never the false-positive direction.
/// Cannot be a static `DEFAULT_CONFIG` literal either way (it reads
/// render-scope bindings) — see `sexpr_default_keys` for where a TRUE
/// positive is evaluated instead.
fn is_sexpr_call_default(schema_field: Option<&OirConfigFieldType>, v: &OirValue) -> bool {
    if orbital_core_base::schema::quote::quoted_oir_value(v).is_some() {
        return false;
    }
    let Some(OirValue::Array(a)) = Some(v) else {
        return false;
    };
    let Some(OirValue::String(head)) = a.first() else {
        return is_list_of_calls(a);
    };
    if head.starts_with('@') || !crate::codegen::is_operator_name(head) {
        return false;
    }
    // Language-keyword control-flow forms (`is_operator_name`'s own small
    // dedicated arm — never a plausible literal string value) join the
    // namespaced tier: unambiguous regardless of the field's declared
    // type. `navItems: (if (= @user.role …) […14 items…] […10 items…])`
    // — PF's role-branched app nav, W-C2 — is array-typed (a genuine
    // `NavItem[]` knob), so the array-type gate below would otherwise
    // false-negative it back into "literal data" and leave the raw
    // 3-branch tuple sitting in the DEFAULT_CONFIG literal (TS2352,
    // regressed std-hr-portal/-lms/-wiki/-healthcare/-fitness-studio
    // sweeping the full corpus with an earlier, keyword-unaware version
    // of this gate). `and`/`or`/`not`/`map`/`filter`/… stay in the
    // collision-prone (bare-word) tier below — `is_operator_name`'s OWN
    // categorization puts them in its short-name arm alongside `sum`/
    // `path`/etc, not this dedicated keyword arm, and this fn does not
    // second-guess that split.
    if matches!(
        head.as_str(),
        "fn" | "lambda" | "let" | "do" | "if" | "when" | "cond"
    ) {
        return true;
    }
    // Bare word = ASCII letters only (no `/` namespace, no symbolic chars)
    // — the collision-prone tier. Anything else (`array/map`, `=`, `!`) is
    // unambiguous.
    let is_bare_word = head.chars().all(|c| c.is_ascii_alphabetic());
    if !is_bare_word {
        return true;
    }
    !matches!(
        schema_field.map(|f| &f.field_type),
        Some(OirType::Array { .. })
    )
}

/// A list holding at least one unambiguous call (`[(i18n/t a) (i18n/t b)]`):
/// a namespaced or symbolic operator head, never a bare-word tuple.
fn is_list_of_calls(items: &[OirValue]) -> bool {
    items.iter().any(|item| match item {
        OirValue::Array(call) => matches!(
            call.first(),
            Some(OirValue::String(h)) if !h.starts_with('@')
                && crate::codegen::is_operator_name(h)
                && !h.chars().all(|c| c.is_ascii_alphabetic())
        ),
        _ => false,
    })
}

/// Every `@`-something binding ROOT referenced anywhere inside an
/// `OirValue` tree — `@entity.x` → `"entity"`, `@item.x` → `"item"`, a bare
/// `@EntityName` → `"EntityName"`. An s-expression default is a nested
/// array/object, so a caller must walk (mirrors `nested_callsite_payload_
/// fields`'s shape, collecting roots generically instead of one specific
/// prefix).
fn nested_binding_roots(v: &OirValue, out: &mut Vec<String>) {
    match v {
        OirValue::String(s) => {
            if let Some(rest) = s.strip_prefix('@') {
                let root = rest.split('.').next().unwrap_or(rest);
                if !root.is_empty() {
                    out.push(root.to_string());
                }
            }
        }
        OirValue::Array(a) => a.iter().for_each(|x| nested_binding_roots(x, out)),
        OirValue::Object(o) => o.values().for_each(|x| nested_binding_roots(x, out)),
        _ => {}
    }
}

/// The shared-store commit block that propagates a hybrid `[persistent,
/// shared]` trait's own field writes into the cross-trait shared frame —
/// filter out `undefined` values, map to `EntityFieldWrite`s, commit if
/// non-empty. Both the T9 optimistic-commit leg and the awaited-response
/// leg emit this identical sequence, differing only in indent and which
/// local variable holds the writes (`_optimistic.fields` vs `_fields`).
fn shared_frame_commit(indent: &str, source_expr: &str) -> String {
    format!(
        "{indent}const _sharedWrites: EntityFieldWrite[] = Object.entries({source})\n\
         {indent}  .filter(([, value]) => value !== undefined)\n\
         {indent}  .map(([field, value]) => ({{ field, value: value as FieldValue }}));\n\
         {indent}if (_sharedWrites.length > 0) {{\n\
         {indent}  _sharedStore.commit(_sharedEntityId, mergeEntityFrame(_sharedStore.getSnapshot(_sharedEntityId), _sharedWrites));\n\
         {indent}}}\n",
        indent = indent,
        source = source_expr,
    )
}

/// Binding roots ALWAYS in scope at `emit_sexpr_default_assignments`'s
/// injection point (late in the hook body, after `fields`/`lastPayload`/
/// `data`/`state`/`config` are all declared — see its own doc) — an
/// allowlist, not a denylist, because the roots that are NOT safe there
/// keep surfacing new ones (`@user` needs a View's `useUser()`;
/// `@item`/`@_item` are per-ROW template bindings resolved by a list/grid
/// renderer at ITERATION time, not a single static default — std-builder
/// `descriptionBinding: (str/concat "Record " @item.entityId)`, found live
/// as a `Cannot find name 'item'` TS2304 while fixing item 5). A bare
/// `@EntityName` (PascalCase root) resolves to `data['EntityName']`, also
/// in scope, so it is allowed structurally rather than by name.
fn binding_root_is_hook_scoped(root: &str) -> bool {
    matches!(
        root,
        "entity" | "payload" | "config" | "state" | "now" | "trait"
    ) || root.chars().next().is_some_and(|c| c.is_uppercase())
}

impl TypeScriptBackend {
    /// Whether an s-expression config default can be safely COMPILED (see
    /// `sexpr_default_keys`'s callers) instead of merely typed. Every
    /// binding root must be `binding_root_is_hook_scoped` (an ALLOWLIST —
    /// see its doc for why not a denylist). `@callsitePayload` is the one
    /// allowlisted-by-name-only exception: it IS hook-scoped structurally
    /// (`config?.<capturedKnob>` for a covered field, `config?.
    /// callsitePayload?.<path>` otherwise — `compile_callsite_payload_ref`,
    /// codegen/expr.rs) but ONLY when the field is either covered by a
    /// `trait_callsite_captures` pair or the trait is `trait_
    /// callsite_payload_flagged` (`backend/mod.rs`'s capture scan — a NESTED
    /// occurrence like ours, `(if (= @callsitePayload.data.status
    /// "resolved") …)`, flags the trait so the embed site forwards the
    /// whole composing payload) — so this needs its own check on top of the
    /// root check.
    fn sexpr_default_is_resolvable(&self, trait_def: &OirTrait, v: &OirValue) -> bool {
        let mut roots = Vec::new();
        nested_binding_roots(v, &mut roots);
        if roots
            .iter()
            .any(|r| r != "callsitePayload" && !binding_root_is_hook_scoped(r))
        {
            return false;
        }
        let mut needed = Vec::new();
        nested_callsite_payload_fields(v, &mut needed);
        if needed.is_empty() {
            return true;
        }
        if self
            .trait_callsite_payload_flagged
            .borrow()
            .contains(&trait_def.name)
        {
            return true;
        }
        let captured = self.trait_callsite_captures.borrow();
        let Some(pairs) = captured.get(&trait_def.name) else {
            return false;
        };
        needed
            .iter()
            .all(|field| pairs.iter().any(|(_, f, _)| f == field))
    }

    /// This trait's config keys whose declared default is an unresolved
    /// S-expression call form AND is safely compilable (`
    /// sexpr_default_is_resolvable`), sorted for stable output. One owner
    /// shared by `generate_trait_config_block` (DEFAULT_CONFIG emission —
    /// SKIPS every s-expr default whether resolvable or not, neither is a
    /// static value) and `generate_trait_logic_hook` (mergedConfig
    /// construction — COMPUTES only the resolvable subset), so the two
    /// stay in lockstep on which keys `generate_trait_config_block` marks
    /// required (only these) vs merely-typed-but-optional.
    fn sexpr_default_keys(&self, trait_def: &OirTrait) -> Vec<(String, OirValue)> {
        let Some(defaults) = trait_def.declared_config_defaults.as_ref() else {
            return Vec::new();
        };
        let schema = trait_def.declared_config_schema.as_ref();
        let mut keys: Vec<(String, OirValue)> = defaults
            .iter()
            .filter(|(k, v)| {
                let field = schema.and_then(|s| s.get(*k));
                is_sexpr_call_default(field, v) && self.sexpr_default_is_resolvable(trait_def, v)
            })
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        keys.sort_by(|a, b| a.0.cmp(&b.0));
        keys
    }

    /// Compile+assign this trait's resolvable s-expr config defaults onto
    /// `mergedConfig`, one `mergedConfig.<key> = mergedConfig.<key> ?? (…);`
    /// line per key (a caller-supplied override already present wins via
    /// `??`). Callers place this AFTER `fields`/`lastPayload`/`data` are
    /// all declared (the compiled expression may read any of them) and
    /// only when the trait's `mergedConfig` was actually built via the
    /// defaults-merge path — shared by the ordinary per-trait hook
    /// (`generate_trait_logic_hook`) and the `[shared]`-entity hook
    /// (`generate_shared_trait_logic_hook`), one owner so the two paths
    /// cannot drift on which keys get evaluated vs left at their
    /// DEFAULT_CONFIG-omitted (optional) `undefined`.
    ///
    /// `try_compile_sexpr_prop` resolves through `BindingFlavor::Render`,
    /// which for a `@callsitePayload.<path>` reference needs the CURRENT
    /// trait's name (`compile_callsite_payload_ref`, codegen/expr.rs) off
    /// `current_trait_scope` — pinned by both hook-generator callers
    /// (`generate_trait_logic_hook`, `generate_shared_trait_logic_hook`)
    /// for exactly this reason; see their doc.
    pub(crate) fn emit_sexpr_default_assignments(&self, trait_def: &OirTrait) -> String {
        let mut code = String::new();
        for (key, default_val) in self.sexpr_default_keys(trait_def) {
            if let OirValue::Array(arr) = &default_val {
                let compiled =
                    if is_list_of_calls(arr) && !matches!(arr.first(), Some(OirValue::String(_))) {
                        arr.iter()
                            .map(|item| match item {
                                OirValue::Array(call)
                                    if is_list_of_calls(std::slice::from_ref(item)) =>
                                {
                                    self.try_compile_sexpr_prop(call)
                                }
                                other => Some(crate::backend::oir_value_to_ts_literal(other)),
                            })
                            .collect::<Option<Vec<String>>>()
                            .map(|items| format!("[{}]", items.join(", ")))
                    } else {
                        self.try_compile_sexpr_prop(arr)
                    };
                if let Some(compiled) = compiled {
                    code.push_str(&format!(
                        "  mergedConfig.{} = mergedConfig.{} ?? ({});\n",
                        key, key, compiled
                    ));
                }
            }
        }
        code
    }

    /// Events this trait reaches through a `listens` edge — the set the
    /// runtime path matches with `l.event === e || l.triggers === e`
    /// (`almadar-ui/hooks/useTraitStateMachine.ts`). Sorted for stable output.
    fn cascade_event_names(trait_def: &OirTrait) -> Vec<String> {
        let mut names: BTreeSet<String> = BTreeSet::new();
        for listener in &trait_def.listeners {
            names.insert(listener.event_pattern.clone());
            names.insert(listener.triggers.clone());
        }
        names.into_iter().collect()
    }

    /// `cascadeReceived` record, emitted inside the dispatch's EXECUTED branch
    /// so the compiled snapshot carries what the runtime path already records
    /// (post-execution, keyed on the event this trait actually processed).
    /// Until this landed the compiled snapshot hardcoded `[]`, which is why
    /// `assert-click-no-listener` carries a compiled-path workaround.
    fn generate_cascade_record(&self, trait_def: &OirTrait, indent: &str) -> String {
        if trait_def.listeners.is_empty() {
            return String::new();
        }
        format!(
            "{indent}if (__CASCADE_EVENTS.has(event)) {{\n\
             {indent}  cascadeReceivedRef.current.push({{ event, ...(payload !== undefined ? {{ payload }} : {{}}), timestamp: Date.now() }});\n\
             {indent}}}\n",
            indent = indent
        )
    }

    /// Generate packages/client/src/hooks/traits/use{TraitName}Logic.tsx
    ///
    /// Pure logic hook: state machine, server bridge, event bus, actions.
    /// No UI rendering — that responsibility belongs to the component.
    pub(crate) fn generate_trait_logic_hook(
        &self,
        trait_def: &OirTrait,
        module: &OirModule,
    ) -> InternalFile {
        let name = &trait_def.name;
        let hook_name = format!("use{}Logic", name);
        let file_name = hook_name.clone();
        let api_path = to_kebab_case(name);

        // Phase E: pin the trait's linked entity for the client-side
        // codegen's date-coercion path (same as the server in
        // `generate_event_handler_function`). Without this, the
        // catalog lookup for `@entity.<field>` would only resolve the
        // BaseEntity hard-coded list, missing trait-specific Date
        // fields and falsely treating string fields as Date.
        self.current_linked_entity
            .set(trait_def.linked_entity.clone());
        self.current_linked_entity_id
            .set(trait_def.linked_entity_id.clone());
        self.current_entity_ref_ids
            .set(trait_def.entity_ref_ids.clone());
        self.current_trait_embed_names
            .set(Self::build_trait_embed_names(trait_def, module));
        // Same ambient scope `generate_trait_component` pins for
        // render-ui/View compilation — needed here too because this
        // hook-body generator ALSO reaches expression compilation that
        // depends on it: `emit_sexpr_default_assignments`'s s-expr config
        // defaults and any transition/tick effect body, both routed through
        // `compile_callsite_payload_ref` (codegen/expr.rs) for a
        // `@callsitePayload.<path>` reference, which reads the CURRENT
        // trait's name off this cell. Left set after this call (no
        // restore) — matches every other ambient cell set here.
        self.current_trait_scope
            .set(Some(format!("{}.{}", trait_def.orbital_name, name)));
        self.current_event_scope_chain
            .set(Self::build_event_scope_chain(trait_def, module));

        // A `[shared]` entity (the `OirEntity.shared` flag) routes through
        // an entirely separate hook shape: writer traits compute pure
        // per-frame field writes and the render trait reads a live
        // `useSharedEntitySnapshot` instead of any trait owning a private
        // `useReducer` copy of the entity. Gated here, before any of the
        // ordinary per-trait codegen below runs, so a non-shared trait's
        // output is completely unaffected — this branch is the ONLY thing
        // that changes for `shared`. See `generate_shared_trait_logic_hook`
        // (shared_trait_logic.rs) and `generate_shared_tick_driver` (tick.rs).
        // This takeover applies to EVERY `[runtime, shared]` trait — what
        // dispatch shape it gets inside that hook (client-only vs. a
        // RuntimeOptimistic server leg) is a lookup on the trait's declared
        // `local` flag (`Almadar_LOLO.md` §7), never inferred from its
        // effects; see the shared hook's own module doc.
        //
        // `shared` is documented as orthogonal to persistence
        // (`OirEntity.shared` doc comment, schema::EntityDefinition::shared)
        // — a `[persistent: X, shared]` entity (e.g. std-realtime-chat's
        // `ChannelMember`/`ChatMessage`) still needs its real server
        // fetch/persist effects, which the shared hook never learned to
        // emit (no `persist`/`fetch` compilation anywhere in
        // shared_trait_logic.rs — only `call-service` and other
        // server-bound effects route through its `sendEvent` server leg).
        // Restricting the takeover to genuinely `[runtime]` entities routes
        // a persisted+shared trait through the ordinary codegen below
        // instead — the same server round trip every other persisted trait
        // already gets correctly. This matches `@almadar/runtime`'s
        // `OrbitalServerRuntime.sharedFieldKey`: there, `shared` only
        // changes which field-state FRAME a trait's scalar writes land in
        // (one shared frame vs. one per trait); persistence always executes
        // regardless. The generated hook below picks up the shared-overlay
        // merge itself (see `shared_overlay_entity` below).
        if let Some(entity) = self.shared_linked_entity(trait_def, module) {
            if matches!(entity.persistence, OirPersistence::Runtime) {
                return self.generate_shared_trait_logic_hook(trait_def, module, entity);
            }
        }

        let mut code = String::new();

        // Header
        code.push_str(&format!("/**\n * {}\n *\n", hook_name));
        if let Some(desc) = &trait_def.description {
            code.push_str(&format!(" * {}\n *\n", desc));
        }
        code.push_str(" * Pure logic hook — state machine, orbital bridge, actions.\n");
        code.push_str(" * Use the companion component for rendering.\n");
        code.push_str(" *\n");
        code.push_str(" * @generated from schema\n");
        code.push_str(&format!(" * @trait {}\n */\n\n", name));

        // Imports — no React JSX imports needed for pure logic
        let uses_navigate = self.trait_has_navigate_effects(trait_def);
        let uses_navstack = self.trait_has_navstack_effects(trait_def);
        let uses_send_server = self.trait_has_send_server_effects(trait_def);
        // `@user.X` can land in either an effect body or a transition guard
        // (the guard threads into the client `else if` condition), so we must
        // scan both — otherwise role-gated guards like std-step-flow's
        // `ADVANCE when (... @user.role ...)` emit `user?.role` without
        // bringing `user` into scope.
        let uses_user = self.trait_client_effects_use_root(trait_def, &OirBindingRoot::User)
            || self.trait_client_guards_use_root(trait_def, &OirBindingRoot::User);
        let uses_now = crate::codegen::effect::shared::trait_reads_now(trait_def);
        let dispatch_scope = self.dispatch_scope.snapshot();
        let reads_dispatch = crate::codegen::effect::shared::trait_reads_dispatch_scope(trait_def);
        let tx = |call: &str| -> String {
            if dispatch_scope {
                format!("withinDispatch(__via.ctx, () => {call})")
            } else {
                call.to_string()
            }
        };
        let dispatch_arg = if reads_dispatch { ", __dispatch" } else { "" };
        let has_ticks = !trait_def.ticks.is_empty();

        // T9 optimistic dispatch gate: a trait linked to a `[runtime]`
        // (in-memory) entity commits transitions LOCALLY first — the fields
        // mirror IS the row (tick.rs establishes this), so client and server
        // guards evaluate the same data — and POSTs to the server on an
        // ordered, non-blocking pump lane for relay/reconcile. Persisted-
        // entity traits keep the server-gated dispatch below, byte-identical
        // (click-rate commands; their guards read fresh server collections).
        // `[shared]` traits never reach here (early-returned above).
        //
        // Dispatch strategy is `OirTrait::dispatch_mode` (LOLO §7): `local`, or a
        // `[runtime]` entity whose own fold-aware effect row never reaches the
        // server, is `HybridClientOnly`; a `[runtime]` entity whose row does is
        // `RuntimeOptimistic`; anything persisted is `PersistedAwaited`. Both
        // client-side modes commit locally first; only `HybridClientOnly` skips
        // the background reconcile POST (see `never_touches_server` below).
        let entity_def = trait_def.linked_entity.as_ref().and_then(|ename| {
            module.resolve_entity_ref(trait_def.linked_entity_id.as_deref(), ename)
        });
        let dispatch_mode = trait_def.dispatch_mode(
            entity_def,
            &orbital_core_base::runs_on::Residence::of_module(module),
        );
        let entity_is_runtime = matches!(dispatch_mode, OirDispatchMode::RuntimeOptimistic);
        // A client-only trait still sends the legs of its browser-leg events
        // (their data lives in the browser store), and only those.
        let leg_events = Self::trait_browser_leg_events(trait_def, module);
        let gated_leg =
            matches!(dispatch_mode, OirDispatchMode::HybridClientOnly) && !leg_events.is_empty();

        // Reaching here with `shared_linked_entity` still `Some` means the
        // linked entity is BOTH `[persistent]` and `[shared]` — the
        // `[runtime]`+`[shared]` case already took the early return above.
        // This hybrid needs the ordinary server fetch/persist codegen below
        // PLUS a shared-store overlay on `fields`, mirroring
        // `@almadar/runtime`'s `OrbitalServerRuntime.sharedFieldKey`/
        // `deferRenderBindings`: persistence executes unconditionally, and
        // `shared` only decides which field-state frame (private vs. one
        // shared frame across every bound trait) is merged on top of the
        // fetched data. See `Almadar_Compiler_Gaps.md` §88 for the writeup.
        let shared_overlay_entity = self.shared_linked_entity(trait_def, module);

        // A trait declaring `local` (e.g. std-realtime-chat's
        // `ChatComposer`, which only ever `(set @entity.draft/activeChannel
        // …)`s the shared frame and `emit`s for a SIBLING trait to persist)
        // gets the SAME T9 optimistic dispatch as a genuinely
        // `[runtime]`-linked trait: commit locally first, never await the
        // network before a keystroke/selection is visible. Routing it
        // through the awaited server-gated path instead (this fix's first
        // pass) made every `DRAFT_CHANGED`/`SELECT_CHANNEL` wait on a full
        // round trip — a dead-feeling input box and a channel switch that
        // never seems to take, the exact regression `@almadar/runtime`
        // avoids via `deferRenderBindings` (its own doc comment: "the eager
        // clobber pinned the chat composer's controlled input to the
        // server's flush-time \"\" on every keystroke round-trip"). A trait
        // that DOES persist something itself (`DirectMessageStarter`'s
        // `TRACK_SELECTION`/`START_DM`) keeps the awaited server-gated path
        // below — those are deliberate, occasional actions, not per-frame.
        let optimistic_dispatch = !matches!(dispatch_mode, OirDispatchMode::PersistedAwaited);

        // Always import useRef for actor model event queue
        if optimistic_dispatch {
            code.push_str(
                "import { useReducer, useCallback, useEffect, useRef, useMemo } from 'react';\n",
            );
        } else {
            code.push_str("import { useReducer, useCallback, useEffect, useRef } from 'react';\n");
        }
        if uses_navigate {
            code.push_str("import { useNavigate } from 'react-router-dom';\n");
        }
        {
            // §60 — a trait listening for an event that also MOUNTS it subscribes
            // through the bridge's hold-until-subscribed helper; a relay target
            // (G-ORB-055) marks itself mounted.
            let mut bridge_names = vec!["useOrbitalBridge"];
            if self.trait_has_racy_listener(trait_def) {
                bridge_names.push("__subscribeListens");
            }
            if self.trait_is_relay_target(trait_def) {
                bridge_names.push("__markTraitMounted");
            }
            code.push_str(&format!(
                "import {{ {} }} from '@/hooks/useOrbitalBridge';\n",
                bridge_names.join(", ")
            ));
        }
        let mut core_types: std::collections::BTreeSet<&str> = [
            "EntityRow",
            "EventPayload",
            "EventPayloadValue",
            "FieldValue",
        ]
        .into_iter()
        .collect();
        // contract/validate-* compiles to the shared @almadar/core helper —
        // the same implementation the JS runtime path calls.
        let uses_validate_contract = self
            .trait_calls_function(trait_def, "contract/validate-output")
            || self.trait_calls_function(trait_def, "contract/validate-input");
        if uses_validate_contract {
            core_types.insert("ContractSpec");
            code.push_str("import { validateContract } from '@almadar/core';\n");
        }
        code.push_str(Self::guard_holds_import(trait_def));
        code.push_str(&self.language_trio_core_import(trait_def));

        if shared_overlay_entity.is_some() {
            core_types.insert("EntityFieldWrite");
        }
        // The linked entity's field types and the event payload types are rendered inline in
        // this hook's casts, so the named struct types and `SExpr` they reach are imported here
        // (G-ORB-150/151); names the config interface below already imports are left to it.
        let rendered_types: Vec<&OirType> = module
            .entities
            .iter()
            .filter(|e| trait_def.linked_entity.as_deref() == Some(e.name.as_str()))
            .flat_map(|e| e.fields.iter().map(|f| &f.field_type))
            .chain(
                trait_def
                    .events
                    .iter()
                    .filter_map(|e| e.payload_schema.as_ref())
                    .flat_map(|schema| schema.values()),
            )
            .collect();
        if rendered_types.iter().any(|t| self.field_type_uses_sexpr(t)) {
            core_types.insert("SExpr");
        }
        let mut rendered_named: std::collections::BTreeSet<String> = Default::default();
        for t in &rendered_types {
            TypeScriptBackend::collect_named_type_refs(t, &mut rendered_named);
        }
        let mut config_named: std::collections::BTreeSet<String> = Default::default();
        if let Some(schema) = &trait_def.declared_config_schema {
            for field in schema.values() {
                TypeScriptBackend::collect_named_type_refs(&field.field_type, &mut config_named);
            }
        }
        rendered_named.retain(|n| module.named_types.contains_key(n) && !config_named.contains(n));
        // Entities the fields/payloads reference (a relation list cast in a guard names them).
        let mut referenced_entities: std::collections::BTreeSet<String> = Default::default();
        for t in &rendered_types {
            collect_entity_refs(t, &mut referenced_entities);
        }
        referenced_entities.retain(|n| {
            module.entities.iter().any(|e| &e.name == n)
                && trait_def.linked_entity.as_deref() != Some(n.as_str())
        });
        code.push_str(&crate::codegen::handler_header::core_imports_clause(
            &core_types,
        ));
        // `getNestedValue` backs `object/get` / `str/template`'s dot-path
        // codegen (`codegen/operator.rs`) — reachable here whenever a
        // guard, filter, or tick expression in this trait's logic reads a
        // nested field. Inlined (not imported) per `GET_NESTED_VALUE_DECL`'s
        // doc.
        code.push_str(crate::codegen::handler_header::GET_NESTED_VALUE_DECL);
        // Import shared types including linked entity type + per-trait event payload map.
        // The linked entity is run through the collision-aware aliasing
        // helper so names that clash with browser/Node globals
        // (`Response`, `URL`, `Event`, ...) get a `<Name>Entity` local
        // alias matching what `entity_type_ref` returns at all type-position
        // use sites in this file.
        let mut shared_imports: Vec<String> = vec!["EventResponse".to_string()];
        if let Some(linked_entity) = &trait_def.linked_entity {
            let mut linked_set: std::collections::BTreeSet<String> =
                std::collections::BTreeSet::new();
            linked_set.insert(linked_entity.clone());
            shared_imports
                .push(crate::codegen::handler_header::aliased_shared_imports_clause(&linked_set));
        }
        if !trait_def.events.is_empty() {
            shared_imports.push(format!("{}EventPayloadMap", name));
        }
        shared_imports.extend(rendered_named.iter().cloned());
        if !referenced_entities.is_empty() {
            shared_imports.push(
                crate::codegen::handler_header::aliased_shared_imports_clause(&referenced_entities),
            );
        }
        code.push_str(&format!(
            "import type {{ {} }} from '@app/shared';\n",
            shared_imports.join(", ")
        ));
        if trait_def.listeners.is_empty() {
            code.push_str("import { useUIEvents } from '@almadar/ui/hooks';\n");
        } else {
            code.push_str("import { useUIEvents, claimDelivery } from '@almadar/ui/hooks';\n");
        }
        if dispatch_scope {
            code.push_str("import { dispatchScopeOf, type DispatchScope } from '@almadar/core';\n");
            code.push_str("import { beginDispatch, currentDispatch, withinDispatch, type DispatchVia } from '../dispatchContext';\n");
        }
        if uses_navstack {
            code.push_str("import { useNavStack } from '@almadar/ui/hooks';\n");
        }
        if self.uses_tick_visibility(trait_def, module) {
            code.push_str("import { useTickVisibility } from '@almadar/ui/hooks';\n");
        }
        if shared_overlay_entity.is_some() {
            code.push_str(
                "import { useSharedEntityStoreContext, useSharedEntitySnapshot } from '@almadar/ui/hooks';\n",
            );
            code.push_str("import { mergeEntityFrame } from '@almadar/core';\n");
        }
        // VG Foundation 1: expose per-trait reducer state to the verifier via
        // registerTraitSnapshot. The generated hook maintains a ref to its
        // internal state and registers a getter on mount, unregisters on
        // unmount. See @almadar/ui/lib/verificationRegistry.ts.
        code.push_str(
            "import { registerTraitSnapshot, type TraitStateSnapshot } from '@almadar/ui/lib';\n",
        );
        if optimistic_dispatch {
            // T9: the optimistic dispatch's server leg rides the same
            // ordered-pump module the interpreted path's ServerBridge uses
            // (T7) — one owner, no duplicated lane logic.
            code.push_str("import { createCommandSendPump } from '@almadar/ui/lib';\n");
        }
        if !trait_def.listeners.is_empty() {
            code.push_str(&crate::codegen::handler_header::core_imports_clause(
                &["BusEvent"].into_iter().collect(),
            ));
        }
        if uses_user {
            code.push_str("import { useUser } from '@almadar/ui/context';\n");
        }
        if crate::codegen::effect::shared::trait_uses_messages(trait_def) {
            code.push_str("import { useTranslate } from '@almadar/ui/hooks';\n");
        }
        if self.dev_logs {
            code.push_str(
                "import { createLogger, generateCorrelationId } from '@almadar/logger';\n",
            );
        }
        code.push('\n');
        if self.dev_logs {
            code.push_str("const _traitLog = createLogger('almadar:trait:dispatch');\n");
            code.push_str("const _queueLog = createLogger('almadar:trait:queue');\n\n");
        }

        // State type
        code.push_str(
            "// ============================================================================\n",
        );
        code.push_str("// State Machine\n");
        code.push_str(
            "// ============================================================================\n\n",
        );

        code.push_str(&format!("export type {}State =\n", name));
        for (i, state) in trait_def.states.iter().enumerate() {
            let is_last = i == trait_def.states.len() - 1;
            if is_last {
                code.push_str(&format!("  | '{}';\n", state.name));
            } else {
                code.push_str(&format!("  | '{}'\n", state.name));
            }
        }
        code.push('\n');

        // Event type — includes declared events AND listened events (cross-orbital)
        let mut all_event_keys: Vec<&str> =
            trait_def.events.iter().map(|e| e.key.as_str()).collect();
        // Add listened event patterns and their triggers
        for listener in &trait_def.listeners {
            if !all_event_keys.contains(&listener.event_pattern.as_str()) {
                all_event_keys.push(&listener.event_pattern);
            }
            if !all_event_keys.contains(&listener.triggers.as_str()) {
                all_event_keys.push(&listener.triggers);
            }
        }
        code.push_str(&format!("export type {}Event =\n", name));
        for (i, key) in all_event_keys.iter().enumerate() {
            let is_last = i == all_event_keys.len() - 1;
            if is_last {
                code.push_str(&format!("  | '{}';\n", key));
            } else {
                code.push_str(&format!("  | '{}'\n", key));
            }
        }
        code.push('\n');

        // State-stored payload: widen to `EventPayload` because `lastPayload`
        // holds whatever event last fired. A narrow `<Trait>EventPayloadMap[K]`
        // union can't be accessed by key without a discriminant, and adding
        // one to every payload would bloat generated code. Per-event dispatch
        // stays fully typed via the `actions` map below.
        let payload_union = "EventPayload".to_string();
        // Fields bag: if the trait has a linked entity, fields narrow to
        // Partial<LinkedEntity>. Otherwise fall back to an empty-shape record.
        let fields_ts_type = match &trait_def.linked_entity {
            Some(linked_entity) => format!(
                "Partial<{}>",
                crate::codegen::handler_header::entity_type_ref(linked_entity)
            ),
            None => "Record<string, never>".to_string(),
        };

        // §98 — slot vocabulary this trait's transitions ever render into.
        // `slotWriter` keys against it so the View's per-slot ternary and the
        // reducer's per-`(fromState, event)` write/clear lookup can never
        // name a slot the other doesn't know about.
        let slot_ty = format!("{}Slot", name);
        code.push_str(&self.slot_union_type_decl(trait_def, &slot_ty));

        code.push_str(&format!("interface {}InternalState {{\n", name));
        code.push_str(&format!("  machineState: {}State;\n", name));
        code.push_str("  data: Record<string, EntityRow[]>;\n");
        code.push_str(&format!("  lastPayload: {} | undefined;\n", payload_union));
        // Track the last-fired transition event so the View component can pick
        // the correct render-ui when multiple transitions land in the same
        // state with different renders. Prior state-based dedup dropped all
        // but the first render per (state, slot), making the running app
        // diverge from the .lolo source's intent (G4).
        code.push_str(&format!("  lastEvent: {}Event | null;\n", name));
        // §98 — per-slot "who's showing": the event that last wrote (or
        // `null` for a `(render-ui <slot> null)` clear) each slot the trait
        // ever renders into. The View gates each `<UISlotComponent>` on its
        // own `slotWriter['<slot>']` instead of the trait's current state —
        // a render-ui is a persistent write to a slot, live until another
        // transition writes or clears it, mirroring the interpreter's
        // `SlotManager` (a state change alone changes nothing).
        code.push_str(&format!(
            "  slotWriter: Partial<Record<{}, {} | null>>;\n",
            slot_ty,
            if self.render_writer_fn(trait_def).is_some() {
                "string".to_string()
            } else {
                format!("{}Event", name)
            }
        ));
        code.push_str("  loading: boolean;\n");
        // Awaiting-server window: the event (and source state) whose server round
        // trip is in flight — the View selects the transition's predicted skeleton.
        code.push_str(&format!("  pendingEvent: {}Event | null;\n", name));
        code.push_str("  pendingFrom: string | null;\n");
        code.push_str("  error: string | null;\n");
        code.push_str(&format!("  fields: {};\n", fields_ts_type));
        code.push_str("}\n\n");

        // Action type. EVENT_SUCCESS carries the per-transition `fields`
        // updates inline so machineState + data + fields commit in a
        // single reducer return — one re-render per transition. The
        // separate SET_FIELD action stays in the union for the rare
        // case where a non-codegen consumer dispatches it directly, but
        // codegen no longer produces SET_FIELD dispatches.
        code.push_str(&format!("type {}Action =\n", name));
        // `renderBearing` flag: true when the (fromState, event) transition
        // has a (render-ui ...) effect. Reducer commits lastPayload /
        // lastEvent only when true; non-render transitions preserve the
        // prior values so the state-based JSX keeps the last rendered
        // frame. `renderWrite`/`renderClear` (§98) carry the SAME
        // transition's per-slot write/clear sets so the reducer can update
        // `slotWriter` precisely instead of the trait-wide boolean.
        code.push_str(&format!(
            "  | {{ type: 'EVENT_SUCCESS'; event: {}Event; newState: string; data: Record<string, EntityRow[]>; payload?: {}; fields?: Record<string, EventPayloadValue | undefined>; renderBearing?: boolean; renderWrite?: {}[]; renderClear?: {}[]; arm?: number }}\n",
            name, payload_union, slot_ty, slot_ty
        ));
        code.push_str("  | { type: 'EVENT_ERROR'; error: string }\n");
        code.push_str("  | { type: 'RESET_ERROR' }\n");
        code.push_str(&format!(
            "  | {{ type: 'START_EVENT'; event: {}Event; from: string }}\n",
            name
        ));
        code.push_str("  | { type: 'END_EVENT' }\n");
        if self.writes_toast_slot(trait_def) {
            code.push_str(&format!("  | {{ type: 'SLOT_CLEARED'; slot: {} }}\n", slot_ty));
        }
        // SET_FIELD accepts an EventPayloadValue so payload-sourced bindings
        // (`(set @entity.X @payload.Y)`) can flow in without a cast at the
        // dispatch site. FieldValue is a subtype of EventPayloadValue (every
        // FieldValue branch is in the EventPayloadValue union since 5.3.2),
        // so entity-sourced bindings also fit. The reducer narrows back to
        // Partial<LinkedEntity> at the single boundary where it writes to
        // state.fields.
        match &trait_def.linked_entity {
            Some(linked_entity) => code.push_str(&format!(
                "  | {{ type: 'SET_FIELD'; field: keyof {} & string; value: EventPayloadValue | undefined }}\n",
                crate::codegen::handler_header::entity_type_ref(linked_entity)
            )),
            None => code.push_str("  | { type: 'SET_FIELD'; field: string; value: EventPayloadValue | undefined }\n"),
        }
        code.push_str("  | { type: 'TICK'; updates: Record<string, EventPayloadValue | undefined>; collection: string };\n\n");

        // Initial state
        let initial_state = trait_def
            .states
            .iter()
            .find(|s| s.is_initial)
            .map(|s| &s.name)
            .unwrap_or(&trait_def.states[0].name);

        if let Some(writer_fn) = self.render_writer_fn(trait_def) {
            code.push_str(&writer_fn);
        }
        // Reducer
        code.push_str(&format!("function {}Reducer(\n", to_camel_case(name)));
        code.push_str(&format!("  state: {}InternalState,\n", name));
        code.push_str(&format!("  action: {}Action\n", name));
        code.push_str(&format!("): {}InternalState {{\n", name));
        code.push_str("  switch (action.type) {\n");
        // START_EVENT / END_EVENT bracket an awaited server round trip
        // (awaiting-server skeleton); EVENT_SUCCESS commits machineState +
        // data + fields atomically.
        code.push_str("    case 'START_EVENT':\n");
        code.push_str("      return { ...state, loading: true, pendingEvent: action.event, pendingFrom: action.from };\n");
        code.push_str("    case 'END_EVENT':\n");
        code.push_str(
            "      return { ...state, loading: false, pendingEvent: null, pendingFrom: null };\n",
        );
        if self.writes_toast_slot(trait_def) {
            code.push_str("    case 'SLOT_CLEARED':\n");
            code.push_str("      return { ...state, slotWriter: { ...state.slotWriter, [action.slot]: null } };\n");
        }
        code.push_str("    case 'EVENT_SUCCESS':\n");
        let fields_cast_ts = match &trait_def.linked_entity {
            Some(linked_entity) => format!(
                "Partial<{}>",
                crate::codegen::handler_header::entity_type_ref(linked_entity)
            ),
            None => "Record<string, never>".to_string(),
        };
        // `renderBearing` gates lastPayload / lastEvent updates: only
        // transitions with a (render-ui ...) effect commit a new payload /
        // event into reducer state. Non-render transitions still update
        // machineState + data + fields (those affect bindings reachable via
        // `@entity` collection / `@entity.X` scalar) but leave the view's
        // ternary branch and `@payload.X` bindings pinned to the last
        // rendered frame — eliminating the empty-data flash between
        // REFETCH_FILTER and BrowseItemLoaded.
        code.push_str("      return {\n");
        code.push_str(&format!(
            "        machineState: action.newState as {}State,\n",
            name
        ));
        code.push_str("        data: { ...state.data, ...action.data },\n");
        code.push_str(
            "        lastPayload: action.renderBearing ? action.payload : state.lastPayload,\n",
        );
        code.push_str(
            "        lastEvent: action.renderBearing ? action.event : state.lastEvent,\n",
        );
        // §98 — per-slot writer: a slot this transition renders into gets
        // stamped with the firing event; a slot it clears (a bare
        // `(render-ui <slot> null)`) gets stamped `null` so a previously-open
        // slot actually closes. Slots this transition never touches keep
        // their prior writer untouched — the View's ternary for THAT slot
        // still matches, so the frame stays live across an unrelated
        // transition (§98 test (c)).
        code.push_str("        slotWriter: {\n");
        code.push_str("          ...state.slotWriter,\n");
        code.push_str(
            if self.render_writer_fn(trait_def).is_some() {
                format!("          ...Object.fromEntries((action.renderWrite ?? []).map((s) => [s, {}RenderWriter(action.event, action.newState, action.arm)] as const)),\n", trait_def.name)
            } else {
                "          ...Object.fromEntries((action.renderWrite ?? []).map((s) => [s, action.event] as const)),\n".to_string()
            }
            .as_str(),
        );
        code.push_str(
            "          ...Object.fromEntries((action.renderClear ?? []).map((s) => [s, null] as const)),\n",
        );
        code.push_str("        },\n");
        code.push_str("        loading: false,\n");
        code.push_str("        pendingEvent: null,\n");
        code.push_str("        pendingFrom: null,\n");
        code.push_str("        error: null,\n");
        code.push_str(&format!(
            "        fields: {{ ...state.fields, ...(action.fields ?? {{}}) }} as {},\n",
            fields_cast_ts
        ));
        code.push_str("      };\n");
        code.push_str("    case 'EVENT_ERROR':\n");
        code.push_str("      return { ...state, loading: false, pendingEvent: null, pendingFrom: null, error: action.error };\n");
        code.push_str("    case 'RESET_ERROR':\n");
        code.push_str("      return { ...state, error: null };\n");
        code.push_str("    case 'SET_FIELD': {\n");
        code.push_str("      // Back-compat for non-codegen consumers that still dispatch\n");
        code.push_str("      // SET_FIELD directly. Codegen folds field updates into\n");
        code.push_str("      // EVENT_SUCCESS so transitions commit in a single render.\n");
        code.push_str("      return {\n");
        code.push_str("        ...state,\n");
        code.push_str(&format!(
            "        fields: {{ ...state.fields, [action.field]: action.value }} as {},\n",
            fields_cast_ts
        ));
        code.push_str("      };\n");
        code.push_str("    }\n");
        code.push_str("    case 'TICK': {\n");
        code.push_str("      // Batch-update entity fields for tick effects. A [runtime]-linked\n");
        code.push_str("      // trait's row lives in the `fields` mirror (transitions write it,\n");
        code.push_str("      // the view reads it), so updates ALWAYS merge there; the\n");
        code.push_str("      // `data` collection row is updated too when one exists.\n");
        code.push_str(&format!(
            "      const tickFields = {{ ...state.fields, ...action.updates }} as {};\n",
            fields_cast_ts
        ));
        code.push_str("      const arr = state.data[action.collection];\n");
        code.push_str("      const target = arr?.[0];\n");
        code.push_str("      if (!target) return { ...state, fields: tickFields };\n");
        code.push_str("      const updated = { ...target, ...action.updates } as EntityRow;\n");
        code.push_str("      return {\n");
        code.push_str("        ...state,\n");
        code.push_str(
            "        data: { ...state.data, [action.collection]: [updated, ...arr.slice(1)] },\n",
        );
        code.push_str("        fields: tickFields,\n");
        code.push_str("      };\n");
        code.push_str("    }\n");
        code.push_str("    default:\n");
        code.push_str("      return state;\n");
        code.push_str("  }\n");
        code.push_str("}\n\n");

        // Initial internal state
        code.push_str(&format!("const initialState: {}InternalState = {{\n", name));
        code.push_str(&format!("  machineState: '{}',\n", initial_state));
        code.push_str("  data: {},\n");
        code.push_str("  lastPayload: undefined,\n");
        code.push_str("  lastEvent: null,\n");
        code.push_str("  slotWriter: {},\n");
        code.push_str("  loading: false,\n");
        code.push_str("  pendingEvent: null,\n");
        code.push_str("  pendingFrom: null,\n");
        code.push_str("  error: null,\n");
        code.push_str("  fields: {},\n");
        code.push_str("};\n\n");

        // Return type interface
        code.push_str(
            "// ============================================================================\n",
        );
        code.push_str("// Hook\n");
        code.push_str(
            "// ============================================================================\n\n",
        );

        code.push_str(&self.generate_trait_config_block(trait_def));
        let has_defaults = trait_def
            .declared_config_defaults
            .as_ref()
            .map(|d| !d.is_empty())
            .unwrap_or(false);

        // Per-event action signature: narrow payload type from EventPayloadMap.
        // Callers that want a typed dispatch use `actions.<eventCamel>(payload)`;
        // the raw `dispatch(event, payload)` stays string-keyed because the queue
        // and listener paths funnel through it with dynamic keys.
        let actions_type = if trait_def.events.is_empty() {
            "Record<string, never>".to_string()
        } else {
            format!(
                "{{ [K in keyof {name}EventPayloadMap]: (payload?: {name}EventPayloadMap[K]) => Promise<EventResponse> }}",
                name = name
            )
        };
        let dispatch_type =
            "(event: string, payload?: EventPayload) => Promise<EventResponse>".to_string();

        code.push_str(&format!("export interface {}LogicReturn {{\n", name));
        code.push_str(&format!("  state: {}State;\n", name));
        code.push_str("  data: Record<string, EntityRow[]>;\n");
        code.push_str(&format!("  lastPayload: {} | undefined;\n", payload_union));
        // Last-fired transition event; view components use this to pick the
        // correct render-ui when multiple transitions land in the same state.
        // Null until the first transition commits.
        code.push_str(&format!("  lastEvent: {}Event | null;\n", name));
        // §98 — per-slot writer the View gates each `<UISlotComponent>` on.
        // Same slot vocabulary as `{Name}InternalState.slotWriter`.
        code.push_str(&format!(
            "  slotWriter: Partial<Record<{}, {} | null>>;\n",
            slot_ty,
            if self.render_writer_fn(trait_def).is_some() {
                "string".to_string()
            } else {
                format!("{}Event", name)
            }
        ));
        code.push_str("  loading: boolean;\n");
        // Awaiting-server window: the event (and source state) whose server round
        // trip is in flight — the View selects the transition's predicted skeleton.
        code.push_str(&format!("  pendingEvent: {}Event | null;\n", name));
        code.push_str("  pendingFrom: string | null;\n");
        code.push_str("  error: string | null;\n");
        code.push_str(&format!("  fields: {};\n", fields_ts_type));
        code.push_str(&format!("  dispatch: {};\n", dispatch_type));
        code.push_str(&format!("  actions: {};\n", actions_type));
        if uses_now {
            code.push_str("  now: number;\n");
        }
        if self.writes_toast_slot(trait_def) {
            code.push_str(&format!("  clearSlot: (slot: {}Slot) => void;\n", name));
        }
        // `config` on the hook return is non-optional WHEN the trait has
        // declared defaults — in that case the hook returns mergedConfig
        // (DEFAULT_CONFIG ∪ user override) which is always populated, and
        // view-side render-ui bindings (`config?.articles[0].title`)
        // resolve to `string` not `string | undefined`. When the trait
        // has no declared defaults, mergedConfig falls through to the
        // raw `config?: …Config` input, so the return must stay optional
        // to mirror the input shape (otherwise `return { config:
        // mergedConfig }` fails with `Config | undefined → Config`).
        let has_defaults_for_return = trait_def
            .declared_config_defaults
            .as_ref()
            .map(|d| !d.is_empty())
            .unwrap_or(false);
        if has_defaults_for_return {
            code.push_str(&format!("  config: {}Config;\n", name));
        } else {
            code.push_str(&format!("  config?: {}Config;\n", name));
        }
        code.push_str("}\n\n");

        // The hook input is ALWAYS `Partial`: pages embed traits with just
        // `{ entityId }`, capturing traits receive only their captured knobs
        // (C-COMPILED-PATH-RED §25). Merged over `DEFAULT_<NAME>_CONFIG` into
        // a full `mergedConfig` below; a defaultless trait's Config is
        // all-optional (required ⟺ has-default), so the no-merge fall-through
        // stays assignable too.
        let config_param_type = format!("Partial<{}Config>", name);
        // Events reached through a `listens` edge — the compiled mirror of the
        // runtime path's `cascadeReceived` bookkeeping.
        let cascade_events = Self::cascade_event_names(trait_def);
        if !cascade_events.is_empty() {
            let list: Vec<String> = cascade_events.iter().map(|e| format!("'{}'", e)).collect();
            code.push_str(&format!(
                "const __CASCADE_EVENTS = new Set<string>([{}]);\n\n",
                list.join(", ")
            ));
        }
        if gated_leg {
            let events: Vec<String> = leg_events.iter().map(|e| format!("'{e}'")).collect();
            code.push_str(&format!(
                "const __LEG_EVENTS: ReadonlySet<string> = new Set([{}]);\n\n",
                events.join(", ")
            ));
        }
        code.push_str(&format!(
            "export function {}(config?: {}): {}LogicReturn {{\n",
            hook_name, config_param_type, name
        ));

        // G24-followup (Solution 1): merge declared defaults with the
        // caller-provided config so `mergedConfig.<field>` reads the
        // documented default whenever the field is omitted. Atoms verified
        // standalone get a fully-populated config without the consumer that
        // would normally override.
        if has_defaults {
            code.push_str(&format!(
                "  const mergedConfig: {}Config = {{ ...DEFAULT_{}_CONFIG, ...(config ?? {{}}) }};\n\n",
                name,
                to_screaming_snake_case(name)
            ));
        } else {
            code.push_str("  const mergedConfig = config;\n\n");
        }

        // Orbital bridge — decoupled event bus + server communication (Phase 5)
        code.push_str("  // Orbital bridge: event bus + server communication\n");
        let sends_ticks = !self.browser_leg_ticks(trait_def, module).is_empty();
        let bridge_destructure = match (uses_send_server, sends_ticks) {
            (true, true) => "  const { sendEvent, sendServerEvent, sendTick, eventBus }",
            (true, false) => "  const { sendEvent, sendServerEvent, eventBus }",
            (false, true) => "  const { sendEvent, sendTick, eventBus }",
            (false, false) => "  const { sendEvent, eventBus }",
        };
        code.push_str(&format!(
            "{} = useOrbitalBridge({{ basePath: '/api/{}', orbitalName: '{}', traitName: '{}' }});\n\n",
            bridge_destructure, api_path, trait_def.orbital_name, name
        ));

        // Internal state
        code.push_str("  // Internal state with reducer\n");
        code.push_str(&format!(
            "  const [internalState, dispatchReducer] = useReducer({}Reducer, initialState);\n",
            to_camel_case(name)
        ));
        // Destructure `fields` under an alias so that
        // `executeTransitionEffects` can declare `let fields = _initialFields`
        // and reassign it after each `(set @entity.X)` effect — subsequent
        // sets in the same transition body then see prior staged writes,
        // matching the runtime's EffectExecutor mirror contract. JSX render
        // bindings outside the callback continue to read the outer
        // `const fields` alias.
        code.push_str("  const { machineState: state, data, lastPayload, lastEvent, slotWriter, loading, pendingEvent, pendingFrom, error, fields: _initialFields } = internalState;\n");
        if let Some(entity) = shared_overlay_entity {
            // Persisted `[shared]` entity: layer the cross-trait shared
            // frame on top of the fetched/dispatched data, mirroring
            // `@almadar/runtime`'s `OrbitalServerRuntime` 3-layer merge
            // (declared defaults < persisted entity data < trait field-state
            // frame, top wins). `_initialFields` already carries layers 1-2
            // (this hook's own reducer state); `_sharedSnapshot` is layer 3,
            // written by every OTHER trait bound to the same entity (e.g. a
            // sibling `[persistent, shared]` writer's `(set @entity.X)`).
            code.push_str("  const _sharedStore = useSharedEntityStoreContext();\n");
            code.push_str(&format!("  const _sharedEntityId = '{}';\n", entity.name));
            code.push_str(
                "  const _sharedSnapshot = useSharedEntitySnapshot(_sharedStore, _sharedEntityId);\n",
            );
            code.push_str("  const fields = { ..._initialFields, ..._sharedSnapshot };\n");
        } else {
            code.push_str("  const fields = _initialFields;\n");
        }
        // Per-render-synced snapshot ref, declared BEFORE any useCallback
        // that reads it (generated-code lint forbids use-before-define).
        // Also serves the verifier snapshot registration below.
        code.push_str("  const internalStateRef = useRef(internalState);\n");
        code.push_str("  internalStateRef.current = internalState;\n\n");
        if !cascade_events.is_empty() {
            code.push_str(
                "  const cascadeReceivedRef = useRef<TraitStateSnapshot['cascadeReceived']>([]);\n\n",
            );
        }

        // Mirror internalState into a ref so async code reads the LATEST
        // machineState without racing React's render cycle. The actor-model
        // queue below drains events sequentially (`while queue.length > 0`);
        // each loop iteration awaits a dispatch whose closure captured `state`
        // at the render that produced this drainQueue. That captured `state`
        // goes stale as soon as the first dispatch's `dispatchReducer` fires
        // — React schedules the update but won't re-render until the
        // microtask settles. Meanwhile the loop's next iteration sends the
        // OLD state to the server via `sendEvent(_, _, state)`, which the
        // server rejects with "Cannot process E from state X" because X is
        // the pre-transition state.
        //
        // Symptom: clicking Confirm on std-cart → Persistor deletes → emits
        // ITEM_DELETED → CartBrowse listens → enqueues INIT → INIT succeeds
        // (browsing → loading) → server emits CartItemLoaded → useUIEvents
        // enqueues CartItemLoaded → drainQueue's next iteration reads the
        // stale `browsing` from closure → server rejects → cart stuck at
        // loading.
        //
        // The ref captures the live state inside dispatch without adding it
        // to the useCallback deps (the ref identity never changes).
        code.push_str("  const machineStateRef = useRef(state);\n");
        code.push_str("  machineStateRef.current = state;\n\n");

        if optimistic_dispatch {
            // T9: fields mirror as a ref — per-render synced like
            // machineStateRef, and updated SYNCHRONOUSLY at each optimistic
            // commit so chained dispatches within one drain pass read the
            // post-commit row, not the pre-render snapshot. EntityRow-typed
            // (like tick.rs's _tickEntityRef) so string-key snapshot reads
            // and EventPayloadValue-wide spread writes typecheck.
            code.push_str("  const fieldsRef = useRef<EntityRow>({ ...fields });\n");
            code.push_str("  fieldsRef.current = { ...fields };\n");
            // The server leg's ordered lane: FIFO, one POST in flight, a
            // rejection neither blocks nor drops later commands. The drain
            // never awaits the network; ordering still holds server-side.
            code.push_str("  const commandPump = useMemo(() => createCommandSendPump(), []);\n\n");
        }

        // Actor model: per-trait event queue for sequential processing
        code.push_str(
            "  // Actor model: sequential event queue (prevents cross-trait race conditions)\n",
        );
        code.push_str(
            if dispatch_scope {
                "  const eventQueueRef = useRef<Array<{ event: string; payload?: EventPayload; via?: DispatchVia; settle?: () => void }>>([]);\n"
            } else {
                "  const eventQueueRef = useRef<Array<{ event: string; payload?: EventPayload; settle?: () => void }>>([]);\n"
            },
        );
        code.push_str("  const processingRef = useRef(false);\n\n");

        // Conditional hooks based on effect usage
        if uses_navigate {
            code.push_str("  const navigate = useNavigate();\n");
        }
        if uses_navstack {
            code.push_str("  const navStack = useNavStack();\n");
        }
        if uses_user {
            code.push_str("  const { user } = useUser();\n");
        }
        if crate::codegen::effect::shared::trait_uses_messages(trait_def) {
            code.push_str("  const { t: __t, locale: __locale } = useTranslate();\n");
        }
        if uses_navigate || uses_navstack || uses_user {
            code.push('\n');
        }
        if uses_now {
            // Render reads the last dispatch's stamp; each dispatch/tick shadows it with its own.
            code.push_str("  const __lastNow = useRef<number>(Date.now());\n  const now = __lastNow.current;\n\n");
        }

        // Phase 4: Generate transpiled client-side effect handler.
        // `resolve_new_state = optimistic_dispatch` (T9): a `RuntimeOptimistic`
        // or `HybridClientOnly` trait resolves guard + to-state locally for
        // the optimistic dispatch.
        //
        // `emit_fanout` (§84, `Almadar_Compiler_Gaps.md`) is NOT one flag for
        // both `optimistic_dispatch` sub-cases — they satisfy the "server
        // echo will relay the cascade" assumption differently:
        //   - `RuntimeOptimistic` (`entity_is_runtime`): the server DOES get
        //     an eventual background POST (see `if entity_is_runtime`
        //     below), whose `emittedEvents` echo relays the cascade via
        //     `emitCascadeEvent` — fan-out here would double-fire every
        //     sibling listener.
        //   - `HybridClientOnly` (trait declares `local`, e.g.
        //     `ChatComposer`): NO server round trip EVER happens for this
        //     trait — there is no echo to relay anything, ever. `emit_fanout
        //     = false` here permanently stranded every declared cross-trait
        //     `emit` this class of trait fires (confirmed:
        //     `ChatComposer.SELECT_CHANNEL` → `CHANNEL_SELECTED` never
        //     reached `ChannelThread`/`ChatThread` on the compiled path).
        //     This sub-case needs the SAME local relay the `[shared]`-only
        //     early-return path already gets, for the identical reason: no
        //     other delivery mechanism exists.
        let never_touches_server = matches!(dispatch_mode, OirDispatchMode::HybridClientOnly);
        code.push_str(&self.generate_transpiled_effect_handler_impl(
            trait_def,
            module,
            optimistic_dispatch,
            never_touches_server,
        ));

        // Static lookup: which (fromState, event) transitions have a
        // render-ui effect. The view's state-based JSX branches on
        // `lastEvent`, so updating `lastEvent` / `lastPayload` for a
        // transition that DOESN'T render (e.g. `REFETCH_FILTER ->
        // browsing` whose only effect is `(fetch ...)`) flips the view
        // to the fallback ternary branch with the wrong payload — visible
        // as an "empty data" flash before the cascade event
        // (`BrowseItemLoaded`) lands. Gating the lastPayload/lastEvent
        // commit on this map keeps the prior render's frame in place
        // until the next render-bearing transition fires.
        code.push_str("  // Per-transition render-ui presence map (codegen).\n");
        code.push_str("  // Used by dispatch to skip lastPayload/lastEvent updates for\n");
        code.push_str("  // transitions whose only effects are server-side or set/emit —\n");
        code.push_str("  // those don't change the rendered JSX, so the view should keep\n");
        code.push_str("  // the prior frame's payload until a render-bearing transition\n");
        code.push_str("  // (e.g. fetch.emit.success cascade) lands.\n");
        code.push_str(&self.generate_render_ui_lookup(trait_def));

        // Dispatch function
        code.push_str("  /**\n");
        code.push_str("   * Dispatch an event through the orbital bridge.\n");
        code.push_str("   * Bridge emits lifecycle events on the bus, forwards to server.\n");
        code.push_str("   * Client effects are transpiled at compile time (Phase 4).\n");
        code.push_str("   */\n");
        // Raw dispatch carries the generic wire shape. Typed per-event dispatch
        // comes through the `actions` map below.
        code.push_str(if dispatch_scope {
            "  const dispatch = useCallback(async (event: string, __rawPayload?: EventPayload, __viaIn?: DispatchVia): Promise<EventResponse> => {\n"
        } else {
            "  const dispatch = useCallback(async (event: string, __rawPayload?: EventPayload): Promise<EventResponse> => {\n"
        });
        if uses_now {
            code.push_str("    const now = Date.now();\n    __lastNow.current = now;\n");
        }
        // The compiled server resolves `@entity` from the incoming event
        // payload ALONE (`payload.entityId ?? payload.id`), so an event whose
        // payload names no row — a fetch-success `{ data, totalCount }`, a
        // bare lifecycle event — left it `null`: every `@entity.X` read in
        // that transition evaluated to `undefined` and every `(set @entity.X)`
        // was skipped by the handler's `if (entity)` guard. A guard like
        // `["=", (object/get @entity openDraft), "1"]` then took the wrong
        // branch while every request still returned 200
        // (C-ENTITY-NULL-WHEN-EVENT-PAYLOAD-CARRIES-NO-ID, §59). The trait's
        // own bound id is known right here, so carry it on every event rather
        // than only the ones that happen to name it. An explicit id in the
        // payload always wins — this only fills a gap, never overrides.
        code.push_str(
            "    const payload: EventPayload | undefined =\n      \
             __rawPayload !== undefined && ('entityId' in __rawPayload || 'id' in __rawPayload)\n        \
             ? __rawPayload\n        \
             : config?.entityId !== undefined\n          \
             ? { ...(__rawPayload ?? {}), entityId: config.entityId }\n          \
             : __rawPayload;\n",
        );
        // Read from the ref, not the closure — the drainQueue loop can
        // iterate multiple dispatches within one render cycle (cascade
        // events synchronously enqueued during a prior dispatch's await).
        code.push_str("    const prevState = machineStateRef.current;\n");
        if dispatch_scope {
            code.push_str("    const __via: DispatchVia = __viaIn ?? { delivery: { event, ...(payload !== undefined ? { payload } : {}), source: {} }, ctx: currentDispatch() ?? beginDispatch() };\n");
            code.push_str(&format!(
                "    const __log = __via.ctx.memory.log('{name}');\n"
            ));
            code.push_str("    const __dispatch: DispatchScope = dispatchScopeOf(__via.delivery, __log, event, payload);\n");
            code.push_str("    if (__via.listenWhen !== undefined && !__via.listenWhen(prevState, __dispatch)) {\n");
            code.push_str("      return { success: true, transitioned: false, states: {}, emittedEvents: [] } as EventResponse;\n");
            code.push_str("    }\n");
            code.push_str(&format!(
                "    __via.ctx.memory.recordDelivery('{name}', __via.delivery);\n"
            ));
            code.push_str("    const __cont = { delivery: __via.delivery, dispatchLog: __log, ctx: __via.ctx };\n");
        }
        if self.dev_logs {
            code.push_str("    const _cid = generateCorrelationId();\n");
            code.push_str("    _traitLog.info('dispatch', { event, currentState: prevState, payload }, _cid);\n");
        }
        if optimistic_dispatch {
            // ── T9 optimistic dispatch ([runtime]-linked traits, and a
            // [persistent, shared] trait whose own transitions never touch
            // the server) ──────────────────────────────────────────────
            // Commit the transition LOCALLY first (guard + to-state resolved
            // by the transpiled handler against the live fields mirror), then
            // POST on the ordered pump lane. Input never waits on the
            // network; the server stays the authoritative relay and a
            // disagreement rolls back to the pre-dispatch snapshot.
            code.push_str(
                "    // T9 optimistic dispatch: the fields mirror IS the [runtime] entity\n",
            );
            code.push_str("    // row, so guard + to-state resolve locally on the same data the\n");
            code.push_str("    // server would read. Commit first, POST after; reconcile below.\n");
            let live_data_ts = match &trait_def.linked_entity {
                Some(linked_entity) => format!(
                    "    const liveData: Record<string, EntityRow[]> = {{ '{}': [fieldsRef.current as EntityRow] }};\n",
                    linked_entity
                ),
                None => "    const liveData: Record<string, EntityRow[]> = {};\n".to_string(),
            };
            code.push_str(&live_data_ts);
            if gated_leg {
                code.push_str("    const _preRow = { ...fieldsRef.current } as EntityRow;\n");
            }
            code.push_str(&format!(
                "    const _optimistic = {};\n",
                tx(&format!(
                    "executeTransitionEffects(prevState, event, liveData, payload{dispatch_arg})"
                ))
            ));
            code.push_str("    if (_optimistic.newState === undefined) {\n");
            code.push_str(
                "      // A blocked guard or an undeclared arm is a rejection, as on every path.\n",
            );
            code.push_str(&format!(
                "      const _armDeclared = {}.some(([from, armEvent]) => armEvent === event && (from === '*' || from.includes(prevState)));\n",
                Self::declared_arms_literal(trait_def)
            ));
            code.push_str(&format!(
                "      return {{ success: true, transitioned: false, states: {{ '{name}': prevState }}, emittedEvents: [], rejections: [{{ code: _armDeclared ? 'guard-rejected' : 'no-matching-transition', trait: '{name}', from: prevState, event }}] }} as EventResponse;\n",
                name = name
            ));
            code.push_str("    }\n");
            code.push_str("    const _renderSlots = getRenderUiSlots(prevState, event, _optimistic.arm);\n");
            code.push_str(
                "    const _renderBearing = _renderSlots.write.length > 0 || _renderSlots.clear.length > 0;\n",
            );
            code.push_str(
                "    // Snapshot the touched fields' prior values for a reconcile rollback.\n",
            );
            code.push_str(
                "    const _snapshot: Record<string, EventPayloadValue | undefined> = {};\n",
            );
            code.push_str(
                "    for (const _k of Object.keys(_optimistic.fields)) { _snapshot[_k] = fieldsRef.current[_k]; }\n",
            );
            code.push_str("    dispatchReducer({\n");
            code.push_str("      type: 'EVENT_SUCCESS',\n");
            code.push_str(&format!("      event: event as {}Event,\n", name));
            code.push_str("      newState: _optimistic.newState,\n");
            code.push_str("      data: {},\n");
            code.push_str("      payload,\n");
            code.push_str("      fields: _optimistic.fields,\n");
            code.push_str("      renderBearing: _renderBearing,\n");
            code.push_str("      renderWrite: _renderSlots.write,\n");
            code.push_str("      renderClear: _renderSlots.clear,\n");
            code.push_str("      arm: _optimistic.arm,\n");
            code.push_str("    });\n");
            code.push_str(&self.generate_cascade_record(trait_def, "    "));
            // Refs must reflect the commit IMMEDIATELY so a chained dispatch
            // inside the same drain pass reads the post-commit values.
            code.push_str(
                "    machineStateRef.current = _optimistic.newState as typeof machineStateRef.current;\n",
            );
            code.push_str(
                "    fieldsRef.current = { ...fieldsRef.current, ..._optimistic.fields } as EntityRow;\n",
            );
            if shared_overlay_entity.is_some() {
                // Propagate this trait's own optimistic writes into the
                // cross-trait shared frame SYNCHRONOUSLY (same commit as the
                // local reducer above) so a sibling trait's own
                // `_sharedSnapshot` re-renders in the same frame — e.g.
                // ChatComposer's `SELECT_CHANNEL` writing `activeChannel`
                // must be visible to ChatThread's next render immediately,
                // not after ChatComposer's background server leg returns.
                code.push_str(&shared_frame_commit("    ", "_optimistic.fields"));
            }
            if dispatch_scope {
                code.push_str(&format!("    __via.ctx.memory.recordTransition('{name}', prevState, _optimistic.newState);\n"));
                code.push_str("    withinDispatch(__via.ctx, () => { for (const _emit of _optimistic.emits) _emit(); });\n");
            } else {
                code.push_str("    for (const _emit of _optimistic.emits) _emit();\n");
            }
            code.push('\n');
            if self.dev_logs {
                code.push_str("        _traitLog.info('dispatch:optimistic', { event, prevState, newState: _optimistic.newState, fieldKeys: Object.keys(_optimistic.fields) }, _cid);\n");
            }
            if gated_leg {
                code.push_str("    if (__LEG_EVENTS.has(event)) {\n");
            }
            if entity_is_runtime || gated_leg {
                // Genuine `[runtime]` entity: the server holds a real
                // in-memory store for it (`getRuntimeEntity`) that's
                // meaningful to reconcile against — sync in the background,
                // never blocking the drain, and roll back on disagreement.
                code.push_str(
                    "    // Server leg: ordered by the pump, never blocking the drain.\n",
                );
                code.push_str("    commandPump.enqueue(async () => {\n");
                code.push_str("      try {\n");
                // A [runtime] entity has no server-side row — its frame is
                // whatever the in-memory store already holds server-side
                // (`getRuntimeEntity`), so there is nothing for the client
                // to hand over here.
                // The browser store replays a leg statelessly from the pre-dispatch state, so it
                // gets the pre-dispatch row; a server keeps its own [runtime] copy.
                code.push_str(match (gated_leg, dispatch_scope) {
                    (true, true) => "        const response = await sendEvent(event, payload, prevState, _preRow, __cont);\n",
                    (true, false) => "        const response = await sendEvent(event, payload, prevState, _preRow);\n",
                    (false, true) => "        const response = await sendEvent(event, payload, prevState, undefined, __cont);\n",
                    (false, false) => "        const response = await sendEvent(event, payload, prevState);\n",
                });
                if gated_leg {
                    // The browser store runs the leg's own success cascade in
                    // process; its echoed emits drive this machine, so only a
                    // failed leg disagrees.
                    code.push_str("        if (response.success) {\n");
                } else {
                    code.push_str(&format!(
                        "        if (response.success && (!response.states?.['{name}'] || response.states?.['{name}'] === _optimistic.newState)) {{\n",
                        name = name
                    ));
                }
                code.push_str(
                    "          // Agreement — merge any fetch/persist results the local commit\n",
                );
                code.push_str(
                    "          // couldn't supply (same reducer action, deferred leg).\n",
                );
                code.push_str(
                    "          if (response.data && Object.keys(response.data).length > 0) {\n",
                );
                code.push_str("            dispatchReducer({\n");
                code.push_str("              type: 'EVENT_SUCCESS',\n");
                code.push_str(&format!("              event: event as {}Event,\n", name));
                code.push_str("              newState: machineStateRef.current,\n");
                code.push_str("              data: response.data,\n");
                code.push_str("              renderBearing: false,\n");
                code.push_str("            });\n");
                code.push_str("          }\n");
                code.push_str("        } else {\n");
                code.push_str("          // Rejection or state disagreement — roll back to the\n");
                code.push_str(
                    "          // pre-dispatch snapshot; the server stays authoritative.\n",
                );
                code.push_str("          dispatchReducer({\n");
                code.push_str("            type: 'EVENT_SUCCESS',\n");
                code.push_str(&format!("            event: event as {}Event,\n", name));
                code.push_str("            newState: prevState,\n");
                code.push_str("            data: {},\n");
                code.push_str("            fields: _snapshot,\n");
                code.push_str("            renderBearing: false,\n");
                code.push_str("          });\n");
                code.push_str("          machineStateRef.current = prevState;\n");
                code.push_str(
                    "          fieldsRef.current = { ...fieldsRef.current, ..._snapshot } as EntityRow;\n",
                );
                code.push_str(&format!(
                    "          dispatchReducer({{ type: 'EVENT_ERROR', error: response.error ?? `server state mismatch: expected ${{_optimistic.newState}}, got ${{response.states?.['{name}'] ?? '(unchanged)'}}` }});\n",
                    name = name
                ));
                code.push_str("        }\n");
                code.push_str("      } catch (err) {\n");
                code.push_str(
                    "        // Pump isolates the rejection; surface it without rolling\n",
                );
                code.push_str(
                    "        // back — local state may simply be ahead of a reconnecting server.\n",
                );
                code.push_str(
                    "        dispatchReducer({ type: 'EVENT_ERROR', error: err instanceof Error ? err.message : 'Network error' });\n",
                );
                code.push_str("      }\n");
                code.push_str("    });\n");
                if gated_leg {
                    code.push_str("    }\n");
                }
            } else {
                // Hybrid `[persistent, shared]` trait with no server-touching
                // transition of its own (this fix's second pass — see
                // `optimistic_dispatch`'s doc comment). There is nothing
                // meaningful to reconcile against: `activeChannel`/`draft`-
                // style scratch fields are never persisted, so the server is
                // stateless w.r.t. them and would reject any guard reading
                // one (`@entity.activeChannel` resolves to its declared
                // default on every request) — posting here only produced a
                // spurious rollback moments after a successful local commit
                // (the "message sends, then un-sends itself" regression).
                // The shared-store commit above already gives every sibling
                // trait cross-instance visibility; skip the network leg.
                code.push_str(
                    "    void sendEvent; void commandPump; // no server-touching effect on this trait; shared-store commit above is the only sync needed\n",
                );
            }
            code.push_str(&format!(
                "    return {{ success: true, transitioned: true, states: {{ '{name}': _optimistic.newState }}, emittedEvents: [] }} as EventResponse;\n",
                name = name
            ));
            code.push_str(
                "  }, [sendEvent, executeTransitionEffects, commandPump, config?.entityId]);\n\n",
            );
        } else {
            // The awaited server round trip is bracketed by START_EVENT /
            // END_EVENT (in `finally`, so every exit clears it): the View shows
            // the transition's predicted skeleton in an empty slot meanwhile.
            code.push_str(&format!("    dispatchReducer({{ type: 'START_EVENT', event: event as {}Event, from: prevState }});\n", name));
            code.push_str("    try {\n");
            // The request carries this trait's `@entity` frame so the server
            // evaluates guards / `set` / `emit` against the same values the
            // client sees (§87). A hybrid trait's frame includes the shared
            // snapshot its siblings wrote.
            let frame_expr = if shared_overlay_entity.is_some() {
                "{ ...internalStateRef.current.fields, ..._sharedStore.getSnapshot(_sharedEntityId) }"
            } else {
                "{ ...internalStateRef.current.fields }"
            };
            let cont_arg = if dispatch_scope { ", __cont" } else { "" };
            code.push_str(&format!(
                "      const response = await sendEvent(event, payload, prevState, {frame_expr}{cont_arg});\n\n"
            ));
            code.push_str("      if (response.success) {\n");
            // Run transpiled client effects (the (set @entity.X) statements)
            // BEFORE dispatching EVENT_SUCCESS. The function returns the
            // staged field updates so the reducer commits machineState +
            // data + fields in a single state transition — one re-render per
            // event instead of one per (set) effect plus the wrapper
            // EVENT_SUCCESS.
            // Server-computed `set` results win over the local transpile:
            // both ran the same expressions, but only the server saw the
            // freshly fetched row.
            if dispatch_scope {
                code.push_str(&format!(
                    "        __via.ctx.memory.recordTransition('{name}', prevState, response.states?.['{name}'] || prevState);\n"
                ));
            }
            code.push_str(&format!(
                "        const _fields: Record<string, EventPayloadValue | undefined> = {{ ...{}, ...(response.entityByTrait?.['{name}'] ?? {{}}) }};\n",
                tx(&format!("executeTransitionEffects(prevState, event, payload{dispatch_arg})")),
                name = name
            ));
            // Render-bearing transitions stamp lastPayload / lastEvent so the
            // view's state-based JSX picks the right ternary branch with the
            // right payload bindings (`@payload.X`). Non-render transitions
            // leave both at their prior values so the view keeps the last
            // frame intact while a cascade is in flight.
            code.push_str("        const _renderSlots = getRenderUiSlots(prevState, event);\n");
            code.push_str(
                "        const _renderBearing = _renderSlots.write.length > 0 || _renderSlots.clear.length > 0;\n",
            );
            code.push_str("        dispatchReducer({\n");
            code.push_str("          type: 'EVENT_SUCCESS',\n");
            code.push_str(&format!("          event: event as {}Event,\n", name));
            code.push_str(&format!(
                "          newState: response.states?.['{name}'] || prevState,\n",
                name = name
            ));
            code.push_str("          data: response.data || {},\n");
            code.push_str("          payload,\n");
            code.push_str("          fields: _fields,\n");
            code.push_str("          renderBearing: _renderBearing,\n");
            code.push_str("          renderWrite: _renderSlots.write,\n");
            code.push_str("          renderClear: _renderSlots.clear,\n");
            code.push_str("        });\n");
            if shared_overlay_entity.is_some() {
                // Propagate this trait's own `(set @entity.X)` writes into
                // the cross-trait shared frame so sibling traits bound to
                // the same `[persistent, shared]` entity (reading via their
                // own `_sharedSnapshot`) see the update without a refetch —
                // the write-side half of the read-side merge above.
                code.push_str(&shared_frame_commit("        ", "_fields"));
            }
            code.push_str(&self.generate_cascade_record(trait_def, "        "));
            code.push('\n');
            // Ref must reflect the new machine state IMMEDIATELY so the next
            // iteration of drainQueue's while loop reads the correct value
            // (React's reducer commit hasn't re-rendered yet by the time the
            // loop pulls the next event off the queue). `response.states[trait]`
            // is typed `string` on the wire; the ref holds the narrow state
            // literal union — cast through the reducer's action type surface
            // so the server-returned state lands in the ref.
            code.push_str(&format!(
                "        if (response.states?.['{name}']) {{\n",
                name = name
            ));
            code.push_str(&format!(
                "          machineStateRef.current = response.states?.['{name}'] as typeof machineStateRef.current;\n",
                name = name
            ));
            code.push_str("        }\n");
            // `internalStateRef` gets the same immediate-sync treatment as
            // `machineStateRef` above, for the same reason (L-14): drainQueue's
            // `while` loop calls `dispatch` again for the next queued event
            // before React re-renders, so a chained dispatch's
            // `executeTransitionEffects` — which reads guard/effect state via
            // `internalStateRef.current.fields`, not the reducer's `fields`
            // closure — was seeing this transition's writes go missing. A
            // manual selection (`TRACK_SELECTION`) immediately followed by an
            // auto-open cascade (`AUTO_OPEN`) queued from the same
            // `BrowseItemLoaded` burst reproduced this: `AUTO_OPEN`'s
            // `(not @entity.openChannel)` guard re-read the pre-selection
            // ref and refired, stomping the manual selection. Mirrors the
            // reducer's own merge (`fields: { ...state.fields, ...action.fields }`)
            // so the ref and the eventual render agree.
            code.push_str(&format!(
                "        internalStateRef.current = {{ ...internalStateRef.current, machineState: (response.states?.['{name}'] || prevState) as typeof machineStateRef.current, fields: {{ ...internalStateRef.current.fields, ..._fields }} }} as typeof internalStateRef.current;\n\n",
                name = name
            ));
            if self.dev_logs {
                code.push_str(&format!(
                    "        _traitLog.info('dispatch:success', {{ event, prevState, newState: response.states?.['{name}'] || prevState, dataKeys: Object.keys(response.data || {{}}), fieldKeys: Object.keys(_fields) }}, _cid);\n",
                    name = name
                ));
            }
            code.push_str("      } else {\n");
            code.push_str("        dispatchReducer({\n");
            code.push_str("          type: 'EVENT_ERROR',\n");
            code.push_str("          error: response.error || 'Unknown error',\n");
            code.push_str("        });\n");
            if self.dev_logs {
                code.push_str("        _traitLog.warn('dispatch:error', { event, error: response.error || 'Unknown error' }, _cid);\n");
            }
            code.push_str("      }\n\n");
            code.push_str("      return response;\n");
            code.push_str("    } catch (err) {\n");
            code.push_str(
                "      const errorMsg = err instanceof Error ? err.message : 'Network error';\n",
            );
            code.push_str("      dispatchReducer({ type: 'EVENT_ERROR', error: errorMsg });\n");
            code.push_str("      return { success: false, transitioned: false, states: {}, emittedEvents: [], error: errorMsg } as EventResponse;\n");
            code.push_str("    } finally {\n");
            code.push_str("      dispatchReducer({ type: 'END_EVENT' });\n");
            code.push_str("    }\n");
            // Drop `state` from deps — dispatch now reads from the ref and is
            // stable across renders. This also stabilizes drainQueue and
            // enqueueEvent, so useUIEvents doesn't re-subscribe on every state
            // change (which would drop in-flight listeners mid-cascade).
            code.push_str("  }, [sendEvent, executeTransitionEffects, config?.entityId]);\n\n");
        }

        // Actor model: drain queue sequentially
        code.push_str("  // Actor model: drain event queue one at a time\n");
        code.push_str("  const drainQueue = useCallback(async () => {\n");
        code.push_str("    if (processingRef.current) return;\n");
        code.push_str("    processingRef.current = true;\n");
        code.push_str("    try {\n");
        code.push_str("      while (eventQueueRef.current.length > 0) {\n");
        code.push_str("        const entry = eventQueueRef.current.shift()!;\n");
        code.push_str(if dispatch_scope {
            "        try { await dispatch(entry.event, entry.payload, entry.via); } finally { entry.settle?.(); }\n"
        } else {
            "        try { await dispatch(entry.event, entry.payload); } finally { entry.settle?.(); }\n"
        });
        code.push_str("      }\n");
        code.push_str("    } finally {\n");
        code.push_str("      processingRef.current = false;\n");
        code.push_str("    }\n");
        code.push_str("  }, [dispatch]);\n\n");

        code.push_str("  // Actor model: enqueue event and start drain\n");
        code.push_str(
            if self.dispatch_scope.snapshot() {
                "  const enqueueEvent = useCallback((event: string, payload?: EventPayload, via?: DispatchVia) => {\n"
            } else {
                "  const enqueueEvent = useCallback((event: string, payload?: EventPayload) => {\n"
            },
        );
        code.push_str(if self.dispatch_scope.snapshot() {
            "    return new Promise<void>((settle) => {\n    eventQueueRef.current.push({ event, payload, via, settle });\n"
        } else {
            "    return new Promise<void>((settle) => {\n    eventQueueRef.current.push({ event, payload, settle });\n"
        });
        if self.dev_logs {
            code.push_str("    _queueLog.debug('enqueue', { event, queueDepth: eventQueueRef.current.length });\n");
        }
        code.push_str("    void drainQueue();\n");
        code.push_str("    });\n");
        code.push_str("  }, [drainQueue]);\n\n");

        // Action creators + event-bridge subscription — shared verbatim with
        // the `[shared]`-entity dispatch path (`generate_shared_trait_logic_hook`),
        // extracted so both hook shapes stay byte-identical here and can
        // never silently diverge. See `generate_actions_block` /
        // `generate_ui_events_subscription` (client.rs).
        code.push_str(&self.generate_actions_block(trait_def, &actions_type));
        code.push_str(&self.generate_ui_events_subscription(trait_def));

        // VG Foundation 1: register per-trait reducer snapshot for the verifier.
        // A ref tracks the live internalState so the registered getter always
        // returns current values (not the mount-time closure).
        let state_names: Vec<String> = trait_def
            .states
            .iter()
            .map(|s| format!("'{}'", s.name))
            .collect();
        let event_names: Vec<String> = trait_def
            .events
            .iter()
            .map(|e| format!("'{}'", e.key))
            .collect();
        code.push_str("  // Verifier snapshot registration (VG Foundation 1)\n");
        code.push_str("  useEffect(() => {\n");
        code.push_str(&format!(
            "    const unregister = registerTraitSnapshot('{}', (): TraitStateSnapshot => ({{\n",
            name
        ));
        code.push_str(&format!("      traitName: '{}',\n", name));
        code.push_str("      currentState: internalStateRef.current.machineState,\n");
        code.push_str(&format!("      states: [{}],\n", state_names.join(", ")));
        code.push_str(&format!("      events: [{}],\n", event_names.join(", ")));
        code.push_str("      data: internalStateRef.current.data,\n");
        code.push_str("      lastPayload: internalStateRef.current.lastPayload,\n");
        // `lastEvent` and `lastPayload` are already tracked by the reducer's
        // EVENT_SUCCESS branch; expose them through the snapshot bridge so
        // verify's `probeBindings` can confirm event delivery to the trait.
        // Without this the snapshot's `lastEventDispatched` was always
        // `undefined` and every accepted frame false-failed VG11a.
        code.push_str("      lastEventDispatched: internalStateRef.current.lastEvent !== null\n");
        code.push_str("        ? {\n");
        code.push_str("            event: internalStateRef.current.lastEvent,\n");
        code.push_str("            ...(internalStateRef.current.lastPayload !== undefined\n");
        code.push_str("              ? { payload: internalStateRef.current.lastPayload }\n");
        code.push_str("              : {}),\n");
        code.push_str("            timestamp: Date.now(),\n");
        code.push_str("          }\n");
        code.push_str("        : undefined,\n");
        // A trait with no `listens` edge can never receive a cascade, so `[]`
        // is its correct steady state; one that does mirrors the runtime
        // path's post-execution record (`useTraitStateMachine`).
        if cascade_events.is_empty() {
            code.push_str("      cascadeReceived: [],\n");
        } else {
            code.push_str("      cascadeReceived: cascadeReceivedRef.current,\n");
        }
        code.push_str("    }));\n");
        code.push_str("    return unregister;\n");
        code.push_str("  // eslint-disable-next-line react-hooks/exhaustive-deps\n");
        code.push_str("  }, []);\n\n");

        // Auto-init on mount + cross-trait listener subscriptions — shared
        // verbatim with the `[shared]`-entity dispatch path, extracted for
        // the same reason as the actions/useUIEvents blocks above. See
        // `generate_auto_init_effect` / `generate_cross_trait_listeners`
        // (client.rs).
        code.push_str(&self.generate_auto_init_effect(trait_def));
        code.push_str(&self.generate_cross_trait_listeners(trait_def, module));

        // Client-side tick execution (game loops, scheduled updates).
        // Only `[runtime]` (in-memory) linked entities run ticks client-side;
        // the gate lives inside generate_tick_effects.
        if has_ticks {
            code.push_str(&self.generate_tick_effects(trait_def, module));
        }

        // State-timeout scheduling (`state X for Ns { ... }`).
        if trait_def.states.iter().any(|s| s.time_bound_ms.is_some()) {
            code.push_str(&self.generate_timeout_effects(trait_def));
        }

        // Config keys whose declared default is an unresolved S-expression
        // (`disabled: (if …)`) were deliberately left OUT of the static
        // DEFAULT_CONFIG literal (see generate_trait_config_block) — compile
        // and assign them here instead, now that `fields`/`lastPayload`/
        // `data`/`config` are all in scope (the compiled expression can read
        // any of them, per the render binding flavor). Only when the trait
        // actually merges a `mergedConfig` (has_defaults) — the defaultless
        // path's `mergedConfig = config` is a passthrough with nothing to
        // populate. A caller-supplied override (`config?.<key>` already set)
        // still wins via `??`.
        if has_defaults {
            code.push_str(&self.emit_sexpr_default_assignments(trait_def));
        }

        // Return — pure logic, no UI
        code.push_str("  return {\n");
        code.push_str("    state,\n");
        code.push_str("    data,\n");
        code.push_str("    lastPayload,\n");
        code.push_str("    lastEvent,\n");
        code.push_str("    slotWriter,\n");
        code.push_str("    loading,\n");
        code.push_str("    pendingEvent,\n");
        code.push_str("    pendingFrom,\n");
        code.push_str("    error,\n");
        code.push_str("    fields,\n");
        code.push_str("    dispatch,\n");
        code.push_str("    actions,\n");
        if uses_now {
            code.push_str("    now,\n");
        }
        if self.writes_toast_slot(trait_def) {
            code.push_str(&format!("    clearSlot: (slot: {}Slot) => dispatchReducer({{ type: 'SLOT_CLEARED', slot }}),\n", name));
        }
        // Return mergedConfig (defaults + caller overrides) so views read
        // declared defaults when no consumer override is present.
        code.push_str("    config: mergedConfig,\n");
        code.push_str("  };\n");
        code.push_str("}\n");

        let code = if code.contains("emitCascadeEvent(eventBus,") {
            code.replacen(
                "import { useOrbitalBridge",
                "import { emitCascadeEvent, useOrbitalBridge",
                1,
            )
        } else {
            code
        };

        InternalFile::new(
            format!("packages/client/src/hooks/traits/{}.tsx", file_name),
            code,
            GeneratedFileType::Hook,
        )
    }

    /// Emit a trait's `{Name}Config` interface (+ the `TraitFieldRef`/`SExpr`
    /// inline imports its field types may need, and a `DEFAULT_{NAME}_CONFIG`
    /// const when the atom declared default values). Extracted from
    /// `generate_trait_logic_hook` so the config surface — which depends only
    /// on `trait_def.declared_config_schema` / `declared_config_defaults`,
    /// never on reducer/state-machine plumbing — is identical for the
    /// ordinary per-trait hook and the `[shared]`-entity hook
    /// (`generate_shared_trait_logic_hook`), which has no reducer at all.
    pub(crate) fn generate_trait_config_block(&self, trait_def: &OirTrait) -> String {
        let name = &trait_def.name;
        let mut code = String::new();

        // Inline `TraitFieldRef` when any config field's type tree
        // references `Trait` — e.g. a tab's `content?: TraitFieldRef`
        // inside an inline struct array. Mirrors the entities.ts emit
        // (line ~712); avoids needing the symbol exported from
        // @almadar/core (older lockfiles predate the export). The type
        // is the same shape as the canonical export — branded
        // `@trait.${string}` — so structural assignability holds.
        let config_uses_trait = trait_def
            .declared_config_schema
            .as_ref()
            .map(|schema| {
                schema
                    .values()
                    .any(|f| self.field_type_uses_trait(&f.field_type))
            })
            .unwrap_or(false);
        if config_uses_trait {
            code.push_str(crate::codegen::handler_header::TRAIT_FIELD_REF_DECL);
            code.push('\n');
        }

        // Import the canonical `SExpr` brand from `@almadar/core` when any
        // config field is `SExpr`-typed (e.g. a `conditionalFields` map value).
        // Unlike `TraitFieldRef` (inlined above for a types-module cycle +
        // old-lockfile reasons), `SExpr` is a current export with no cycle, so
        // import the single source of truth rather than shadow it. Gated to
        // avoid an unused-import lint failure on traits without SExpr config.
        let config_uses_sexpr = trait_def
            .declared_config_schema
            .as_ref()
            .map(|schema| {
                schema
                    .values()
                    .any(|f| self.field_type_uses_sexpr(&f.field_type))
            })
            .unwrap_or(false);
        if config_uses_sexpr {
            code.push_str(&crate::codegen::handler_header::core_imports_clause(
                &["SExpr"].into_iter().collect(),
            ));
            code.push('\n');
        }

        // `node`-typed config fields render as `PatternValue` — inline the
        // local declaration (same shadow-not-import reasoning as
        // PATTERN_VALUE_DECL's other consumers; mirrors the shared/events.ts
        // gate) or every generated `ui-*` hook whose config carries renderable
        // content (Typography `content`, layout `children`) fails TS2304.
        let config_uses_node = trait_def
            .declared_config_schema
            .as_ref()
            .map(|schema| {
                schema
                    .values()
                    .any(|f| self.field_type_uses_node(&f.field_type))
            })
            .unwrap_or(false);
        if config_uses_node {
            code.push_str(crate::codegen::handler_header::PATTERN_VALUE_DECL);
            code.push('\n');
        }

        // Named struct types (e.g. `NavItem`) a config field reaches via
        // `OirType::TypeRef` — `map_type_with_enum` below renders the bare
        // interface name, so this hook file must import it (entities.ts
        // re-exports through `@app/shared`, unlike `generate_shared_trait_configs`'s
        // `./entities`-relative import — this file lives under
        // `client/src/hooks/traits/`, not alongside entities.ts) or every
        // such config field trips TS2304 (Cannot find name 'NavItem').
        let mut referenced_struct_names: std::collections::BTreeSet<String> = Default::default();
        if let Some(schema) = &trait_def.declared_config_schema {
            for field in schema.values() {
                TypeScriptBackend::collect_named_type_refs(
                    &field.field_type,
                    &mut referenced_struct_names,
                );
            }
        }
        code.push_str(
            &crate::codegen::handler_header::named_struct_type_import_line(
                &referenced_struct_names.iter().map(String::as_str).collect(),
                "@app/shared",
            ),
        );

        code.push_str(&format!("export interface {}Config {{\n", name));
        code.push_str("  linkedEntity?: string;\n");
        code.push_str("  entityId?: string;\n");
        // Page-mounted callers additionally pass the route's `:param`s and
        // the navigate-state payload — both merged into INIT alongside
        // `entityId` (`generate_auto_init_effect`, codegen/effect/client.rs).
        code.push_str("  routeParams?: Record<string, string | undefined>;\n");
        code.push_str("  initPayload?: EventPayload;\n");
        // Forwarded ONLY for a trait `trait_callsite_payload_flagged`
        // (backend/mod.rs's capture scan) — a NESTED `@callsitePayload.<path>`
        // reference this trait's own config/effects carry that no single
        // typed knob (the `trait_callsite_captures` pairs) covers. The
        // embed site (`embedded_view_config_attr`) forwards the composing
        // View's whole `lastPayload` under this key; the child reads any
        // depth back via `config?.callsitePayload?.<path>`
        // (`compile_callsite_payload_ref`, codegen/expr.rs).
        if self
            .trait_callsite_payload_flagged
            .borrow()
            .contains(&trait_def.name)
        {
            code.push_str("  callsitePayload?: EventPayload;\n");
        }
        // Declared `config { ... }` fields from the atom's .lolo source.
        // Captured by the resolve phase as `OirTrait.declared_config_schema`
        // and emitted here so the view component (and any consumer override)
        // typechecks against the declared shape. Fields with a declared
        // default are marked REQUIRED — the hook merges defaults so the
        // runtime value is always populated, and render-ui bindings
        // (`config?.articles[0].title`) resolve to `string` not
        // `string | undefined`. Fields without a default stay optional so
        // a caller can choose not to set them. Mirrors the same gate in
        // generate_shared_trait_configs.
        if let Some(schema) = &trait_def.declared_config_schema {
            let defaults = trait_def.declared_config_defaults.as_ref();
            let mut keys: Vec<&String> = schema.keys().collect();
            keys.sort();
            for k in keys {
                let field = &schema[k];
                // For object / object-array defaults the declared `config{}`
                // type (`string`/`string[]`) doesn't match the authored nested
                // shape — derive the field type from the default value so the
                // `DEFAULT_CONFIG … as {name}Config` cast and nested reads
                // typecheck. Scalars, string-arrays and enums keep their
                // declared (often narrower) type.
                let default_val = defaults.and_then(|d| d.get(k));
                // An UNRESOLVED s-expression default (`disabled: (if …)`,
                // std-marketing-campaign `LineChart.data`) is never a static
                // literal — DEFAULT_CONFIG omits it (see the emission loop
                // below) and `generate_trait_logic_hook` computes it into
                // `mergedConfig` once render-scope bindings are available.
                // Its member type is therefore the trait's own DECLARED type
                // (the compiled expression's real result), NOT the raw
                // tuple shape the OTHER `derive_from_default` arms use for a
                // genuinely-authored array/object default.
                let is_sexpr_default =
                    default_val.is_some_and(|dv| is_sexpr_call_default(Some(field), dv));
                // An s-expr default is ALWAYS optional in the interface —
                // like a `@config.` forward token, DEFAULT_CONFIG cannot
                // hold it as a static value (see the emission loop below),
                // so nothing GUARANTEES it is populated by the time a
                // consumer reads `config?.<key>`: `emit_sexpr_default_
                // assignments` populates the RESOLVABLE subset once
                // render-scope bindings are available, but only near the
                // hook's return — well after `mergedConfig`'s own `as
                // {Name}Config` cast, which cannot see that later
                // assignment. Marking it required there lied about that
                // gap (a required-but-absent member breaks the DEFAULT_
                // CONFIG cast's overlap check outright — TS2352, std-
                // helpdesk InlineDataListRender19 — and a required member
                // that then only sometimes gets populated is worse: an
                // honest `undefined` beats a false compile-time guarantee).
                let has_default = defaults.is_some_and(|d| {
                    d.get(k).is_some_and(|dv| {
                        // Forward-token defaults resolve at runtime; the
                        // member stays optional (DEFAULT_CONFIG omits them).
                        !matches!(dv, OirValue::String(s) if s.starts_with("@config."))
                    })
                }) && !is_sexpr_default;
                let derive_from_default = !is_sexpr_default
                    && (matches!(default_val, Some(OirValue::Object(_)))
                        || matches!(
                            default_val,
                            Some(OirValue::Array(a))
                                if a.first().is_some_and(|e| matches!(e, OirValue::Object(_)))
                        )
                        // A non-empty array default on a NON-array declared type
                        // (`children: string = ["@trait.X", …]`): the authored
                        // shape is the truth — derive `string[]` etc. from it, or
                        // the DEFAULT_CONFIG cast has no overlap (TS2352).
                        || matches!(
                            default_val,
                            Some(OirValue::Array(a))
                                if !a.is_empty() && !matches!(field.field_type, OirType::Array { .. })
                        ));
                let ty = if derive_from_default {
                    oir_value_to_ts_type(default_val.unwrap())
                } else if matches!(default_val, Some(OirValue::Array(a)) if a.is_empty())
                    && matches!(field.field_type, OirType::Json)
                {
                    // json knob with an EMPTY-array default (`itemActions: []`):
                    // the generic json mapping (`Record<…>`) has no overlap with
                    // the array literal in DEFAULT_CONFIG (TS2352) and misses
                    // the knob's array nature; emit the wide array type.
                    "EventPayloadValue[]".to_string()
                } else {
                    self.map_type_with_enum(&field.field_type, field.values.as_ref())
                };
                // An unresolved `@`-binding default on a non-string member
                // (`value: number = @entity.progress`, `status: <enum> =
                // @entity.status`): DEFAULT_CONFIG stores the raw binding
                // string — the View resolves it inline at render — so the
                // member's static type must admit `string` or the
                // `DEFAULT_CONFIG as …Config` cast has no overlap (TS2352,
                // C-COMPILED-PATH-RED §25).
                let ty = if !derive_from_default
                    && ty != "string"
                    && matches!(default_val, Some(OirValue::String(s))
                        if s.starts_with('@')
                            // `@config.` forwards are omitted from DEFAULT_CONFIG
                            // (runtime-chained); `@trait.` stays the branded
                            // TraitFieldRef literal — both keep the declared type.
                            && !s.starts_with("@config.")
                            && !s.starts_with("@trait."))
                {
                    format!("{} | string", ty)
                } else {
                    ty
                };
                // An explicit `null` default (a `trait` knob bound `none`):
                // DEFAULT_CONFIG carries `null`, so the member admits it.
                let ty = if matches!(default_val, Some(OirValue::Null)) {
                    format!("{} | null", ty)
                } else {
                    ty
                };
                let marker = if has_default { "" } else { "?" };
                code.push_str(&format!("  {}{}: {};\n", k, marker, ty));
            }
        }
        // Referrer-chained forwards: `@config.<key>` reads in the trait's own
        // body whose key the trait's schema does NOT declare are supplied by
        // the embedder's resolved config at runtime — carry them (optional,
        // wide) or every view read trips TS2339 (C-SHELL-TS-EMIT-TSC-DRIFT).
        // Mirrors generate_shared_trait_configs.
        {
            let declared: std::collections::HashSet<&String> = trait_def
                .declared_config_schema
                .iter()
                .flat_map(|s| s.keys())
                .collect();
            for key in Self::config_read_keys(trait_def) {
                if !declared.contains(&key) {
                    // EventPayloadValue is already in every hook's core import.
                    code.push_str(&format!("  {}?: EventPayloadValue;\n", key));
                }
            }
        }
        code.push_str("}\n\n");

        // G24-followup (Solution 1): emit a DEFAULT_CONFIG constant when the
        // atom declares default values. The hook merges these with the
        // caller-provided config so that `config.icon`, `config.title`, etc.
        // resolve to the declared defaults whenever a consumer omits them
        // (or, in the standalone-verify case, no consumer is present).
        let has_defaults = trait_def
            .declared_config_defaults
            .as_ref()
            .map(|d| !d.is_empty())
            .unwrap_or(false);
        if has_defaults {
            let defaults = trait_def.declared_config_defaults.as_ref().unwrap();
            // Emit the const without an inline annotation, then assert the
            // `<Name>Config` shape via `as`. Bare object-literal annotations
            // run TS's excess-property check, which rejects authored knobs
            // that aren't part of the typed shape (e.g. metric `filter` —
            // a polymorphic SExpr predicate or `{key: value}` map the lolo
            // type system can't express today). The `as` cast keeps
            // structural type-checking on declared keys while letting the
            // runtime see every authored field. Parity with the .lolo source
            // is preserved — every literal we write is exactly what the
            // author declared.
            code.push_str(&format!(
                "const DEFAULT_{}_CONFIG = {{\n",
                to_screaming_snake_case(name),
            ));
            let default_schema = trait_def.declared_config_schema.as_ref();
            let mut keys: Vec<&String> = defaults.keys().collect();
            keys.sort();
            for k in keys {
                // An unresolved `@config.<key>` forward token is NOT a static
                // default — the runtime chains it through the embedder's
                // resolved config. Emitting the literal string both lies about
                // the value and breaks the `as <Name>Config` overlap (TS2352,
                // e.g. `cols: "@config.cols"` vs `cols: number`).
                if matches!(&defaults[k], OirValue::String(s) if s.starts_with("@config."))
                    || is_sexpr_call_default(default_schema.and_then(|s| s.get(k)), &defaults[k])
                {
                    continue;
                }
                let lit = oir_value_to_ts_literal(&defaults[k]);
                code.push_str(&format!("  {}: {},\n", k, lit));
            }
            code.push_str(&format!("}} as {}Config;\n\n", name));
        }

        code
    }
}

#[cfg(test)]
mod sexpr_config_default_tests {
    use super::{binding_root_is_hook_scoped, is_sexpr_call_default, nested_binding_roots};
    use crate::backend::TypeScriptBackend;
    use orbital_core_base::ir::{OirConfigFieldType, OirTrait, OirType, OirValue};

    /// G-CROSS-041: a quoted default is static data, emitted like any literal.
    #[test]
    fn a_quoted_default_is_not_a_call_default() {
        let sexpr: orbital_core_base::schema::SExpression =
            serde_json::from_str(r#"[">", "@payload.amount", 0]"#).unwrap();
        let quoted = OirValue::Array(vec![
            OirValue::String("quote".into()),
            OirValue::String(orbital_core_base::schema::quote::encode_quote_body(&sexpr)),
        ]);
        assert!(!is_sexpr_call_default(None, &quoted));
        let call = OirValue::Array(vec![
            OirValue::String("str/upper".into()),
            OirValue::String("x".into()),
        ]);
        assert!(
            is_sexpr_call_default(None, &call),
            "control: a real call default is still deferred"
        );
    }

    /// std-behavior-tour `captions: [(i18n/t a) (i18n/t b)]` and std-board
    /// `columnLabels` landed in DEFAULT_CONFIG as raw `[["i18n/t", …]]`
    /// tuples typed `string[]` (TS2352). A list holding calls is computed in
    /// the hook like a call default.
    #[test]
    fn a_list_of_calls_is_a_call_default() {
        let call = |k: &str| {
            OirValue::Array(vec![
                OirValue::String("i18n/t".into()),
                OirValue::String(k.into()),
            ])
        };
        assert!(is_sexpr_call_default(
            None,
            &OirValue::Array(vec![call("a"), call("b")])
        ));
        let tuples = OirValue::Array(vec![OirValue::Array(vec![
            OirValue::String("name".into()),
            OirValue::String("string".into()),
        ])]);
        assert!(
            !is_sexpr_call_default(None, &tuples),
            "control: a list of bare-word tuples is data"
        );
        let words = OirValue::Array(vec![
            OirValue::String("a".into()),
            OirValue::String("b".into()),
        ]);
        assert!(
            !is_sexpr_call_default(None, &words),
            "control: a list of strings is data"
        );
    }

    fn if_sexpr(cond: OirValue, then: OirValue, else_: OirValue) -> OirValue {
        OirValue::Array(vec![OirValue::String("if".into()), cond, then, else_])
    }

    fn bool_field() -> OirConfigFieldType {
        OirConfigFieldType {
            field_type: OirType::Boolean,
            values: None,
        }
    }

    fn array_field() -> OirConfigFieldType {
        OirConfigFieldType {
            field_type: OirType::Array {
                inner: Box::new(OirType::String),
            },
            values: None,
        }
    }

    #[test]
    fn detects_a_call_form_but_not_a_literal_array_or_binding_string() {
        let sexpr = if_sexpr(
            OirValue::String("@entity.assignee".into()),
            OirValue::Bool(true),
            OirValue::Bool(false),
        );
        assert!(is_sexpr_call_default(Some(&bool_field()), &sexpr));
        assert!(!is_sexpr_call_default(
            Some(&bool_field()),
            &OirValue::Array(vec![
                OirValue::String("a".into()),
                OirValue::String("b".into()),
            ])
        ));
        assert!(!is_sexpr_call_default(
            Some(&bool_field()),
            &OirValue::String("@config.forwarded".into())
        ));
    }

    // C1-E3 item (5) follow-up (found live sweeping the full corpus):
    // `fields: (path method status target rateLimit)` on std-api-gateway's
    // RouteCreate/RouteEdit — `path` is ALSO a genuine bare canonical
    // operator (std-object, "build a dot-separated path string"), so the
    // structural check alone treats a literal field-NAME list as a call
    // form (G44-class ambiguity), and the actual operator compiler has no
    // real arm for a bare `path` value-position call → an UNSUPPORTED
    // marker hard-fails the whole compile (backend error, not just a tsc
    // red). The field's OWN declared type is the disambiguator: `fields`
    // is itself array-typed, so a non-empty array default is legitimately
    // literal data there, never an unresolved expression.
    #[test]
    fn an_operator_shaped_head_on_an_array_typed_field_is_literal_data_not_a_call() {
        let field_name_list = OirValue::Array(vec![
            OirValue::String("path".into()),
            OirValue::String("method".into()),
            OirValue::String("status".into()),
        ]);
        assert!(
            !is_sexpr_call_default(Some(&array_field()), &field_name_list),
            "an array-typed field's array default is literal data, even when \
             its first element happens to share a name with an operator"
        );
        // The SAME shape on a SCALAR-typed field has no such literal-array
        // reading available — still treated as a call form.
        assert!(is_sexpr_call_default(Some(&bool_field()), &field_name_list));
    }

    // The array-typed-field exception is scoped to BARE-word operator
    // heads only — a NAMESPACED head is unambiguous regardless of the
    // field's declared type (std-marketing-campaign `data: (array/map
    // @callsitePayload.data (fn item {…}))`, `data` itself array-typed —
    // regressed by an earlier, too-broad version of this fix that gated
    // ANY array-typed field, not just the bare-word collision tier).
    #[test]
    fn a_namespaced_operator_head_is_always_a_call_even_on_an_array_typed_field() {
        let sexpr = OirValue::Array(vec![
            OirValue::String("array/map".into()),
            OirValue::String("@callsitePayload.data".into()),
        ]);
        assert!(is_sexpr_call_default(Some(&array_field()), &sexpr));
        assert!(is_sexpr_call_default(None, &sexpr));
    }

    // A language-keyword head (`if`/`when`/`cond`/`and`… no — `and` stays
    // in the bare-word tier, see the fn's own doc) on an ARRAY-typed field
    // is ALSO always a call — regressed sweeping the full corpus: PF's
    // role-branched `navItems: (if (= @user.role …) […] […])` is itself
    // array-typed (`NavItem[]`), and an earlier version of this fn only
    // exempted NAMESPACED heads from the array-type gate, so `if` (a bare
    // word) still fell through to "literal data" — std-hr-portal/-lms/
    // -wiki/-healthcare/-fitness-studio all share this exact shape.
    #[test]
    fn a_language_keyword_head_is_always_a_call_even_on_an_array_typed_field() {
        let sexpr = if_sexpr(
            OirValue::String("@user.role".into()),
            OirValue::Array(vec![OirValue::Object(orbital_core_base::ir::OirObject::new())]),
            OirValue::Array(vec![OirValue::Object(orbital_core_base::ir::OirObject::new())]),
        );
        assert!(is_sexpr_call_default(Some(&array_field()), &sexpr));
        assert!(is_sexpr_call_default(None, &sexpr));
    }

    #[test]
    fn collects_every_nested_binding_root() {
        let sexpr = if_sexpr(
            OirValue::String("@user.role".into()),
            OirValue::Array(vec![
                OirValue::String("str/concat".into()),
                OirValue::String("Record ".into()),
                OirValue::String("@item.entityId".into()),
            ]),
            OirValue::String("@config.fallback".into()),
        );
        let mut roots = Vec::new();
        nested_binding_roots(&sexpr, &mut roots);
        roots.sort();
        assert_eq!(roots, vec!["config", "item", "user"]);
    }

    #[test]
    fn hook_scope_allowlist_admits_entity_payload_config_and_pascal_case_but_not_item_or_user() {
        for root in [
            "entity", "payload", "config", "state", "now", "trait", "Ticket",
        ] {
            assert!(
                binding_root_is_hook_scoped(root),
                "{root} must be hook-scoped"
            );
        }
        // `@item`/`@_item` are per-ROW list/grid template bindings resolved
        // by the RENDERER at iteration time, not a single static default
        // computed once in the hook (std-builder descriptionBinding,
        // `(str/concat "Record " @item.entityId)` → bare `item` reference,
        // TS2304, found live fixing item 5). `@user` needs a View's
        // `useUser()`, never declared in a logic hook.
        for root in ["item", "_item", "user", "col"] {
            assert!(
                !binding_root_is_hook_scoped(root),
                "{root} must NOT be hook-scoped"
            );
        }
    }

    fn trait_with_one_bool_config_default(default: OirValue) -> OirTrait {
        let mut tr = OirTrait::new("Widget");
        let mut schema = orbital_core_base::ir::OirConfigSchema::new();
        schema.insert(
            "disabled".to_string(),
            OirConfigFieldType {
                field_type: OirType::Boolean,
                values: None,
            },
        );
        tr.declared_config_schema = Some(schema);
        let mut defaults = orbital_core_base::ir::OirObject::new();
        defaults.insert("disabled".to_string(), default);
        tr.declared_config_defaults = Some(defaults);
        tr
    }

    // C1-E3 item (5): a config default that is an unresolved s-expression
    // must NEVER be typed from the raw AST tuple (the C1-E1 residual —
    // `disabled?: (string|boolean|…)[]` against a `boolean`-typed JSX
    // consumption site, TS2322) — always the trait's own DECLARED type,
    // and always OPTIONAL (DEFAULT_CONFIG cannot hold it as a static
    // value, so nothing guarantees it is populated before a consumer
    // could read it — see emit_sexpr_default_assignments for what does).
    #[test]
    fn an_sexpr_default_types_as_the_declared_type_and_stays_optional() {
        let b = TypeScriptBackend::new();
        let tr = trait_with_one_bool_config_default(if_sexpr(
            OirValue::String("@entity.assignee".into()),
            OirValue::Bool(true),
            OirValue::Bool(false),
        ));
        let block = b.generate_trait_config_block(&tr);
        assert!(
            block.contains("disabled?: boolean;"),
            "must be the declared type, optional:\n{block}"
        );
        assert!(
            !block.contains("disabled:"),
            "must not appear as a REQUIRED member:\n{block}"
        );
        assert!(
            !block.contains("\"if\""),
            "DEFAULT_CONFIG must not hold the raw tuple as a JS value:\n{block}"
        );
    }

    // A resolvable default (only `@entity`/`@payload`/`@config` — no
    // `@callsitePayload`/`@user`) IS compiled and assigned once render-scope
    // bindings are available.
    #[test]
    fn a_resolvable_sexpr_default_is_compiled_into_a_mergedconfig_assignment() {
        let b = TypeScriptBackend::new();
        let tr = trait_with_one_bool_config_default(if_sexpr(
            OirValue::String("@entity.assignee".into()),
            OirValue::Bool(true),
            OirValue::Bool(false),
        ));
        let assignment = b.emit_sexpr_default_assignments(&tr);
        assert!(
            assignment.contains("mergedConfig.disabled = mergedConfig.disabled ?? ("),
            "resolvable default must be compiled+assigned:\n{assignment}"
        );
        assert!(
            assignment.contains("fields?.assignee"),
            "@entity binding must compile to the fields mirror read:\n{assignment}"
        );
    }

    // An UNRESOLVABLE default (nested `@user.*`, which is never declared
    // inside a logic hook) must NOT be compiled — that would emit a
    // reference to an undeclared `user` identifier (TS2304, found live on
    // std-helpdesk InlineTypographyRender25 while fixing item 5).
    #[test]
    fn an_unresolvable_user_binding_default_is_never_assigned() {
        let b = TypeScriptBackend::new();
        let tr = trait_with_one_bool_config_default(if_sexpr(
            OirValue::String("@user.isAdmin".into()),
            OirValue::Bool(true),
            OirValue::Bool(false),
        ));
        let assignment = b.emit_sexpr_default_assignments(&tr);
        assert_eq!(
            assignment, "",
            "an unresolvable default must not be assigned at all:\n{assignment}"
        );
    }
}

#[cfg(test)]
mod tick_reducer_tests {
    use crate::backend::TypeScriptBackend;
    use orbital_core_base::ir::{
        OirEntity, OirField, OirModule, OirPersistence, OirState, OirTrait, OirType,
    };

    // C-TICK-RUNTIME-ENTITY-MIRROR: the TICK reducer must always merge
    // updates into the `fields` mirror (the view renders from it) and must
    // not early-return when the data collection row is absent.
    #[test]
    fn tick_reducer_merges_into_fields_mirror_without_early_return() {
        let mut tr = OirTrait::new("Board");
        tr.linked_entity = Some("Game".to_string());
        tr.states.push(OirState::initial("playing"));

        let mut module = OirModule::new("Mirror", "0.1.0");
        module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Game".to_string(),
            description: None,
            collection: "Game".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });

        let backend = TypeScriptBackend::new();
        let file = backend.generate_trait_logic_hook(&tr, &module);
        let ts = &file.content;

        assert!(
            ts.contains(
                "const tickFields = { ...state.fields, ...action.updates } as Partial<Game>;"
            ),
            "TICK must merge updates into the fields mirror:\n{ts}"
        );
        assert!(
            ts.contains("if (!target) return { ...state, fields: tickFields };"),
            "missing-row path must still commit the fields merge:\n{ts}"
        );
        assert!(
            !ts.contains("if (!target) return state;"),
            "the old early-return (silent tick no-op) must be gone:\n{ts}"
        );
    }
}

#[cfg(test)]
mod optimistic_dispatch_tests {
    use crate::backend::TypeScriptBackend;
    use orbital_core_base::ir::{
        OirBinding, OirEffect, OirEntity, OirExpr, OirField, OirModule, OirPersistence, OirState,
        OirTrait, OirTransition, OirType,
    };

    fn module_with_entity(persistence: OirPersistence) -> OirModule {
        let mut module = OirModule::new("Game", "0.1.0");
        module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Game".to_string(),
            description: None,
            collection: "Game".to_string(),
            persistence,
            fields: vec![
                OirField::new("id", OirType::String),
                OirField::new("x", OirType::Number),
            ],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });
        module
    }

    fn play_trait() -> OirTrait {
        let mut tr = OirTrait::new("Play");
        tr.linked_entity = Some("Game".to_string());
        tr.states.push(OirState::initial("playing"));
        tr.transitions.push(
            // Its own `fetch` is the server work that makes a `[runtime]`
            // trait optimistic (one with none compiles client-only).
            OirTransition::new("playing", "playing", "MOVE").with_effects(vec![
                OirExpr::effect(OirEffect::set(
                    OirBinding::parse("@entity.x").unwrap(),
                    OirExpr::number(1.0),
                )),
                OirExpr::effect(OirEffect::fetch("Game")),
            ]),
        );
        tr
    }

    /// The queued UI-event entry point resolves when THAT event's dispatch
    /// settles, so `useUIEvents` can keep the firing control busy for exactly
    /// its own dispatch (`@almadar/ui` lib/pendingDispatch).
    #[test]
    fn enqueue_event_resolves_when_its_dispatch_settles() {
        let backend = TypeScriptBackend::new();
        let module = module_with_entity(OirPersistence::Runtime);
        let ts = &backend
            .generate_trait_logic_hook(&play_trait(), &module)
            .content;
        for marker in [
            "settle?: () => void",
            "return new Promise<void>((settle) => {",
            "finally { entry.settle?.(); }",
        ] {
            assert!(
                ts.contains(marker),
                "missing settle marker {marker:?}:\n{ts}"
            );
        }
    }

    /// D-2: `@payload` in a view is the payload of the event whose transition rendered it —
    /// a rendering event without a payload never shows an earlier event's.
    #[test]
    fn a_render_reads_only_its_own_events_payload() {
        let backend = TypeScriptBackend::new();
        let module = module_with_entity(OirPersistence::Runtime);
        let ts = &backend
            .generate_trait_logic_hook(&play_trait(), &module)
            .content;
        assert!(
            ts.contains("lastPayload: action.renderBearing ? action.payload : state.lastPayload,"),
            "{ts}"
        );
        assert!(
            !ts.contains("action.payload ?? state.lastPayload"),
            "no carry-over"
        );
    }

    /// D-11: a blocked guard or an undeclared arm on the optimistic client is a benign
    /// rejection (`success: true`, `transitioned: false`, `guard-rejected` /
    /// `no-matching-transition`), as on the server and the JS runtime, never an `EVENT_ERROR`.
    #[test]
    fn a_blocked_optimistic_dispatch_is_a_rejection_not_an_error() {
        let backend = TypeScriptBackend::new();
        let module = module_with_entity(OirPersistence::Runtime);
        let ts = &backend
            .generate_trait_logic_hook(&play_trait(), &module)
            .content;
        let start = ts
            .find("if (_optimistic.newState === undefined) {")
            .expect("the optimistic no-arm branch");
        let branch = &ts[start..ts[start..].find("\n    }\n").map(|e| start + e).unwrap()];
        assert!(
            branch.contains("success: true, transitioned: false"),
            "{branch}"
        );
        assert!(
            branch.contains("'guard-rejected'") && branch.contains("'no-matching-transition'"),
            "{branch}"
        );
        assert!(
            !branch.contains("EVENT_ERROR"),
            "a rejection is not an error:\n{branch}"
        );
    }

    /// T9: a `[runtime]`-linked trait's dispatch commits the transition
    /// LOCALLY first (guard + to-state resolved by the transpiled handler
    /// against the live fields mirror), then POSTs on the ordered pump lane
    /// with a reconcile/rollback continuation. Input must never await the
    /// network (R-COMMAND-DRAIN-AWAIT-INPUT-LAG's compiled-path twin).
    #[test]
    fn runtime_entity_trait_gets_optimistic_dispatch() {
        let backend = TypeScriptBackend::new();
        let module = module_with_entity(OirPersistence::Runtime);
        let ts = &backend
            .generate_trait_logic_hook(&play_trait(), &module)
            .content;

        for marker in [
            "import { createCommandSendPump } from '@almadar/ui/lib';",
            "useReducer, useCallback, useEffect, useRef, useMemo",
            "const commandPump = useMemo(() => createCommandSendPump(), []);",
            "const fieldsRef = useRef<EntityRow>({ ...fields });",
            "const _optimistic = executeTransitionEffects(prevState, event, liveData, payload);",
            "newState: _optimistic.newState,",
            "commandPump.enqueue(async () => {",
            "server state mismatch",
        ] {
            assert!(
                ts.contains(marker),
                "missing optimistic marker {marker:?}:\n{ts}"
            );
        }
        // The local commit must precede the server leg in the emitted body.
        let commit = ts
            .find("machineStateRef.current = _optimistic.newState")
            .unwrap();
        let server_leg = ts.find("commandPump.enqueue").unwrap();
        assert!(
            commit < server_leg,
            "local commit must come before the POST"
        );
        // The transpiled handler must be in resolve_new_state shape.
        assert!(
            ts.contains("return { fields: _fields, newState: _newState, emits: _emits, arm: _arm };"),
            "runtime-linked trait's handler must resolve newState locally:\n{ts}"
        );
    }

    /// T9 scope gate: a persisted-entity trait keeps the server-gated
    /// dispatch byte-for-byte — no pump, no optimistic commit, no fieldsRef.
    /// Awaiting-server window: a persisted trait's awaited dispatch marks
    /// START_EVENT (event + source state) before `await sendEvent` and clears it
    /// in `finally`, so every exit (success, failure, network error) ends it.
    #[test]
    fn persisted_trait_brackets_its_server_round_trip_with_start_and_end_event() {
        let backend = TypeScriptBackend::new();
        let module = module_with_entity(OirPersistence::Persistent);
        let ts = &backend
            .generate_trait_logic_hook(&play_trait(), &module)
            .content;
        let start = ts
            .find("dispatchReducer({ type: 'START_EVENT'")
            .expect("START_EVENT dispatched");
        let send = ts
            .find("const response = await sendEvent(")
            .expect("awaited send");
        let end = ts
            .find("} finally {\n      dispatchReducer({ type: 'END_EVENT' });")
            .expect("END_EVENT in finally");
        assert!(
            start < send && send < end,
            "START_EVENT before the send, END_EVENT after:\n{ts}"
        );
        for marker in [
            "pendingEvent: null",
            "case 'START_EVENT':",
            "case 'END_EVENT':",
            "pendingEvent,",
        ] {
            assert!(ts.contains(marker), "missing {marker:?}");
        }
    }

    #[test]
    fn control_runtime_optimistic_trait_never_marks_start_event() {
        let backend = TypeScriptBackend::new();
        let module = module_with_entity(OirPersistence::Runtime);
        let ts = &backend
            .generate_trait_logic_hook(&play_trait(), &module)
            .content;
        assert!(
            !ts.contains("dispatchReducer({ type: 'START_EVENT'"),
            "optimistic traits paint locally"
        );
    }

    #[test]
    fn persisted_entity_trait_keeps_server_gated_dispatch() {
        let backend = TypeScriptBackend::new();
        let module = module_with_entity(OirPersistence::Persistent);
        let ts = &backend
            .generate_trait_logic_hook(&play_trait(), &module)
            .content;

        for absent in [
            "createCommandSendPump",
            "_optimistic",
            "fieldsRef",
            "useMemo",
            "_newState",
        ] {
            assert!(
                !ts.contains(absent),
                "persisted trait must not contain {absent:?}"
            );
        }
        assert!(
            ts.contains("const response = await sendEvent(event, payload, prevState, { ...internalStateRef.current.fields });"),
            "persisted trait must keep the server-gated dispatch:\n{ts}"
        );
        assert!(
            ts.contains("newState: response.states?.['Play'] || prevState,"),
            "persisted trait's newState must still come from the server:\n{ts}"
        );
    }
}

/// A `[persistent: X, shared]` entity (std-realtime-chat's `ChannelMember`/
/// `ChatMessage`, plus 6 more across the corpus) is BOTH server-backed AND
/// cross-trait-shared. Before this fix, `shared_linked_entity` treated
/// `shared` as implying `[runtime]` unconditionally, routing the trait
/// through `generate_shared_trait_logic_hook` — a client-only stub with no
/// `persist`/`fetch` compilation at all, silently dropping every
/// server-backed effect. Mirrors `@almadar/runtime`'s
/// `OrbitalServerRuntime.sharedFieldKey`/`deferRenderBindings`: persistence
/// always executes; `shared` only decides which field-state frame overlays
/// the fetched data.
#[cfg(test)]
mod persisted_shared_entity_tests {
    use crate::backend::TypeScriptBackend;
    use orbital_core_base::ir::{
        OirBinding, OirEffect, OirEntity, OirExpr, OirField, OirModule, OirPersistOp,
        OirPersistence, OirState, OirTrait, OirTransition, OirType,
    };

    fn module_with_shared_persisted_entity() -> OirModule {
        let mut module = OirModule::new("Chat", "0.1.0");
        module.entities.push(OirEntity {
            shared: true,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "ChannelMember".to_string(),
            description: None,
            collection: "channelmembers".to_string(),
            persistence: OirPersistence::Persistent,
            fields: vec![
                OirField::new("id", OirType::String),
                OirField::new("openChannel", OirType::String),
            ],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });
        module
    }

    /// Mirrors `DirectMessageStarter.TRACK_SELECTION`: a pure scratch
    /// `(set @entity.X)` PLUS a real `(persist update …)` in the SAME
    /// transition — the trait genuinely touches the server, so it must
    /// keep the awaited, server-gated dispatch (not T9-optimistic).
    fn track_selection_trait_with_persist() -> OirTrait {
        let mut tr = OirTrait::new("Starter");
        tr.linked_entity = Some("ChannelMember".to_string());
        tr.states.push(OirState::initial("idle"));
        tr.transitions.push(
            OirTransition::new("idle", "idle", "TRACK_SELECTION").with_effects(vec![
                OirExpr::effect(OirEffect::set(
                    OirBinding::parse("@entity.openChannel").unwrap(),
                    OirExpr::string("c1"),
                )),
                OirExpr::effect(OirEffect::Persist {
                    operation: OirPersistOp::Update,
                    entity_type: "ChannelMember".to_string(),
                    data: OirExpr::object(Default::default()),
                    emit: None,
                }),
            ]),
        );
        tr
    }

    /// Mirrors `ChatComposer.DRAFT_CHANGED`: a pure scratch `(set @entity.X)`
    /// with NO persist/fetch anywhere in the trait, and the header declares
    /// `local` — every keystroke must commit locally first (T9-optimistic),
    /// never await a round trip. Dispatch mode is a pure lookup over
    /// declared facts (`OirTrait::dispatch_mode`), so this flag is what
    /// actually earns `HybridClientOnly` — see
    /// `draft_changed_trait_no_persist_unmarked` for the negative case.
    fn draft_changed_trait_no_persist_local() -> OirTrait {
        let mut tr = OirTrait::new("Composer");
        tr.linked_entity = Some("ChannelMember".to_string());
        tr.local = true;
        tr.states.push(OirState::initial("ready"));
        tr.transitions.push(
            OirTransition::new("ready", "ready", "DRAFT_CHANGED").with_effects(vec![
                OirExpr::effect(OirEffect::set(
                    OirBinding::parse("@entity.openChannel").unwrap(),
                    OirExpr::string("draft text"),
                )),
            ]),
        );
        tr
    }

    /// Same shape as `draft_changed_trait_no_persist_local` but WITHOUT the
    /// `local` header flag. `dispatch_mode` never infers from effects, so
    /// this trait — despite never touching the server — is
    /// `PersistedAwaited`, same as any other persisted trait.
    fn draft_changed_trait_no_persist_unmarked() -> OirTrait {
        let mut tr = draft_changed_trait_no_persist_local();
        tr.local = false;
        tr
    }

    #[test]
    fn hybrid_trait_that_touches_server_keeps_awaited_dispatch_and_gains_overlay() {
        let backend = TypeScriptBackend::new();
        let module = module_with_shared_persisted_entity();
        let ts = &backend
            .generate_trait_logic_hook(&track_selection_trait_with_persist(), &module)
            .content;

        // Must NOT take the client-only shared-hook takeover — that hook
        // never learned to emit persist/fetch effects.
        assert!(
            !ts.contains("[shared]-entity logic hook"),
            "persisted+shared entity must not route through the client-only stub:\n{ts}"
        );
        // Must NOT take T9's optimistic path — a real persist here means a
        // dispatch has to wait for the server's outcome.
        for absent in [
            "createCommandSendPump",
            "_optimistic",
            "commandPump.enqueue",
        ] {
            assert!(
                !ts.contains(absent),
                "a trait with a real persist effect must keep the awaited server-gated path, not T9-optimistic: {absent:?}\n{ts}"
            );
        }
        assert!(
            ts.contains("if (response.success) {"),
            "must gate the commit on the awaited server response:\n{ts}"
        );

        // Must gain the shared-store overlay: read side merges the shared
        // snapshot on top of the fetched/dispatched fields; write side
        // propagates this trait's own `(set @entity.X)` writes back into the
        // shared frame for sibling traits.
        for marker in [
            "useSharedEntityStoreContext",
            "useSharedEntitySnapshot",
            "const _sharedEntityId = 'ChannelMember';",
            "const fields = { ..._initialFields, ..._sharedSnapshot };",
            "mergeEntityFrame",
            "_sharedStore.commit(_sharedEntityId,",
        ] {
            assert!(
                ts.contains(marker),
                "missing shared-overlay marker {marker:?}:\n{ts}"
            );
        }
    }

    /// L-14 (`Almadar_LOLO_Gaps.md`): the awaited server-gated dispatch path
    /// synced `machineStateRef` immediately after a successful dispatch (so
    /// a second dispatch drained from the same queue pass, before React
    /// re-renders, sees the right state) but NOT the fields that same
    /// transition just wrote via `(set @entity.X)` — those only reached
    /// `internalStateRef.current.fields` on the NEXT render. A trait whose
    /// `TRACK_SELECTION`-like transition sets `openChannel`, immediately
    /// followed by a queued `AUTO_OPEN`-like transition whose guard reads
    /// `(not @entity.openChannel)` via `executeTransitionEffects`'s
    /// `internalStateRef.current.fields` snapshot, saw the pre-write value
    /// and refired — this is exactly the `DirectMessageStarter` auto-open
    /// race that stomped a manual channel selection back to empty.
    /// §87: the awaited dispatch of a hybrid `[persistent, shared]` trait
    /// sends the merged frame (own fields + the shared snapshot its siblings
    /// wrote) so the server evaluates against what the client sees, and
    /// merges the server's post-effect `fields` over the local transpile.
    #[test]
    fn awaited_dispatch_sends_shared_frame_and_merges_server_fields() {
        let backend = TypeScriptBackend::new();
        let module = module_with_shared_persisted_entity();
        let ts = &backend
            .generate_trait_logic_hook(&track_selection_trait_with_persist(), &module)
            .content;

        assert!(
            ts.contains("const response = await sendEvent(event, payload, prevState, { ...internalStateRef.current.fields, ..._sharedStore.getSnapshot(_sharedEntityId) });"),
            "hybrid awaited dispatch must send own fields + shared snapshot as the request frame:\n{ts}"
        );
        assert!(
            ts.contains("const _fields: Record<string, EventPayloadValue | undefined> = { ...executeTransitionEffects(prevState, event, payload), ...(response.entityByTrait?.['Starter'] ?? {}) };"),
            "server-computed set results must win over the local transpile:\n{ts}"
        );
    }

    #[test]
    fn awaited_dispatch_syncs_internal_state_ref_fields_immediately() {
        let backend = TypeScriptBackend::new();
        let module = module_with_shared_persisted_entity();
        let ts = &backend
            .generate_trait_logic_hook(&track_selection_trait_with_persist(), &module)
            .content;

        assert!(
            ts.contains(
                "internalStateRef.current = { ...internalStateRef.current, machineState: (response.states?.['Starter'] || prevState) as typeof machineStateRef.current, fields: { ...internalStateRef.current.fields, ..._fields } }"
            ),
            "the awaited dispatch path must sync internalStateRef.current's fields \
             synchronously, the same way it already syncs machineStateRef, so a chained \
             dispatch in the same drainQueue pass reads this transition's writes instead of a \
             stale pre-render snapshot:\n{ts}"
        );
    }

    #[test]
    fn hybrid_trait_marked_local_gets_optimistic_dispatch_and_overlay() {
        let backend = TypeScriptBackend::new();
        let module = module_with_shared_persisted_entity();
        let ts = &backend
            .generate_trait_logic_hook(&draft_changed_trait_no_persist_local(), &module)
            .content;

        // A per-keystroke scratch write on a [persistent, shared] entity
        // must commit locally FIRST (T9), exactly like a [runtime] entity —
        // never await a round trip before the value is visible. Regression
        // guard for the "can't type in the composer" bug: routing this
        // through the awaited server-gated path made every keystroke wait
        // on a network round trip.
        for marker in [
            "createCommandSendPump",
            "const _optimistic = executeTransitionEffects(prevState, event, liveData, payload);",
        ] {
            assert!(
                ts.contains(marker),
                "missing T9-optimistic marker {marker:?}:\n{ts}"
            );
        }
        assert!(
            !ts.contains("[shared]-entity logic hook"),
            "must not route through the client-only stub either:\n{ts}"
        );
        // No transition on this trait touches the server (no persist/fetch
        // anywhere), and the scratch field is never persisted, so the
        // server can never correctly evaluate a guard reading it (stateless
        // per request — it has no memory of a prior `(set @entity.X)`).
        // The background reconcile POST must NOT run here: regression
        // guard for "message sends, then un-sends itself a moment later"
        // (the server's stale/default view of the scratch field looked
        // like a guard rejection and rolled the optimistic commit back).
        assert!(
            !ts.contains("commandPump.enqueue(async () => {"),
            "a trait whose transitions never touch the server must skip the background reconcile POST:\n{ts}"
        );

        // Still gains the shared overlay, on BOTH the read side (merged
        // into `fields`) and the write side (committed synchronously at
        // the optimistic commit, not deferred to the background POST).
        for marker in [
            "useSharedEntityStoreContext",
            "useSharedEntitySnapshot",
            "const fields = { ..._initialFields, ..._sharedSnapshot };",
            "_sharedStore.commit(_sharedEntityId,",
        ] {
            assert!(
                ts.contains(marker),
                "missing shared-overlay marker {marker:?}:\n{ts}"
            );
        }
        // The shared-store commit for the optimistic path must read from
        // `_optimistic.fields` (the locally-resolved write), not `_fields`
        // (the server-gated path's variable — absent here entirely).
        assert!(
            ts.contains("Object.entries(_optimistic.fields)"),
            "optimistic path's shared commit must source from _optimistic.fields:\n{ts}"
        );
    }

    /// Negative case for the fix above: `dispatch_mode` is a pure lookup
    /// over declared facts, never inferred from a trait's own effects — an
    /// author who forgets to declare `local` on an otherwise-identical
    /// hybrid `[persistent, shared]` trait (never touches the server) now
    /// gets ordinary `PersistedAwaited` dispatch, not T9-optimistic.
    #[test]
    fn hybrid_trait_without_local_flag_is_server_gated() {
        let backend = TypeScriptBackend::new();
        let module = module_with_shared_persisted_entity();
        let ts = &backend
            .generate_trait_logic_hook(&draft_changed_trait_no_persist_unmarked(), &module)
            .content;

        for absent in [
            "createCommandSendPump",
            "_optimistic",
            "commandPump.enqueue",
        ] {
            assert!(
                !ts.contains(absent),
                "an un-marked hybrid trait must not get T9-optimistic dispatch just because \
                 its entity is [persistent, shared] with no server-touching transition: \
                 {absent:?}\n{ts}"
            );
        }
        assert!(
            ts.contains("if (response.success) {"),
            "must gate the commit on the awaited server response, same as any other \
             persisted trait:\n{ts}"
        );
        // Still gains the shared overlay — `local` only gates DISPATCH
        // strategy, not whether the entity's shared frame is read/written.
        assert!(
            ts.contains("useSharedEntitySnapshot"),
            "an un-marked hybrid trait on a [shared] entity still gets the overlay:\n{ts}"
        );
    }

    /// §84 (`Almadar_Compiler_Gaps.md`): a hybrid `[persistent, shared]`
    /// trait with no server-touching transition (same shape as
    /// `draft_changed_trait_no_persist_local` above) that ALSO `emit`s a
    /// cross-trait event a SIBLING reaches only via `listens {
    /// Source.EVENT -> LocalTrigger }` — the dominant `.lolo` cascade
    /// idiom, where the sibling's own local trigger name (`INIT`) differs
    /// from the emitted event name (`CHANNEL_SELECTED`) — must relay the
    /// emit to the sibling's qualified subscription key. Before this fix,
    /// `emit_fanout` was hardcoded `false` for the WHOLE T9 optimistic
    /// path (conflating it with the genuine `[runtime]`-linked sub-case,
    /// which DOES get a server echo), so this class of trait silently
    /// dropped every declared cross-trait emit — no server round trip
    /// ever happens here to relay it another way. This is the exact shape
    /// that dropped `ChatComposer.CHANNEL_SELECTED` on the compiled path.
    #[test]
    fn hybrid_trait_with_no_server_effect_relays_emit_to_listens_remap_sibling() {
        use orbital_core_base::ir::OirListener;

        let backend = TypeScriptBackend::new();
        let mut module = module_with_shared_persisted_entity();

        let mut composer = OirTrait::new("Composer");
        composer.orbital_name = "Chat".to_string();
        composer.linked_entity = Some("ChannelMember".to_string());
        composer.local = true;
        composer.states.push(OirState::initial("ready"));
        composer.transitions.push(
            OirTransition::new("ready", "ready", "SELECT_CHANNEL").with_effects(vec![
                OirExpr::effect(OirEffect::set(
                    OirBinding::parse("@entity.openChannel").unwrap(),
                    OirExpr::string("c1"),
                )),
                OirExpr::effect(OirEffect::emit_with_payload(
                    "CHANNEL_SELECTED",
                    OirExpr::string("c1"),
                )),
            ]),
        );
        module.traits.push(composer.clone());

        let mut thread = OirTrait::new("Thread");
        thread.orbital_name = "Chat".to_string();
        thread.linked_entity = Some("ChannelMember".to_string());
        thread.states.push(OirState::initial("browsing"));
        thread
            .transitions
            .push(OirTransition::new("browsing", "browsing", "INIT"));
        let mut listener = OirListener::new("CHANNEL_SELECTED", "INIT");
        listener.source_trait = Some("Composer".to_string());
        thread.listeners.push(listener);
        module.traits.push(thread);

        let ts = &backend
            .generate_trait_logic_hook(&composer, &module)
            .content;

        assert!(
            ts.contains("eventBus.emit('CHANNEL_SELECTED'"),
            "the original bare emit must stay unchanged:\n{ts}"
        );
        assert!(
            ts.contains("emitCascadeEvent(eventBus, 'Chat', 'Composer', { event: 'CHANNEL_SELECTED', payload: "),
            "a client-only emit must publish the source-qualified key its listens edges subscribe to:\n{ts}"
        );
        assert!(
            ts.contains(
                "import { emitCascadeEvent, useOrbitalBridge } from '@/hooks/useOrbitalBridge';"
            ),
            "the hook must import the shared cascade it calls:\n{ts}"
        );
        assert!(
            !ts.contains("eventBus.emit('UI:Chat.Thread.CHANNEL_SELECTED'"),
            "no destination-scoped relay for a listens edge — its subscription is source-keyed:\n{ts}"
        );
    }

    #[test]
    fn plain_persisted_entity_has_no_shared_overlay() {
        let backend = TypeScriptBackend::new();
        let mut module = OirModule::new("Chat", "0.1.0");
        module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "ChannelMember".to_string(),
            description: None,
            collection: "channelmembers".to_string(),
            persistence: OirPersistence::Persistent,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });
        let ts = &backend
            .generate_trait_logic_hook(&track_selection_trait_with_persist(), &module)
            .content;
        for absent in [
            "useSharedEntityStoreContext",
            "useSharedEntitySnapshot",
            "_sharedStore",
        ] {
            assert!(
                !ts.contains(absent),
                "non-shared persisted trait must not gain the overlay: {absent:?}"
            );
        }
    }
}

#[cfg(test)]
mod shared_frame_commit_tests {
    use super::shared_frame_commit;

    /// The optimistic leg (4-space indent, `_optimistic.fields`) and the
    /// awaited leg (8-space indent, `_fields`) must emit byte-identical
    /// structure modulo indent and source expression — pin the shared
    /// helper directly rather than re-deriving the block at each call site.
    #[test]
    fn identical_modulo_indent_and_source() {
        let optimistic = shared_frame_commit("    ", "_optimistic.fields");
        let awaited = shared_frame_commit("        ", "_fields");

        let strip = |block: &str, source: &str| -> Vec<String> {
            block
                .lines()
                .map(|line| line.trim_start().replace(source, "_SOURCE_"))
                .collect()
        };
        assert_eq!(
            strip(&optimistic, "_optimistic.fields"),
            strip(&awaited, "_fields"),
            "shared_frame_commit must produce the same shape regardless of indent/source:\n{optimistic}\n---\n{awaited}"
        );
        assert!(optimistic.contains("    const _sharedWrites"));
        assert!(awaited.contains("        const _sharedWrites"));
    }
}

#[cfg(test)]
mod message_hook_tests {
    use crate::backend::TypeScriptBackend;
    use orbital_core_base::ir::{OirConfigFieldType, OirModule, OirState, OirTrait, OirType, OirValue};

    fn trait_with_string_default(default: OirValue) -> OirTrait {
        let mut tr = OirTrait::new("Footer");
        tr.states.push(OirState::initial("idle"));
        let mut schema = orbital_core_base::ir::OirConfigSchema::new();
        schema.insert(
            "tagline".to_string(),
            OirConfigFieldType {
                field_type: OirType::String,
                values: None,
            },
        );
        tr.declared_config_schema = Some(schema);
        tr.declared_config_defaults = Some(orbital_core_base::ir::OirObject::from([(
            "tagline".to_string(),
            default,
        )]));
        tr
    }

    fn hook(tr: &OirTrait) -> String {
        TypeScriptBackend::new()
            .generate_trait_logic_hook(tr, &OirModule::new("App", "1.0.0"))
            .content
    }

    #[test]
    fn a_config_default_calling_i18n_t_brings_translate_into_the_hook() {
        let ts = hook(&trait_with_string_default(OirValue::Array(vec![
            OirValue::String("i18n/t".into()),
            OirValue::String("chrome:footer.tagline".into()),
        ])));
        assert!(ts.contains("__t(\"chrome:footer.tagline\")"), "{ts}");
        assert!(
            ts.contains("import { useTranslate } from '@almadar/ui/hooks';"),
            "{ts}"
        );
        let prelude = ts
            .find("const { t: __t, locale: __locale } = useTranslate();")
            .expect("prelude");
        let use_site = ts.find("__t(\"chrome:footer.tagline\")").unwrap();
        assert!(
            prelude < use_site,
            "translate must be in scope before the default is evaluated"
        );
    }

    #[test]
    fn control_a_literal_default_needs_no_translate() {
        let ts = hook(&trait_with_string_default(OirValue::String("Hello".into())));
        assert!(!ts.contains("useTranslate"), "{ts}");
    }
}

fn collect_entity_refs(
    oir_type: &orbital_core_base::ir::OirType,
    out: &mut std::collections::BTreeSet<String>,
) {
    use orbital_core_base::ir::OirType;
    match oir_type {
        OirType::Reference { entity } | OirType::Row { entity } => {
            out.insert(entity.clone());
        }
        OirType::Array { inner } | OirType::Optional { inner } => collect_entity_refs(inner, out),
        OirType::Map { key, value } => {
            collect_entity_refs(key, out);
            collect_entity_refs(value, out);
        }
        OirType::Tuple { items } => items.iter().for_each(|t| collect_entity_refs(t, out)),
        OirType::Struct { fields } => fields
            .iter()
            .for_each(|f| collect_entity_refs(&f.field_type, out)),
        OirType::Union { variants } => variants
            .iter()
            .for_each(|v| collect_entity_refs(&v.field_type, out)),
        _ => {}
    }
}

#[cfg(test)]
mod referenced_entity_import_tests {
    use crate::TypeScriptBackend;
    use orbital_core_base::ir::{
        OirEntity, OirField, OirModule, OirState, OirTrait, OirTransition, OirType,
    };

    fn hook(field_type: OirType) -> String {
        let mut tr = OirTrait::new("OriginsSection");
        tr.orbital_name = "Sdk".to_string();
        tr.linked_entity = Some("OriginsView".to_string());
        tr.states.push(OirState::initial("ready"));
        tr.transitions
            .push(OirTransition::new("ready", "ready", "ADD"));
        let mut view = OirEntity::new("OriginsView");
        view.fields.push(OirField::new("origins", field_type));
        let mut module = OirModule::new("Sdk", "1.0.0");
        module.entities.push(view);
        module.entities.push(OirEntity::new("SdkENAllowedOrigin"));
        module.traits.push(tr.clone());
        TypeScriptBackend::new()
            .generate_trait_logic_hook(&tr, &module)
            .content
    }

    /// G-ORB-189(d): a relation-list field's element entity is cast by name in guards
    /// (`as readonly SdkENAllowedOrigin[]`), so the hook imports it.
    #[test]
    fn a_relation_list_field_imports_its_element_entity() {
        let ts = hook(OirType::array(OirType::Reference {
            entity: "SdkENAllowedOrigin".into(),
        }));
        let import = ts
            .lines()
            .find(|l| l.ends_with("from '@app/shared';"))
            .unwrap_or_default()
            .to_string();
        assert!(import.contains("SdkENAllowedOrigin"), "{import}");
    }

    #[test]
    fn control_a_scalar_list_imports_no_entity() {
        let ts = hook(OirType::array(OirType::String));
        let import = ts
            .lines()
            .find(|l| l.ends_with("from '@app/shared';"))
            .unwrap_or_default()
            .to_string();
        assert!(!import.contains("SdkENAllowedOrigin"), "{import}");
    }
}

#[cfg(test)]
mod aliased_entity_type_position_tests {
    use crate::TypeScriptBackend;
    use orbital_core_base::ir::{OirEntity, OirModule, OirState, OirTrait, OirTransition};

    /// An entity imported under its `<Name>Entity` alias (a global like `Response`, or a
    /// `<Trait>View`-suffixed name) must be named by that alias in every type position —
    /// the `SET_FIELD` action's `keyof` named it bare (TS2304, 929× on orb.almadar.io).
    #[test]
    fn set_field_names_an_aliased_entity_by_its_alias() {
        for (entity, alias) in [
            ("Response", "ResponseEntity"),
            ("OrbHomeView", "OrbHomeViewEntity"),
        ] {
            let mut tr = OirTrait::new("Panel");
            tr.orbital_name = "Orb".to_string();
            tr.linked_entity = Some(entity.to_string());
            tr.states.push(OirState::initial("idle"));
            tr.transitions
                .push(OirTransition::new("idle", "idle", "GO"));
            let mut module = OirModule::new("Orb", "1.0.0");
            module.entities.push(OirEntity::new(entity));
            module.traits.push(tr.clone());
            let ts = TypeScriptBackend::new()
                .generate_trait_logic_hook(&tr, &module)
                .content;
            assert!(
                ts.contains(&format!("field: keyof {alias} & string")),
                "{entity}:\n{ts}"
            );
            assert!(
                !ts.contains(&format!("keyof {entity} & string")),
                "{entity}"
            );
        }
    }
}

impl TypeScriptBackend {
    /// The trait's declared `(from, event)` arms as a TS literal — `'*'` for an any-state arm —
    /// so a dispatch that took no arm reports `guard-rejected` vs `no-matching-transition`.
    fn declared_arms_literal(trait_def: &OirTrait) -> String {
        use orbital_core_base::ir::OirTransitionFrom;
        let quote = |s: &str| serde_json::to_string(s).expect("a name serializes");
        let arms: Vec<String> = trait_def
            .transitions
            .iter()
            .map(|t| {
                let from = match &t.from {
                    OirTransitionFrom::Any => "'*'".to_string(),
                    OirTransitionFrom::Single(s) => format!("[{}]", quote(s)),
                    OirTransitionFrom::Multiple(states) => format!(
                        "[{}]",
                        states
                            .iter()
                            .map(|s| quote(s))
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                };
                format!("[{from}, {}]", quote(&t.event))
            })
            .collect();
        format!(
            "([{}] as ReadonlyArray<readonly [ReadonlyArray<string> | '*', string]>)",
            arms.join(", ")
        )
    }
}

#[cfg(test)]
mod guard_holds_client_tests {
    use crate::backend::TypeScriptBackend;
    use orbital_core_base::ir::{
        OirBinding, OirEffect, OirEvent, OirExpr, OirModule, OirState, OirTrait, OirTransition,
    };

    fn hook(guarded: bool) -> String {
        let mut trait_def = OirTrait::new("Composer");
        trait_def.states.push(OirState::initial("ready"));
        let mut t = OirTransition::new("ready", "sent", "SEND");
        t.effects
            .push(OirExpr::effect(OirEffect::navigate(OirExpr::string(
                "/sent",
            ))));
        if guarded {
            t.guard = Some(OirExpr::binding(OirBinding::entity(vec!["ok".to_string()])));
        }
        trait_def.transitions.push(t);
        trait_def.events.push(OirEvent::new("SEND"));
        let mut module = OirModule::new("GuardHolds", "0.1.0");
        module.traits.push(trait_def.clone());
        TypeScriptBackend::new()
            .generate_trait_logic_hook(&trait_def, &module)
            .content
    }

    /// The generated client applies the same rule as the server and the JS runtime: a guard
    /// that throws blocks its arm like a false guard (D-7, `@almadar/core` `guardHolds`).
    #[test]
    fn a_client_guard_runs_through_guard_holds() {
        let ts = hook(true);
        assert!(
            ts.contains("guardHolds(() =>"),
            "client guards must run through guardHolds:\n{ts}"
        );
        assert!(
            ts.lines().any(|l| l.starts_with("import")
                && l.contains("guardHolds")
                && l.contains("@almadar/core")),
            "guardHolds must be imported from @almadar/core:\n{ts}"
        );
    }

    #[test]
    fn control_a_trait_without_guards_does_not_import_guard_holds() {
        assert!(!hook(false).contains("guardHolds"));
    }
}
