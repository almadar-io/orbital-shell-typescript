//! Persist-effect codegen: the single source of truth for `OirEffect::Persist`
//! shared by Express + Hono backends, plus emit-payload server lowering.

use super::*;
use crate::backend::server::access_policies::policy_const_name;

/// The denial message, as a TypeScript string literal. Mirrors
/// `accessDeniedMessage(op, entityType)` in `@almadar/runtime`'s
/// `entityAccess.ts` — a consumer distinguishing "denied" from "failed" reads
/// this string, so the compiled path must produce it byte-for-byte. A test
/// asserts the two definitions agree.
fn access_denied_literal(op: &str, entity_type: &str) -> String {
    format!(
        "\"@{} denied: the declared access policy for '{}' rejected this row\"",
        op, entity_type
    )
}

/// How the generated persist code should bind the incoming `data` expression
/// to a typed `createData`/`updateData` constant before the persistence call.
///
/// `Cast` is the default Express path: `<data> as unknown as Partial<E>`.
/// `ZodSchema` is the Hono path: `<entity>InputSchema.parse(<data>)` /
/// `<entity>UpdateSchema.parse(<data>)`.
#[derive(Clone, Debug)]
pub(crate) enum PersistDataValidation {
    Cast,
    ZodSchema { entity_lower: String },
}

impl TypeScriptBackend {
    /// Single source of truth for `OirEffect::Persist` codegen.
    ///
    /// Both `generate_server_effect_code` (Express / shared) and
    /// `generate_server_effect_code_hono` (Hono) call this. The only
    /// per-backend variation is `validation`: Express casts data with
    /// `as unknown as Partial<E>`; Hono parses with the entity's
    /// `<entity>InputSchema` / `<entity>UpdateSchema`. Everything else
    /// (id-resolution chain, `if (id) {...}` guard, store-mutate +
    /// effectResults push, emit, structured logs at every persist
    /// boundary) lives here so a single change touches both backends.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn generate_persist_block(
        &self,
        operation: &OirPersistOp,
        entity_type: &str,
        data: &OirExpr,
        emit: &Option<OirEmitConfig>,
        module: &OirModule,
        linked_entity: Option<&str>,
        validation: &PersistDataValidation,
    ) -> String {
        let (ref_name, ref_id) = if entity_type == "@entity" {
            (
                linked_entity.unwrap_or("Entity"),
                self.current_linked_entity_id.snapshot(),
            )
        } else {
            // A NON-linked positional `persist` entity token carries its stable
            // id in the trait's `entity_ref_ids` side-map, so a renamed entity
            // is followed by id (id-first). Missing key → `None` → the exact
            // name join used before the V4 flip.
            (
                entity_type,
                self.current_entity_ref_ids
                    .borrow()
                    .as_ref()
                    .and_then(|m| m.get(entity_type).cloned()),
            )
        };
        let node = module.resolve_entity_ref(ref_id.as_deref(), ref_name);
        let resolved_entity = node
            .map(|e| e.name.clone())
            .unwrap_or_else(|| ref_name.to_string());
        let collection = node
            .map(|e| e.collection.clone())
            .unwrap_or_else(|| to_snake_case(&resolved_entity));
        let resolved_entity = resolved_entity.as_str();

        let data_expr = self.expr_to_ts_server(data);
        let mut code = String::new();

        code.push_str(&format!(
            "      // Persist {} ({})\n",
            resolved_entity,
            operation_to_string(operation)
        ));
        code.push_str("      {\n");
        code.push_str(&format!(
            // `payload` is `EventPayload | undefined` (or a narrower per-event
            // shape). Both expose object-keys directly — no cast needed.
            "        effectsLog.debug('persist:dispatch', {{ action: '{}', entityType: '{}', payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload).join(',') : null }});\n",
            operation_to_string(operation),
            resolved_entity
        ));

        // Strip the target schema's intrinsic fields before validation, policy checks and writes.
        let data_is_bare_entity_frame = matches!(
            data,
            OirExpr::Binding {
                binding: OirBinding { root: OirBindingRoot::Entity, path }
            } if path.is_empty()
        );
        let frame_fields = node.map(|entity| entity.frame_fields()).unwrap_or_default();
        let store_data_expr = if matches!(operation, OirPersistOp::Create | OirPersistOp::Update)
            && !frame_fields.is_empty()
        {
            let keys = frame_fields
                .iter()
                .map(|field| format!("'{}'", orbital_core::str_utils::escape_js_string(field)))
                .collect::<Vec<_>>()
                .join(", ");
            // A literal row of wide reads (`id: FieldValue`) is no `EntityRow` until asserted.
            let row = if matches!(data, OirExpr::Object { .. }) {
                format!("({}) as EntityRow", data_expr)
            } else {
                data_expr.clone()
            };
            format!("omitFrameFields({}, [{}])", row, keys)
        } else {
            data_expr.clone()
        };

        match operation {
            OirPersistOp::Create => {
                // Bind `createData` per the active validation strategy. After
                // this prelude, the rest of the persist + emit + log chain is
                // identical for every backend.
                match validation {
                    PersistDataValidation::Cast => {
                        // `data_expr` resolves to the payload's data field
                        // (typed via the event's payload schema). Route
                        // through `Record<string, FieldValue | undefined>`
                        // so the `@now` → ISO string sites that target
                        // Date-typed BaseEntity fields don't trip the
                        // string→Date comparability check. FieldValue
                        // covers both string and Date; the data service
                        // overwrites createdAt/updatedAt server-side
                        // anyway.
                        code.push_str(&format!(
                            "        const createData = ({}) as Record<string, FieldValue | undefined> as Partial<{}> | undefined;\n",
                            store_data_expr,
                            entity_type_ref(resolved_entity)
                        ));
                    }
                    PersistDataValidation::ZodSchema { entity_lower } => {
                        code.push_str(&format!("        const rawCreate = {};\n", store_data_expr));
                        code.push_str(&format!(
                            "        const createData = rawCreate ? {}InputSchema.parse(rawCreate) as Partial<{}> : null;\n",
                            entity_lower,
                            entity_type_ref(resolved_entity)
                        ));
                    }
                }
                // `@create` is checked against the INCOMING data — no row
                // exists yet. Emitted only when the entity declares the
                // directive, so an unpoliced entity's output is
                // byte-identical to before. `createData` is already frame-
                // stripped above when it came from `@entity`, so the policy
                // check needs no extra wrap.
                let create_policy = node
                    .and_then(|e| e.create_policy.as_ref())
                    .map(|_| policy_const_name(resolved_entity, "CREATE"));
                if let Some(policy) = &create_policy {
                    code.push_str(&format!(
                        "        const createAllowed = createData ? checkMutationAccess(createData, {}, {{ user, now }}) : true;\n",
                        policy
                    ));
                    code.push_str("        if (createData && !createAllowed) {\n");
                    code.push_str(&format!(
                        "          effectsLog.warn('persist:access-denied', {{ action: 'create', entityType: '{}' }});\n",
                        resolved_entity
                    ));
                    code.push_str("          effectResults.push({\n");
                    code.push_str("            effect: 'persist',\n");
                    code.push_str("            action: 'create',\n");
                    code.push_str(&format!("            entityType: '{}',\n", resolved_entity));
                    code.push_str("            success: false,\n");
                    code.push_str(&format!(
                        "            error: {},\n",
                        access_denied_literal("create", resolved_entity)
                    ));
                    code.push_str("          });\n");
                    code.push_str(&self.emit_failure_js_impl(
                        emit,
                        &access_denied_literal("create", resolved_entity),
                        "",
                        "          ",
                    ));
                    code.push_str("        } else {\n");
                }

                // The store write + success report, built once and either
                // emitted directly or nested inside the required-column gate
                // below — one block, not a duplicated copy per branch.
                let mut success_block = String::new();
                success_block.push_str(&format!(
                    "          const created = createData ? await getDataService().create<{}>('{}', createData) : null;\n",
                    entity_type_ref(resolved_entity),
                    collection
                ));
                // The store assigns the real id on create. When this create's
                // data source is the bare `@entity` binding (the local
                // `entity` var the handler header resolved/seeded), write the
                // real id back onto it so later effects in the SAME handler
                // invocation that read `entity.id` see it, not the pre-create
                // seed.
                if data_is_bare_entity_frame {
                    success_block
                        .push_str("          if (created && entity) { entity.id = created.id; }\n");
                }
                // `created` is `<Entity> | null` from `getDataService().
                // create<<Entity>>(...)`. `<Entity>` has `id: string`
                // (the auto-added bookkeeping field every entity carries),
                // so `created?.id` is `string | undefined` — directly
                // assignable to LogMeta without a Record-string-unknown
                // cast.
                success_block.push_str(&format!(
                    "          effectsLog.debug('persist:store-mutate', {{ action: 'create', entityType: '{}', resultId: created?.id, success: !!created }});\n",
                    resolved_entity
                ));
                success_block.push_str("          effectResults.push({\n");
                success_block.push_str("            effect: 'persist',\n");
                success_block.push_str("            action: 'create',\n");
                success_block
                    .push_str(&format!("            entityType: '{}',\n", resolved_entity));
                success_block.push_str("            success: !!created,\n");
                success_block.push_str("            data: created,\n");
                success_block.push_str("          });\n");
                success_block.push_str(&self.emit_success_js_impl(
                    emit,
                    "success",
                    "created",
                    "          ",
                    Some(resolved_entity),
                ));

                // A `persist create` whose data is missing a declared REQUIRED
                // column (schema-level definition: `OirEntity::
                // required_create_field_names`, shared with the Rust kernel's
                // `runtime::entity_access::required_create_field_names`) must
                // fail the write rather than store a partial row — the same
                // `EffectOutcome::Failed` shape a denied mutation already
                // produces. Emitted only when the entity declares at least
                // one such column, so an entity with none stays
                // byte-identical to before.
                let required_fields = node
                    .map(|e| e.required_create_field_names())
                    .unwrap_or_default();
                if required_fields.is_empty() {
                    code.push_str(&success_block);
                } else {
                    let required_array = required_fields
                        .iter()
                        .map(|f| format!("'{}'", f))
                        .collect::<Vec<_>>()
                        .join(", ");
                    code.push_str(&format!(
                        "        const __requiredFields = [{}];\n",
                        required_array
                    ));
                    code.push_str(
                        "        const __missingRequired = createData ? __requiredFields.filter((k) => { const v = (createData as Record<string, FieldValue | undefined>)[k]; return v === undefined || v === null || v === ''; }) : [];\n",
                    );
                    let missing_error_expr = format!(
                        "`persist create {}: required field(s) ${{__missingRequired.join(', ')}} missing`",
                        resolved_entity
                    );
                    code.push_str("        if (createData && __missingRequired.length > 0) {\n");
                    code.push_str(&format!(
                        "          effectsLog.warn('persist:required-missing', {{ entityType: '{}', missing: __missingRequired }});\n",
                        resolved_entity
                    ));
                    code.push_str("          effectResults.push({\n");
                    code.push_str("            effect: 'persist',\n");
                    code.push_str("            action: 'create',\n");
                    code.push_str(&format!("            entityType: '{}',\n", resolved_entity));
                    code.push_str("            success: false,\n");
                    code.push_str(&format!("            error: {},\n", missing_error_expr));
                    code.push_str("          });\n");
                    code.push_str(&self.emit_failure_js_impl(
                        emit,
                        &missing_error_expr,
                        "",
                        "          ",
                    ));
                    code.push_str("        } else {\n");
                    code.push_str(&success_block);
                    code.push_str("        }\n");
                }

                if create_policy.is_some() {
                    code.push_str("        }\n");
                }
            }
            OirPersistOp::Update => {
                // Bind `updateData` and `idSourceVar` (the variable the
                // resolution chain reads `.id` off) per the active validation
                // strategy. Hono reads from the raw input so a missing id
                // surfaces even if Zod stripped it; default reads from the
                // post-cast value.
                let id_source_var: &str = match validation {
                    PersistDataValidation::Cast => {
                        // Same widen-through-FieldValue trick as the
                        // Create path — admits `@now` ISO strings into
                        // Date-typed BaseEntity fields without an `as
                        // unknown` escape hatch.
                        code.push_str(&format!(
                            "        const updateData = ({}) as Record<string, FieldValue | undefined> as Partial<{}> | undefined;\n",
                            store_data_expr,
                            entity_type_ref(resolved_entity)
                        ));
                        "updateData"
                    }
                    PersistDataValidation::ZodSchema { entity_lower } => {
                        code.push_str(&format!("        const rawUpdate = {};\n", store_data_expr));
                        code.push_str(&format!(
                            "        const updateData = rawUpdate ? {}UpdateSchema.parse(rawUpdate) as Partial<{}> : undefined;\n",
                            entity_lower,
                            entity_type_ref(resolved_entity)
                        ));
                        "rawUpdate"
                    }
                };
                // Update id resolution chain — typed across the board.
                // Payload is widened to EventPayload at the read site so
                // `entityId` / `id` keys are accessible regardless of the
                // narrowed-payload schema. Each leaf is typeof-narrowed
                // to string.
                code.push_str(
                    "        const __payloadWideUpd = payload as EventPayload | undefined;\n",
                );
                code.push_str("        const __pEntityIdUpd = __payloadWideUpd?.entityId;\n");
                code.push_str("        const __pIdUpd = __payloadWideUpd?.id;\n");
                // `updateData?.id` / `entity?.id` / payload ids can be the wide
                // `FieldValue` / `EventPayloadValue` (a scan loop's per-record
                // `entity` comes from a fetched `EventPayloadValue[]`). Pick the
                // first string via `.find` with a type-guard predicate — inline
                // `typeof ? :` ternaries in a `??` chain don't reliably narrow
                // the recursive `EventPayloadValue` union, but the predicate does.
                // The ZodSchema strategy's `id_source_var` is `rawUpdate` — the
                // UNVALIDATED `EventPayloadValue`, read before `.parse()` so a
                // missing id surfaces even when the schema would strip it
                // (see above) — which has no `.id` member (TS2339). Widen it
                // to `EventPayload` at the two read sites only, the same
                // `payload`-widening idiom already used for `entityId`/`id`
                // above; the Cast strategy's `updateData` is already
                // entity-typed and needs no extra cast.
                let id_access_expr = match validation {
                    PersistDataValidation::ZodSchema { .. } => {
                        format!("({} as EventPayload | undefined)", id_source_var)
                    }
                    PersistDataValidation::Cast => id_source_var.to_string(),
                };
                code.push_str(&format!(
                    "        const __updDataId = {}?.id;\n",
                    id_access_expr
                ));
                code.push_str("        const __updEntityId = entity?.id;\n");
                code.push_str("        const updateId: string | undefined = [__updDataId, __updEntityId, __pEntityIdUpd, __pIdUpd].find((__v): __v is string => typeof __v === 'string');\n");
                code.push_str(&format!(
                    "        effectsLog.debug('persist:resolve-id', {{ action: 'update', entityType: '{}', resolvedId: updateId, fromData: !!{}?.id, fromEntity: !!entity?.id, fromPayloadEntityId: typeof __pEntityIdUpd === 'string', fromPayloadId: typeof __pIdUpd === 'string' }});\n",
                    resolved_entity, id_access_expr
                ));
                code.push_str("        if (updateId) {\n");
                // `@update` is checked against the EXISTING row, read fresh — what the
                // caller may touch is decided by the stored row, not by the patch
                // they sent. The extra read is emitted ONLY when the directive
                // exists, so unpoliced entities keep their single round-trip.
                if let Some(policy) = node
                    .and_then(|e| e.update_policy.as_ref())
                    .map(|_| policy_const_name(resolved_entity, "UPDATE"))
                {
                    code.push_str(&format!(
                        "          const __existingUpdate = await getDataService().getById<{}>('{}', updateId as string);\n",
                        entity_type_ref(resolved_entity),
                        collection
                    ));
                    code.push_str(&format!(
                        "          const updateAllowed = !!__existingUpdate && checkMutationAccess(__existingUpdate, {}, {{ user, now }});\n",
                        policy
                    ));
                    code.push_str(&format!("          if (!updateAllowed) {{\n"));
                    code.push_str(&format!(
                        "            effectsLog.warn('persist:access-denied', {{ action: 'update', entityType: '{}', resolvedId: updateId }});\n",
                        resolved_entity
                    ));
                    code.push_str("            effectResults.push({\n");
                    code.push_str("              effect: 'persist',\n");
                    code.push_str("              action: 'update',\n");
                    code.push_str(&format!(
                        "              entityType: '{}',\n",
                        resolved_entity
                    ));
                    code.push_str("              success: false,\n");
                    code.push_str(&format!(
                        "              error: {},\n",
                        access_denied_literal("update", resolved_entity)
                    ));
                    code.push_str("            });\n");
                    code.push_str(&self.emit_failure_js_impl(
                        emit,
                        &access_denied_literal("update", resolved_entity),
                        "",
                        "            ",
                    ));
                    code.push_str("          } else {\n");
                }
                code.push_str(&format!(
                    "          const updated = await getDataService().update<{}>('{}', updateId, updateData ?? {{}});\n",
                    entity_type_ref(resolved_entity),
                    collection
                ));
                // `updated` is `null` when the store's own lookup missed —
                // the row resolved an id but that id names no existing
                // record. Reporting `success:true`/`data:null` here told the
                // caller "updated" for a write that never happened (the
                // two-path divergence: the interpreter throws "not found"
                // and routes to `emit.failure`, this path silently
                // "succeeded"). A miss is a failed persist, not a no-op.
                code.push_str("          if (updated === null) {\n");
                code.push_str(&format!(
                    "            effectsLog.warn('persist:miss', {{ action: 'update', entityType: '{}', resolvedId: updateId }});\n",
                    resolved_entity
                ));
                code.push_str("            effectResults.push({\n");
                code.push_str("              effect: 'persist',\n");
                code.push_str("              action: 'update',\n");
                code.push_str(&format!(
                    "              entityType: '{}',\n",
                    resolved_entity
                ));
                code.push_str("              success: false,\n");
                code.push_str(&format!(
                    "              error: `Entity {} ${{updateId}} not found`,\n",
                    resolved_entity
                ));
                code.push_str("              code: 'not-found',\n");
                code.push_str("            });\n");
                code.push_str(&self.emit_failure_js_impl(
                    emit,
                    &format!("`Entity {} ${{updateId}} not found`", resolved_entity),
                    ", code: 'not-found'",
                    "            ",
                ));
                code.push_str("          } else {\n");
                code.push_str(&format!(
                    "            effectsLog.debug('persist:store-mutate', {{ action: 'update', entityType: '{}', resultId: updateId, success: true }});\n",
                    resolved_entity
                ));
                code.push_str("            effectResults.push({\n");
                code.push_str("              effect: 'persist',\n");
                code.push_str("              action: 'update',\n");
                code.push_str(&format!(
                    "              entityType: '{}',\n",
                    resolved_entity
                ));
                code.push_str("              success: true,\n");
                code.push_str("              data: updated,\n");
                code.push_str("            });\n");
                code.push_str(&self.emit_success_js_impl(
                    emit,
                    "success",
                    "updated",
                    "            ",
                    Some(resolved_entity),
                ));
                code.push_str("          }\n");
                // Close the `else` branch the policy gate opened, if any.
                if node.and_then(|e| e.update_policy.as_ref()).is_some() {
                    code.push_str("          }\n");
                }
                code.push_str("        } else {\n");
                code.push_str(&format!(
                    "          effectsLog.warn('persist:noop-no-id', {{ action: 'update', entityType: '{}', reason: 'updateId did not resolve from data/entity/payload' }});\n",
                    resolved_entity
                ));
                code.push_str("          effectResults.push({\n");
                code.push_str("            effect: 'persist',\n");
                code.push_str("            action: 'update',\n");
                code.push_str(&format!("            entityType: '{}',\n", resolved_entity));
                code.push_str("            success: false,\n");
                code.push_str(&format!(
                    "            error: 'persist update {} resolved no row key',\n",
                    resolved_entity
                ));
                code.push_str("            code: 'no-row-key',\n");
                code.push_str("          });\n");
                code.push_str(&self.emit_failure_js_impl(
                    emit,
                    &format!("'persist update {} resolved no row key'", resolved_entity),
                    ", code: 'no-row-key'",
                    "          ",
                ));
                code.push_str("        }\n");
            }
            OirPersistOp::Delete => {
                // Delete has no Zod-validation variant today; the data
                // expression is treated as either a bare id string or a
                // partial entity carrying `.id`. If a future backend needs
                // delete-time validation, branch on `validation` here.
                // Cache the data expression into a local so the `typeof`
                // narrow propagates (TS doesn't narrow complex member-access
                // expressions evaluated twice in a ternary).
                code.push_str(&format!("        const __deleteIdSrc = {};\n", data_expr));
                // Delete id resolution — same widened-EventPayload read pattern
                // as the update path. Pick the first string via `.find` with a
                // type-guard predicate; inline `typeof ? :` in a `??` chain
                // doesn't reliably narrow the recursive `EventPayloadValue` union.
                code.push_str(
                    "        const __payloadWideDel = payload as EventPayload | undefined;\n",
                );
                code.push_str("        const __pEntityIdDel = __payloadWideDel?.entityId;\n");
                code.push_str("        const __pIdDel = __payloadWideDel?.id;\n");
                code.push_str(&format!(
                    "        const __delSrcId = typeof __deleteIdSrc === 'string' ? __deleteIdSrc : (__deleteIdSrc as Partial<{}> | undefined)?.id;\n",
                    entity_type_ref(resolved_entity)
                ));
                code.push_str("        const __delEntityId = entity?.id;\n");
                code.push_str("        const deleteId: string | undefined = [__delSrcId, __delEntityId, __pEntityIdDel, __pIdDel].find((__v): __v is string => typeof __v === 'string');\n");
                code.push_str(&format!(
                    "        effectsLog.debug('persist:resolve-id', {{ action: 'delete', entityType: '{}', resolvedId: deleteId, fromEntity: !!entity?.id, fromPayloadEntityId: typeof __pEntityIdDel === 'string', fromPayloadId: typeof __pIdDel === 'string' }});\n",
                    resolved_entity
                ));
                code.push_str("        if (deleteId) {\n");
                // `@delete` is checked against the EXISTING row, read fresh — what the
                // caller may touch is decided by the stored row, not by the patch
                // they sent. The extra read is emitted ONLY when the directive
                // exists, so unpoliced entities keep their single round-trip.
                if let Some(policy) = node
                    .and_then(|e| e.delete_policy.as_ref())
                    .map(|_| policy_const_name(resolved_entity, "DELETE"))
                {
                    code.push_str(&format!(
                        "          const __existingDelete = await getDataService().getById<{}>('{}', deleteId as string);\n",
                        entity_type_ref(resolved_entity),
                        collection
                    ));
                    code.push_str(&format!(
                        "          const deleteAllowed = !!__existingDelete && checkMutationAccess(__existingDelete, {}, {{ user, now }});\n",
                        policy
                    ));
                    code.push_str(&format!("          if (!deleteAllowed) {{\n"));
                    code.push_str(&format!(
                        "            effectsLog.warn('persist:access-denied', {{ action: 'delete', entityType: '{}', resolvedId: deleteId }});\n",
                        resolved_entity
                    ));
                    code.push_str("            effectResults.push({\n");
                    code.push_str("              effect: 'persist',\n");
                    code.push_str("              action: 'delete',\n");
                    code.push_str(&format!(
                        "              entityType: '{}',\n",
                        resolved_entity
                    ));
                    code.push_str("              success: false,\n");
                    code.push_str(&format!(
                        "              error: {},\n",
                        access_denied_literal("delete", resolved_entity)
                    ));
                    code.push_str("            });\n");
                    code.push_str(&self.emit_failure_js_impl(
                        emit,
                        &access_denied_literal("delete", resolved_entity),
                        "",
                        "            ",
                    ));
                    code.push_str("          } else {\n");
                }
                code.push_str(&format!(
                    "          const deleted = await getDataService().delete('{}', deleteId as string);\n",
                    collection
                ));
                // `deleted` is `false` when the store's own lookup missed —
                // the resolved id names no existing record. Reporting
                // `success:true`/`{ deleted: true }` here told the caller a
                // row was removed when nothing was (the two-path
                // divergence: the interpreter throws "not found" and routes
                // to `emit.failure`, this path silently "succeeded"). A miss
                // is a failed persist, not a no-op.
                code.push_str("          if (deleted === false) {\n");
                code.push_str(&format!(
                    "            effectsLog.warn('persist:miss', {{ action: 'delete', entityType: '{}', resolvedId: deleteId }});\n",
                    resolved_entity
                ));
                code.push_str("            effectResults.push({\n");
                code.push_str("              effect: 'persist',\n");
                code.push_str("              action: 'delete',\n");
                code.push_str(&format!(
                    "              entityType: '{}',\n",
                    resolved_entity
                ));
                code.push_str("              success: false,\n");
                code.push_str(&format!(
                    "              error: `Entity {} ${{deleteId}} not found`,\n",
                    resolved_entity
                ));
                code.push_str("              code: 'not-found',\n");
                code.push_str("            });\n");
                code.push_str(&self.emit_failure_js_impl(
                    emit,
                    &format!("`Entity {} ${{deleteId}} not found`", resolved_entity),
                    ", code: 'not-found'",
                    "            ",
                ));
                code.push_str("          } else {\n");
                code.push_str(&format!(
                    "            effectsLog.debug('persist:store-mutate', {{ action: 'delete', entityType: '{}', resultId: deleteId as string, success: true }});\n",
                    resolved_entity
                ));
                code.push_str("            effectResults.push({\n");
                code.push_str("              effect: 'persist',\n");
                code.push_str("              action: 'delete',\n");
                code.push_str(&format!(
                    "              entityType: '{}',\n",
                    resolved_entity
                ));
                code.push_str("              success: true,\n");
                code.push_str("              data: { id: deleteId, deleted: true },\n");
                code.push_str("            });\n");
                // `{ id, deleted }` — the delete contract declared in
                // canonical-operators.json and already emitted by the
                // interpreted path (`ServerEffectHandlers.ts:383`). This path
                // used to emit `{ id }` alone, so an event declaring `deleted`
                // read `undefined` on the compiled path only — a two-paths
                // divergence invisible to anything that tested one path.
                code.push_str(&self.emit_success_js_impl(
                    emit,
                    "success",
                    "{ id: deleteId, deleted: true }",
                    "            ",
                    Some(resolved_entity),
                ));
                code.push_str("          }\n");
                // Close the `else` branch the policy gate opened, if any.
                if node.and_then(|e| e.delete_policy.as_ref()).is_some() {
                    code.push_str("          }\n");
                }
                code.push_str("        } else {\n");
                code.push_str(&format!(
                    "          effectsLog.warn('persist:noop-no-id', {{ action: 'delete', entityType: '{}', reason: 'deleteId did not resolve from data/entity/payload' }});\n",
                    resolved_entity
                ));
                code.push_str("          effectResults.push({\n");
                code.push_str("            effect: 'persist',\n");
                code.push_str("            action: 'delete',\n");
                code.push_str(&format!("            entityType: '{}',\n", resolved_entity));
                code.push_str("            success: false,\n");
                code.push_str(&format!(
                    "            error: 'persist delete {} resolved no row key',\n",
                    resolved_entity
                ));
                code.push_str("            code: 'no-row-key',\n");
                code.push_str("          });\n");
                code.push_str(&self.emit_failure_js_impl(
                    emit,
                    &format!("'persist delete {} resolved no row key'", resolved_entity),
                    ", code: 'no-row-key'",
                    "          ",
                ));
                code.push_str("        }\n");
            }
            _ => {
                code.push_str("        // Other persist operations not yet implemented\n");
            }
        }

        code.push_str("      }\n\n");
        code
    }

    /// Build an emit's payload object as server TS, coercing each field whose
    /// declared event payload-schema type is `string` with `String(… ?? '')`.
    /// A `?payload.field` read otherwise lowers to `EventPayloadValue | undefined`
    /// and won't assign into the event's typed `string` slot (TS2322). The
    /// coercion is a no-op for values that are already strings.
    pub(super) fn emit_payload_to_ts_server(
        &self,
        payload: &OirExpr,
        event: &str,
        module: &OirModule,
    ) -> String {
        let schema = module
            .traits
            .iter()
            .flat_map(|t| t.events.iter())
            .find(|e| e.key == event)
            .and_then(|e| e.payload_schema.as_ref());
        if let (OirExpr::Object { fields }, Some(schema)) = (payload, schema) {
            let mut keys: Vec<&String> = fields.keys().collect();
            keys.sort();
            let parts: Vec<String> = keys
                .into_iter()
                .map(|k| {
                    let v_ts = self.expr_to_ts_server(&fields[k]);
                    let target_ty = match schema.get(k) {
                        Some(OirType::Optional { inner }) => Some(inner.as_ref()),
                        other => other,
                    };
                    // Only coerce/guard wide reads (bindings / computed calls)
                    // that lower to `EventPayloadValue | undefined`. Literals
                    // are already clean values of their own type — wrapping
                    // one in `String(… ?? '')` makes the `?? ''` unreachable
                    // (TS2869), and a `typeof` guard on a literal is equally
                    // pointless.
                    let is_wide =
                        matches!(&fields[k], OirExpr::Binding { .. } | OirExpr::Call { .. });
                    if !is_wide {
                        return format!("{}: {}", k, v_ts);
                    }
                    match target_ty {
                        Some(OirType::String) => {
                            format!(
                                "{}: {}",
                                k,
                                crate::codegen::effect::shared::string_coerce_ts(&v_ts)
                            )
                        }
                        // A non-string scalar's wide read stays `T | undefined`
                        // regardless of a `typeof` narrow, so the narrow is a
                        // guard, not a coercion — it protects the field from a
                        // wrong-shaped runtime value without asserting one
                        // that isn't there.
                        Some(OirType::Number) => {
                            format!(
                                "{0}: (typeof ({1}) === 'number' ? ({1}) : undefined)",
                                k, v_ts
                            )
                        }
                        Some(OirType::Boolean) => {
                            format!(
                                "{0}: (typeof ({1}) === 'boolean' ? ({1}) : undefined)",
                                k, v_ts
                            )
                        }
                        _ => format!("{}: {}", k, v_ts),
                    }
                })
                .collect();
            format!("{{ {} }}", parts.join(", "))
        } else {
            self.expr_to_ts_server(payload)
        }
    }
}
