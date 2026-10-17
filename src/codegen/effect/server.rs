//! Server-side effect codegen: `generate_server_effect_code`.

use super::shared::emit_relation_hydration;
use super::*;
use crate::backend::server::access_policies::policy_const_name;

impl TypeScriptBackend {
    /// Generate server-side effect execution code
    pub(crate) fn generate_server_effect_code(
        &self,
        effect: &OirEffect,
        module: &OirModule,
        linked_entity: Option<&str>,
    ) -> String {
        let mut code = String::new();

        match effect {
            OirEffect::Fetch {
                entity_type,
                id,
                filter,
                order_by,
                offset,
                limit,
                include,
                nearest,
                emit,
            } => {
                if nearest.is_some() {
                    code.push_str("      throw new Error('fetch nearest runs on the kernel host only; this generated handler does not implement it');\n");
                    return code;
                }
                // Resolve @entity to the trait's linked entity + collection.
                let (resolved_entity, collection, entity_node) = Self::resolve_entity_collection(
                    entity_type,
                    module,
                    linked_entity,
                    self.current_linked_entity_id.snapshot().as_deref(),
                    self.current_entity_ref_ids.borrow().as_ref(),
                );
                let resolved_entity = resolved_entity.as_str();

                code.push_str(&format!("      // Fetch {} entities\n", resolved_entity));
                code.push_str("      {\n");

                // A collection fetch the store may answer with one `queryPage`. The
                // legacy list+filter+sort+slice path stays as the `else` branch.
                let pushdown = self.emit_fetch_pushdown_prelude(
                    resolved_entity,
                    &collection,
                    entity_node,
                    id,
                    filter,
                    order_by,
                    offset.as_ref(),
                    limit.as_ref(),
                    linked_entity.is_some(),
                    true,
                );
                let pushed = pushdown.is_some();
                if let Some(prelude) = pushdown {
                    code.push_str(&prelude);
                }

                // Shared id-load / list+filter prelude (see emit_entity_load_block).
                // Filtering/sorting beyond `filter` is handled by the explicit
                // order_by/offset/limit arguments below.
                code.push_str(&self.emit_entity_load_block(
                    resolved_entity,
                    &collection,
                    entity_node,
                    id,
                    filter,
                    linked_entity.is_some(),
                ));

                // No order_by: the default order, `createdAt` ascending then `id` (EXEC-FETCH-1).
                if order_by.is_none() && id.is_none() {
                    code.push_str(&Self::emit_default_order(resolved_entity));
                }

                // Apply order_by if present
                // Supports: static "field:dir" strings, or dynamic s-expressions
                if let Some(sort_expr) = order_by {
                    // Compile the sort expression to TypeScript
                    let sort_ts = self.compile_guard_to_ts(sort_expr);

                    // Check if it's a static string literal (e.g., 'name:asc')
                    // If so, we can split at compile time for a cleaner sort
                    let static_spec = match sort_expr {
                        OirExpr::String { value } => Some(value.as_str()),
                        _ => None,
                    };
                    let is_static = static_spec.is_some();

                    if is_static {
                        // Static: e.g., OirExpr::String("name:asc") → sort_ts = "'name:asc'"
                        let raw = static_spec.unwrap_or_default();
                        let parts: Vec<&str> = raw.split(':').collect();
                        let sort_field = parts[0];
                        let asc = parts.get(1).copied() != Some("desc");
                        code.push_str(&format!(
                            "          data['{}'] = [...data['{}']].sort((a, b) => {{\n",
                            resolved_entity, resolved_entity
                        ));
                        // `a` / `b` are inferred as `EntityRow` from
                        // `data[<entity>]: EntityRow[]`. `EntityRow` extends
                        // `Record<string, FieldValue | undefined>`, so
                        // `a['<field>']` returns `FieldValue | undefined`
                        // — typed, no `Record<string, unknown>` cast needed.
                        code.push_str(&format!("            const aVal = a['{}'];\n", sort_field));
                        code.push_str(&format!("            const bVal = b['{}'];\n", sort_field));
                        code.push_str("            if (aVal === bVal) return 0;\n");
                        code.push_str("            if (aVal == null) return 1;\n");
                        code.push_str("            if (bVal == null) return -1;\n");
                        if asc {
                            code.push_str("            return aVal < bVal ? -1 : 1;\n");
                        } else {
                            code.push_str("            return aVal > bVal ? -1 : 1;\n");
                        }
                        code.push_str("          });\n");
                    } else {
                        // Dynamic: compile to runtime sort using the expression result
                        // Expression should evaluate to "field:direction" string
                        code.push_str(&format!(
                            "          const sortSpec = String({});\n",
                            sort_ts
                        ));
                        code.push_str(
                            "          const [sortField, sortDir = 'asc'] = sortSpec.split(':');\n",
                        );
                        code.push_str(&format!(
                            "          data['{}'] = [...data['{}']].sort((a, b) => {{\n",
                            resolved_entity, resolved_entity
                        ));
                        // Dynamic-field sort — same EntityRow index-signature
                        // story as the literal-field path above; no cast needed.
                        code.push_str("            const aVal = a[sortField];\n");
                        code.push_str("            const bVal = b[sortField];\n");
                        code.push_str("            if (aVal === bVal) return 0;\n");
                        code.push_str("            if (aVal == null) return 1;\n");
                        code.push_str("            if (bVal == null) return -1;\n");
                        code.push_str("            const cmp = aVal < bVal ? -1 : 1;\n");
                        code.push_str("            return sortDir === 'desc' ? -cmp : cmp;\n");
                        code.push_str("          });\n");
                    }
                }

                // Capture pre-pagination row count for the emit payload's
                // `totalCount` so paginating consumers can compute totalPages
                // without a second round-trip. Mirrors the runtime path's
                // FetchResult.total contract (@almadar/runtime ≥ 5.11.0).
                code.push_str(&format!(
                    // `data['<entity>']: EntityRow[]` — `.length` is typed
                    // off the array directly; no `as unknown[]` cast.
                    "          {1}__totalCount_{0} = data['{0}'].length;\n",
                    resolved_entity,
                    if pushed { "" } else { "const " }
                ));

                code.push_str(&self.emit_page_slice(
                    offset.as_ref(),
                    limit.as_ref(),
                    resolved_entity,
                ));
                if pushed {
                    code.push_str("        }\n");
                }

                // Populate relation fields if include is specified.
                // Cycle-safe (shallow clone + self-ref neutralize) via the shared
                // emitter — the prior inline version attached live store rows,
                // which formed circular structures for self-referential relations
                // (ThreadPost.replies : [ThreadPost]) → JSON.stringify 500.
                if let Some(include_fields) = include {
                    if !include_fields.is_empty() {
                        code.push_str(&emit_relation_hydration(
                            resolved_entity,
                            include_fields,
                            module,
                            true,
                        ));
                    }
                }

                code.push_str("        effectResults.push({\n");
                code.push_str("          effect: 'fetch',\n");
                code.push_str(&format!("          entityType: '{}',\n", resolved_entity));
                code.push_str("          success: true,\n");
                code.push_str(&format!("          data: data['{}'],\n", resolved_entity));
                code.push_str("        });\n");
                // Close-the-circuit: fire author-configured event with the fetched data.
                // Wrap as `{ data: <items> }` so the emit payload is always an
                // object (EventPayload type contract). Authors reach items via
                // `@payload.data`. Matches interpreted runtime's EffectExecutor
                // fetch/ref success emit shape.
                code.push_str(&self.emit_success_js(
                    emit,
                    "success",
                    &format!(
                        "{{ data: data['{0}'], totalCount: __totalCount_{0} }}",
                        resolved_entity
                    ),
                    "        ",
                ));
                code.push_str("      }\n\n");
            }

            // Ref: server-side identical to Fetch (query DB, populate data)
            OirEffect::Ref {
                entity_type,
                id,
                filter,
                order_by: _,
                limit,
                include,
                emit,
            } => {
                let (resolved_entity, collection, entity_node) = Self::resolve_entity_collection(
                    entity_type,
                    module,
                    linked_entity,
                    self.current_linked_entity_id.snapshot().as_deref(),
                    self.current_entity_ref_ids.borrow().as_ref(),
                );
                let resolved_entity = resolved_entity.as_str();

                code.push_str(&format!(
                    "      // Ref {} entities (reactive subscription)\n",
                    resolved_entity
                ));
                code.push_str("      {\n");

                // A ref's own load is pushed like a fetch's (its filter and limit, plus `@read`);
                // it declares no order, so none is sent.
                let pushdown = self.emit_fetch_pushdown_prelude(
                    resolved_entity,
                    &collection,
                    entity_node,
                    id,
                    filter,
                    &None,
                    None,
                    limit.as_ref(),
                    linked_entity.is_some(),
                    false,
                );
                let pushed = pushdown.is_some();
                if let Some(prelude) = pushdown {
                    code.push_str(&prelude);
                }

                // Same id-load / list+filter prelude as fetch.
                code.push_str(&self.emit_entity_load_block(
                    resolved_entity,
                    &collection,
                    entity_node,
                    id,
                    filter,
                    linked_entity.is_some(),
                ));

                if id.is_none() {
                    code.push_str(&Self::emit_default_order(resolved_entity));
                }
                code.push_str(&self.emit_page_slice(None, limit.as_ref(), resolved_entity));
                if pushed {
                    code.push_str("        }\n");
                }

                if let Some(includes) = include {
                    if !includes.is_empty() {
                        // Inline cycle-safe hydration (the prior `populateRelations`
                        // call referenced an undefined helper → ReferenceError).
                        code.push_str(&emit_relation_hydration(
                            resolved_entity,
                            includes,
                            module,
                            false,
                        ));
                    }
                }
                code.push_str("        effectResults.push({\n");
                code.push_str("          effect: 'ref',\n");
                code.push_str(&format!("          entityType: '{}',\n", resolved_entity));
                code.push_str("          success: true,\n");
                code.push_str(&format!("          data: data['{}'],\n", resolved_entity));
                code.push_str("        });\n");
                // ref is a reactive subscription. Server-side, the initial
                // data load is analogous to fetch success — fire on_change
                // once so the state machine can kick off dependent work.
                // The continuous reactive-update story lives in the client
                // reactivity layer. Wrap as `{ data: <items> }` to match
                // fetch's emit shape (authors bind `@payload.data`).
                code.push_str(&self.emit_success_js(
                    emit,
                    "on_change",
                    &format!("{{ data: data['{}'] }}", resolved_entity),
                    "        ",
                ));
                code.push_str("      }\n\n");
            }

            // Deref: snapshot read from DB
            OirEffect::Deref { entity_type, id } => {
                let (resolved_entity, collection, entity_node) = Self::resolve_entity_collection(
                    entity_type,
                    module,
                    linked_entity,
                    self.current_linked_entity_id.snapshot().as_deref(),
                    self.current_entity_ref_ids.borrow().as_ref(),
                );
                let resolved_entity = resolved_entity.as_str();

                code.push_str(&format!(
                    "      // Deref {} (snapshot read)\n",
                    resolved_entity
                ));
                code.push_str("      {\n");
                if let Some(id_expr) = id {
                    let id_ts = self.compile_guard_to_ts(id_expr);
                    code.push_str(&format!(
                        "        const derefResult = await getDataService().getById<{}>('{}', {});\n",
                        entity_type_ref(resolved_entity),
                        collection,
                        id_ts
                    ));
                } else {
                    code.push_str(&format!(
                        "        const derefResult = await getDataService().list<{}>('{}');\n",
                        entity_type_ref(resolved_entity),
                        collection
                    ));
                }
                // A deref is a read: the declared `@read` scopes its snapshot
                // exactly as it scopes a fetch. Without this the effect result
                // carries rows the same viewer's fetch would have withheld.
                if let Some(policy) = entity_node
                    .and_then(|e| e.read_policy.as_ref())
                    .map(|_| policy_const_name(resolved_entity, "READ"))
                {
                    if id.is_some() {
                        code.push_str(&format!(
                            "        const derefScoped = derefResult ? (applyRowAccess([derefResult], {}, undefined, {{ user, now }})[0] ?? null) : null;\n",
                            policy
                        ));
                    } else {
                        code.push_str(&format!(
                            "        const derefScoped = applyRowAccess(derefResult, {}, undefined, {{ user, now }});\n",
                            policy
                        ));
                    }
                } else {
                    code.push_str("        const derefScoped = derefResult;\n");
                }
                code.push_str("        effectResults.push({\n");
                code.push_str("          effect: 'deref',\n");
                code.push_str(&format!("          entityType: '{}',\n", resolved_entity));
                code.push_str("          success: true,\n");
                code.push_str("          data: derefScoped,\n");
                code.push_str("        });\n");
                code.push_str("      }\n\n");
            }

            // Swap: CAS read-modify-write (simplified, no version check yet)
            OirEffect::Swap {
                entity_type,
                id,
                transform,
            } => {
                let (resolved_entity, collection, entity_node) = Self::resolve_entity_collection(
                    entity_type,
                    module,
                    linked_entity,
                    self.current_linked_entity_id.snapshot().as_deref(),
                    self.current_entity_ref_ids.borrow().as_ref(),
                );
                let resolved_entity = resolved_entity.as_str();
                let id_ts = self.compile_guard_to_ts(id);
                let transform_ts = self.compile_guard_to_ts(transform);

                code.push_str(&format!("      // Swap {} (atomic CAS)\n", resolved_entity));
                code.push_str("      {\n");
                code.push_str(&format!("        const swapId = {};\n", id_ts));
                code.push_str(&format!(
                    "        const current = await getDataService().getById<{}>('{}', swapId as string);\n",
                    entity_type_ref(resolved_entity),
                    collection
                ));
                code.push_str("        if (current) {\n");
                // `current` is `<Entity> | null` from `getById<<Entity>>` and
                // the `if (current)` narrowed it to `<Entity>`. The transform
                // SExpr's `@current` substitution can read `current` directly
                // — EntityRow's index signature already admits string-key
                // access without a cast.
                code.push_str(&format!(
                    "          const transformed = {{ ...current, ...({}) }};\n",
                    transform_ts.replace("@current", "current")
                ));
                code.push_str(&format!(
                    "          await getDataService().update<{}>('{}', swapId as string, transformed);\n",
                    entity_type_ref(resolved_entity),
                    collection
                ));
                // The post-write refresh is a read like any other — reload
                // through the declared `@read` so a swap does not hand the
                // caller the whole collection.
                match entity_node
                    .and_then(|e| e.read_policy.as_ref())
                    .map(|_| policy_const_name(resolved_entity, "READ"))
                {
                    Some(policy) => code.push_str(&format!(
                        "          data['{}'] = applyRowAccess(await getDataService().list<{}>('{}'), {}, undefined, {{ user, now }});\n",
                        resolved_entity,
                        entity_type_ref(resolved_entity),
                        collection,
                        policy
                    )),
                    None => code.push_str(&format!(
                        "          data['{}'] = await getDataService().list<{}>('{}');\n",
                        resolved_entity,
                        entity_type_ref(resolved_entity),
                        collection
                    )),
                }
                code.push_str("          effectResults.push({ effect: 'swap', entityType: '");
                code.push_str(resolved_entity);
                code.push_str("', success: true, data: transformed });\n");
                code.push_str("        } else {\n");
                code.push_str("          effectResults.push({ effect: 'swap', entityType: '");
                code.push_str(resolved_entity);
                code.push_str("', success: false, error: `Entity not found: ${swapId}` });\n");
                code.push_str("        }\n");
                code.push_str("      }\n\n");
            }

            // Watch: client-only, no server codegen
            OirEffect::Watch { .. } => {
                code.push_str("      // Watch: client-only (EntityStore subscription)\n");
            }

            // Atomic: transaction wrapper (executes inner effects sequentially)
            OirEffect::Atomic { effects } => {
                code.push_str("      // Atomic transaction\n");
                code.push_str("      {\n");
                code.push_str("        try {\n");
                for inner_effect in effects {
                    if let OirExpr::Effect { effect: inner } = inner_effect {
                        let inner_code =
                            self.generate_server_effect_code(inner.as_ref(), module, linked_entity);
                        for line in inner_code.lines() {
                            code.push_str("      ");
                            code.push_str(line);
                            code.push('\n');
                        }
                    }
                }
                code.push_str("        } catch (txErr) {\n");
                code.push_str("          effectResults.push({ effect: 'atomic', success: false, error: txErr instanceof Error ? txErr.message : String(txErr) });\n");
                code.push_str("        }\n");
                code.push_str("      }\n\n");
            }

            OirEffect::Persist {
                operation,
                entity_type,
                data,
                emit,
            } => {
                code.push_str(&self.generate_persist_block(
                    operation,
                    entity_type,
                    data,
                    emit,
                    module,
                    linked_entity,
                    &PersistDataValidation::Cast,
                ));
            }

            OirEffect::PersistBatch { ops, emit, .. } => {
                code.push_str(&self.generate_persist_batch_block(ops, emit, module));
            }

            OirEffect::RenderUi { .. } => {
                // Phase 5.5: render-ui is handled declaratively on the client (Phase 3).
                // No server-EXECUTION code needed here. §A7: the effect still
                // reaches the wire — `TypeScriptBackend::client_effect_tuple_ts`
                // (codegen/expr.rs) builds its `clientEffects` tuple from
                // `trans.effects` directly, in `generate_transition_body_impl`.
            }

            OirEffect::Navigate { .. } => {
                // Phase 5.5: navigate is transpiled at compile time on the client (Phase 4).
                // No server-EXECUTION code needed here. §A7: see the
                // `client_effect_tuple_ts` note on the `RenderUi` arm above.
            }

            OirEffect::BrowserOpenFilePicker { .. }
            | OirEffect::BrowserClipboardRead { .. }
            | OirEffect::BrowserClipboardWrite { .. }
            | OirEffect::BrowserGeolocationCurrent { .. }
            | OirEffect::BrowserPageFacts { .. }
            | OirEffect::BrowserBeacon { .. }
            | OirEffect::BrowserPrompt { .. }
            | OirEffect::BrowserEmbed { .. }
            | OirEffect::BrowserTab { .. }
            | OirEffect::BrowserPushSubscribe { .. } => {
                // Client host device APIs — transpiled on the client (Phase 4).
                // No server-side code needed.
            }

            OirEffect::Emit { event, payload } => {
                // Phase 7: Emit to server event bus + log to effectResults +
                // push to emittedEvents so the client bridge re-dispatches
                // on the client bus. Without the `emittedEvents.push`,
                // cross-trait `listens { X EVENT → Y }` wiring never sees
                // the event on the client even when the server fires it —
                // the state machine stalls with no visible cascade.
                code.push_str(&format!(
                    "      // Emit {} event to server event bus + client (Phase 4)\n",
                    event
                ));
                if let Some(p) = payload {
                    let payload_expr = self.emit_payload_to_ts_server(p, event, module);
                    code.push_str(&format!(
                        "      getServerEventBus().emit('{}', {}, __ORBITAL_SOURCE);\n",
                        event, payload_expr
                    ));
                    code.push_str(&format!(
                        "      emittedEvents.push({{ event: '{}', payload: {}, source: __ORBITAL_SOURCE }});\n",
                        event, payload_expr
                    ));
                    code.push_str(&format!(
                        "      effectResults.push({{ effect: 'emit', success: true, data: {{ event: '{}', payload: {} }} }});\n\n",
                        event, payload_expr
                    ));
                } else {
                    code.push_str(&format!(
                        "      getServerEventBus().emit('{}', undefined, __ORBITAL_SOURCE);\n",
                        event
                    ));
                    code.push_str(&format!(
                        "      emittedEvents.push({{ event: '{}', source: __ORBITAL_SOURCE }});\n",
                        event
                    ));
                    code.push_str(&format!(
                        "      effectResults.push({{ effect: 'emit', success: true, data: {{ event: '{}' }} }});\n\n",
                        event
                    ));
                }
            }

            OirEffect::CallService {
                service,
                method,
                args,
                key,
                emit,
            } => {
                // Server context: server entities come from getById() as single
                // objects, so `@entity.X` must lower to `entity?.X` (server
                // shape), not `entity?.[0]?.X` (client array shape). Using the
                // client `expr_to_ts` here produced `entity?.[0]?.field` which
                // returns `FieldValue` and fails `tsc` with "Property 'X' does
                // not exist on type 'FieldValue'" — the G30 family of errors
                // across every service-class atom.
                let args_expr = self.expr_to_ts_server(args);
                let key_expr = key.as_ref().map(|k| self.expr_to_ts_server(k));
                code.push_str(&format!("      // Call service {}.{}\n", service, method));
                // A keyed call is registered so `cancel-call` can abort it; the
                // block scopes its controller when one handler runs several calls.
                if let Some(k) = &key_expr {
                    code.push_str("      {\n");
                    code.push_str(&format!("      const __callKey = String({});\n", k));
                    code.push_str("      const __callCtl = beginKeyedCall(__callKey);\n");
                }
                code.push_str("      try {\n");
                // The running app, lent as the caller (`llm call-tools`).
                // `emit: { onMessage }`: the call's live messages go to this request's tab only.
                match emit.as_ref().and_then(|e| e.on_message.as_ref()) {
                    Some(on_message) => code.push_str(&format!(
                        "        const __host = servicePorts(__ORBITAL_SOURCE, user, (__message) => pushToOrigin(clientId, {{ type: 'bus', event: '{}', payload: __message, source: __ORBITAL_SOURCE, timestamp: Date.now(), target: 'origin' }}));\n",
                        on_message
                    )),
                    None => code.push_str("        const __host = servicePorts(__ORBITAL_SOURCE, user);\n"),
                }
                // `callService` is typed (see CallServiceHandler in
                // @almadar/integrations/runtime) so passing literal
                // service + action narrows the inferred return type to
                // `IntegrationContracts['<service>']['<action>']['result']`.
                // No `: unknown` annotation, no downstream `as <Result>`
                // casts — the inferred type IS the typed result.
                code.push_str(&format!(
                    "        const serviceResult = await callService('{}', '{}'",
                    service, method
                ));
                code.push_str(&format!(", {}", args_expr));
                // Caller identity (I-25): the same normalized viewer entity ACL
                // enforces against; role-gated services fail closed without it.
                let signal = if key_expr.is_some() {
                    ", signal: __callCtl.signal"
                } else {
                    ""
                };
                code.push_str(&format!(
                    ", {{ ...(user ? {{ principal: user.id, role: user.role }} : {{}}), ...(__host ? {{ host: __host }} : {{}}){} }}",
                    signal
                ));
                code.push_str(");\n");
                if key_expr.is_some() {
                    // A service that ignored the abort still reports as cancelled.
                    code.push_str(
                        "        if (__callCtl.signal.aborted) { throw new Error('call cancelled'); }\n",
                    );
                }
                code.push_str("        effectResults.push({\n");
                code.push_str("          effect: 'call-service',\n");
                code.push_str(&format!("          action: '{}',\n", method));
                code.push_str("          success: true,\n");
                code.push_str("          data: serviceResult as EventPayloadValue,\n");
                code.push_str("        });\n");
                let success_value = if key_expr.is_some() {
                    "(serviceResult !== null && typeof serviceResult === 'object' && !Array.isArray(serviceResult) ? { ...serviceResult, key: __callKey } : serviceResult)"
                } else {
                    "serviceResult"
                };
                code.push_str(&self.emit_success_js(emit, "success", success_value, "        "));
                code.push_str("      } catch (err) {\n");
                let failure_indent = if key_expr.is_some() {
                    code.push_str("        if (__callCtl.signal.aborted) {\n");
                    let cancelled = self.emit_cancelled_js(emit, "          ");
                    if cancelled.is_empty() {
                        code.push_str(
                            "          // aborted by cancel-call; no emit.cancelled declared\n",
                        );
                    } else {
                        code.push_str(&cancelled);
                    }
                    code.push_str("        } else {\n");
                    "          "
                } else {
                    "        "
                };
                code.push_str(&format!("{failure_indent}effectResults.push({{\n"));
                code.push_str(&format!("{failure_indent}  effect: 'call-service',\n"));
                code.push_str(&format!("{failure_indent}  action: '{}',\n", method));
                code.push_str(&format!("{failure_indent}  success: false,\n"));
                code.push_str(&format!(
                    "{failure_indent}  error: err instanceof Error ? err.message : String(err),\n"
                ));
                code.push_str(&format!("{failure_indent}}});\n"));
                // The declared failure route, returned to the client like every other effect's.
                code.push_str(&self.emit_failure_js_impl(
                    emit,
                    "err instanceof Error ? err.message : String(err)",
                    if key_expr.is_some() { ", key: __callKey" } else { "" },
                    failure_indent,
                ));
                if key_expr.is_some() {
                    code.push_str("        }\n");
                    code.push_str("      } finally {\n");
                    code.push_str("        endKeyedCall(__callKey, __callCtl);\n");
                    code.push_str("      }\n");
                    code.push_str("      }\n\n");
                } else {
                    code.push_str("      }\n\n");
                }
            }

            OirEffect::Http {
                method,
                origin,
                path,
                request,
                key,
                emit,
            } => {
                let verb = format!("{:?}", method).to_uppercase();
                let origin_expr = self.expr_to_ts_server(origin);
                let path_expr = self.expr_to_ts_server(path);
                let request_expr = request
                    .as_ref()
                    .map(|r| self.expr_to_ts_server(r))
                    .unwrap_or_else(|| "{}".to_string());
                let key_expr = key.as_ref().map(|k| self.expr_to_ts_server(k));
                code.push_str(&format!("      // Http {}\n", verb));
                if let Some(k) = &key_expr {
                    code.push_str("      {\n");
                    code.push_str(&format!("      const __callKey = {};\n", k));
                    code.push_str("      if (typeof __callKey !== 'string' || __callKey === '') { throw new Error(`http key: key resolved to ${String(__callKey)}`); }\n");
                    code.push_str("      const __callCtl = beginKeyedCall(__callKey);\n");
                }
                code.push_str("      try {\n");
                let mut options: Vec<String> = Vec::new();
                if key_expr.is_some() {
                    options.push("signal: __callCtl.signal".to_string());
                }
                if let Some(on_message) = emit.as_ref().and_then(|e| e.on_message.as_ref()) {
                    options.push(format!(
                        "onMessage: (__message) => pushToOrigin(clientId, {{ type: 'bus', event: '{}', payload: __message, source: __ORBITAL_SOURCE, timestamp: Date.now(), target: 'origin' }})",
                        on_message
                    ));
                }
                options.push("principal: user?.id".to_string());
                code.push_str(&format!(
                    "        const httpResult = await httpCall({{ method: '{}', origin: {}, path: {}, request: {}, key: {}, nowMs: now }}, {{ {} }});\n",
                    verb,
                    origin_expr,
                    path_expr,
                    request_expr,
                    if key_expr.is_some() { "__callKey" } else { "null" },
                    options.join(", ")
                ));
                if key_expr.is_some() {
                    code.push_str(
                        "        if (__callCtl.signal.aborted) { throw new Error('call cancelled'); }\n",
                    );
                }
                code.push_str("        effectResults.push({\n");
                code.push_str("          effect: 'http',\n");
                code.push_str("          success: true,\n");
                code.push_str("          data: httpResult as EventPayloadValue,\n");
                code.push_str("        });\n");
                code.push_str(&self.emit_success_js(emit, "success", "httpResult", "        "));
                code.push_str("      } catch (err) {\n");
                let failure_indent = if key_expr.is_some() {
                    code.push_str("        if (__callCtl.signal.aborted) {\n");
                    let cancelled = self.emit_cancelled_js(emit, "          ");
                    if cancelled.is_empty() {
                        code.push_str(
                            "          // aborted by cancel-call; no emit.cancelled declared\n",
                        );
                    } else {
                        code.push_str(&cancelled);
                    }
                    code.push_str("        } else {\n");
                    "          "
                } else {
                    "        "
                };
                code.push_str(&format!("{failure_indent}effectResults.push({{\n"));
                code.push_str(&format!("{failure_indent}  effect: 'http',\n"));
                code.push_str(&format!("{failure_indent}  success: false,\n"));
                code.push_str(&format!(
                    "{failure_indent}  error: err instanceof Error ? err.message : String(err),\n"
                ));
                code.push_str(&format!("{failure_indent}}});\n"));
                code.push_str(&self.emit_failure_js_impl(
                    emit,
                    "err instanceof Error ? err.message : String(err)",
                    ", ...(err instanceof HttpCallError ? err.payload : { kind: 'failed', key: null, credential: null })",
                    failure_indent,
                ));
                if key_expr.is_some() {
                    code.push_str("        }\n");
                    code.push_str("      } finally {\n");
                    code.push_str("        endKeyedCall(__callKey, __callCtl);\n");
                    code.push_str("      }\n");
                    code.push_str("      }\n\n");
                } else {
                    code.push_str("      }\n\n");
                }
            }

            OirEffect::Redis { .. } => {
                code.push_str("      throw new Error('redis is run by the kernel, which a generated handler does not reach');\n\n");
            }

            OirEffect::Postgres { .. } => {
                code.push_str("      throw new Error('postgres is run by the kernel, which a generated handler does not reach');\n\n");
            }

            OirEffect::CredentialAdmin { op, .. } => {
                code.push_str(&format!(
                    "      throw new Error('{} is run by the kernel, which a generated handler does not reach');\n\n",
                    op.name()
                ));
            }

            OirEffect::RandomBytes { .. }
            | OirEffect::Os { .. }
            | OirEffect::CredentialStatus { .. }
            | OirEffect::CredentialForget { .. } => {
                let random_key = match effect {
                    OirEffect::RandomBytes { key: Some(key), .. } => Some(self.expr_to_ts_server(key)),
                    _ => None,
                };
                if let Some(key_ts) = &random_key {
                    code.push_str(&format!("      {{\n      const __randKey = {key_ts};\n"));
                }
                let (name, call, emit) = match effect {
                    OirEffect::RandomBytes { bytes: arg, emit, .. } => (
                        "random-bytes".to_string(),
                        format!(
                            "hostRandomBytes({}{})",
                            self.expr_to_ts_server(arg),
                            if random_key.is_some() { ", __randKey" } else { "" }
                        ),
                        emit,
                    ),
                    OirEffect::Os { op, args, key, emit } => {
                        let args_ts: Vec<String> = args.iter().map(|a| self.expr_to_ts_server(a)).collect();
                        let key_ts = key
                            .as_ref()
                            .map(|k| self.expr_to_ts_server(k))
                            .unwrap_or_else(|| "null".to_string());
                        (
                            op.name().to_string(),
                            format!("await hostOs('{}', [{}], {}, user?.id)", op.name(), args_ts.join(", "), key_ts),
                            emit,
                        )
                    }
                    OirEffect::CredentialStatus { credential: arg, emit } => (
                        "credential-status".to_string(),
                        format!("await hostCredentialStatus({}, user?.id)", self.expr_to_ts_server(arg)),
                        emit,
                    ),
                    OirEffect::CredentialForget { credential: arg, emit } => (
                        "credential-forget".to_string(),
                        format!("await hostCredentialForget({}, user?.id)", self.expr_to_ts_server(arg)),
                        emit,
                    ),
                    _ => return code,
                };
                code.push_str(&format!("      // {name}\n"));
                code.push_str("      try {\n");
                code.push_str(&format!("        const hostResult = {call};\n"));
                code.push_str(&self.emit_success_js(emit, "success", "hostResult", "        "));
                code.push_str("      } catch (err) {\n");
                let routed = emit.as_ref().is_some_and(|e| e.failure.is_some());
                if routed {
                    code.push_str(&self.emit_failure_js_impl(
                        emit,
                        "err instanceof Error ? err.message : String(err)",
                        if random_key.is_some() { ", key: __randKey" } else { "" },
                        "        ",
                    ));
                } else {
                    code.push_str("        throw err;\n");
                }
                code.push_str("      }\n\n");
                if random_key.is_some() {
                    code.push_str("      }\n");
                }
            }

            OirEffect::OAuthAuthorize { client, options, key, emit } => {
                let key_ts = key.as_ref().map(|k| self.expr_to_ts_server(k));
                if let Some(key_ts) = &key_ts {
                    code.push_str(&format!("      {{\n      const __authKey = {key_ts};\n"));
                }
                let call = format!(
                    "await hostOAuthAuthorize({}, {}, user?.id{})",
                    self.expr_to_ts_server(client),
                    self.expr_to_ts_server(options),
                    if key_ts.is_some() { ", __authKey" } else { "" }
                );
                self.push_oauth_effect(&mut code, "oauth-authorize", &call, emit, key_ts.is_some());
                if key_ts.is_some() {
                    code.push_str("      }\n");
                }
            }

            OirEffect::OAuthConnectionStatus { provider, emit } | OirEffect::OAuthConnectionForget { provider, emit } => {
                let name = effect.kind();
                let call = format!("await hostOAuthConnection('{name}', {}, user?.id)", self.expr_to_ts_server(provider));
                self.push_oauth_effect(&mut code, name, &call, emit, false);
            }

            OirEffect::CancelCall { key } => {
                code.push_str("      // Cancel the keyed call-service started with this key, or each key of a list\n");
                code.push_str(&format!(
                    "      {{\n        const __keys = {};\n        for (const __key of Array.isArray(__keys) ? __keys : [__keys]) cancelKeyedCall(String(__key));\n      }}\n\n",
                    self.expr_to_ts_server(key)
                ));
            }

            OirEffect::Set {
                target,
                value,
                emit,
            } => {
                // Set effect — mutate entity field and persist
                // Server-side: entity is a single object, not an array
                let target_ts = self.binding_to_ts_server(target);
                let value_ts = self.expr_to_ts_server(value);
                code.push_str(&format!("      // Set {} = {}\n", target_ts, value_ts));

                // Check if this targets @entity
                if matches!(target.root, OirBindingRoot::Entity) && !target.path.is_empty() {
                    // Direct entity mutation — entity is properly typed via getById<T>
                    let field = target.path.join(".");
                    // The entity's declared TYPE name for the type-position
                    // cast below — resolved the same way persist.rs resolves
                    // `@entity` (id-first, name fallback), never `typeof
                    // entity[...]` (see the cast comment further down).
                    let resolved_entity = module
                        .resolve_entity_ref(
                            self.current_linked_entity_id.snapshot().as_deref(),
                            linked_entity.unwrap_or("Entity"),
                        )
                        .map(|e| e.name.clone())
                        .unwrap_or_else(|| linked_entity.unwrap_or("Entity").to_string());
                    let coerced_value = value_ts.clone();
                    // Empty array literal `[]` is `undefined[]` to TS; the
                    // `as <Entity>['X']` cast rejects it. Drop the cast for
                    // empty literals — `entity.X = []` is a fresh array, TS
                    // accepts assignment to any array-typed slot. Same for
                    // the empty object literal `{}`.
                    let trimmed = coerced_value.trim();
                    let drop_cast = trimmed == "[]" || trimmed == "{}";
                    // `@config.<field>` reaching server codegen still a
                    // `Binding` means compose/inline had nothing to
                    // substitute for this knob — no declared default, no
                    // call-site override — so `value_ts` above is the
                    // literal fallback `binding_to_ts_server`'s `Config`
                    // arm always returns: `undefined`. Assign it honestly —
                    // the JS runtime sets the same `undefined` here, and a
                    // skip would silently diverge from that. For a field
                    // whose declared TS type admits `undefined` the cast
                    // below passes; a REQUIRED field stays honestly red,
                    // which is the correct signal — see
                    // `ORB_X_SET_REQUIRED_FIELD_FROM_OPTIONAL_KNOB`
                    // (phases/validation/effect/set.rs), which catches this
                    // at validate time instead of leaving it to `tsc`.
                    // `entity` is always bound (payload id + row + request
                    // frame, see `handler_header::entity_frame_binding`), so
                    // the write is unconditional — the old `if (entity)`
                    // guard silently dropped every `set` on an event whose
                    // payload named no row (§87).
                    if !field.contains('.') {
                        // Single-level: cast through the entity's own field
                        // type, named by the resolved entity type — no
                        // `unknown` escape hatch needed, still lint-clean.
                        if drop_cast {
                            code.push_str(&format!(
                                "      entity.{0} = {1};\n",
                                field, coerced_value
                            ));
                        } else {
                            code.push_str(&format!(
                                "      entity.{0} = ({1}) as {2}['{0}'];\n",
                                field,
                                coerced_value,
                                entity_type_ref(&resolved_entity)
                            ));
                        }
                    } else {
                        // Nested path: use direct assignment
                        code.push_str(&format!("      entity.{} = {};\n", field, coerced_value));
                    }
                    // set is synchronous — fire success immediately with the new value.
                    code.push_str(&self.emit_success_js(emit, "success", &coerced_value, "      "));
                    code.push('\n');
                } else {
                    // Phase 5.5: Non-entity set is transpiled on the client (Phase 4).
                    // No server-side code needed.
                }
            }

            OirEffect::SetDynamic { .. } => {
                // Phase 5.5: set-dynamic is transpiled on the client (Phase 4).
                // No server-side code needed.
            }

            OirEffect::Log { level, message } => {
                let msg_ts = self.expr_to_ts(message);
                let level_str = match level {
                    OirLogLevel::Trace | OirLogLevel::Debug | OirLogLevel::Info => "info",
                    OirLogLevel::Warn => "warn",
                    OirLogLevel::Error => "error",
                };
                code.push_str(&format!("      logger.{}({});\n\n", level_str, msg_ts));
            }

            OirEffect::Spawn { .. } => {
                // Phase 5.5: spawn is a client-side effect.
                // No server-side code needed.
            }

            OirEffect::Despawn { .. } => {
                // Phase 5.5: despawn is a client-side effect.
                // No server-side code needed.
            }

            // OS trigger effects — generate pure inline Node.js code
            OirEffect::OsWatchFiles {
                glob,
                options: _,
                emit,
            } => {
                let glob_ts = self.expr_to_ts(glob);
                let event_name = emit
                    .as_ref()
                    .and_then(|c| c.on_message.as_deref())
                    .unwrap_or("OS_FILE_MODIFIED");
                code.push_str("      // os/watch-files — register file system watcher\n");
                code.push_str("      {\n");
                code.push_str("        const { watch } = await import('fs');\n");
                code.push_str(&format!("        const globPattern = {};\n", glob_ts));
                code.push_str("        const globRe = new RegExp('^' + globPattern.replace(/\\*\\*/g, '.*').replace(/\\*/g, '[^/]*').replace(/\\?/g, '[^/]').replace(/\\./g, '\\\\.') + '$');\n");
                code.push_str("        const watcher = watch('.', { recursive: true }, (_event, filename) => {\n");
                code.push_str("          if (filename && globRe.test(filename)) {\n");
                code.push_str(&format!(
                    "            getServerEventBus().emit('{}', {{ file: filename, glob: globPattern }});\n",
                    event_name
                ));
                code.push_str("          }\n");
                code.push_str("        });\n");
                code.push_str("        process.on('SIGTERM', () => watcher.close());\n");
                code.push_str("      }\n\n");
            }

            OirEffect::OsWatchProcess {
                name,
                subcommand,
                emit,
            } => {
                let name_ts = self.expr_to_ts(name);
                // Process has two sub-event kinds. When the author sets
                // emit.on_message we alias both to that single name —
                // consumers discriminate on the payload (process field).
                let start_event = emit
                    .as_ref()
                    .and_then(|c| c.on_message.as_deref())
                    .unwrap_or("OS_PROCESS_STARTED");
                let exit_event = emit
                    .as_ref()
                    .and_then(|c| c.on_message.as_deref())
                    .unwrap_or("OS_PROCESS_EXITED");
                code.push_str("      // os/watch-process — monitor process\n");
                code.push_str("      {\n");
                code.push_str("        const { execSync } = await import('child_process');\n");
                code.push_str(&format!("        const procName = {};\n", name_ts));
                if let Some(sub) = subcommand {
                    let sub_ts = self.expr_to_ts(sub);
                    code.push_str(&format!(
                        "        const searchTerm = procName + ' ' + {};\n",
                        sub_ts
                    ));
                } else {
                    code.push_str("        const searchTerm = procName;\n");
                }
                code.push_str("        let wasRunning = false;\n");
                code.push_str("        const interval = setInterval(() => {\n");
                code.push_str("          let isRunning = false;\n");
                code.push_str("          try { execSync(`pgrep -f \"${searchTerm}\"`, { stdio: 'pipe' }); isRunning = true; } catch { isRunning = false; }\n");
                code.push_str(&format!(
                    "          if (isRunning && !wasRunning) getServerEventBus().emit('{}', {{ process: procName }});\n",
                    start_event
                ));
                code.push_str(&format!(
                    "          else if (!isRunning && wasRunning) getServerEventBus().emit('{}', {{ process: procName }});\n",
                    exit_event
                ));
                code.push_str("          wasRunning = isRunning;\n");
                code.push_str("        }, 2000);\n");
                code.push_str("        process.on('SIGTERM', () => clearInterval(interval));\n");
                code.push_str("      }\n\n");
            }

            OirEffect::OsWatchPort {
                port,
                protocol,
                emit,
            } => {
                let port_ts = self.expr_to_ts(port);
                let proto_ts = if let Some(p) = protocol {
                    self.expr_to_ts(p)
                } else {
                    "'tcp'".to_string()
                };
                let open_event = emit
                    .as_ref()
                    .and_then(|c| c.on_message.as_deref())
                    .unwrap_or("OS_PORT_OPENED");
                let close_event = emit
                    .as_ref()
                    .and_then(|c| c.on_message.as_deref())
                    .unwrap_or("OS_PORT_CLOSED");
                code.push_str("      // os/watch-port — monitor port\n");
                code.push_str("      {\n");
                code.push_str("        const { Socket } = await import('net');\n");
                code.push_str(&format!("        const watchPort = {};\n", port_ts));
                code.push_str(&format!("        const watchProto = {};\n", proto_ts));
                code.push_str("        let wasOpen = false;\n");
                code.push_str("        const interval = setInterval(() => {\n");
                code.push_str("          const s = new Socket();\n");
                code.push_str("          s.setTimeout(1000);\n");
                code.push_str(&format!(
                    "          s.on('connect', () => {{ s.destroy(); if (!wasOpen) {{ wasOpen = true; getServerEventBus().emit('{}', {{ port: watchPort, protocol: watchProto }}); }} }});\n",
                    open_event
                ));
                code.push_str(&format!(
                    "          s.on('error', () => {{ s.destroy(); if (wasOpen) {{ wasOpen = false; getServerEventBus().emit('{}', {{ port: watchPort, protocol: watchProto }}); }} }});\n",
                    close_event
                ));
                code.push_str(&format!(
                    "          s.on('timeout', () => {{ s.destroy(); if (wasOpen) {{ wasOpen = false; getServerEventBus().emit('{}', {{ port: watchPort, protocol: watchProto }}); }} }});\n",
                    close_event
                ));
                code.push_str("          s.connect(watchPort, '127.0.0.1');\n");
                code.push_str("        }, 3000);\n");
                code.push_str("        process.on('SIGTERM', () => clearInterval(interval));\n");
                code.push_str("      }\n\n");
            }

            OirEffect::OsWatchHttp {
                url_pattern,
                method,
                emit,
            } => {
                let url_ts = self.expr_to_ts(url_pattern);
                let event_name = emit
                    .as_ref()
                    .and_then(|c| c.on_message.as_deref())
                    .unwrap_or("OS_HTTP_RESPONSE");
                code.push_str("      // os/watch-http — intercept HTTP responses\n");
                code.push_str("      {\n");
                code.push_str(&format!("        const urlPattern = {};\n", url_ts));
                if let Some(m) = method {
                    let method_ts = self.expr_to_ts(m);
                    code.push_str(&format!("        const methodFilter = {};\n", method_ts));
                } else {
                    code.push_str("        const methodFilter: string | undefined = undefined;\n");
                }
                code.push_str("        const http = await import('http');\n");
                // `addRequest` is an internal method on http.Agent — present
                // at runtime but not in the public DefinitelyTyped surface.
                // Intersect the agent type with a structural shape that
                // declares it; gives the access proper types without
                // widening to `any` or `as unknown as`.
                code.push_str("        type AddRequestFn = (req: import('http').ClientRequest, opts: import('http').RequestOptions) => void;\n");
                code.push_str("        const httpAgent = http.globalAgent as import('http').Agent & { addRequest: AddRequestFn };\n");
                code.push_str("        const origAdd = httpAgent.addRequest.bind(httpAgent);\n");
                code.push_str("        const urlRe = new RegExp('^' + urlPattern.replace(/\\*\\*/g, '.*').replace(/\\*/g, '[^/]*').replace(/\\./g, '\\\\.') + '$');\n");
                // `req` is `http.ClientRequest` (an EventEmitter exposing
                // `.method` + `.on(...)`) and `opts` is `http.RequestOptions`
                // (declares `hostname`/`host`/`path`/`port` directly). No
                // casts needed — let TS check the surface.
                code.push_str("        httpAgent.addRequest = function(req, opts) {\n");
                code.push_str("          req.on('response', (res) => {\n");
                code.push_str("            const url = `http://${opts.hostname ?? opts.host ?? 'localhost'}${opts.port ? ':' + opts.port : ''}${opts.path ?? '/'}`;\n");
                code.push_str("            if (urlRe.test(url) && (!methodFilter || req.method === methodFilter.toUpperCase())) {\n");
                code.push_str(&format!(
                    "              getServerEventBus().emit('{}', {{ url, method: req.method ?? 'GET', statusCode: res.statusCode ?? 0 }});\n",
                    event_name
                ));
                code.push_str("            }\n");
                code.push_str("          });\n");
                code.push_str("          return origAdd(req, opts);\n");
                code.push_str("        };\n");
                code.push_str(
                    "        process.on('SIGTERM', () => { httpAgent.addRequest = origAdd; });\n",
                );
                code.push_str("      }\n\n");
            }

            OirEffect::OsWatchCron { expression, emit } => {
                let expr_ts = self.expr_to_ts(expression);
                let event_name = emit
                    .as_ref()
                    .and_then(|c| c.on_message.as_deref())
                    .unwrap_or("OS_CRON_FIRE");
                code.push_str("      // os/watch-cron — cron schedule\n");
                code.push_str("      {\n");
                code.push_str(&format!("        const cronExpr = {};\n", expr_ts));
                code.push_str("        const fields = cronExpr.trim().split(/\\s+/);\n");
                code.push_str("        const parseCF = (f: string, min: number, max: number): Set<number> => {\n");
                code.push_str("          const s = new Set<number>();\n");
                code.push_str("          for (const p of f.split(',')) {\n");
                code.push_str(
                    "            if (p === '*') { for (let i = min; i <= max; i++) s.add(i); }\n",
                );
                code.push_str("            else if (p.includes('/')) { const [r, st] = p.split('/'); const start = r === '*' ? min : +r; for (let i = start; i <= max; i += +st) s.add(i); }\n");
                code.push_str("            else if (p.includes('-')) { const [lo, hi] = p.split('-').map(Number); for (let i = lo; i <= hi; i++) s.add(i); }\n");
                code.push_str("            else s.add(+p);\n");
                code.push_str("          }\n");
                code.push_str("          return s;\n");
                code.push_str("        };\n");
                code.push_str("        const cf = { m: parseCF(fields[0], 0, 59), h: parseCF(fields[1], 0, 23), d: parseCF(fields[2], 1, 31), mo: parseCF(fields[3], 1, 12), w: parseCF(fields[4], 0, 6) };\n");
                code.push_str("        let lastFired = -1;\n");
                code.push_str("        const interval = setInterval(() => {\n");
                code.push_str("          const n = new Date();\n");
                code.push_str("          const key = n.getFullYear() * 1e8 + n.getMonth() * 1e6 + n.getDate() * 1e4 + n.getHours() * 100 + n.getMinutes();\n");
                code.push_str("          if (key !== lastFired && cf.m.has(n.getMinutes()) && cf.h.has(n.getHours()) && cf.d.has(n.getDate()) && cf.mo.has(n.getMonth() + 1) && cf.w.has(n.getDay())) {\n");
                code.push_str("            lastFired = key;\n");
                code.push_str(&format!(
                    "            getServerEventBus().emit('{}', {{ expression: cronExpr, firedAt: n.toISOString() }});\n",
                    event_name
                ));
                code.push_str("          }\n");
                code.push_str("        }, 1000);\n");
                code.push_str("        process.on('SIGTERM', () => clearInterval(interval));\n");
                code.push_str("      }\n\n");
            }

            OirEffect::OsWatchSignal { signal, emit } => {
                let signal_ts = self.expr_to_ts(signal);
                code.push_str("      // os/watch-signal — register signal handler\n");
                code.push_str("      {\n");
                code.push_str(&format!(
                    "        const sig = ({}).toUpperCase();\n",
                    signal_ts
                ));
                code.push_str("        process.on(sig, () => {\n");
                if let Some(cfg) = emit {
                    if let Some(event_name) = &cfg.on_message {
                        code.push_str(&format!(
                            "          getServerEventBus().emit('{}', {{ signal: sig }});\n",
                            event_name
                        ));
                    } else {
                        code.push_str(
                            "          getServerEventBus().emit(`OS_SIGNAL_${sig}`, { signal: sig });\n",
                        );
                    }
                } else {
                    code.push_str(
                        "          getServerEventBus().emit(`OS_SIGNAL_${sig}`, { signal: sig });\n",
                    );
                }
                code.push_str("        });\n");
                code.push_str("      }\n\n");
            }

            OirEffect::OsWatchEnv { variable, emit } => {
                let var_ts = self.expr_to_ts(variable);
                let event_name = emit
                    .as_ref()
                    .and_then(|c| c.on_message.as_deref())
                    .unwrap_or("OS_ENV_CHANGED");
                code.push_str("      // os/watch-env — watch environment variable\n");
                code.push_str("      {\n");
                code.push_str(&format!("        const envVar = {};\n", var_ts));
                code.push_str("        let lastVal = process.env[envVar];\n");
                code.push_str("        const interval = setInterval(() => {\n");
                code.push_str("          const cur = process.env[envVar];\n");
                code.push_str("          if (cur !== lastVal) {\n");
                code.push_str("            const prev = lastVal;\n");
                code.push_str("            lastVal = cur;\n");
                code.push_str(&format!(
                    "            getServerEventBus().emit('{}', {{ variable: envVar, value: cur ?? null, previous: prev ?? null }});\n",
                    event_name
                ));
                code.push_str("          }\n");
                code.push_str("        }, 1000);\n");
                code.push_str("        process.on('SIGTERM', () => clearInterval(interval));\n");
                code.push_str("      }\n\n");
            }

            OirEffect::FetchStream {
                entity_type,
                id,
                filter,
                emit,
            } => {
                let (resolved_entity, collection, entity_node) = Self::resolve_entity_collection(
                    entity_type,
                    module,
                    linked_entity,
                    self.current_linked_entity_id.snapshot().as_deref(),
                    self.current_entity_ref_ids.borrow().as_ref(),
                );
                let resolved_entity = resolved_entity.as_str();

                let on_message_event = emit
                    .as_ref()
                    .and_then(|c| c.on_message.as_deref())
                    .unwrap_or("CHUNK_RECEIVED");
                let success_event = emit
                    .as_ref()
                    .and_then(|c| c.success.as_deref())
                    .unwrap_or("STREAM_DONE");
                let failure_event = emit
                    .as_ref()
                    .and_then(|c| c.failure.as_deref())
                    .unwrap_or("");

                code.push_str(&format!(
                    "      // fetch-stream {} — SSE streaming\n",
                    resolved_entity
                ));
                code.push_str("      try {\n");

                // Load the entity row(s) that back the stream
                code.push_str(&self.emit_entity_load_block(
                    resolved_entity,
                    &collection,
                    entity_node,
                    id,
                    filter,
                    linked_entity.is_some(),
                ));

                // Emit on_message per row (simulates streaming chunks)
                code.push_str(&format!(
                    "        for (const __chunk of data['{}']) {{\n",
                    resolved_entity
                ));
                code.push_str(&format!(
                    "          getServerEventBus().emit('{}', {{ chunk: __chunk }});\n",
                    on_message_event
                ));
                code.push_str("        }\n");

                // Emit success on completion
                code.push_str(&format!(
                    "        getServerEventBus().emit('{}', {{ data: data['{}'] }});\n",
                    success_event, resolved_entity
                ));
                code.push_str(&format!(
                    "        effectResults.push({{ effect: 'fetch-stream', entityType: '{}', success: true }});\n",
                    resolved_entity
                ));
                code.push_str("      } catch (__streamErr) {\n");
                if !failure_event.is_empty() {
                    code.push_str(&format!(
                        "        getServerEventBus().emit('{}', {{ error: __streamErr instanceof Error ? __streamErr.message : String(__streamErr) }});\n",
                        failure_event
                    ));
                }
                code.push_str("        throw __streamErr;\n");
                code.push_str("      }\n\n");
            }

            // Substrate operators — compiled to TypeScript service calls
            OirEffect::Custom { name, args, emit }
                if crate::codegen::operator_names::is_substrate_operator(name) =>
            {
                let mut sorted_args: Vec<(&String, &OirExpr)> = args.iter().collect();
                sorted_args.sort_by(|a, b| a.0.cmp(b.0));
                let arg_exprs: Vec<String> = sorted_args
                    .iter()
                    .map(|(_, v)| self.expr_to_ts_server(v))
                    .collect();
                let a = |i: usize| arg_exprs.get(i).map(|s| s.as_str()).unwrap_or("undefined");

                match name.as_str() {
                    "trace/emit" => {
                        code.push_str("      // trace/emit\n");
                        code.push_str(&format!("      effectsLog.info(String({}));\n", a(0)));
                        code.push_str("      effectResults.push({ effect: 'substrate', name: 'trace/emit', success: true });\n\n");
                    }
                    "trace/log" => {
                        code.push_str("      // trace/log\n");
                        code.push_str(&format!("      effectsLog.info(String({}));\n", a(1)));
                        code.push_str("      effectResults.push({ effect: 'substrate', name: 'trace/log', success: true });\n\n");
                    }
                    "memory/store" => {
                        let content = a(0);
                        code.push_str("      // memory/store\n");
                        code.push_str("      const _memId = crypto.randomUUID();\n");
                        code.push_str(&format!(
                            "      await getDataService().create('memories', {{ id: _memId, content: ({}) as string, strength: 0.5, pinned: false, createdAt: new Date(), updatedAt: new Date() }});\n",
                            content
                        ));
                        code.push_str("      effectResults.push({ effect: 'substrate', name: 'memory/store', success: true, data: { id: _memId } });\n\n");
                    }
                    "session/write-spec" => {
                        code.push_str("      // session/write-spec\n");
                        code.push_str(&format!(
                            "      await getSubstrateService().session.writeSpec({});\n",
                            a(0)
                        ));
                        code.push_str("      effectResults.push({ effect: 'substrate', name: 'session/write-spec', success: true });\n\n");
                    }
                    op if Self::substrate_op_is_agent_port(op) => {
                        // `program/inputs`, `program/dispatch` and `persist/read-named` run over the host ports
                        // the route lends this call: the app as the signed-in viewer. `{ result, text }` on success,
                        // `{ error, errors? }` on failure; no emit config at all: a failure throws.
                        let args_arr: Vec<String> = (0..arg_exprs.len())
                            .map(|i| format!("({}) as JsonValue", a(i)))
                            .collect();
                        code.push_str(&format!("      // agent port effect: {}\n", op));
                        code.push_str("      {\n");
                        code.push_str("        const __ports = servicePorts(__ORBITAL_SOURCE, user);\n");
                        code.push_str(&format!(
                            "        const __out: AgentPortOutcome = __ports ? await runAgentPort('{}', [{}], __ports) : {{ ok: false, error: 'no host ports configured for {}' }};\n",
                            op,
                            args_arr.join(", "),
                            op
                        ));
                        code.push_str("        if (__out.ok) {\n");
                        code.push_str(&format!(
                            "          effectResults.push({{ effect: 'substrate', name: '{}', success: true, data: agentPortPayload(__out.result).result }});\n",
                            op
                        ));
                        if let Some(success_event) = emit.as_ref().and_then(|c| c.success.as_ref()) {
                            code.push_str(&format!(
                                "          {{ const __evP: EventPayload = agentPortPayload(__out.result); emittedEvents.push({{ event: '{success_event}', payload: __evP, source: __ORBITAL_SOURCE }}); getServerEventBus().emit('{success_event}', __evP, __ORBITAL_SOURCE); }}\n"
                            ));
                        }
                        code.push_str("        } else {\n");
                        code.push_str(&format!(
                            "          effectResults.push({{ effect: 'substrate', name: '{}', success: false, error: __out.error }});\n",
                            op
                        ));
                        match emit.as_ref() {
                            None => code.push_str("          throw new Error(__out.error);\n"),
                            Some(cfg) => {
                                if let Some(failure_event) = &cfg.failure {
                                    code.push_str(&format!(
                                        "          {{ const __evF: EventPayload = {{ error: __out.error, ...(__out.errors ? {{ errors: __out.errors.map((__issue) => ({{ code: __issue.code, message: __issue.message }})) }} : {{}}) }}; emittedEvents.push({{ event: '{failure_event}', payload: __evF, source: __ORBITAL_SOURCE }}); getServerEventBus().emit('{failure_event}', __evF, __ORBITAL_SOURCE); }}\n"
                                    ));
                                }
                            }
                        }
                        code.push_str("        }\n");
                        code.push_str("      }\n\n");
                    }
                    op if Self::substrate_op_is_program_effect(op) => {
                        // Same contract as the interpreter's executor arm: the
                        // host parses the JSON args; `{ result }` on success,
                        // `{ error }` (+ `errors` for eval's validator issues)
                        // on failure; no emit config at all → a failure throws.
                        let args_arr: Vec<String> = (0..arg_exprs.len())
                            .map(|i| format!("({}) as JsonValue", a(i)))
                            .collect();
                        code.push_str(&format!("      // program effect: {}\n", op));
                        code.push_str("      {\n");
                        code.push_str(&format!(
                            "        const __out = await runProgramEffect('{}', [{}], {{ cwd: process.env['ALMADAR_PROJECT_ROOT'] ?? process.cwd() }}, user ? {{ principal: user.id, role: user.role }} : undefined);\n",
                            op,
                            args_arr.join(", ")
                        ));
                        code.push_str("        if (__out.ok) {\n");
                        code.push_str(&format!(
                            "          effectResults.push({{ effect: 'substrate', name: '{}', success: true, data: __out.result as EventPayloadValue }});\n",
                            op
                        ));
                        if let Some(success_event) = emit.as_ref().and_then(|c| c.success.as_ref()) {
                            code.push_str(&format!(
                                "          {{ const __evP: EventPayload = {{ result: __out.result as EventPayloadValue }}; emittedEvents.push({{ event: '{success_event}', payload: __evP, source: __ORBITAL_SOURCE }}); getServerEventBus().emit('{success_event}', __evP, __ORBITAL_SOURCE); }}\n"
                            ));
                        }
                        code.push_str("        } else {\n");
                        code.push_str(&format!(
                            "          effectResults.push({{ effect: 'substrate', name: '{}', success: false, error: __out.error }});\n",
                            op
                        ));
                        match emit.as_ref() {
                            None => code.push_str("          throw new Error(__out.error);\n"),
                            Some(cfg) => {
                                if let Some(failure_event) = &cfg.failure {
                                    code.push_str(&format!(
                                        "          {{ const __evF: EventPayload = {{ error: __out.error, ...(__out.errors ? {{ errors: __out.errors }} : {{}}) }}; emittedEvents.push({{ event: '{failure_event}', payload: __evF, source: __ORBITAL_SOURCE }}); getServerEventBus().emit('{failure_event}', __evF, __ORBITAL_SOURCE); }}\n"
                                    ));
                                }
                            }
                        }
                        code.push_str("        }\n");
                        code.push_str("      }\n\n");
                    }
                    _ => {
                        // Generic substrate dispatch. Mirrors call-service:
                        // await the client call, then dispatch the
                        // success/failure event on completion (the `.lolo`
                        // emit/onSuccess/onFail model). Without this the op
                        // was fire-and-forget — a manual follow-up `(emit
                        // X)` fired immediately, not on completion
                        // (C-EMIT-SUBSTRATE-OPS-MARKER).
                        code.push_str(&format!("      // substrate: {}\n", name));
                        // `llm/*` ops call `getLLMClient()` (imported above
                        // via the SAME `substrate_op_uses_llm_client` check
                        // the handlers-file import uses — one truth for
                        // which client an op needs) with the per-op method
                        // mapping `to_ts.rs`'s VALUE-position
                        // `substrate_value_to_ts` also uses; every other op
                        // falls through to the generic
                        // `getSubstrateService().invoke(...)`, whose
                        // payload-typed args cross into the substrate's
                        // JsonValue universe at this boundary (both are
                        // JSON-serializable at runtime; the cast just names
                        // the crossing — TS2322 without it).
                        let invoke_expr = if Self::substrate_op_uses_llm_client(name) {
                            match name.as_str() {
                                // Same op→method mapping as `to_ts.rs`'s
                                // VALUE-position arm: `.lolo`'s `llm/
                                // generate` carries no systemPrompt arg;
                                // `callRaw` requires one (TS2345 without
                                // it), so `''` names "none configured."
                                "llm/generate" => format!(
                                    "getLLMClient().callRaw({{ systemPrompt: '', userPrompt: ({}) as string }})",
                                    a(0)
                                ),
                                // Same shape as `to_ts.rs`'s VALUE-position
                                // arm: `callWithTools` takes ONE object arg
                                // (`{ messages, tools, … }`), not two
                                // positional args (`.lolo`'s declared
                                // `prompt`/`tools`) — TS2554 without this.
                                "llm/call-tools" => {
                                    format!(
                                        "getLLMClient().callWithTools({{ messages: [{{ role: 'user', content: ({}) as string }}], tools: {} }})",
                                        a(0), a(1)
                                    )
                                }
                                "llm/token-count" => {
                                    "(getLLMClient().getTokenCount?.() ?? 0)".to_string()
                                }
                                "llm/compact" => format!("getLLMClient().compact({})", a(0)),
                                _ => unreachable!(
                                    "substrate_op_uses_llm_client covers exactly these ops"
                                ),
                            }
                        } else {
                            let args_arr: Vec<String> = (0..arg_exprs.len())
                                .map(|i| format!("({}) as JsonValue", a(i)))
                                .collect();
                            format!(
                                "getSubstrateService().invoke('{}', [{}])",
                                name,
                                args_arr.join(", ")
                            )
                        };
                        code.push_str("      try {\n");
                        code.push_str(&format!("        const _result = await {};\n", invoke_expr));
                        code.push_str(&format!(
                            "        effectResults.push({{ effect: 'substrate', name: '{}', success: true, data: _result as EventPayloadValue }});\n",
                            name
                        ));
                        // Uniform `{ result: v }` payload (NOT emit_success_js's
                        // object-pass-through) so the `.lolo` capture is always
                        // `?result` regardless of the op's return type — a string,
                        // number, array, or object all land under one `result` key.
                        if let Some(cfg) = emit {
                            if let Some(success_event) = &cfg.success {
                                code.push_str(&format!(
                                    "        {{ const __evP: EventPayload = {{ result: _result as EventPayloadValue }}; emittedEvents.push({{ event: '{success_event}', payload: __evP, source: __ORBITAL_SOURCE }}); getServerEventBus().emit('{success_event}', __evP, __ORBITAL_SOURCE); }}\n"
                                ));
                                code.push_str(&format!(
                                    "        effectsLog.debug('emit:push', {{ event: '{success_event}', cumulativeEmittedCount: emittedEvents.length, sourceTrait: __ORBITAL_SOURCE.trait, sourceOrbital: __ORBITAL_SOURCE.orbital }});\n"
                                ));
                            }
                        }
                        code.push_str("      } catch (err) {\n");
                        code.push_str(&format!(
                            "        effectResults.push({{ effect: 'substrate', name: '{}', success: false, error: err instanceof Error ? err.message : String(err) }});\n",
                            name
                        ));
                        if let Some(cfg) = emit {
                            if let Some(failure_event) = &cfg.failure {
                                code.push_str(&format!(
                                    "        getServerEventBus().emit('{}', {{ error: err instanceof Error ? err.message : String(err) }}, __ORBITAL_SOURCE);\n",
                                    failure_event
                                ));
                            }
                        }
                        code.push_str("      }\n\n");
                    }
                }
            }

            OirEffect::SendServer { .. } => {
                // Client-only; no server-side code generated.
            }

            _ => {
                code.push_str("      // Unsupported effect type\n\n");
            }
        }

        code
    }
}

impl TypeScriptBackend {
    /// One OAuth effect: the runtime's payload function (the same owner the interpreter calls) in a try block;
    /// a routed failure carries the closed `code` and `reason` beside the fixed safe `error`.
    fn push_oauth_effect(&self, code: &mut String, name: &str, call: &str, emit: &Option<orbital_core_base::ir::OirEmitConfig>, keyed: bool) {
        code.push_str(&format!("      // {name}\n"));
        code.push_str("      try {\n");
        code.push_str(&format!("        const hostResult = {call};\n"));
        code.push_str(&self.emit_success_js(emit, "success", "hostResult", "        "));
        code.push_str("      } catch (err) {\n");
        if emit.as_ref().is_some_and(|e| e.failure.is_some()) {
            code.push_str(&self.emit_failure_js_impl(
                emit,
                "err instanceof Error ? err.message : String(err)",
                if keyed {
                    ", ...(err instanceof OAuthEffectFailure ? { code: err.payload.code, reason: err.payload.reason } : {}), key: __authKey"
                } else {
                    ", ...(err instanceof OAuthEffectFailure ? { code: err.payload.code, reason: err.payload.reason } : {})"
                },
                "        ",
            ));
        } else {
            code.push_str("        throw err;\n");
        }
        code.push_str("      }\n\n");
    }
    /// The one compiled page rule: offset and limit each apply only when > 0 (as `resolve_page_option`).
    pub(crate) fn emit_page_slice(
        &self,
        offset: Option<&OirExpr>,
        limit: Option<&OirExpr>,
        entity: &str,
    ) -> String {
        if offset.is_none() && limit.is_none() {
            return String::new();
        }
        let offset_ts = offset.map_or_else(|| "0".to_string(), |e| self.compile_guard_to_ts(e));
        let limit_ts = limit.map_or_else(|| "0".to_string(), |e| self.compile_guard_to_ts(e));
        format!(
            "          {{\n            const __offset = Number({offset_ts});\n            const __limit = Number({limit_ts});\n            if (__offset > 0) data['{entity}'] = data['{entity}'].slice(Math.floor(__offset));\n            if (__limit > 0) data['{entity}'] = data['{entity}'].slice(0, Math.floor(__limit));\n          }}\n"
        )
    }
}
