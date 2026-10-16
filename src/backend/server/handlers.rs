use crate::backend::*;
use crate::codegen::operator_names::is_substrate_operator;

/// Resolve every event key to its server handler function name in ONE place so
/// the switch dispatcher and the handler definitions always agree.
///
/// Naming is `handle{Pascal(key)}` via `to_identifier_pascal` (every
/// non-alphanumeric char is a separator, so a key that is not identifier-safe —
/// e.g. an unbound `@config.<knob>` outlet — still yields a valid function
/// name), with two rules layered on top:
///   - **Sharing (GAP-COMP-13):** event keys that Pascal-case to the same name
///     (e.g. UPPER_SNAKE `MEMORIZED` and PascalCase `Memorized` → `handleMemorized`)
///     share ONE handler — the switch routes both case labels to it.
///   - **Reserved-name avoidance:** the trait dispatcher is itself `handleEvent(c)`,
///     so a per-event handler whose base name would be `handleEvent` (an event
///     keyed `EVENT`, e.g. a configurable emit outlet named `event`) must not
///     shadow it. It's disambiguated by the canonical "append the next free
///     index" rule used throughout codegen — no per-name special-casing.
fn resolve_event_handler_names(events: &[OirEvent]) -> std::collections::HashMap<String, String> {
    // Top-level symbols in the handler module a per-event handler must not shadow.
    let reserved = ["handleEvent"];
    let mut assigned: std::collections::HashSet<String> =
        reserved.iter().map(|s| s.to_string()).collect();
    let mut base_to_resolved: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut out: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for ev in events {
        let base = format!("handle{}", to_identifier_pascal(&ev.key));
        let resolved = if let Some(r) = base_to_resolved.get(&base) {
            r.clone()
        } else {
            let mut name = base.clone();
            let mut n = 2;
            while assigned.contains(&name) {
                name = format!("{}{}", base, n);
                n += 1;
            }
            assigned.insert(name.clone());
            base_to_resolved.insert(base.clone(), name.clone());
            name
        };
        out.insert(ev.key.clone(), resolved);
    }
    out
}

/// Placeholder standing in for the entity-access import lines until the handler
/// body has been emitted and we can see which symbols it actually uses.
pub(crate) const ACCESS_IMPORT_MARKER: &str = "//__ALMADAR_ACCESS_IMPORTS__\n";

/// Replace the marker with imports for exactly the helpers and policy consts
/// the emitted body references — or with nothing at all.
///
/// Narrowing matters beyond tidiness: the policy set is module-wide, but most
/// handlers touch one entity or none, so importing all of them would leave
/// unused symbols in almost every generated file and fail the emitted app's
/// own lint gate.
pub(crate) fn resolve_access_imports(code: String, entities: &[OirEntity]) -> String {
    if !code.contains(ACCESS_IMPORT_MARKER) {
        return code;
    }
    let body = code.replace(ACCESS_IMPORT_MARKER, "");

    let mut helpers: Vec<&str> = Vec::new();
    if body.contains("applyRowAccess(") {
        helpers.push("applyRowAccess");
    }
    if body.contains("checkMutationAccess(") {
        helpers.push("checkMutationAccess");
    }
    if body.contains("rowAccess(") {
        helpers.push("rowAccess");
    }

    let consts: Vec<String> = crate::backend::server::access_policies::declared_policies(entities)
        .into_iter()
        .map(|(entity, op)| crate::backend::server::access_policies::policy_const_name(&entity, op))
        .filter(|name| body.contains(name.as_str()))
        .collect();

    let pushdown: Vec<&str> = crate::backend::server::pushdown::PUSHDOWN_HELPERS
        .iter()
        .copied()
        .filter(|name| body.contains(&format!("{name}(")) || body.contains(&format!("{name}<")))
        .collect();

    let orders_rows = body.contains("orderRows(");
    if helpers.is_empty() && consts.is_empty() && pushdown.is_empty() && !orders_rows {
        return body;
    }
    let mut imports = String::new();
    if orders_rows {
        imports.push_str("import { orderRows } from '@almadar/core';\n");
    }
    if !pushdown.is_empty() {
        imports.push_str(&format!(
            "import {{ {} }} from '@almadar/db/pushdown';\n",
            pushdown.join(", ")
        ));
    }
    if !helpers.is_empty() {
        imports.push_str(&format!(
            "import {{ {} }} from '@almadar/evaluator/entityAccess';\n",
            helpers.join(", ")
        ));
    }
    if !consts.is_empty() {
        imports.push_str(&format!(
            "import {{ {} }} from '../../../access-policies.js';\n",
            consts.join(", ")
        ));
    }
    code.replace(ACCESS_IMPORT_MARKER, &imports)
}

impl TypeScriptBackend {
    /// Walk every expression and effect inside a trait, collecting the
    /// full names of substrate operators referenced (e.g. `llm/generate`,
    /// `memory/recall`, `trace/emit`). Used by the handler-file generator
    /// to decide which service accessors to import.
    pub(crate) fn collect_substrate_operators(
        &self,
        trait_def: &OirTrait,
    ) -> std::collections::BTreeSet<String> {
        let mut ops: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        let mut stack: Vec<&OirExpr> = Vec::new();

        for trans in &trait_def.transitions {
            if let Some(g) = &trans.guard {
                stack.push(g);
            }
            for e in &trans.effects {
                stack.push(e);
            }
        }

        while let Some(expr) = stack.pop() {
            match expr {
                OirExpr::Effect { effect } => match effect.as_ref() {
                    OirEffect::Custom { name, args, .. } => {
                        if is_substrate_operator(name) {
                            ops.insert(name.clone());
                        }
                        for v in args.values() {
                            stack.push(v);
                        }
                    }
                    OirEffect::Set { value, .. } => stack.push(value),
                    OirEffect::SetDynamic { target, value, .. } => {
                        stack.push(target);
                        stack.push(value);
                    }
                    OirEffect::Emit {
                        payload: Some(p), ..
                    } => stack.push(p),
                    OirEffect::Fetch {
                        id,
                        filter,
                        order_by,
                        offset,
                        limit,
                        ..
                    } => {
                        stack.extend([id, filter, order_by, offset, limit].into_iter().flatten());
                    }
                    OirEffect::Persist { data, .. } => stack.push(data),
                    OirEffect::PersistBatch { ops, .. } => stack.push(ops),
                    OirEffect::Ref {
                        id,
                        filter,
                        order_by,
                        limit,
                        ..
                    } => {
                        stack.extend([id, filter, order_by, limit].into_iter().flatten());
                    }
                    OirEffect::Deref { id: Some(e), .. } => stack.push(e),
                    OirEffect::Swap { id, transform, .. } => {
                        stack.push(id);
                        stack.push(transform);
                    }
                    OirEffect::Watch { effects, .. } => {
                        for e in effects {
                            stack.push(e);
                        }
                    }
                    OirEffect::Atomic { effects } => {
                        for e in effects {
                            stack.push(e);
                        }
                    }
                    OirEffect::Navigate {
                        path,
                        params,
                        crumb,
                    } => {
                        stack.push(path);
                        if let Some(p) = params {
                            stack.push(p);
                        }
                        if let Some(c) = crumb {
                            stack.push(c);
                        }
                    }
                    OirEffect::CallService { args, key, .. } => {
                        stack.push(args);
                        stack.extend(key);
                    }
                    OirEffect::Http {
                        origin,
                        path,
                        request,
                        key,
                        ..
                    } => {
                        stack.push(origin);
                        stack.push(path);
                        stack.extend(request);
                        stack.extend(key);
                    }
                    OirEffect::Os { args, key, .. } => {
                        stack.extend(args);
                        stack.extend(key);
                    }
                    OirEffect::CancelCall { key } => stack.push(key),
                    OirEffect::RandomBytes { bytes: expr, .. }
                    | OirEffect::CredentialStatus {
                        credential: expr, ..
                    }
                    | OirEffect::CredentialForget {
                        credential: expr, ..
                    }
                    | OirEffect::OAuthConnectionStatus { provider: expr, .. }
                    | OirEffect::OAuthConnectionForget { provider: expr, .. } => stack.push(expr),
                    OirEffect::OAuthAuthorize { client, options, key, .. } => {
                        stack.push(client);
                        stack.push(options);
                        stack.extend(key);
                    }
                    OirEffect::Spawn { props, .. } => stack.push(props),
                    OirEffect::Despawn { entity_id } => stack.push(entity_id),
                    OirEffect::Log { message, .. } => stack.push(message),
                    _ => {}
                },
                OirExpr::Array { items } => {
                    for i in items {
                        stack.push(i);
                    }
                }
                OirExpr::Object { fields } => {
                    for v in fields.values() {
                        stack.push(v);
                    }
                }
                OirExpr::BinaryOp { left, right, .. } => {
                    stack.push(left);
                    stack.push(right);
                }
                OirExpr::UnaryOp { operand, .. } => stack.push(operand),
                OirExpr::Conditional {
                    condition,
                    then_branch,
                    else_branch,
                } => {
                    stack.push(condition);
                    stack.push(then_branch);
                    stack.push(else_branch);
                }
                OirExpr::Call { function, args } => {
                    if is_substrate_operator(function) {
                        ops.insert(function.clone());
                    }
                    for a in args {
                        stack.push(a);
                    }
                }
                OirExpr::Map { source, body, .. } => {
                    stack.push(source);
                    stack.push(body);
                }
                OirExpr::Filter {
                    source, predicate, ..
                } => {
                    stack.push(source);
                    stack.push(predicate);
                }
                OirExpr::Reduce {
                    source,
                    initial,
                    body,
                    ..
                } => {
                    stack.push(source);
                    stack.push(initial);
                    stack.push(body);
                }
                _ => {}
            }
        }

        ops
    }

    /// Generate the main event handler file for a trait
    pub(crate) fn generate_trait_event_handler_file(
        &self,
        trait_def: &OirTrait,
        module: &OirModule,
        folder_name: &str,
    ) -> InternalFile {
        let trait_name = &trait_def.name;

        let mut code = String::new();

        // Header
        code.push_str(&format!("/**\n * {} Event Handlers\n *\n", trait_name));
        code.push_str(" * Server-side event handlers with guard enforcement.\n");
        code.push_str(" * All data operations flow through these handlers.\n");
        code.push_str(" *\n * @generated by Orbital Compiler\n");
        code.push_str(" * @packageDocumentation\n */\n\n");

        // Imports
        code.push_str("import type { Request, Response, NextFunction } from 'express';\n");

        // Check if trait has any emit effects (standalone `emit` or
        // V2 data-op emit config on fetch/persist/call-service/ref).
        let has_emit_effects = crate::codegen::handler_header::trait_has_emit_effects(trait_def);

        // Live-push (Almadar_Live_Push.md): a persist effect's `emit:{success}`
        // envelope broadcasts cross-client over SSE. Gates the
        // `broadcastBusEvent` import below.
        let has_persist_success_emit =
            crate::codegen::handler_header::trait_has_persist_success_emit(trait_def);

        // Shared helpers — see `codegen/handler_header.rs` for the DRY
        // decomposition (Phase 3e.7). Detection + entity collection lives
        // there and is called from both backends.
        let has_call_service_effects =
            crate::codegen::handler_header::has_call_service_effects(trait_def);

        // Detect [runtime]-entity linkage so we can pull `getRuntimeEntity`
        // for the long-lived per-trait scalar-state map. See backend.rs's
        // entity-binding step in `generate_event_handler_function`.
        let needs_runtime_entity_store = trait_def.linked_entity.as_ref().is_some_and(|name| {
            module
                .entities
                .iter()
                .any(|e| &e.name == name && matches!(e.persistence, OirPersistence::Runtime))
        });

        let mut server_imports: Vec<&str> = vec![
            "getDataService",
            "logger",
            "createLogger as createServerLogger",
        ];
        if has_emit_effects {
            server_imports.push("getServerEventBus");
        }
        if needs_runtime_entity_store {
            server_imports.push("getRuntimeEntity");
        }
        code.push_str(&format!(
            "import {{ {} }} from '@almadar/server';\n",
            server_imports.join(", "),
        ));
        // Pre-instantiate a namespaced logger for the persist/emit hot path so
        // the verifier's `[almadar:*]` capture filter (server-lifecycle.ts)
        // picks up persist:dispatch / persist:resolve-id / persist:store-mutate /
        // persist:noop-no-id / emit:push log lines emitted by the persist codegen.
        // A single instance per handler file matches the convention used in
        // DataService.ts (`almadar:server:data`) and authenticateFirebase.ts
        // (`almadar:server:auth`). Aliased on import because handlers also
        // import `createLogger` from `@almadar/logger` for the bus-trace
        // logger; both share a name but come from different packages.
        code.push_str("const effectsLog = createServerLogger('almadar:server:effects');\n");
        // EventPayload + EventPayloadValue imported here so the call-service
        // emit chain can cast `serviceResult` (from `callService` which
        // returns `Promise<unknown>`) into the typed `payload`/`data` slots.
        // Bus emits expect EventPayload; ServerEffectResult.data expects the
        // single-value EventPayloadValue (which includes Date — distinct
        // from EventPayload). FieldValue gets imported because per-event
        // narrowed payload types lower object/Json fields to
        // `Record<string, FieldValue | undefined>` (mirrors entities.ts's
        // emit). SExpr backs the §A7 client-effect-tuple pattern-config cast
        // when a render-ui effect carries a live `@`-binding. All cheap to
        // import even when unused.
        let mut core_symbols: std::collections::BTreeSet<&str> = [
            "EntityRow",
            "EventPayload",
            "EventPayloadValue",
            "FieldValue",
        ]
        .into_iter()
        .collect();
        if crate::codegen::handler_header::trait_needs_sexpr_import(trait_def) {
            core_symbols.insert("SExpr");
        }
        let reads_dispatch = crate::codegen::effect::shared::trait_reads_dispatch_scope(trait_def);
        if reads_dispatch {
            core_symbols.insert("DispatchScope");
        }
        code.push_str(&crate::codegen::handler_header::core_imports_clause(
            &core_symbols,
        ));
        code.push_str("import type { EventRequest, EventResponse, ServerEffectResult, EmittedEvent, ClientEffectTuple, UserContext } from '@app/shared';\n");
        code.push_str("import { viewerOf } from '../../../viewer.js';\n");
        // `resolveEntityView`/`omitFrameFields` back the §87/§88 `@entity`
        // frame binding and auto-persist strip (`handler_header::
        // entity_frame_binding`) — the same `@almadar/core` primitives the
        // JS interpreter uses, so a handler file with no linked entity
        // simply never calls them (cheap to import even when unused, see
        // above).
        let mut core_values: std::collections::BTreeSet<&str> =
            ["resolveEntityView", "omitFrameFields", "guardHolds"]
                .into_iter()
                .collect();
        if reads_dispatch {
            core_values.insert("dispatchScopeOf");
        }
        code.push_str(&crate::codegen::handler_header::core_value_imports_clause(
            &core_values,
        ));
        code.push_str(&self.language_trio_core_import(trait_def));
        // `getNestedValue` backs `object/get` / `str/template`'s dot-path
        // codegen (`codegen/operator.rs`) wherever a transition's guard or
        // effect reads a nested field — inlined (not imported) per
        // `GET_NESTED_VALUE_DECL`'s doc; cheap to declare even on a handler
        // file that happens not to use either operator (`noUnusedLocals` is
        // off in the emitted server tsconfig).
        code.push_str(crate::codegen::handler_header::GET_NESTED_VALUE_DECL);
        let sse_imports: Vec<&str> = [
            has_persist_success_emit.then_some("broadcastBusEvent"),
            crate::codegen::handler_header::trait_has_call_service_message(trait_def)
                .then_some("pushToOrigin"),
        ]
        .into_iter()
        .flatten()
        .collect();
        if !sse_imports.is_empty() {
            code.push_str(&format!(
                "import {{ {} }} from '../../../sse.js';\n",
                sse_imports.join(", ")
            ));
        }
        if !super::ticks::server_ticks(trait_def, module).is_empty() {
            code.push_str("import { recordMount } from '../../../mounts.js';\n");
        }

        // Row-level entity access. A marker here, resolved at the end of this
        // function once the body exists — only the helpers and policy consts the
        // emitted handlers actually reference get imported, so a trait that
        // touches no policied entity gets no import (and no unused-symbol lint).
        code.push_str(ACCESS_IMPORT_MARKER);

        // Import service handler when call-service effects are used
        if has_call_service_effects {
            code.push_str("import { callService } from '../../../services/clients.js';\n");
        }
        if let Some(http_import) = crate::codegen::handler_header::http_call_import(
            trait_def,
            "../../../services/clients.js",
        ) {
            code.push_str(&http_import);
        }
        if let Some(host_import) = crate::codegen::handler_header::service_host_import(
            trait_def,
            "../../../services/host.js",
        ) {
            code.push_str(&host_import);
        }

        // Entity-type collection shared with the Hono backend — see
        // `codegen/handler_header::collect_effect_entity_types`.
        // Collision names (`Response`, `Request`, ...) are imported under a
        // `<Name>Entity` alias so they don't clash with the express imports
        // emitted above. All type-position uses of those entity names in
        // this file go through `entity_type_ref` to pick up the alias.
        {
            let entity_types =
                crate::codegen::handler_header::collect_effect_entity_types(trait_def, module);
            if !entity_types.is_empty() {
                let types_str =
                    crate::codegen::handler_header::aliased_shared_imports_clause(&entity_types);
                code.push_str(&format!(
                    "import type {{ {} }} from '@app/shared';\n",
                    types_str
                ));
            }
        }
        if self.dev_logs {
            code.push_str("import { createLogger } from '@almadar/logger';\n");
        }

        // Substrate imports — two sources:
        // - getLLMClient: from generated substrate-config.ts (self-contained)
        // - getSubstrateService: from @almadar/server-hono (owned by @almadar/server)
        // getDataService (for memory/*) and effectsLog (for trace/*) are already
        // available in the handler scope.
        {
            let substrate_ops = self.collect_substrate_operators(trait_def);
            if !substrate_ops.is_empty() {
                let mut config_symbols: std::collections::BTreeSet<&'static str> =
                    std::collections::BTreeSet::new();
                let mut needs_server_substrate = false;
                let mut needs_program_host = false;
                for op in &substrate_ops {
                    if Self::substrate_op_is_program_effect(op) {
                        needs_program_host = true;
                        continue;
                    }
                    // Derive the client from the SAME dispatch the emission
                    // uses: ops with a dedicated `getLLMClient()` arm import
                    // that; `memory/recall` uses the in-scope
                    // getDataService; everything else reaches the generic
                    // `getSubstrateService().invoke(...)` fallback. The old
                    // prefix guess (`llm/*` → getLLMClient) imported the
                    // wrong client for `llm/embed`.
                    if Self::substrate_op_uses_llm_client(op) {
                        config_symbols.insert("getLLMClient");
                    } else if op != "memory/recall" {
                        needs_server_substrate = true;
                    }
                }
                if !config_symbols.is_empty() {
                    let symbols_str: Vec<&str> = config_symbols.into_iter().collect();
                    code.push_str(&format!(
                        "import {{ {} }} from '../../../substrate-config.js';\n",
                        symbols_str.join(", ")
                    ));
                }
                if needs_server_substrate {
                    // `@almadar/server` owns getSubstrateService (server-hono
                    // re-exports it), so this import is correct under BOTH
                    // frameworks — the previous '@almadar/server-hono' source
                    // was TS2307 on the Express template, which doesn't
                    // depend on the hono package.
                    code.push_str("import { getSubstrateService } from '@almadar/server';\n");
                }
                if needs_program_host {
                    code.push_str(
                        "import { runProgramEffect } from '@almadar/integrations/program';\n",
                    );
                }
                if needs_server_substrate || needs_program_host {
                    // Both cross payload types into JsonValue at the host boundary.
                    code.push_str("import type { JsonValue } from '@almadar/core';\n");
                }
            }
        }

        code.push('\n');

        // Shared handler-header emissions — see `codegen/handler_header.rs`.
        // `__ORBITAL_SOURCE` const + agent row-type aliases + State/Event
        // unions are identical between the Express and Hono backends.
        crate::codegen::handler_header::emit_orbital_source_const(&mut code, module, trait_def);

        if self.dev_logs {
            code.push_str("const _hLog = createLogger('almadar:handler');\n");
            code.push_str("const _hDataLog = createLogger('almadar:handler:data');\n\n");
        }

        crate::codegen::handler_header::emit_state_union(&mut code, trait_def);
        crate::codegen::handler_header::emit_event_union(&mut code, trait_def);

        // Initial state
        let initial_state = trait_def
            .states
            .iter()
            .find(|s| s.is_initial)
            .map(|s| &s.name)
            .unwrap_or(&trait_def.states[0].name);

        // Main event handler function
        code.push_str("/**\n");
        code.push_str(&format!(
            " * Dispatch one event to the {} trait without HTTP — the route below wraps it,\n",
            trait_name
        ));
        code.push_str(" * and the server lends it to a service acting as the caller. Throws on a handler error.\n");
        code.push_str(" */\n");
        code.push_str("export async function runEvent(body: EventRequest, user: UserContext | undefined): Promise<EventResponse> {\n");
        code.push_str("  const { event, payload, traits, entityByTrait, clientId } = body;\n");
        code.push_str("  const now = Date.now();\n\n");
        if crate::codegen::effect::shared::trait_reads_dispatch_scope(trait_def) {
            code.push_str("  const __dispatch: DispatchScope = dispatchScopeOf(body.delivery, body.dispatchLog, event, payload);\n\n");
        }
        code.push_str(&self.server_tick_mount_lines(
            trait_def,
            module,
            "return { success: true, transitioned: false, states: {}, emittedEvents: [] };",
        ));

        code.push_str(&format!(
            "  const state: {trait}State = (traits?.find((t) => t.trait === '{trait}')?.from as {trait}State) ?? '{initial}';\n",
            trait = trait_name, initial = initial_state
        ));
        // §156: `entityByTrait` replaces the retired single `fields` — the
        // stateless per-trait addressing request carries the `@entity` frame
        // keyed by trait name, generalizing the single-trait shape this
        // handler always read.
        code.push_str(&format!(
            "  const entityFrame: EntityRow | undefined = entityByTrait?.['{}'];\n\n",
            trait_name
        ));

        if self.dev_logs {
            code.push_str("  _hLog.info('event:received', { event, currentState: state, hasPayload: !!payload });\n\n");
        }

        code.push_str("  {\n");
        code.push_str("    let response: EventResponse;\n\n");

        code.push_str("    switch (event) {\n");

        // Collect local entity names so non-local entity references in
        // payload types (e.g. ModalRecord on a molecule that listens to an
        // imported atom's events) get rewritten to EntityRow rather than
        // producing an undeclared identifier in the generated switch.
        let local_entity_names: std::collections::HashSet<String> =
            module.entities.iter().map(|e| e.name.clone()).collect();

        // One resolved key → handler-name map, shared by the switch dispatcher
        // and the handler definitions below so they can never disagree.
        let handler_names = resolve_event_handler_names(&trait_def.events);

        // Generate a case for each event
        for event_def in &trait_def.events {
            // Generate typed payload from event's payload_schema. The handler
            // file imports collision-name entities under their `<Name>Entity`
            // alias (see the `aliased_shared_imports_clause` call earlier in
            // this file), so payload type emission must use `map_type_aliased`
            // to match that alias. Without aliasing, an entity named `Response`
            // collides with express's `Response` import and trips TS2300.
            let payload_type = if let Some(schema) = &event_def.payload_schema {
                if !schema.is_empty() {
                    let fields: Vec<String> = schema
                        .iter()
                        .map(|(name, oir_type)| {
                            let narrowed =
                                rewrite_non_local_entity_refs(oir_type, &local_entity_names);
                            format!(
                                "{}: {}",
                                ts_member_name(name),
                                self.map_type_aliased(&narrowed)
                            )
                        })
                        .collect();
                    Some(format!("{{ {} }}", fields.join("; ")))
                } else {
                    None
                }
            } else {
                None
            };

            let handler_name = &handler_names[&event_def.key];
            let dispatch_arg =
                if crate::codegen::effect::shared::trait_reads_dispatch_scope(trait_def) {
                    ", __dispatch"
                } else {
                    ""
                };
            code.push_str(&format!("      case '{}':\n", event_def.key));
            if let Some(ref pt) = payload_type {
                code.push_str(&format!(
                    "        response = await {}(state, payload as {} | undefined, user, now, clientId, entityFrame{});\n",
                    handler_name, pt, dispatch_arg
                ));
            } else {
                code.push_str(&format!(
                    "        response = await {}(state, payload, user, now, clientId, entityFrame{});\n",
                    handler_name, dispatch_arg
                ));
            }
            code.push_str("        break;\n\n");
        }

        code.push_str("      default:\n");
        code.push_str("        response = {\n");
        code.push_str("          success: false,\n");
        code.push_str("          transitioned: false,\n");
        code.push_str("          states: {},\n");
        code.push_str("          emittedEvents: [],\n");
        code.push_str("          error: `Unknown event: ${event}`,\n");
        code.push_str("        };\n");
        code.push_str("    }\n\n");

        if self.dev_logs {
            code.push_str(&format!(
                "    _hLog.info('event:response', {{ event, success: response.success, newState: response.states?.['{}'], dataKeys: Object.keys(response.data ?? {{}}), effectCount: response.effectResults?.length ?? 0 }});\n",
                trait_name
            ));
        }
        code.push_str("    return response;\n");
        code.push_str("  }\n");
        code.push_str("}\n\n");

        code.push_str("/**\n");
        code.push_str(&format!(" * Handle events for {} trait\n", trait_name));
        code.push_str(" */\n");
        code.push_str("export async function handleEvent(\n");
        code.push_str("  req: Request,\n");
        code.push_str("  res: Response,\n");
        code.push_str("  _next: NextFunction\n");
        code.push_str("): Promise<void> {\n");
        code.push_str("  const body = req.body as EventRequest;\n");
        // `req.body` is untyped over the wire; `event` is `EventRequest`'s one
        // REQUIRED field, so a non-string body would otherwise fail with an
        // opaque `Unknown event: undefined` instead of a clear 400.
        code.push_str("  if (typeof body.event !== 'string') {\n");
        code.push_str("    res.status(400).json({ success: false, error: 'Invalid event request: event must be a string' });\n");
        code.push_str("    return;\n");
        code.push_str("  }\n");
        code.push_str("  if (body.mount !== undefined) {\n");
        code.push_str("    res.status(400).json({ success: false, error: 'A mount batch goes to the orbital events route' });\n");
        code.push_str("    return;\n");
        code.push_str("  }\n");
        // The WHOLE viewer (C-USER-ROLE-NEVER-POPULATED): `viewerOf` resolves the verified
        // token against the `[identity]` entity (`@almadar/auth`), shared with the interpreter path.
        // is the one claims->UserContext owner, shared with the interpreter path.
        code.push_str("  try {\n");
        code.push_str("    res.json(await runEvent(body, await viewerOf(req.authUser)));\n");
        code.push_str("  } catch (error) {\n");
        code.push_str(&format!(
            "    logger.error('[{}] Event handler error:', {{ error: error instanceof Error ? error.message : String(error) }});\n",
            trait_name
        ));
        code.push_str("    res.status(500).json({\n");
        code.push_str("      success: false,\n");
        code.push_str(
            "      error: error instanceof Error ? error.message : 'Internal server error',\n",
        );
        code.push_str("    });\n");
        code.push_str("  }\n");
        code.push_str("}\n\n");

        // Generate individual event handlers.
        //
        // GAP-COMP-13 dedupe: event keys that share a resolved handler name
        // (same `to_pascal_case`) emit the handler body only once. The switch
        // statement above already routes both case labels to the shared
        // handler, so behavior is preserved and the TypeScript compiler no
        // longer sees a duplicate symbol.
        let mut seen_handler_names: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        for event_def in &trait_def.events {
            let handler_name = handler_names[&event_def.key].clone();
            if !seen_handler_names.insert(handler_name.clone()) {
                continue;
            }
            code.push_str(&self.generate_event_handler_function(
                trait_def,
                event_def,
                module,
                &handler_name,
            ));
        }

        code.push_str(&self.generate_trait_tick_functions(
            trait_def,
            module,
            ServerFramework::Express,
        ));

        let code = resolve_access_imports(code, &module.entities);
        let code = crate::backend::server::i18n::localize_handler_file(code, &module.locales);

        InternalFile::new(
            format!(
                "packages/server/src/routes/features/{}/handlers.ts",
                folder_name
            ),
            code,
            GeneratedFileType::Handler,
        )
    }

    /// Generate a handler function for a specific event
    pub(crate) fn generate_event_handler_function(
        &self,
        trait_def: &OirTrait,
        event_def: &OirEvent,
        module: &OirModule,
        handler_name: &str,
    ) -> String {
        let trait_name = &trait_def.name;
        let event_key = &event_def.key;

        // Phase E: pin the event's payload schema and the trait's linked
        // entity for any compile_sexpr* call originating from this
        // handler's guards / effects / render-ui. Set per-event so
        // `@payload.<F>` source inference resolves to real types.
        self.current_payload_schema
            .set(event_def.payload_schema.clone());
        self.current_linked_entity
            .set(trait_def.linked_entity.clone());
        self.current_linked_entity_id
            .set(trait_def.linked_entity_id.clone());
        self.current_entity_ref_ids
            .set(trait_def.entity_ref_ids.clone());
        self.current_trait_embed_names
            .set(Self::build_trait_embed_names(trait_def, module));
        // The trait whose config a leftover `@config.<knob>` belongs to — a
        // call-site-captured knob compiles to its captured value (see
        // `captured_knob_server_ts`). Same `<Orbital>.<Trait>` form the client
        // sets, left set like the cells above.
        self.current_trait_scope
            .set(Some(format!("{}.{}", trait_def.orbital_name, trait_name)));

        let mut code = String::new();

        // Generate typed payload from event's payload_schema if available.
        // Rewrite entity references that aren't local so the generated
        // handler doesn't reference an undeclared type (molecules that
        // listen for imported atoms' events — e.g. std-cart listening to
        // std-modal's ModalRecordLoaded — would otherwise produce
        // `data: ModalRecord[]` without an import).
        let local_entity_names: std::collections::HashSet<String> =
            module.entities.iter().map(|e| e.name.clone()).collect();
        let payload_type = if let Some(schema) = &event_def.payload_schema {
            if !schema.is_empty() {
                let fields: Vec<String> = schema
                    .iter()
                    .map(|(name, oir_type)| {
                        let narrowed = rewrite_non_local_entity_refs(oir_type, &local_entity_names);
                        format!(
                            "{}: {}",
                            ts_member_name(name),
                            self.map_type_aliased(&narrowed)
                        )
                    })
                    .collect();
                format!("{{ {} }}", fields.join("; "))
            } else {
                // No declared payload schema — fall back to `EventPayload`
                // (`{ [key]: EventPayloadValue }`) from @almadar/core
                // rather than `Record<string, unknown>`. Same structural
                // shape, typed values, lint-clean.
                "EventPayload".to_string()
            }
        } else {
            "EventPayload".to_string()
        };

        code.push_str(&format!("/**\n * Handle {} event\n */\n", event_key));
        code.push_str(&format!("async function {}(\n", handler_name));
        code.push_str(&format!("  state: {}State,\n", trait_name));
        code.push_str(&format!("  payload: {} | undefined,\n", payload_type));
        code.push_str("  user: UserContext | undefined,\n");
        code.push_str("  now: number,\n");
        code.push_str("  clientId: string | undefined,\n");
        if crate::codegen::effect::shared::trait_reads_dispatch_scope(trait_def) {
            code.push_str("  entityFrame: EntityRow | undefined,\n");
            code.push_str("  __dispatch: DispatchScope\n");
        } else {
            code.push_str("  entityFrame: EntityRow | undefined\n");
        }
        code.push_str("): Promise<EventResponse> {\n");

        // Find transitions triggered by this event
        let transitions: Vec<_> = trait_def
            .transitions
            .iter()
            .filter(|t| t.event == *event_key)
            .collect();

        if transitions.is_empty() {
            // No transitions for this event
            code.push_str("  return {\n");
            code.push_str("    success: false,\n");
            code.push_str("    transitioned: false,\n");
            code.push_str("    states: {},\n");
            code.push_str("    emittedEvents: [],\n");
            code.push_str(&format!(
                "    error: 'No transition defined for event {} in current state',\n",
                event_key
            ));
            code.push_str("  };\n");
            code.push_str("}\n\n");
            return code;
        }

        // API-boundary payload validation. Inject a check at the top
        // of each handler so the `!` required marker on listens-block
        // fields is enforced before any state-machine dispatch or
        // persist effect runs. Mirrors `validateEventPayload` in
        // `@almadar/runtime/PayloadValidator.ts` (the runtime path's
        // boundary check) so both paths reject identically-malformed
        // requests. The required-field list is inlined per event from
        // `OirEvent.payload_required_fields`. Access goes through
        // the handler's typed `payload` parameter (the codegen emits
        // `payload: <PayloadInterface> | undefined` above) so no
        // `unknown` casts are needed — the field name is part of the
        // generated payload type contract.
        let required_fields: Vec<&String> = trait_def
            .events
            .iter()
            .find(|e| &e.key == event_key)
            .map(|e| e.payload_required_fields.iter().collect())
            .unwrap_or_default();
        if !required_fields.is_empty() {
            code.push_str("  // Required-payload-field validation (mirrors runtime path)\n");
            for field in &required_fields {
                code.push_str(&format!(
                    "  if (payload?.{} === undefined || payload?.{} === null) {{\n",
                    field, field
                ));
                code.push_str(&format!(
                    "    return {{ success: false, transitioned: false, states: {{}}, emittedEvents: [], error: \"Payload validation failed for event '{}': {} (missing or null)\" }};\n",
                    event_key, field
                ));
                code.push_str("  }\n");
            }
            code.push('\n');
        }

        code.push_str("  const data: Record<string, EntityRow[]> = {};\n");
        code.push_str("  const effectResults: ServerEffectResult[] = [];\n");
        code.push_str("  const emittedEvents: EmittedEvent[] = [];\n\n");

        // Phase 5.5: Entity fetch — resolve @entity binding from linkedEntity collection (typed)
        if let Some(linked_entity) = &trait_def.linked_entity {
            let entity_def =
                module.resolve_entity_ref(trait_def.linked_entity_id.as_deref(), linked_entity);
            let is_runtime = entity_def
                .map(|e| matches!(e.persistence, OirPersistence::Runtime))
                .unwrap_or(false);
            let collection = entity_def
                .map(|e| &e.collection)
                .cloned()
                .unwrap_or_else(|| to_snake_case(linked_entity));

            code.push_str("  // Resolve entity from linked entity collection. Accept both\n");
            code.push_str("  // `entityId` (system convention for config-injected ids) and `id`\n");
            code.push_str(
                "  // (the .lolo emit-declaration field name surfaced by `actionPayload`).\n",
            );
            // `payload` is typed at the handler signature with the
            // per-event narrowed shape — which may NOT declare
            // `entityId` / `id` even though those keys are commonly
            // present at runtime (config-injected ids, actionPayload-
            // surfaced ids). Widen via `EventPayload` (whose `[key]:
            // EventPayloadValue` index signature admits any string key)
            // before reading. Then `typeof`-narrow each leaf to string.
            // Shared with the Hono handler (`ENTITY_ID_FROM_PAYLOAD_DECL`).
            code.push_str(crate::codegen::handler_header::ENTITY_ID_FROM_PAYLOAD_DECL);
            if is_runtime {
                // [runtime] entities have no persistence row. Bind `entity` to a
                // long-lived per-(orbital, trait, entityId) object held in
                // `getRuntimeEntity` so `(set @entity.X)` writes accumulate
                // across requests and guards reading `@entity.X` see prior
                // step values. Mirrors @almadar/runtime's `traitFieldStates`.
                code.push_str(&crate::codegen::handler_header::runtime_entity_binding(
                    &module.name,
                    &trait_def.name,
                    &crate::codegen::handler_header::entity_type_ref(linked_entity),
                ));
            } else {
                let entity_ty = crate::codegen::handler_header::entity_type_ref(linked_entity);
                let frame_fields: Vec<&str> =
                    entity_def.map(|e| e.frame_fields()).unwrap_or_default();
                code.push_str(&crate::codegen::handler_header::entity_frame_binding(
                    &entity_ty,
                    &collection,
                    &frame_fields,
                ));
            }
        }

        // Generate state-based transition dispatch (shared with the Hono
        // backend via `generate_state_dispatch_switch`).
        code.push_str(&self.generate_state_dispatch_switch(
            event_key,
            &transitions,
            trait_def,
            module,
            ServerFramework::Express,
        ));
        code.push_str("}\n\n");

        code
    }

    /// Emit the `switch (state) { ... }` transition dispatcher shared by both
    /// backends' per-event handlers.
    ///
    /// Groups `transitions` (already filtered to this event) by from-state,
    /// emits guard `if / else if / else` chains, and routes each transition body
    /// through the framework-switched `generate_transition_body_impl`. The guard
    /// codegen (`compile_guard_to_ts`) and the `success: false` guard-rejection
    /// blocks are framework-agnostic. The only per-framework line is the
    /// `default:` return literal (Express multi-line vs Hono inline) — pinned by
    /// `framework` to preserve byte-parity with the previous forked copies.
    /// §84 (Almadar_Compiler_Gaps.md): the response for a dispatched event
    /// with no matching (unconditional-or-guard-passing) arm in the current
    /// state. `@almadar/runtime`'s `StateMachineCore.processEvent` treats
    /// this uniformly as a benign no-op — `{executed: false, newState:
    /// unchanged}`, never a thrown error or a rejected response — for EVERY
    /// guarded transition, including ones genuinely meant to gate a
    /// mutation (verified empirically: `SEND -> ready when
    /// @entity.activeChannel` with no channel open resolves
    /// `transitionFired: false` with `success: true` on the runtime path,
    /// not a denial). The compiled server previously invented a harder
    /// contract here (`{success: false, error: 'Access denied: guard
    /// condition not met'}`) to stop a guard from being silently bypassed —
    /// but "bypassed" was never the alternative: a no-op that doesn't run
    /// the transition's effects blocks the mutation exactly as intended,
    /// it just doesn't ALSO manufacture an HTTP-level rejection. That
    /// distinction matters concretely for an event declared `-> external`
    /// for other traits to observe (e.g. `std-browse`'s `VIEW`, whose only
    /// guarded arm exists to enable an alternate UI look) — the compiled
    /// path's rejection surfaced as a visible client-side error for a
    /// perfectly normal click, something the runtime never did. Mirrors
    /// the real success-response shape (`data`/`effectResults` — both are
    /// still-empty locals declared at the top of the handler — plus
    /// `emittedEvents`, always present, §156) with `states` set back to the
    /// unchanged `from_state`, so the client's existing `EVENT_SUCCESS`
    /// handling applies with no visible transition and no error. This IS
    /// the one true guard-rejection site (no guard-passing arm matched the
    /// dispatched event in the current state), so it populates `guardFailed`
    /// (`"<Trait>.<event>"`, for debugging — never gates `success`, see the
    /// doctrine above) — mirroring `orbital-core`'s `from_process_results`
    /// seed-rejection rule.
    fn push_guard_noop_response(
        code: &mut String,
        from_state: &str,
        trait_name: &str,
        event_key: &str,
    ) {
        code.push_str("      return {\n");
        code.push_str("        success: true,\n");
        code.push_str("        transitioned: false,\n");
        code.push_str(&format!(
            "        states: {{ '{}': '{}' }},\n",
            trait_name, from_state
        ));
        code.push_str("        data,\n");
        code.push_str("        effectResults,\n");
        code.push_str("        emittedEvents,\n");
        code.push_str(&format!(
            "        guardFailed: '{}.{}',\n",
            trait_name, event_key
        ));
        code.push_str("      };\n");
    }

    pub(crate) fn generate_state_dispatch_switch(
        &self,
        event_key: &str,
        transitions: &[&OirTransition],
        trait_def: &OirTrait,
        module: &OirModule,
        framework: ServerFramework,
    ) -> String {
        let mut code = String::new();
        code.push_str("  switch (state) {\n");

        // Group transitions by from-state to avoid duplicate case labels (GAP-V10)
        let mut state_transitions: HashMap<String, Vec<&OirTransition>> = HashMap::new();
        let mut state_order: Vec<String> = Vec::new();

        for trans in transitions {
            let from_states = match &trans.from {
                OirTransitionFrom::Single(s) => vec![s.clone()],
                OirTransitionFrom::Multiple(states) => states.clone(),
                OirTransitionFrom::Any => trait_def.states.iter().map(|s| s.name.clone()).collect(),
            };

            for from_state in from_states {
                if !state_transitions.contains_key(&from_state) {
                    state_order.push(from_state.clone());
                }
                state_transitions.entry(from_state).or_default().push(trans);
            }
        }

        for from_state in &state_order {
            // Prune arms whose guard compiles to the literal constant `false`
            // (a config-resolved gate like `(== @config.paymentProvider
            // "stripe")` with a different provider bound). The branch is
            // provably unreachable; emitting it produces dead code in which
            // tsc SKIPS control-flow narrowing, so `err instanceof Error ?
            // err.message : …` inside the dead arm fails typecheck (TS2339 on
            // `unknown`). Guards are compiled once here and reused below.
            let group: Vec<(&OirTransition, Option<String>)> = state_transitions[from_state]
                .iter()
                .map(|t| {
                    let guard_code = t.guard.as_ref().map(|g| {
                        self.in_transition(&t.to, crate::backend::TransitionPhase::Guard, || {
                            self.compile_guard_to_ts(g)
                        })
                    });
                    (*t, guard_code)
                })
                .filter(|(_, g)| g.as_deref() != Some("false"))
                // A guard that throws blocks its arm like a false guard (`@almadar/core`
                // `guardHolds`, the JS runtime's rule too); the error is logged, never dropped.
                .map(|(t, g)| {
                    let wrapped = g.map(|g| {
                        format!(
                            "guardHolds(() => Boolean({g}), (error) => console.error(`[guard] {}.{} {} -> {} threw:`, error.message))",
                            trait_def.name, event_key, from_state, t.to
                        )
                    });
                    (t, wrapped)
                })
                .collect();

            code.push_str(&format!("    case '{}':\n", from_state));
            code.push_str("    {\n");

            if group.is_empty() {
                // Every arm for this state was compile-time false — a
                // no-op, exactly like an unmet runtime guard (§84).
                Self::push_guard_noop_response(&mut code, from_state, &trait_def.name, event_key);
                code.push_str("    }\n\n");
                continue;
            }

            if group.len() == 1 {
                // Single transition for this state. If it has a guard, wrap the
                // body in `if (guardCode)` so guard rejection returns
                // success:false instead of silently advancing the state machine
                // (atom-defined guards like std-confirmation's
                // `REQUEST when @payload.row` must not be dropped server-side).
                let (trans, guard_code) = &group[0];
                let trans = *trans;
                if let Some(guard_code) = guard_code {
                    code.push_str(&format!("      if ({guard_code}) {{\n"));
                    code.push_str(&self.generate_transition_body_impl(
                        trans, trait_def, module, "        ", framework,
                    ));
                    code.push_str("      } else {\n");
                    Self::push_guard_noop_response(
                        &mut code,
                        from_state,
                        &trait_def.name,
                        event_key,
                    );
                    code.push_str("      }\n");
                } else {
                    code.push_str(&self.generate_transition_body_impl(
                        trans, trait_def, module, "      ", framework,
                    ));
                }
            } else {
                // Multiple transitions for this (state, event): tried in declaration order, as on
                // every other path. A guarded arm is the next `if`/`else if`; an unguarded arm is the
                // chain's final `else` and ends it (anything declared after it never fires). A guard
                // that is the complement of an earlier one covers every remaining case, so it closes
                // the chain as its `else` too (re-testing it is a comparison TS has already narrowed
                // away — TS2367, G-ORB-189(1)).
                let mut opened = false;
                let mut closed = false;
                for (i, (trans, guard_code)) in group.iter().enumerate() {
                    match guard_code {
                        Some(guard_code) => {
                            let complements_earlier =
                                group[..i].iter().any(|(earlier, earlier_guard)| {
                                    earlier_guard.is_some()
                                        && guards_complementary(
                                            earlier.guard.as_ref(),
                                            trans.guard.as_ref(),
                                        )
                                });
                            if !opened {
                                code.push_str(&format!("      if ({guard_code}) {{\n"));
                                opened = true;
                            } else if complements_earlier {
                                code.push_str("      } else {\n");
                                closed = true;
                            } else {
                                code.push_str(&format!("      }} else if ({guard_code}) {{\n"));
                            }
                            code.push_str(&self.generate_transition_body_impl(
                                trans, trait_def, module, "        ", framework,
                            ));
                        }
                        None if !opened => {
                            code.push_str(&self.generate_transition_body_impl(
                                trans, trait_def, module, "      ", framework,
                            ));
                            closed = true;
                        }
                        None => {
                            code.push_str("      } else {\n");
                            code.push_str(&self.generate_transition_body_impl(
                                trans, trait_def, module, "        ", framework,
                            ));
                            closed = true;
                        }
                    }
                    if closed {
                        break;
                    }
                }
                if opened {
                    if !closed {
                        // Only guarded transitions, no fallback — a no-op (§84).
                        code.push_str("      } else {\n");
                        Self::push_guard_noop_response(
                            &mut code,
                            from_state,
                            &trait_def.name,
                            event_key,
                        );
                    }
                    code.push_str("      }\n");
                }
            }

            code.push_str("    }\n\n");
        }

        match framework {
            ServerFramework::Express => {
                code.push_str("    default:\n");
                code.push_str("      return {\n");
                code.push_str("        success: false,\n");
                code.push_str("        transitioned: false,\n");
                code.push_str("        states: {},\n");
                code.push_str("        emittedEvents: [],\n");
                code.push_str(&format!(
                    "        error: `Cannot process {} from state ${{state}}`,\n",
                    event_key
                ));
                code.push_str("      };\n");
            }
            ServerFramework::Hono => {
                code.push_str("    default:\n");
                code.push_str(&format!(
                    "      return {{ success: false, transitioned: false, states: {{}}, emittedEvents: [], error: `Cannot process {} from state ${{state}}` }};\n",
                    event_key
                ));
            }
        }
        code.push_str("  }\n");

        code
    }

    /// Shared transition-body generator for both frameworks.
    ///
    /// The effect-execution loop, auto-persist-on-set, auto-fetch-of-ref'd
    /// entities, and the typed response are identical across backends. The two
    /// real per-framework differences are switched on `framework`: persist
    /// create/update effects go through the Zod-validating
    /// `generate_server_effect_code_hono` on Hono (every other effect delegates
    /// to the shared Express path), and the auto-persist/auto-fetch type
    /// positions use the collision-aliased `entity_type_ref` on Express
    /// (Express imports collision-name entities under a `<Name>Entity` alias;
    /// Hono imports no express `Response`/`Request`, so the raw name is safe).
    pub(crate) fn generate_transition_body_impl(
        &self,
        trans: &OirTransition,
        trait_def: &OirTrait,
        module: &OirModule,
        indent: &str,
        framework: ServerFramework,
    ) -> String {
        self.in_transition(&trans.to, crate::backend::TransitionPhase::Effect, || {
            self.transition_body_in_scope(trans, trait_def, module, indent, framework)
        })
    }

    /// `generate_transition_body_impl`'s body, compiled with the transition's target in scope.
    fn transition_body_in_scope(
        &self,
        trans: &OirTransition,
        trait_def: &OirTrait,
        module: &OirModule,
        indent: &str,
        framework: ServerFramework,
    ) -> String {
        // Type-position entity reference: Express aliases collision names,
        // Hono uses the bare name.
        let entity_ref = |name: &str| -> String {
            match framework {
                ServerFramework::Express => crate::codegen::handler_header::entity_type_ref(name),
                ServerFramework::Hono => name.to_string(),
            }
        };

        let mut body = String::new();

        // Execute server-side effects
        body.push_str(&format!("{indent}// Execute server-side effects\n"));
        for effect_expr in &trans.effects {
            if let OirExpr::Effect { effect } = effect_expr {
                let effect_code = match framework {
                    ServerFramework::Express => self.generate_server_effect_code(
                        effect.as_ref(),
                        module,
                        trait_def.linked_entity.as_deref(),
                    ),
                    ServerFramework::Hono => self.generate_server_effect_code_hono(
                        effect.as_ref(),
                        module,
                        trait_def.linked_entity.as_deref(),
                    ),
                };
                // Re-indent effect code to match the current indent level
                for line in effect_code.lines() {
                    if line.is_empty() {
                        body.push('\n');
                    } else {
                        // Effect code is generated with 8-space indent (2 levels).
                        // Strip the base indent and replace with our indent.
                        let trimmed = line.strip_prefix("        ").unwrap_or(line);
                        body.push_str(&format!("{indent}{trimmed}\n"));
                    }
                }
            }
        }

        // Phase 5.5: If entity was modified by set effects, persist it
        if let Some(linked_entity) = &trait_def.linked_entity {
            // Runtime entities already accumulate `set` mutations in the
            // in-memory `getRuntimeEntity` store (see the effect-execution
            // loop above); an extra DB write here would be an incoherent
            // double-write to a collection the runtime reads never see.
            let linked_node =
                module.resolve_entity_ref(trait_def.linked_entity_id.as_deref(), linked_entity);
            let is_runtime =
                linked_node.is_some_and(|e| matches!(e.persistence, OirPersistence::Runtime));

            // A `set` that only touches this entity's `@intrinsic` frame
            // fields (view-state the trait owns, never a persisted column)
            // must not trigger an auto-persist — there is nothing new to
            // write, and writing `entity` unstripped would smuggle the
            // frame into the store. Gate on at least one NON-intrinsic
            // field actually being set.
            let frame_fields: Vec<&str> = linked_node.map(|e| e.frame_fields()).unwrap_or_default();
            let set_fields = crate::codegen::handler_header::entity_set_fields(trans);
            let has_non_intrinsic_entity_set = set_fields
                .iter()
                .any(|f| f != "id" && !frame_fields.contains(&f.as_str()));

            let has_explicit_persist_update = trans.effects.iter().any(|e| {
                if let OirExpr::Effect { effect } = e {
                    matches!(effect.as_ref(), OirEffect::Persist { operation: OirPersistOp::Update, entity_type, .. } if entity_type == linked_entity)
                } else {
                    false
                }
            });

            if has_non_intrinsic_entity_set && !has_explicit_persist_update && !is_runtime {
                let collection = linked_node
                    .map(|e| &e.collection)
                    .cloned()
                    .unwrap_or_else(|| to_snake_case(linked_entity));

                body.push_str(&format!(
                    "\n{indent}// Persist entity mutations (auto-generated from set effects)\n"
                ));
                body.push_str(&format!(
                    "{indent}if (__row !== null && entityId !== undefined) {{\n"
                ));
                let update_policy = linked_node.and_then(|e| e.update_policy.as_ref()).map_or_else(
                    || "undefined".to_string(),
                    |_| crate::backend::server::access_policies::policy_const_name(linked_entity, "UPDATE"),
                );
                body.push_str(&format!(
                    "{indent}  const __autoWrite = await pushUpdate<{ty}>(getDataService(), {{ collection: '{coll}', id: entityId, data: omitFrameFields(entity, __FRAME_KEYS) as Partial<{ty}>, policy: {policy}, requiredFields: [{required}], access: rowAccess({{ user, now, payload: payload as EventPayload | undefined }}) }});\n",
                    ty = entity_ref(linked_entity),
                    coll = collection,
                    policy = update_policy,
                    required = crate::codegen::effect::persist::required_field_list(linked_node)
                ));
                body.push_str(&format!("{indent}  if (__autoWrite.kind === 'denied') {{\n"));
                body.push_str(&format!(
                    "{indent}    effectsLog.warn('persist:access-denied', {{ action: 'update', entityType: '{}', resolvedId: entityId }});\n",
                    linked_entity
                ));
                body.push_str(&format!("{indent}    effectResults.push({{\n"));
                body.push_str(&format!("{indent}      effect: 'persist',\n"));
                body.push_str(&format!("{indent}      action: 'update',\n"));
                body.push_str(&format!("{indent}      entityType: '{}',\n", linked_entity));
                body.push_str(&format!("{indent}      success: false,\n"));
                body.push_str(&format!(
                    "{indent}      error: {},\n",
                    crate::codegen::effect::persist::access_denied_literal("update", linked_entity)
                ));
                body.push_str(&format!("{indent}    }});\n"));
                body.push_str(&format!("{indent}  }} else {{\n"));
                body.push_str(&format!("{indent}  effectResults.push({{\n"));
                body.push_str(&format!("{indent}    effect: 'persist',\n"));
                body.push_str(&format!("{indent}    action: 'update',\n"));
                body.push_str(&format!("{indent}    entityType: '{}',\n", linked_entity));
                body.push_str(&format!("{indent}    success: true,\n"));
                body.push_str(&format!("{indent}    data: entity,\n"));
                body.push_str(&format!("{indent}  }});\n"));
                body.push_str(&format!("{indent}  }}\n"));
                body.push_str(&format!("{indent}}}\n"));
            }
        }

        // Auto-fetch ref'd entities after mutation effects
        // Scans all traits in the module for Ref effects, then for each entity type
        // that was mutated (persist/set/swap) AND is ref'd, re-fetches fresh data
        // so the response includes it for EntityStore.advance() on the client
        {
            // Collect entity types that have ref effects across all traits
            // The page each ref'd entity needs re-sent: the ref's own `(filter, limit)` when its filter reads
            // only `@user`/`@config` (anything else belongs to the issuing request, which this handler cannot
            // evaluate) and all its refs agree; `None` otherwise, so the viewer's whole readable set is re-sent.
            let mut ref_entities: std::collections::HashMap<String, Option<(Option<String>, u64)>> =
                std::collections::HashMap::new();
            for t in &module.traits {
                for tr in &t.transitions {
                    for eff_expr in &tr.effects {
                        if let OirExpr::Effect { effect: eff } = eff_expr {
                            if let OirEffect::Ref {
                                entity_type,
                                id: ref_id,
                                filter: ref_filter,
                                limit: ref_limit,
                                ..
                            } = eff.as_ref()
                            {
                                let resolved = if entity_type == "@entity" {
                                    t.linked_entity.clone().unwrap_or_default()
                                } else {
                                    entity_type.clone()
                                };
                                if !resolved.is_empty() {
                                    let limit = match ref_limit {
                                        None => Some(0),
                                        Some(OirExpr::Number { value }) if *value >= 1.0 => {
                                            Some(value.floor() as u64)
                                        }
                                        Some(_) => None,
                                    };
                                    let filter = match ref_filter {
                                        None => Some(None),
                                        Some(expr) => {
                                            let own = expr.collect_bindings().iter().all(|b| {
                                                matches!(
                                                    b.root,
                                                    orbital_core::ir::OirBindingRoot::User
                                                        | orbital_core::ir::OirBindingRoot::Config
                                                )
                                            });
                                            if own {
                                                expr.to_sexpression()
                                                    .and_then(|x| serde_json::to_string(&x.to_canonical_json()).ok())
                                                    .map(Some)
                                            } else {
                                                None
                                            }
                                        }
                                    };
                                    let query = match (ref_id, limit, filter) {
                                        (None, Some(limit), Some(filter)) => Some((filter, limit)),
                                        _ => None,
                                    };
                                    ref_entities
                                        .entry(resolved)
                                        .and_modify(|seen| {
                                            *seen = match (seen.take(), query.clone()) {
                                                (Some((fa, la)), Some((fb, lb))) if fa == fb => {
                                                    Some((fa, if la == 0 || lb == 0 { 0 } else { la.max(lb) }))
                                                }
                                                _ => None,
                                            }
                                        })
                                        .or_insert(query);
                                }
                            }
                        }
                    }
                }
            }

            // Collect entity types mutated by THIS transition
            let mut mutated: std::collections::HashSet<String> = std::collections::HashSet::new();
            for eff_expr in &trans.effects {
                if let OirExpr::Effect { effect: eff } = eff_expr {
                    match eff.as_ref() {
                        OirEffect::Persist { entity_type, .. }
                        | OirEffect::Swap { entity_type, .. } => {
                            let resolved = if entity_type == "@entity" {
                                trait_def.linked_entity.clone().unwrap_or_default()
                            } else {
                                entity_type.clone()
                            };
                            if !resolved.is_empty() {
                                mutated.insert(resolved);
                            }
                        }
                        OirEffect::PersistBatch { entities, .. } => {
                            mutated.extend(entities.iter().cloned());
                        }
                        OirEffect::Set { target, .. } => {
                            if target.root == orbital_core::ir::OirBindingRoot::Entity {
                                if let Some(linked) = &trait_def.linked_entity {
                                    mutated.insert(linked.clone());
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }

            // Generate auto-fetch for mutated ref'd entity types
            for entity_type in &mutated {
                if let Some(page) = ref_entities.get(entity_type) {
                    let collection = module
                        .entities
                        .iter()
                        .find(|e| e.name == *entity_type)
                        .map(|e| &e.collection)
                        .cloned()
                        .unwrap_or_else(|| to_snake_case(entity_type));
                    let entity_node = module.entities.iter().find(|e| e.name == *entity_type);
                    let read_policy = entity_node
                        .and_then(|e| e.read_policy.as_ref())
                        .map_or_else(
                            || "undefined".to_string(),
                            |_| crate::backend::server::access_policies::policy_const_name(entity_type, "READ"),
                        );
                    let required = entity_node
                        .map(|e| {
                            e.required_fields()
                                .map(|f| format!("'{}'", f.name))
                                .collect::<Vec<_>>()
                                .join(", ")
                        })
                        .unwrap_or_default();
                    body.push_str(&format!(
                        "\n{indent}// Re-send the ref'd entity after mutation: the ref's own page (or the viewer's readable rows), one queryPage when the store takes it\n"
                    ));
                    body.push_str(&format!(
                        "{indent}data['{}'] = await refreshRows<{}>(getDataService(), {{ collection: '{}', readPolicy: {}, filter: {}, limit: {}, requiredFields: [{}], access: rowAccess({{ user, now, payload: payload as EventPayload | undefined }}) }});\n",
                        entity_type,
                        entity_ref(entity_type),
                        collection,
                        read_policy,
                        page.as_ref().and_then(|(f, _)| f.clone()).unwrap_or_else(|| "undefined".to_string()),
                        page.as_ref().map_or(0, |(_, l)| *l),
                        required
                    ));
                }
            }
        }

        // §A7: `clientEffects`/`clientEffectsByTrait` — server-side twin of
        // the kernel's `resolve_effect_bindings`, built from THIS
        // transition's declared effects in DECLARATION ORDER, after the
        // effect-execution loop above (and the auto-persist/auto-refresh
        // blocks) so a render-ui/navigate's `@entity` reads see the
        // post-effect frame — a `set @entity.X` earlier in the same
        // transition is already reflected in `entity` by this point.
        let client_effect_tuples: Vec<String> = trans
            .effects
            .iter()
            .filter_map(|effect_expr| match effect_expr {
                OirExpr::Effect { effect } => self.client_effect_tuple_ts(effect.as_ref()),
                _ => None,
            })
            .collect();
        if !client_effect_tuples.is_empty() {
            body.push_str(&format!(
                "\n{indent}const clientEffects: ClientEffectTuple[] = [{}];\n",
                client_effect_tuples.join(", ")
            ));
            body.push_str(&format!(
                "{indent}const clientEffectsByTrait: EventResponse['clientEffectsByTrait'] = clientEffects.map((effect) => ({{ traitName: '{}', effect, event: {}, fromState: state }}));\n",
                trait_def.name,
                serde_json::to_string(&trans.event).unwrap_or_default()
            ));
        }

        // Return response. §156: `emittedEvents` is ALWAYS present (both
        // frameworks always declare the local array, see the handler-frame
        // setup above); `states` replaces the retired single `newState`;
        // `entityByTrait` (keyed by this trait) replaces the retired single
        // `fields` when the transition's `set` effects wrote entity fields.
        body.push_str(&format!("\n{indent}return {{\n"));
        body.push_str(&format!("{indent}  success: true,\n"));
        body.push_str(&format!("{indent}  transitioned: true,\n"));
        body.push_str(&format!(
            "{indent}  states: {{ '{}': '{}' }},\n",
            trait_def.name, trans.to
        ));
        body.push_str(&format!("{indent}  data,\n"));
        body.push_str(&format!("{indent}  effectResults,\n"));
        body.push_str(&format!("{indent}  emittedEvents,\n"));
        if !client_effect_tuples.is_empty() {
            body.push_str(&format!("{indent}  clientEffects,\n"));
            body.push_str(&format!("{indent}  clientEffectsByTrait,\n"));
        }
        if trait_def.linked_entity.is_some() {
            let set_fields = crate::codegen::handler_header::entity_set_fields(trans);
            if !set_fields.is_empty() {
                let pairs: Vec<String> = set_fields
                    .iter()
                    .map(|f| format!("{f}: entity.{f}"))
                    .collect();
                body.push_str(&format!(
                    "{indent}  entityByTrait: {{ '{}': {{ {} }} }},\n",
                    trait_def.name,
                    pairs.join(", ")
                ));
            }
        }
        body.push_str(&format!("{indent}}};\n"));

        body
    }
}

/// `b` holds exactly when `a` does not: `(= x y)` / `(!= x y)` over the same operands (either
/// order), or `(not a)`.
fn guards_complementary(a: Option<&OirExpr>, b: Option<&OirExpr>) -> bool {
    let (Some(a), Some(b)) = (a, b) else {
        return false;
    };
    let negates = |x: &OirExpr, y: &OirExpr| matches!(y, OirExpr::UnaryOp { op: orbital_core::ir::OirUnaryOp::Not, operand } if operand.as_ref() == x);
    if negates(a, b) || negates(b, a) {
        return true;
    }
    use orbital_core::ir::OirBinaryOp::{Eq, Ne};
    match (a, b) {
        (
            OirExpr::BinaryOp {
                op: op_a,
                left: la,
                right: ra,
            },
            OirExpr::BinaryOp {
                op: op_b,
                left: lb,
                right: rb,
            },
        ) if matches!((op_a, op_b), (Eq, Ne) | (Ne, Eq)) => {
            (la == lb && ra == rb) || (la == rb && ra == lb)
        }
        _ => false,
    }
}

#[cfg(test)]
mod guard_complement_tests {
    use super::guards_complementary;
    use orbital_core::ir::{OirBinaryOp, OirExpr, OirUnaryOp};

    fn cmp(op: OirBinaryOp, l: OirExpr, r: OirExpr) -> OirExpr {
        OirExpr::BinaryOp {
            op,
            left: Box::new(l),
            right: Box::new(r),
        }
    }

    #[test]
    fn eq_and_ne_over_the_same_operands_are_complements_in_either_order() {
        let tier = OirExpr::string("@entity.tier");
        let org = OirExpr::string("organism");
        let eq = cmp(OirBinaryOp::Eq, tier.clone(), org.clone());
        assert!(guards_complementary(
            Some(&eq),
            Some(&cmp(OirBinaryOp::Ne, tier.clone(), org.clone()))
        ));
        assert!(guards_complementary(
            Some(&eq),
            Some(&cmp(OirBinaryOp::Ne, org.clone(), tier.clone()))
        ));
        let not = OirExpr::UnaryOp {
            op: OirUnaryOp::Not,
            operand: Box::new(eq.clone()),
        };
        assert!(guards_complementary(Some(&eq), Some(&not)));
    }

    #[test]
    fn control_different_operands_or_a_missing_guard_are_not_complements() {
        let tier = OirExpr::string("@entity.tier");
        let eq = cmp(OirBinaryOp::Eq, tier.clone(), OirExpr::string("organism"));
        let ne_other = cmp(OirBinaryOp::Ne, tier.clone(), OirExpr::string("subset"));
        assert!(!guards_complementary(Some(&eq), Some(&ne_other)));
        assert!(!guards_complementary(Some(&eq), None));
        assert!(!guards_complementary(
            Some(&eq),
            Some(&cmp(OirBinaryOp::Lt, tier, OirExpr::string("organism")))
        ));
    }
}

#[cfg(test)]
mod create_entity_seed_tests {
    use super::*;
    use orbital_core::ir::{OirBinding, OirField, OirState};

    fn module_with_task() -> OirModule {
        let mut m = OirModule::new("TestApp", "0.1.0");
        m.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Task".to_string(),
            description: None,
            collection: "tasks".to_string(),
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
        m
    }

    /// A `Task` with one real REQUIRED column (`content`, no default, not
    /// `@intrinsic`), one required column with a `default` (`priority`, the
    /// store fills it in), and one required `@intrinsic` column
    /// (`workingCopy`, the trait's own frame) — only `content` may ever be
    /// reported missing by `persist create`'s required-column gate.
    fn module_with_task_required_field() -> OirModule {
        let mut m = OirModule::new("TestApp", "0.1.0");
        let mut priority_field = OirField::new("priority", OirType::String);
        priority_field.default = Some(orbital_core::ir::OirValue::String("normal".to_string()));
        let mut working_copy_field = OirField::new("workingCopy", OirType::String);
        working_copy_field.intrinsic = true;
        m.entities.push(OirEntity {
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
                OirField::new("content", OirType::String),
                priority_field,
                working_copy_field,
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
        m
    }

    /// A `Task` with one host-authored REQUIRED column (`content`) and one
    /// field the inline phase's rebind merge ADDED from an imported entity
    /// (`name`, `required: true`, `merged_from: Some("BrowseItem")`) — only
    /// `content` may ever appear in the generated `__requiredFields` list;
    /// `name`'s `!` is BrowseItem's own write contract, never Task's.
    fn module_with_task_merged_from_field() -> OirModule {
        let mut m = OirModule::new("TestApp", "0.1.0");
        let mut merged_field = OirField::new("name", OirType::String);
        merged_field.merged_from = Some("BrowseItem".to_string());
        m.entities.push(OirEntity {
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
                OirField::new("content", OirType::String),
                merged_field,
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
        m
    }

    /// A `Task` with one persisted field (`title`) and one `@intrinsic`
    /// frame field (`draft`, trait-owned scratch view-state, never a
    /// persisted column) — the fixture §88's frame-stripping tests need.
    fn module_with_task_frame_field() -> OirModule {
        let mut m = OirModule::new("TestApp", "0.1.0");
        let mut draft_field = OirField::new("draft", OirType::String);
        draft_field.intrinsic = true;
        m.entities.push(OirEntity {
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
                draft_field,
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
        m
    }

    /// The Project Friday CREATE_TASK shape: `(set @entity.id ?id) … (persist
    /// create Task @entity)` with no row bound yet. Pins both halves of the
    /// fix — `entity` is always an object (payload id + row + request frame,
    /// §87), and the persist create writes the store-assigned id back onto it.
    #[test]
    fn create_task_handler_seeds_and_writes_id_back() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task();

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());

        let mut trans = OirTransition::new("backlog", "backlog", "CREATE_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::Set {
            target: OirBinding::entity(vec!["id".to_string()]),
            value: OirExpr::binding(OirBinding::payload(vec!["id".to_string()])),
            emit: None,
        }));
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Create,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: None,
        }));
        trait_def.transitions.push(trans);

        let event_def = OirEvent::new("CREATE_TASK");
        trait_def.events.push(event_def.clone());

        let js = backend.generate_event_handler_function(
            &trait_def,
            &event_def,
            &module,
            "handleCreateTask",
        );

        assert!(
            js.contains(
                "const entity: Task = resolveEntityView({ frame: entityFrame, row: __row, id: entityId, allowedFrameKeys: __FRAME_KEYS }) as Task;"
            ),
            "CREATE_TASK handler must bind entity from payload id + row + request frame, got:\n{}",
            js
        );
        assert!(
            js.contains("if (created && entity) { entity.id = created.id; }"),
            "CREATE_TASK handler must write the created id back onto entity, got:\n{}",
            js
        );
    }

    /// An update-only handler gets the same frame binding and no create-side
    /// id write-back.
    #[test]
    fn update_only_handler_does_not_seed_an_entity() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task();

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());

        let mut trans = OirTransition::new("backlog", "backlog", "UPDATE_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Update,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: None,
        }));
        trait_def.transitions.push(trans);

        let event_def = OirEvent::new("UPDATE_TASK");
        trait_def.events.push(event_def.clone());

        let js = backend.generate_event_handler_function(
            &trait_def,
            &event_def,
            &module,
            "handleUpdateTask",
        );

        assert!(
            js.contains("const entity: Task = resolveEntityView({ frame: entityFrame, row: __row, id: entityId, allowedFrameKeys: __FRAME_KEYS }) as Task;"),
            "UPDATE_TASK handler must bind entity from payload id + row + request frame, got:\n{}",
            js
        );
        assert!(
            !js.contains("entity.id = created.id"),
            "UPDATE_TASK handler has no create, so no id write-back, got:\n{}",
            js
        );
    }

    /// §87 (`Almadar_Compiler_Gaps.md`): std-realtime-chat's
    /// `DirectMessageStarter.AUTO_OPEN` — `(set @entity.openChannel …)` then
    /// `(emit CONVERSATION_OPENED { channel: @entity.openChannel })` on an
    /// event whose payload names no row. The handler used to bind `entity`
    /// to `null`, skip the `set` behind `if (entity)`, and emit `''`. Pins
    /// the whole contract: the handler takes the request frame, binds
    /// `entity` from id + row + frame, writes the field unconditionally, and
    /// echoes the written fields back in the response.
    #[test]
    fn handler_binds_request_frame_writes_set_unconditionally_and_returns_fields() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task();

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());

        let mut trans = OirTransition::new("backlog", "backlog", "AUTO_OPEN");
        trans.effects.push(OirExpr::effect(OirEffect::Set {
            target: OirBinding::entity(vec!["openChannel".to_string()]),
            value: OirExpr::binding(OirBinding::payload(vec!["channel".to_string()])),
            emit: None,
        }));
        trans.effects.push(OirExpr::effect(OirEffect::Emit {
            event: "CONVERSATION_OPENED".to_string(),
            payload: Some(OirExpr::binding(OirBinding::entity(vec![
                "openChannel".to_string()
            ]))),
        }));
        trait_def.transitions.push(trans);

        let event_def = OirEvent::new("AUTO_OPEN");
        trait_def.events.push(event_def.clone());

        let js = backend.generate_event_handler_function(
            &trait_def,
            &event_def,
            &module,
            "handleAutoOpen",
        );

        assert!(
            js.contains("  clientId: string | undefined,\n  entityFrame: EntityRow | undefined\n): Promise<EventResponse> {"),
            "handler must accept the request frame, got:\n{}",
            js
        );
        assert!(
            js.contains("const __row: Task | null = entityId ? await getDataService().getById<Task>('tasks', entityId) : null;"),
            "handler must still resolve the row by id, got:\n{}",
            js
        );
        assert!(
            js.contains("const entity: Task = resolveEntityView({ frame: entityFrame, row: __row, id: entityId, allowedFrameKeys: __FRAME_KEYS }) as Task;"),
            "handler must layer the request frame over the row, got:\n{}",
            js
        );
        assert!(
            !js.contains("if (entity) {"),
            "set must no longer be guarded on a resolved row, got:\n{}",
            js
        );
        assert!(
            js.contains("entity.openChannel = ("),
            "set must write the field unconditionally, got:\n{}",
            js
        );
        assert!(
            js.contains("entityByTrait: { 'TaskLifecycle': { openChannel: entity.openChannel } },"),
            "response must echo the written fields, got:\n{}",
            js
        );
        assert!(
            js.contains("if (__row !== null && entityId !== undefined) {"),
            "auto-persist must stay gated on a real row, got:\n{}",
            js
        );
    }

    #[test]
    fn persist_target_intrinsics_escape_valid_localized_field_names() {
        // The validator accepting these names is pinned in orbital-integration-tests
        // (`localized_intrinsic_field_names_validate`).
        use crate::codegen::effect::PersistDataValidation;
        let backend = TypeScriptBackend::new();
        for (name, encoded) in [("draft", "draft"), ("حقل'\\مؤقت", "حقل\\'\\\\مؤقت")]
        {
            let mut module = module_with_task_frame_field();
            module.entities[0].fields.last_mut().unwrap().name = name.into();
            for validation in [
                PersistDataValidation::Cast,
                PersistDataValidation::ZodSchema {
                    entity_lower: "task".into(),
                },
            ] {
                let js = backend.generate_persist_block(
                    &OirPersistOp::Update,
                    "Task",
                    &OirExpr::binding(OirBinding::entity(vec![])),
                    &None,
                    &module,
                    Some("Task"),
                    &validation,
                );
                assert!(
                    js.contains(&format!("omitFrameFields(entity, ['{encoded}'])")),
                    "{js}"
                );
            }
        }
    }

    #[test]
    fn persist_target_intrinsics_cover_all_operands_and_backends() {
        use crate::codegen::effect::PersistDataValidation;
        let backend = TypeScriptBackend::new();
        for persistence in [OirPersistence::Persistent, OirPersistence::Runtime] {
            for intrinsic in [false, true] {
                let mut module = module_with_task_frame_field();
                module.entities[0].persistence = persistence;
                module.entities[0].fields.last_mut().unwrap().intrinsic = intrinsic;
                module.entities[0]
                    .fields
                    .push(OirField::new("shippingAddress", OirType::String));
                let mut source = module.entities[0].clone();
                source.name = "Checkout".into();
                source.persistence = OirPersistence::Runtime;
                source.fields.last_mut().unwrap().intrinsic = true;
                module.entities.push(source);
                let bare = OirExpr::binding(OirBinding::entity(vec![]));
                let object = OirExpr::Object {
                    fields: [
                        (
                            "shippingAddress".into(),
                            OirExpr::String {
                                value: "address".into(),
                            },
                        ),
                        (
                            "draft".into(),
                            OirExpr::String {
                                value: "scratch".into(),
                            },
                        ),
                    ]
                    .into_iter()
                    .collect(),
                };
                let merged = OirExpr::call("object/merge", vec![bare.clone(), object.clone()]);
                for (is_bare, data) in [(true, bare), (false, object), (false, merged)] {
                    for operation in [OirPersistOp::Create, OirPersistOp::Update] {
                        for validation in [
                            PersistDataValidation::Cast,
                            PersistDataValidation::ZodSchema {
                                entity_lower: "task".into(),
                            },
                        ] {
                            let js = backend.generate_persist_block(
                                &operation,
                                "Task",
                                &data,
                                &None,
                                &module,
                                Some("Checkout"),
                                &validation,
                            );
                            assert!(!js.contains("__FRAME_KEYS"), "{js}");
                            assert_eq!(js.contains("omitFrameFields("), intrinsic, "{js}");
                            if intrinsic {
                                assert!(js.contains(", ['draft'])"), "{js}");
                            }
                            assert!(!js.contains("['shippingAddress']"), "{js}");
                            assert_eq!(
                                js.contains("if (created && entity) { entity.id = created.id; }"),
                                is_bare && matches!(operation, OirPersistOp::Create),
                                "{js}"
                            );
                            if !is_bare {
                                assert!(js.contains("shippingAddress"), "{js}");
                            }
                            let binding = if matches!(operation, OirPersistOp::Create) {
                                "createData"
                            } else {
                                "updateData"
                            };
                            assert!(js.contains(binding), "{js}");
                        }
                    }
                }
                let deletion = backend.generate_persist_block(
                    &OirPersistOp::Delete,
                    "Task",
                    &OirExpr::String { value: "id".into() },
                    &None,
                    &module,
                    Some("Checkout"),
                    &PersistDataValidation::Cast,
                );
                assert!(!deletion.contains("omitFrameFields("), "{deletion}");
            }
        }
    }

    /// std-agent-suggestions updates with `{ id: (object/get (array/first ?data) id), … }`: a
    /// literal row of wide reads is no `EntityRow` (`id: FieldValue`), so the frame strip takes
    /// it through an `EntityRow` assertion (TS2322 otherwise).
    #[test]
    fn a_literal_row_is_asserted_to_an_entity_row_before_the_frame_strip() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task_frame_field();
        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());
        let mut trans = OirTransition::new("backlog", "backlog", "SAVE");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Update,
            entity_type: "Task".to_string(),
            data: OirExpr::object(
                [(
                    "id".to_string(),
                    OirExpr::call("object/get", vec![OirExpr::binding(OirBinding::parse("@payload.row").unwrap()), OirExpr::string("id")]),
                )]
                .into_iter()
                .collect(),
            ),
            emit: None,
        }));
        trait_def.transitions.push(trans);
        let event_def = OirEvent::new("SAVE");
        trait_def.events.push(event_def.clone());
        let js = backend.generate_event_handler_function(&trait_def, &event_def, &module, "handleSave");
        assert!(js.contains("omitFrameFields(({ id: "), "{js}");
        assert!(js.contains(" as EntityRow, ['draft'])"), "{js}");
    }

    /// §88: `(persist create Task @entity)` on a policied entity must check
    /// the `@create` policy AND write the store with `entity`'s `@intrinsic`
    /// frame fields stripped — `entity` carries the client-supplied frame
    /// layered on by `resolveEntityView`, which is untrusted view-state, not
    /// something a policy should authorize on or a store should persist.
    #[test]
    fn create_from_bare_entity_strips_frame_before_policy_check_and_store_write() {
        let backend = TypeScriptBackend::new();
        let mut module = module_with_task_frame_field();
        module.entities[0].create_policy = Some(OirExpr::Bool { value: true });

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());

        let mut trans = OirTransition::new("backlog", "backlog", "CREATE_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Create,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: None,
        }));
        trait_def.transitions.push(trans);

        let event_def = OirEvent::new("CREATE_TASK");
        trait_def.events.push(event_def.clone());

        let js = backend.generate_event_handler_function(
            &trait_def,
            &event_def,
            &module,
            "handleCreateTask",
        );

        assert!(
            js.contains("const __FRAME_KEYS: readonly string[] = ['draft'];"),
            "must declare the frame allow-list from the entity's @intrinsic fields, got:\n{}",
            js
        );
        assert!(
            js.contains(
                "const createData = (omitFrameFields(entity, ['draft'])) as Record<string, FieldValue | undefined> as Partial<Task> | undefined;"
            ),
            "createData sourced from bare @entity must be frame-stripped before the cast, got:\n{}",
            js
        );
        assert!(
            js.contains("const createAllowed = createData ? checkMutationAccess(createData, TASK_CREATE_POLICY, { user, now }) : true;"),
            "policy check reads the already frame-stripped createData, no extra wrap needed, got:\n{}",
            js
        );
        assert!(
            js.contains("await pushCreate<Task>(getDataService(), { collection: 'tasks', data: createData })"),
            "store write must use the same frame-stripped createData, got:\n{}",
            js
        );
    }

    /// §88: `@update`'s policy check re-fetches the row fresh and checks
    /// THAT, never the client-derived `entity`/`updateData` — what the
    /// caller may touch is decided by the stored row, not by the patch they
    /// sent (nor by whatever frame the client attached to the request).
    #[test]
    fn update_policy_checks_the_freshly_fetched_row_not_entity_or_update_data() {
        let backend = TypeScriptBackend::new();
        let mut module = module_with_task_frame_field();
        module.entities[0].update_policy = Some(OirExpr::Bool { value: true });

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());

        let mut trans = OirTransition::new("backlog", "backlog", "UPDATE_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Update,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: None,
        }));
        trait_def.transitions.push(trans);

        let event_def = OirEvent::new("UPDATE_TASK");
        trait_def.events.push(event_def.clone());

        let js = backend.generate_event_handler_function(
            &trait_def,
            &event_def,
            &module,
            "handleUpdateTask",
        );

        assert!(
            js.contains("const __updWrite = await pushUpdate<Task>(getDataService(), { collection: 'tasks', id: updateId, data: updateData ?? {}, policy: TASK_UPDATE_POLICY,"),
            "the update policy must reach the guarded write as the stored-row guard, got:\n{}",
            js
        );
        assert!(
            js.contains("if (__updWrite.kind === 'denied')"),
            "a refused guarded write must take the denied branch, got:\n{}",
            js
        );
        assert!(
            !js.contains("checkMutationAccess(entity,")
                && !js.contains("checkMutationAccess(updateData,"),
            "policy must never check the client-derived entity/updateData directly, got:\n{}",
            js
        );
    }

    /// §88: a `set` that touches ONLY `@intrinsic` frame fields (trait-owned
    /// view-state, never a persisted column) must not trigger the
    /// auto-generated persist — there is nothing new to write.
    #[test]
    fn auto_persist_skipped_when_only_the_id_binding_is_set() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task();

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());

        let mut trans = OirTransition::new("idle", "viewing", "OPEN_VIEW");
        trans.effects.push(OirExpr::effect(OirEffect::Set {
            target: OirBinding::entity(vec!["id".to_string()]),
            value: OirExpr::binding(OirBinding::payload(vec!["id".to_string()])),
            emit: None,
        }));
        trait_def.transitions.push(trans);

        let event_def = OirEvent::new("OPEN_VIEW");
        trait_def.events.push(event_def.clone());

        let js = backend.generate_event_handler_function(
            &trait_def,
            &event_def,
            &module,
            "handleOpenView",
        );

        assert!(
            !js.contains("Persist entity mutations (auto-generated from set effects)"),
            "binding the row id is not a column write and must not auto-persist, got:\n{}",
            js
        );
    }

    #[test]
    fn auto_persist_skipped_when_only_intrinsic_fields_are_set() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task_frame_field();

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());

        let mut trans = OirTransition::new("backlog", "backlog", "DRAFT_CHANGED");
        trans.effects.push(OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.draft").unwrap(),
            OirExpr::string("scratch text"),
        )));
        trait_def.transitions.push(trans);

        let event_def = OirEvent::new("DRAFT_CHANGED");
        trait_def.events.push(event_def.clone());

        let js = backend.generate_event_handler_function(
            &trait_def,
            &event_def,
            &module,
            "handleDraftChanged",
        );

        assert!(
            !js.contains("Persist entity mutations (auto-generated from set effects)"),
            "an intrinsic-only set must not trigger auto-persist, got:\n{}",
            js
        );
    }

    /// §88: a `set` that touches a NON-intrinsic field still auto-persists,
    /// and the write strips this entity's `@intrinsic` frame fields first.
    #[test]
    fn auto_persist_strips_frame_fields_when_a_non_intrinsic_field_is_set() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task_frame_field();

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());

        let mut trans = OirTransition::new("backlog", "backlog", "RENAME_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.title").unwrap(),
            OirExpr::string("new title"),
        )));
        trait_def.transitions.push(trans);

        let event_def = OirEvent::new("RENAME_TASK");
        trait_def.events.push(event_def.clone());

        let js = backend.generate_event_handler_function(
            &trait_def,
            &event_def,
            &module,
            "handleRenameTask",
        );

        assert!(
            js.contains("Persist entity mutations (auto-generated from set effects)"),
            "a non-intrinsic set must still trigger auto-persist, got:\n{}",
            js
        );
        assert!(
            js.contains(
                "await pushUpdate<Task>(getDataService(), { collection: 'tasks', id: entityId, data: omitFrameFields(entity, __FRAME_KEYS) as Partial<Task>, policy: undefined,"
            ),
            "auto-persist write must strip the entity's frame fields, got:\n{}",
            js
        );
    }

    /// §88: the Express AND Hono backends share the exact same
    /// `entity_frame_binding` helper (`codegen/handler_header.rs`) — pin
    /// that both generated outputs bind `@entity` through the new
    /// `resolveEntityView` call and neither regresses to the old untrusted
    /// spread-merge (`...(__row ?? {}), ...(fields ?? {})`, where a
    /// client-supplied frame could override the fetched row).
    #[test]
    fn both_backends_bind_entity_through_resolve_entity_view() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task();

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());
        trait_def.states.push(OirState::initial("backlog"));
        trait_def
            .transitions
            .push(OirTransition::new("backlog", "backlog", "UPDATE_TASK"));
        trait_def.events.push(OirEvent::new("UPDATE_TASK"));

        let express_js = backend
            .generate_trait_event_handler_file(&trait_def, &module, "task-lifecycle")
            .content;
        let hono_js = backend
            .generate_trait_event_handler_file_hono(&trait_def, &module, "task-lifecycle")
            .content;

        for (name, js) in [("Express", &express_js), ("Hono", &hono_js)] {
            assert!(
                js.contains("resolveEntityView("),
                "{name} handler must bind @entity through resolveEntityView:\n{js}"
            );
            assert!(
                !js.contains("...(__row ?? {}), ...(fields ?? {})"),
                "{name} handler must not regress to the old untrusted spread-merge:\n{js}"
            );
        }
    }

    /// std-learn-generate's FILL carries `roster : SExpr!`: the handler's payload parameter is
    /// typed `{ roster: SExpr }`, so both backends import `SExpr` (TS2304 otherwise).
    #[test]
    fn both_backends_import_sexpr_for_a_payload_that_carries_one() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task();
        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());
        trait_def.states.push(OirState::initial("backlog"));
        trait_def.transitions.push(OirTransition::new("backlog", "backlog", "FILL"));
        let mut fill = OirEvent::new("FILL");
        fill.payload_schema = Some([("roster".to_string(), OirType::SExpr)].into_iter().collect());
        trait_def.events.push(fill);
        let express_js = backend.generate_trait_event_handler_file(&trait_def, &module, "task-lifecycle").content;
        let hono_js = backend.generate_trait_event_handler_file_hono(&trait_def, &module, "task-lifecycle").content;
        for (name, js) in [("Express", &express_js), ("Hono", &hono_js)] {
            let core_import = js.lines().find(|l| l.starts_with("import type {") && l.ends_with("from '@almadar/core';")).unwrap_or("");
            assert!(js.contains("roster: SExpr"), "{name}:\n{js}");
            assert!(core_import.contains("SExpr"), "{name} must import SExpr: {core_import}");
        }
    }

    #[test]
    fn both_backends_bind_the_row_from_a_row_bearing_payload() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task();
        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());
        trait_def.states.push(OirState::initial("backlog"));
        trait_def
            .transitions
            .push(OirTransition::new("backlog", "backlog", "OPEN_THREAD"));
        trait_def.events.push(OirEvent::new("OPEN_THREAD"));
        let express_js = backend
            .generate_trait_event_handler_file(&trait_def, &module, "task-lifecycle")
            .content;
        let hono_js = backend
            .generate_trait_event_handler_file_hono(&trait_def, &module, "task-lifecycle")
            .content;
        for (name, js) in [("Express", &express_js), ("Hono", &hono_js)] {
            assert!(
                js.contains("typeof __payloadRowId === 'string' ? __payloadRowId"),
                "{name} handler must bind @entity from a `row`-bearing payload (the same contract the validator's row-binding check uses):\n{js}"
            );
        }
    }

    #[test]
    fn both_backends_import_access_policy_helpers_for_a_policied_entity() {
        let backend = TypeScriptBackend::new();
        let mut module = module_with_task();
        module.entities[0].create_policy = Some(OirExpr::bool(true));

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());
        trait_def.states.push(OirState::initial("backlog"));
        let mut trans = OirTransition::new("backlog", "backlog", "CREATE_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Create,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: None,
        }));
        trait_def.transitions.push(trans);
        trait_def.events.push(OirEvent::new("CREATE_TASK"));

        let express_js = backend
            .generate_trait_event_handler_file(&trait_def, &module, "task-lifecycle")
            .content;
        let hono_js = backend
            .generate_trait_event_handler_file_hono(&trait_def, &module, "task-lifecycle")
            .content;

        for (name, js) in [("Express", &express_js), ("Hono", &hono_js)] {
            assert!(
                js.contains("checkMutationAccess("),
                "{name} handler must evaluate the @create policy:\n{js}"
            );
            assert!(
                js.contains("import { checkMutationAccess } from '@almadar/evaluator/entityAccess';"),
                "{name} handler must import the helper it calls:\n{js}"
            );
            assert!(
                js.contains("TASK_CREATE_POLICY } from '../../../access-policies.js';")
                    || js.contains("{ TASK_CREATE_POLICY } from '../../../access-policies.js';"),
                "{name} handler must import the policy const it references:\n{js}"
            );
            assert!(
                !js.contains(ACCESS_IMPORT_MARKER),
                "{name} handler must not leak the access-import marker:\n{js}"
            );
        }
    }

    /// §102 (Almadar_Compiler_Gaps.md): a `persist update` whose resolved id
    /// names no existing row must report `success: false` and fire the
    /// configured `emit.failure` event — not `success: true` with `data:
    /// null` (the two-path divergence: the interpreter throws "not found"
    /// and routes to `emit.failure`; this codegen used to report success on
    /// a write that never landed).
    #[test]
    fn persist_update_miss_emits_failure_not_success_both_backends() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task();

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());
        trait_def.states.push(OirState::initial("backlog"));
        let mut trans = OirTransition::new("backlog", "backlog", "UPDATE_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Update,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: Some(orbital_core::ir::OirEmitConfig {
                success: Some("TASK_UPDATED".to_string()),
                failure: Some("TASK_UPDATE_FAILED".to_string()),
                on_change: None,
                on_message: None,
                cancelled: None,
            }),
        }));
        trait_def.transitions.push(trans);
        trait_def.events.push(OirEvent::new("UPDATE_TASK"));

        let express_js = backend
            .generate_trait_event_handler_file(&trait_def, &module, "task-lifecycle")
            .content;
        let hono_js = backend
            .generate_trait_event_handler_file_hono(&trait_def, &module, "task-lifecycle")
            .content;

        for (name, js) in [("Express", &express_js), ("Hono", &hono_js)] {
            assert!(
                js.contains("if (updated === null)"),
                "{name} handler must branch on a null update result:\n{js}"
            );
            assert!(
                js.contains("code: 'not-found'"),
                "{name} handler must tag the miss with a not-found code:\n{js}"
            );
            assert!(
                js.contains("getServerEventBus().emit('TASK_UPDATE_FAILED'"),
                "{name} handler must fire the configured emit.failure event on a miss:\n{js}"
            );
            let miss_idx = js.find("if (updated === null)").unwrap();
            let failure_idx = js
                .find("getServerEventBus().emit('TASK_UPDATE_FAILED'")
                .unwrap();
            let success_emit_idx = js.find("getServerEventBus().emit('TASK_UPDATED'").unwrap();
            assert!(
                failure_idx > miss_idx,
                "{name} handler's failure emit must live inside the miss branch:\n{js}"
            );
            assert!(
                success_emit_idx > failure_idx,
                "{name} handler must emit success only in the found-row branch, after the miss branch:\n{js}"
            );
        }
    }

    /// §102: a `persist delete` whose resolved id names no existing row must
    /// report failure the same way — `deleted === false` from the store, not
    /// `success: true` with a fabricated `{ deleted: true }`.
    #[test]
    fn persist_delete_miss_emits_failure_not_success_both_backends() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task();

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());
        trait_def.states.push(OirState::initial("backlog"));
        let mut trans = OirTransition::new("backlog", "backlog", "DELETE_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Delete,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: Some(orbital_core::ir::OirEmitConfig {
                success: Some("TASK_DELETED".to_string()),
                failure: Some("TASK_DELETE_FAILED".to_string()),
                on_change: None,
                on_message: None,
                cancelled: None,
            }),
        }));
        trait_def.transitions.push(trans);
        trait_def.events.push(OirEvent::new("DELETE_TASK"));

        let express_js = backend
            .generate_trait_event_handler_file(&trait_def, &module, "task-lifecycle")
            .content;
        let hono_js = backend
            .generate_trait_event_handler_file_hono(&trait_def, &module, "task-lifecycle")
            .content;

        for (name, js) in [("Express", &express_js), ("Hono", &hono_js)] {
            assert!(
                js.contains("const __delWrite = await pushDelete<Task>(getDataService(), { collection: 'tasks', id: deleteId,"),
                "{name} handler must capture the delete result:\n{js}"
            );
            assert!(
                js.contains("if (deleted === false)"),
                "{name} handler must branch on a false delete result:\n{js}"
            );
            assert!(
                js.contains("code: 'not-found'"),
                "{name} handler must tag the miss with a not-found code:\n{js}"
            );
            assert!(
                js.contains("getServerEventBus().emit('TASK_DELETE_FAILED'"),
                "{name} handler must fire the configured emit.failure event on a miss:\n{js}"
            );
            assert!(
                js.contains("getServerEventBus().emit('TASK_DELETED'"),
                "{name} handler must still emit success on a found row:\n{js}"
            );
        }
    }

    /// §102: an unresolved row key (`updateId`/`deleteId` never resolved from
    /// data/entity/payload) is also a failed persist, not a silent no-op —
    /// it must report `success: false` and fire `emit.failure` too.
    #[test]
    fn persist_update_no_row_key_emits_failure_both_backends() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task();

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());
        trait_def.states.push(OirState::initial("backlog"));
        let mut trans = OirTransition::new("backlog", "backlog", "UPDATE_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Update,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: Some(orbital_core::ir::OirEmitConfig {
                success: Some("TASK_UPDATED".to_string()),
                failure: Some("TASK_UPDATE_FAILED".to_string()),
                on_change: None,
                on_message: None,
                cancelled: None,
            }),
        }));
        trait_def.transitions.push(trans);
        trait_def.events.push(OirEvent::new("UPDATE_TASK"));

        let express_js = backend
            .generate_trait_event_handler_file(&trait_def, &module, "task-lifecycle")
            .content;
        let hono_js = backend
            .generate_trait_event_handler_file_hono(&trait_def, &module, "task-lifecycle")
            .content;

        for (name, js) in [("Express", &express_js), ("Hono", &hono_js)] {
            assert!(
                js.contains("code: 'no-row-key'"),
                "{name} handler must tag an unresolved row key with a no-row-key code:\n{js}"
            );
            assert!(
                js.contains("getServerEventBus().emit('TASK_UPDATE_FAILED'"),
                "{name} handler must fire emit.failure when updateId never resolves:\n{js}"
            );
        }
    }

    /// §102 regression pin: a found row's persist update/delete must still
    /// report `success: true` and fire the configured `emit.success` event —
    /// the miss-handling addition must not swallow the happy path.
    #[test]
    fn persist_update_found_row_still_emits_success_both_backends() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task();

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());
        trait_def.states.push(OirState::initial("backlog"));
        let mut trans = OirTransition::new("backlog", "backlog", "UPDATE_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Update,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: Some(orbital_core::ir::OirEmitConfig {
                success: Some("TASK_UPDATED".to_string()),
                failure: Some("TASK_UPDATE_FAILED".to_string()),
                on_change: None,
                on_message: None,
                cancelled: None,
            }),
        }));
        trait_def.transitions.push(trans);
        trait_def.events.push(OirEvent::new("UPDATE_TASK"));

        let express_js = backend
            .generate_trait_event_handler_file(&trait_def, &module, "task-lifecycle")
            .content;
        let hono_js = backend
            .generate_trait_event_handler_file_hono(&trait_def, &module, "task-lifecycle")
            .content;

        for (name, js) in [("Express", &express_js), ("Hono", &hono_js)] {
            assert!(
                js.contains("success: true,\n            data: updated,"),
                "{name} handler must still push a success effect result on a found row:\n{js}"
            );
            assert!(
                js.contains("getServerEventBus().emit('TASK_UPDATED'"),
                "{name} handler must still fire emit.success on a found row:\n{js}"
            );
        }
    }

    /// §102 follow-on: `@update`/`@delete` access-denied already reported
    /// `success: false` in `effectResults` but never fired the configured
    /// `emit.failure` event — the same "reports failure, never signals it"
    /// gap as the not-found miss, on the sibling branch that already had the
    /// right if/else shape to carry it. One invariant, enforced once.
    #[test]
    fn persist_update_denied_also_fires_the_failure_event_both_backends() {
        let backend = TypeScriptBackend::new();
        let mut module = module_with_task();
        module.entities[0].update_policy = Some(OirExpr::bool(true));

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());
        trait_def.states.push(OirState::initial("backlog"));
        let mut trans = OirTransition::new("backlog", "backlog", "UPDATE_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Update,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: Some(orbital_core::ir::OirEmitConfig {
                success: Some("TASK_UPDATED".to_string()),
                failure: Some("TASK_UPDATE_FAILED".to_string()),
                on_change: None,
                on_message: None,
                cancelled: None,
            }),
        }));
        trait_def.transitions.push(trans);
        trait_def.events.push(OirEvent::new("UPDATE_TASK"));

        let express_js = backend
            .generate_trait_event_handler_file(&trait_def, &module, "task-lifecycle")
            .content;
        let hono_js = backend
            .generate_trait_event_handler_file_hono(&trait_def, &module, "task-lifecycle")
            .content;

        for (name, js) in [("Express", &express_js), ("Hono", &hono_js)] {
            assert!(
                js.contains("if (__updWrite.kind === 'denied')"),
                "{name} handler must still gate on the update policy:\n{js}"
            );
            assert!(
                js.contains("getServerEventBus().emit('TASK_UPDATE_FAILED'"),
                "{name} handler must fire emit.failure when the policy denies the update:\n{js}"
            );
            let denied_idx = js.find("if (__updWrite.kind === 'denied')").unwrap();
            let failure_idx = js
                .find("getServerEventBus().emit('TASK_UPDATE_FAILED'")
                .unwrap();
            assert!(
                failure_idx > denied_idx,
                "{name} handler's failure emit must live inside the denied branch:\n{js}"
            );
        }
    }

    /// §104 (Almadar_Compiler_Gaps.md): a `persist create` denied by the `@create`
    /// policy pushed `effectResults` TWICE (once with the denial, once more
    /// unconditionally with `success: !!created` where `created` is `null`) and
    /// still fired the configured `emit.success` event — a denied create must
    /// report exactly ONE result and route `emit.failure`, never `emit.success`.
    #[test]
    fn persist_create_denied_pushes_once_and_fires_failure_not_success_both_backends() {
        let backend = TypeScriptBackend::new();
        let mut module = module_with_task();
        module.entities[0].create_policy = Some(OirExpr::bool(true));

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());
        trait_def.states.push(OirState::initial("backlog"));
        let mut trans = OirTransition::new("backlog", "backlog", "CREATE_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Create,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: Some(orbital_core::ir::OirEmitConfig {
                success: Some("TASK_CREATED".to_string()),
                failure: Some("TASK_CREATE_FAILED".to_string()),
                on_change: None,
                on_message: None,
                cancelled: None,
            }),
        }));
        trait_def.transitions.push(trans);
        trait_def.events.push(OirEvent::new("CREATE_TASK"));

        let express_js = backend
            .generate_trait_event_handler_file(&trait_def, &module, "task-lifecycle")
            .content;
        let hono_js = backend
            .generate_trait_event_handler_file_hono(&trait_def, &module, "task-lifecycle")
            .content;

        for (name, js) in [("Express", &express_js), ("Hono", &hono_js)] {
            let denied_idx = js.find("if (createData && !createAllowed) {").unwrap();
            let else_idx = js[denied_idx..]
                .find("} else {")
                .map(|i| denied_idx + i)
                .unwrap();
            let denied_branch = &js[denied_idx..else_idx];
            assert_eq!(
                denied_branch.matches("effect: 'persist'").count(),
                1,
                "{name} handler must push exactly ONE persist effectResult on a denied create:\n{denied_branch}"
            );
            assert!(
                denied_branch.contains("getServerEventBus().emit('TASK_CREATE_FAILED'"),
                "{name} handler must fire emit.failure when the policy denies the create:\n{denied_branch}"
            );
            assert!(
                !denied_branch.contains("getServerEventBus().emit('TASK_CREATED'"),
                "{name} handler must NOT fire emit.success when the policy denies the create:\n{denied_branch}"
            );
        }
    }

    /// Required-column twin of `persist_create_denied_pushes_once_and_fires_
    /// failure_not_success_both_backends`: a `persist create` whose data is
    /// missing a declared REQUIRED column (`content`) must fail the write —
    /// same `success: false` / `emit.failure`-not-`emit.success` shape as a
    /// denied create, never falling through to the store write.
    #[test]
    fn persist_create_missing_required_field_fires_failure_not_success_both_backends() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task_required_field();

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());
        trait_def.states.push(OirState::initial("backlog"));
        let mut trans = OirTransition::new("backlog", "backlog", "CREATE_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Create,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: Some(orbital_core::ir::OirEmitConfig {
                success: Some("TASK_CREATED".to_string()),
                failure: Some("TASK_CREATE_FAILED".to_string()),
                on_change: None,
                on_message: None,
                cancelled: None,
            }),
        }));
        trait_def.transitions.push(trans);
        trait_def.events.push(OirEvent::new("CREATE_TASK"));

        let express_js = backend
            .generate_trait_event_handler_file(&trait_def, &module, "task-lifecycle")
            .content;
        let hono_js = backend
            .generate_trait_event_handler_file_hono(&trait_def, &module, "task-lifecycle")
            .content;

        for (name, js) in [("Express", &express_js), ("Hono", &hono_js)] {
            assert!(
                js.contains("const __requiredFields = ['content'];"),
                "{name} handler must declare the required-column list, excluding the \
                 default-bearing and @intrinsic required fields:\n{js}"
            );
            let gate_idx = js
                .find("if (createData && __missingRequired.length > 0) {")
                .unwrap();
            let else_idx = js[gate_idx..]
                .find("} else {")
                .map(|i| gate_idx + i)
                .unwrap();
            let missing_branch = &js[gate_idx..else_idx];
            assert_eq!(
                missing_branch.matches("effect: 'persist'").count(),
                1,
                "{name} handler must push exactly ONE persist effectResult when a required column is missing:\n{missing_branch}"
            );
            assert!(
                missing_branch.contains(
                    "persist create Task: required field(s) ${__missingRequired.join(', ')} missing"
                ),
                "{name} handler must report the exact required-column-missing message:\n{missing_branch}"
            );
            assert!(
                missing_branch.contains("getServerEventBus().emit('TASK_CREATE_FAILED'"),
                "{name} handler must fire emit.failure when a required column is missing:\n{missing_branch}"
            );
            assert!(
                !missing_branch.contains("getServerEventBus().emit('TASK_CREATED'"),
                "{name} handler must NOT fire emit.success when a required column is missing:\n{missing_branch}"
            );
            assert!(
                !missing_branch.contains("getDataService().create"),
                "{name} handler must NOT reach the store write when a required column is missing:\n{missing_branch}"
            );
        }
    }

    /// A `merged_from` field (added onto the host entity by the inline
    /// phase's rebind merge from an imported atom's entity, never authored
    /// by the host) must NOT appear in the generated `__requiredFields`
    /// array even when it declares `required: true` — that `!` is the
    /// imported atom's own write contract, never the host's `persist
    /// create` obligation. See `OirEntity::required_create_field_names`.
    #[test]
    fn persist_create_merged_from_field_excluded_from_required_fields_both_backends() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task_merged_from_field();

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());
        trait_def.states.push(OirState::initial("backlog"));
        let mut trans = OirTransition::new("backlog", "backlog", "CREATE_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Create,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: Some(orbital_core::ir::OirEmitConfig {
                success: Some("TASK_CREATED".to_string()),
                failure: Some("TASK_CREATE_FAILED".to_string()),
                on_change: None,
                on_message: None,
                cancelled: None,
            }),
        }));
        trait_def.transitions.push(trans);
        trait_def.events.push(OirEvent::new("CREATE_TASK"));

        let express_js = backend
            .generate_trait_event_handler_file(&trait_def, &module, "task-lifecycle")
            .content;
        let hono_js = backend
            .generate_trait_event_handler_file_hono(&trait_def, &module, "task-lifecycle")
            .content;

        for (name, js) in [("Express", &express_js), ("Hono", &hono_js)] {
            assert!(
                js.contains("const __requiredFields = ['content'];"),
                "{name} handler must exclude the merged_from field from __requiredFields, \
                 keeping only the host-authored required column:\n{js}"
            );
            assert!(
                !js.contains("'name'"),
                "{name} handler must never list the merged_from field as required:\n{js}"
            );
        }
    }

    /// An entity with no genuine required column (only `id`, which is a
    /// `FRAMEWORK_STAMPED_FIELDS` member) must emit byte-identical create
    /// codegen to before this feature — no dead required-column check.
    #[test]
    fn persist_create_with_no_required_columns_emits_no_required_check_both_backends() {
        let backend = TypeScriptBackend::new();
        let module = module_with_task();

        let mut trait_def = OirTrait::new("TaskLifecycle");
        trait_def.linked_entity = Some("Task".to_string());
        trait_def.states.push(OirState::initial("backlog"));
        let mut trans = OirTransition::new("backlog", "backlog", "CREATE_TASK");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Create,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: Some(orbital_core::ir::OirEmitConfig {
                success: Some("TASK_CREATED".to_string()),
                failure: Some("TASK_CREATE_FAILED".to_string()),
                on_change: None,
                on_message: None,
                cancelled: None,
            }),
        }));
        trait_def.transitions.push(trans);
        trait_def.events.push(OirEvent::new("CREATE_TASK"));

        let express_js = backend
            .generate_trait_event_handler_file(&trait_def, &module, "task-lifecycle")
            .content;
        let hono_js = backend
            .generate_trait_event_handler_file_hono(&trait_def, &module, "task-lifecycle")
            .content;

        for (name, js) in [("Express", &express_js), ("Hono", &hono_js)] {
            assert!(
                !js.contains("__requiredFields"),
                "{name} handler must not emit a required-column check for an entity with none declared:\n{js}"
            );
            assert!(
                js.contains("getServerEventBus().emit('TASK_CREATED'"),
                "{name} handler must still fire emit.success on a plain create:\n{js}"
            );
        }
    }
}

/// §84 (Almadar_Compiler_Gaps.md): a dispatched event whose only declared
/// arm(s) in the current state are guarded, and the guard doesn't hold, must
/// resolve as a benign no-op — matching `@almadar/runtime`'s
/// `StateMachineCore.processEvent`, which returns `{executed: false,
/// newState: unchanged}` for the identical case and never rejects the
/// request. The server previously fabricated a `{success: false, error:
/// 'Access denied: guard condition not met'}` response here, which the
/// compiled path invented independent of the runtime — surfacing as a real
/// error for events (like `std-browse`'s `VIEW`) whose guard exists only to
/// gate an alternate UI variant, not to authorize a mutation.
#[cfg(test)]
mod guard_rejection_is_a_noop_tests {
    use super::*;
    use orbital_core::ir::{OirBinding, OirField};

    fn module_with_chat_message() -> OirModule {
        let mut m = OirModule::new("TestApp", "0.1.0");
        m.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "ChatMessage".to_string(),
            description: None,
            collection: "chat_messages".to_string(),
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
        m
    }

    fn two_arms(unguarded_first: bool) -> String {
        let backend = TypeScriptBackend::new();
        let module = module_with_chat_message();
        let mut trait_def = OirTrait::new("ChatComposer");
        trait_def.linked_entity = Some("ChatMessage".to_string());
        let plain = OirTransition::new("ready", "plainTarget", "SEND");
        let mut guarded = OirTransition::new("ready", "guardedTarget", "SEND");
        guarded.guard = Some(OirExpr::binding(OirBinding::entity(vec![
            "activeChannel".to_string()
        ])));
        if unguarded_first {
            trait_def.transitions.push(plain);
            trait_def.transitions.push(guarded);
        } else {
            trait_def.transitions.push(guarded);
            trait_def.transitions.push(plain);
        }
        let event_def = OirEvent::new("SEND");
        trait_def.events.push(event_def.clone());
        backend.generate_event_handler_function(&trait_def, &event_def, &module, "handleSend")
    }

    /// Transitions sharing (state, event) are tried in declaration order on every path
    /// (Rust kernel, JS runtime, generated client): an unguarded arm declared first wins.
    /// A guard that throws blocks its arm like a false guard (D-7): every generated guard goes
    /// through `@almadar/core`'s `guardHolds`, the rule the JS runtime uses too.
    #[test]
    fn a_generated_guard_runs_through_guard_holds() {
        let js = two_arms(false);
        assert!(
            js.contains("guardHolds(() =>"),
            "guards must run through guardHolds:\n{js}"
        );
    }

    #[test]
    fn the_handler_file_imports_guard_holds_from_core() {
        let mut trait_def = OirTrait::new("ChatComposer");
        trait_def.linked_entity = Some("ChatMessage".to_string());
        trait_def
            .states
            .push(orbital_core::ir::OirState::initial("ready"));
        let mut guarded = OirTransition::new("ready", "sent", "SEND");
        guarded.guard = Some(OirExpr::binding(OirBinding::entity(vec![
            "activeChannel".to_string()
        ])));
        trait_def.transitions.push(guarded);
        trait_def.events.push(OirEvent::new("SEND"));
        let file = TypeScriptBackend::new().generate_trait_event_handler_file(
            &trait_def,
            &module_with_chat_message(),
            "chat",
        );
        assert!(
            file.content.lines().any(|l| l.starts_with("import")
                && l.contains("guardHolds")
                && l.contains("@almadar/core")),
            "guardHolds must be imported from @almadar/core:\n{}",
            file.content
        );
    }

    #[test]
    fn an_unguarded_arm_declared_first_is_the_one_that_fires() {
        let js = two_arms(true);
        assert!(
            js.contains("plainTarget"),
            "the first-declared unguarded arm must be generated:\n{js}"
        );
        assert!(
            !js.contains("guardedTarget"),
            "an arm declared after an unguarded one is unreachable and must not fire on the server:\n{js}"
        );
    }

    #[test]
    fn control_a_guarded_arm_declared_first_is_tried_first() {
        let js = two_arms(false);
        let guarded = js.find("guardedTarget").expect("guarded arm generated");
        let plain = js.find("plainTarget").expect("fallback arm generated");
        assert!(
            guarded < plain,
            "declaration order: guarded arm first, fallback after:\n{js}"
        );
    }

    /// A single guarded arm (`SEND -> ready when @entity.activeChannel`),
    /// no unguarded fallback for the event in this state — the shape that
    /// previously fell into the "Access denied" branch.
    #[test]
    fn single_guarded_arm_with_no_fallback_resolves_to_unchanged_state_not_an_error() {
        let backend = TypeScriptBackend::new();
        let module = module_with_chat_message();

        let mut trait_def = OirTrait::new("ChatComposer");
        trait_def.linked_entity = Some("ChatMessage".to_string());

        let mut trans = OirTransition::new("ready", "ready", "SEND");
        trans.guard = Some(OirExpr::binding(OirBinding::entity(vec![
            "activeChannel".to_string()
        ])));
        trait_def.transitions.push(trans);

        let event_def = OirEvent::new("SEND");
        trait_def.events.push(event_def.clone());

        let js =
            backend.generate_event_handler_function(&trait_def, &event_def, &module, "handleSend");

        assert!(
            !js.contains("Access denied"),
            "a guard mismatch must not fabricate a rejection, got:\n{}",
            js
        );
        assert!(
            js.contains("success: true"),
            "a guard mismatch must resolve as a benign no-op, got:\n{}",
            js
        );
        assert!(
            js.contains("states: { 'ChatComposer': 'ready' }"),
            "the no-op must report the state UNCHANGED (still 'ready'), got:\n{}",
            js
        );
        assert!(
            js.contains("guardFailed: 'ChatComposer.SEND'"),
            "the no-op must populate guardFailed for debugging, got:\n{}",
            js
        );
    }

    /// §A7: `render-ui` + `navigate` effects on a transition compile to a
    /// `clientEffects`/`clientEffectsByTrait` pair, in declaration order,
    /// with `@payload.title` resolved through the server single-record
    /// binding chain (`binding_to_ts_server`'s `EventPayload` cast — the
    /// same one `set`/`persist` codegen already uses) and `OirPattern.config`
    /// keys sorted (`config` is a `HashMap` — regen must be deterministic).
    /// A call-site-captured knob (the inline phase keeps it as `@config.<knob>`)
    /// renders from the handler with no composing payload: it compiles against
    /// an absent payload, never `undefined` (TS2322 on a required prop). The
    /// handler itself scopes the trait — no hand-set context.
    #[test]
    fn server_render_of_a_captured_knob_uses_the_absent_payload_fallback() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let mut trait_def = OirTrait::new("Child");
        trait_def.orbital_name = "Orb".to_string();
        let mut trans = OirTransition::new("idle", "idle", "INIT");
        let pattern = orbital_core::ir::OirPattern::new("stat-display")
            .with_config(
                "value",
                orbital_core::ir::OirValue::String("@config.value".to_string()),
            )
            .with_config(
                "max",
                orbital_core::ir::OirValue::String("@config.max".to_string()),
            )
            .with_config(
                "label",
                orbital_core::ir::OirValue::String("@config.label".to_string()),
            );
        trans.effects.push(OirExpr::effect(OirEffect::RenderUi {
            slot: "main".to_string(),
            pattern,
        }));
        trait_def.transitions.push(trans);
        let event_def = OirEvent::new("INIT");
        trait_def.events.push(event_def.clone());
        let mut knobs = orbital_core::ir::OirObject::new();
        knobs.insert(
            "value".to_string(),
            orbital_core::ir::OirValue::String("@callsitePayload.row.memberCount".to_string()),
        );
        knobs.insert(
            "max".to_string(),
            orbital_core::ir::OirValue::Array(vec![
                orbital_core::ir::OirValue::String("array/len".to_string()),
                orbital_core::ir::OirValue::String("@callsitePayload.data".to_string()),
            ]),
        );
        backend
            .trait_callsite_knob_values
            .set(std::collections::HashMap::from([(
                "Child".to_string(),
                knobs,
            )]));

        let js =
            backend.generate_event_handler_function(&trait_def, &event_def, &module, "handleInit");

        assert!(
            !js.contains("value: undefined"),
            "whole-value capture compiled to undefined:\n{js}"
        );
        assert!(
            js.contains("(undefined as EventPayload | undefined)?.row"),
            "{js}"
        );
        assert!(
            !js.contains("max: undefined"),
            "nested capture compiled to undefined:\n{js}"
        );
        assert!(
            js.contains("(undefined as EventPayload | undefined)?.data"),
            "{js}"
        );
        // Control: a knob that is not a capture keeps the inlined-config rule.
        assert!(js.contains("label: undefined"), "{js}");
        assert!(
            !js.contains("callsitePayload"),
            "no callsitePayload identifier server-side:\n{js}"
        );
    }

    /// G-ORB-189(e): a server render mapping a struct-list field keeps the callback
    /// contextually typed by the source's element cast (an `EntityRow` param is TS2345).
    #[test]
    fn a_server_render_map_over_a_struct_list_leaves_the_callback_unannotated() {
        use orbital_core::ir::{OirEntity, OirField, OirType, OirValue};
        let backend = TypeScriptBackend::new();
        let mut module = OirModule::new("TestApp", "0.1.0");
        let mut view = OirEntity::new("DeployView");
        view.fields.push(OirField::new(
            "steps",
            OirType::array(OirType::Struct {
                fields: vec![OirField::new("step", OirType::String)],
            }),
        ));
        module.entities.push(view);
        let mut trait_def = OirTrait::new("DeployPanel");
        trait_def.linked_entity = Some("DeployView".to_string());
        let mut trans = OirTransition::new("idle", "idle", "SHOW");
        let items = OirValue::Array(vec![
            OirValue::String("array/map".into()),
            OirValue::String("@entity.steps".into()),
            OirValue::Array(vec![
                OirValue::String("fn".into()),
                OirValue::String("s".into()),
                OirValue::Object(
                    [("title".to_string(), OirValue::String("@s.step".into()))]
                        .into_iter()
                        .collect(),
                ),
            ]),
        ]);
        trans.effects.push(OirExpr::effect(OirEffect::RenderUi {
            slot: "main".to_string(),
            pattern: orbital_core::ir::OirPattern::new("timeline").with_config("items", items),
        }));
        trait_def.transitions.push(trans);
        let event_def = OirEvent::new("SHOW");
        trait_def.events.push(event_def.clone());
        module.traits.push(trait_def.clone());
        let js =
            backend.generate_event_handler_function(&trait_def, &event_def, &module, "handleShow");
        assert!(js.contains(".map(((s) =>"), "{js}");
        assert!(!js.contains("(s: EntityRow)"), "{js}");
    }

    #[test]
    fn render_ui_and_navigate_effects_emit_client_effects_tuple() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");

        let mut trait_def = OirTrait::new("TaskLifecycle");

        let mut trans = OirTransition::new("idle", "idle", "SHOW");
        let pattern = orbital_core::ir::OirPattern::new("box")
            .with_config(
                "title",
                orbital_core::ir::OirValue::String("@payload.title".to_string()),
            )
            .with_config("count", orbital_core::ir::OirValue::Number(3.0));
        trans.effects.push(OirExpr::effect(OirEffect::RenderUi {
            slot: "main".to_string(),
            pattern,
        }));
        trans.effects.push(OirExpr::effect(OirEffect::Navigate {
            path: OirExpr::string("/done"),
            params: None,
            crumb: None,
        }));
        trait_def.transitions.push(trans);

        let event_def = OirEvent::new("SHOW");
        trait_def.events.push(event_def.clone());

        let js =
            backend.generate_event_handler_function(&trait_def, &event_def, &module, "handleShow");

        assert!(
            js.contains("const clientEffects: ClientEffectTuple[] = [['render-ui', 'main', {"),
            "render-ui + navigate must compile to a clientEffects tuple array, got:\n{}",
            js
        );
        assert!(
            js.contains("type: \"box\""),
            "the render-ui pattern must flatten to a `type` field, got:\n{}",
            js
        );
        assert!(
            js.contains("count: 3"),
            "a plain-literal config value must stay a plain literal, got:\n{}",
            js
        );
        assert!(
            js.contains("title: ((payload as EventPayload | undefined)?.title) as SExpr"),
            "an `@payload.*` config value must resolve through the server binding chain \
             and cast to `SExpr` (§A7 — every pattern's `AnyPatternConfig` prop type is \
             `<declared> | SExpr`), got:\n{}",
            js
        );
        assert!(
            js.contains("}], ['navigate', \"/done\"]];"),
            "navigate must follow render-ui in the same array, in declaration order, got:\n{}",
            js
        );
        assert!(
            js.contains(
                "const clientEffectsByTrait: EventResponse['clientEffectsByTrait'] = clientEffects.map((effect) => ({ traitName: 'TaskLifecycle', effect, event: \"SHOW\", fromState: state }));"
            ),
            "clientEffectsByTrait must pair each tuple with this trait's name, got:\n{}",
            js
        );
        assert!(
            js.contains("clientEffects,\n"),
            "the response must include clientEffects when the transition declares one, got:\n{}",
            js
        );
        assert!(
            js.contains("clientEffectsByTrait,\n"),
            "the response must include clientEffectsByTrait alongside clientEffects, got:\n{}",
            js
        );
    }

    /// §A7: a transition with no render-ui/navigate/navigate-back effects
    /// must not declare `clientEffects` at all — matching the runtime
    /// path's `if (clientEffects.length > 0)` gate in `OrbitalServerRuntime.ts`.
    #[test]
    fn transition_with_no_client_effects_omits_the_key() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");

        let mut trait_def = OirTrait::new("Notifier");

        let mut trans = OirTransition::new("idle", "idle", "PING");
        trans.effects.push(OirExpr::effect(OirEffect::Emit {
            event: "PONG".to_string(),
            payload: None,
        }));
        trait_def.transitions.push(trans);

        let event_def = OirEvent::new("PING");
        trait_def.events.push(event_def.clone());

        let js =
            backend.generate_event_handler_function(&trait_def, &event_def, &module, "handlePing");

        assert!(
            !js.contains("clientEffects"),
            "a transition with no render-ui/navigate effects must not declare clientEffects, got:\n{}",
            js
        );
    }
}

#[cfg(test)]
mod run_event_core_tests {
    use super::*;
    use orbital_core::ir::OirState;

    fn persistor() -> OirTrait {
        let mut t = OirTrait::new("TaskPersistor");
        t.states.push(OirState::initial("idle"));
        t.transitions
            .push(OirTransition::new("idle", "idle", "DO_CREATE"));
        t.events.push(OirEvent::new("DO_CREATE"));
        t
    }

    /// Every trait's dispatch is callable without HTTP (`runEvent(body, user)`),
    /// so the server can lend it to a service as the caller; the HTTP route is a
    /// wrapper over it on both frameworks.
    #[test]
    fn both_frameworks_export_a_framework_free_run_event_the_route_wraps() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let express = backend
            .generate_trait_event_handler_file(&persistor(), &module, "task-persistor")
            .content;
        let hono = backend
            .generate_trait_event_handler_file_hono(&persistor(), &module, "task-persistor")
            .content;
        for (name, js) in [("Express", &express), ("Hono", &hono)] {
            assert!(
                js.contains("export async function runEvent(body: EventRequest, user: UserContext | undefined): Promise<EventResponse> {"),
                "{name}:\n{js}"
            );
            let run = js
                .split("export async function runEvent(")
                .nth(1)
                .expect("runEvent body");
            let run_body = run
                .split("export async function handleEvent(")
                .next()
                .unwrap_or(run);
            assert!(
                !run_body.contains("req.")
                    && !run_body.contains("res.")
                    && !run_body.contains("c.req")
                    && !run_body.contains("c.json"),
                "{name} runEvent touches HTTP:\n{run_body}"
            );
        }
        assert!(
            express.contains("res.json(await runEvent(body, await viewerOf(req.authUser)));"),
            "{express}"
        );
        assert!(hono.contains("return c.json(await runEvent({ ...body, payload }, await viewerOf(c.get('authUser'))));"), "{hono}");
    }
    /// A mount batch is an orbital-route request (`/api/orbitals/:orbital/events`); a
    /// per-trait route refuses it instead of silently running only `body.event`.
    #[test]
    fn a_per_trait_route_refuses_a_mount_batch() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let express = backend
            .generate_trait_event_handler_file(&persistor(), &module, "task-persistor")
            .content;
        let hono = backend
            .generate_trait_event_handler_file_hono(&persistor(), &module, "task-persistor")
            .content;
        assert!(express.contains("res.status(400).json({ success: false, error: 'A mount batch goes to the orbital events route' });"), "{express}");
        assert!(hono.contains("return c.json({ success: false, error: 'A mount batch goes to the orbital events route' }, 400);"), "{hono}");
    }
}
