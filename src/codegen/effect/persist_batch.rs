//! `persist batch` server codegen: one effect writing many rows.
//!
//! The op tuples are data, evaluated by the handler at run time (`<ops>` may be any
//! array-valued expression), so the entity of each op is only known then. The emitted
//! block therefore routes by entity NAME through small lookup functions built from the
//! module's entities (collection, required create columns, `@create`/`@update`/`@delete`
//! policy consts), and runs every op through the same gates the single forms use:
//! policy check, required-column check, store write. When the store declares an atomic
//! `writeBatch` the whole batch is one write (all or nothing); otherwise the first failing
//! op stops the batch (earlier ops stay written). A failure routes `emit.failure` with
//! `{ error }`; success emits `{ operations, completedCount, totalCount }`.

use super::*;
use crate::backend::server::access_policies::policy_const_name;

impl TypeScriptBackend {
    pub(crate) fn generate_persist_batch_block(
        &self,
        ops: &OirExpr,
        emit: &Option<OirEmitConfig>,
        module: &OirModule,
    ) -> String {
        let ops_expr = self.expr_to_ts_server(ops);
        let routable: Vec<&OirEntity> = module.entities.iter().filter(|e| !e.local).collect();

        let mut code = String::new();
        code.push_str("      // Persist batch\n");
        code.push_str("      {\n");
        code.push_str("        effectsLog.debug('persist:dispatch', { action: 'batch', entityType: 'batch', payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload).join(',') : null });\n");
        code.push_str(&format!(
            "        const __batchOps: EventPayloadValue | undefined = ({}) as EventPayloadValue | undefined;\n",
            ops_expr
        ));

        code.push_str("        const __batchCollectionOf = (e: string): string | undefined => {\n");
        code.push_str("          switch (e) {\n");
        for e in &routable {
            code.push_str(&format!(
                "            case '{}': return '{}';\n",
                e.name, e.collection
            ));
        }
        code.push_str("            default: return undefined;\n");
        code.push_str("          }\n");
        code.push_str("        };\n");

        code.push_str("        const __batchRequiredOf = (e: string): readonly string[] => {\n");
        for e in &routable {
            let required = e.required_create_field_names();
            if required.is_empty() {
                continue;
            }
            let list = required
                .iter()
                .map(|f| format!("'{}'", f))
                .collect::<Vec<_>>()
                .join(", ");
            code.push_str(&format!(
                "          if (e === '{}') return [{}];\n",
                e.name, list
            ));
        }
        code.push_str("          return [];\n");
        code.push_str("        };\n");

        code.push_str("        const __batchPolicyOf = (e: string, a: string) => {\n");
        for e in &routable {
            for (op, policy) in [
                ("create", &e.create_policy),
                ("update", &e.update_policy),
                ("delete", &e.delete_policy),
            ] {
                if policy.is_some() {
                    code.push_str(&format!(
                        "          if (e === '{}' && a === '{}') return {};\n",
                        e.name,
                        op,
                        policy_const_name(&e.name, &op.to_uppercase())
                    ));
                }
            }
        }
        code.push_str("          return undefined;\n");
        code.push_str("        };\n");

        code.push_str(
            "        const __batchDone: Array<Record<string, FieldValue | undefined>> = [];\n",
        );
        code.push_str("        const __batchTouched = new Set<string>();\n");
        code.push_str("        let __batchError: string | undefined;\n");
        code.push_str(
            "        const __batchList = Array.isArray(__batchOps) ? __batchOps : undefined;\n",
        );
        code.push_str("        if (__batchList === undefined) {\n");
        code.push_str(
            "          __batchError = 'persist batch operations must evaluate to an array';\n",
        );
        code.push_str("        } else if (__batchList.length === 0) {\n");
        code.push_str("          __batchError = 'Batch requires a non-empty operations array';\n");
        code.push_str("        } else {\n");
        code.push_str("          const __pushedBatch = await pushBatch(getDataService(), __batchList, { collectionOf: __batchCollectionOf, requiredOf: __batchRequiredOf, policyOf: __batchPolicyOf }, rowAccess({ user, now }));\n");
        code.push_str("          if (__pushedBatch !== null) {\n");
        code.push_str("            if (__pushedBatch.kind === 'failed') {\n");
        code.push_str("              __batchError = __pushedBatch.error;\n");
        code.push_str("            } else {\n");
        code.push_str("              for (const __row of __pushedBatch.done) {\n");
        code.push_str("                __batchDone.push(__row);\n");
        code.push_str("                if (typeof __row.entityType === 'string') { __batchTouched.add(__row.entityType); }\n");
        code.push_str("              }\n");
        code.push_str("            }\n");
        code.push_str("          } else {\n");
        code.push_str("          for (const __op of __batchList) {\n");
        code.push_str("            if (!Array.isArray(__op)) { __batchError = `Invalid batch operation format: ${JSON.stringify(__op)}`; break; }\n");
        code.push_str("            const __action = __op[0];\n");
        code.push_str(
            "            const __entityName = typeof __op[1] === 'string' ? __op[1] : '';\n",
        );
        code.push_str("            if (__action !== 'create' && __action !== 'update' && __action !== 'delete') { __batchError = `Unknown batch operation action: ${String(__action)}`; break; }\n");
        code.push_str("            const __arity = __action === 'update' ? 4 : 3;\n");
        code.push_str("            const __collection = __batchCollectionOf(__entityName);\n");
        code.push_str("            if (__op.length !== __arity || __collection === undefined) { __batchError = `Invalid batch operation format: ${JSON.stringify(__op)}`; break; }\n");
        code.push_str("            try {\n");
        code.push_str("              const __policy = __batchPolicyOf(__entityName, __action);\n");
        code.push_str("              const __asRow = (v: EventPayloadValue | undefined): Record<string, FieldValue | undefined> => (v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) ? (v as Record<string, FieldValue | undefined>) : {};\n");
        code.push_str(
            "              const __rowId = __action === 'create' ? undefined : String(__op[2]);\n",
        );
        code.push_str("              if (__action === 'create') {\n");
        code.push_str("                const __data = __asRow(__op[2]);\n");
        code.push_str("                if (__policy !== undefined && !checkMutationAccess(__data, __policy, { user, now })) {\n");
        code.push_str("                  effectsLog.warn('persist:access-denied', { action: 'create', entityType: __entityName });\n");
        code.push_str("                  throw new Error(`@create denied: the declared access policy for '${__entityName}' rejected this row`);\n");
        code.push_str("                }\n");
        code.push_str("                const __missing = __batchRequiredOf(__entityName).filter((k) => { const v = __data[k]; return v === undefined || v === null || v === ''; });\n");
        code.push_str("                if (__missing.length > 0) {\n");
        code.push_str("                  effectsLog.warn('persist:required-missing', { entityType: __entityName, missing: __missing });\n");
        code.push_str("                  throw new Error(`persist create ${__entityName}: required field(s) ${__missing.join(', ')} missing`);\n");
        code.push_str("                }\n");
        code.push_str("                if (typeof __data.id === 'string' && __data.id !== '' && (await getDataService().getById<EntityRow>(__collection, __data.id)) !== null) {\n");
        code.push_str("                  throw new Error(`${__entityName} ${__data.id} already exists`);\n");
        code.push_str("                }\n");
        code.push_str("                const __created = await getDataService().create<EntityRow>(__collection, __data);\n");
        code.push_str("                __batchDone.push({ ...(__created ?? __data), action: 'create', entityType: __entityName, id: __created?.id });\n");
        code.push_str("              } else if (__action === 'update') {\n");
        code.push_str("                if (__policy !== undefined) {\n");
        code.push_str("                  const __existing = await getDataService().getById<EntityRow>(__collection, __rowId as string);\n");
        code.push_str("                  if (!__existing || !checkMutationAccess(__existing, __policy, { user, now })) {\n");
        code.push_str("                    effectsLog.warn('persist:access-denied', { action: 'update', entityType: __entityName, resolvedId: __rowId });\n");
        code.push_str("                    throw new Error(`@update denied: the declared access policy for '${__entityName}' rejected this row`);\n");
        code.push_str("                  }\n");
        code.push_str("                }\n");
        code.push_str("                const __updated = await getDataService().update<EntityRow>(__collection, __rowId as string, __asRow(__op[3]));\n");
        code.push_str("                if (__updated === null) { throw new Error(`Entity ${__entityName} ${__rowId} not found`); }\n");
        code.push_str("                __batchDone.push({ ...__updated, action: 'update', entityType: __entityName, id: __rowId });\n");
        code.push_str("              } else {\n");
        code.push_str("                if (__policy !== undefined) {\n");
        code.push_str("                  const __existing = await getDataService().getById<EntityRow>(__collection, __rowId as string);\n");
        code.push_str("                  if (!__existing || !checkMutationAccess(__existing, __policy, { user, now })) {\n");
        code.push_str("                    effectsLog.warn('persist:access-denied', { action: 'delete', entityType: __entityName, resolvedId: __rowId });\n");
        code.push_str("                    throw new Error(`@delete denied: the declared access policy for '${__entityName}' rejected this row`);\n");
        code.push_str("                  }\n");
        code.push_str("                }\n");
        code.push_str("                const __deleted = await getDataService().delete(__collection, __rowId as string);\n");
        code.push_str("                if (__deleted === false) { throw new Error(`Entity ${__entityName} ${__rowId} not found`); }\n");
        code.push_str("                __batchDone.push({ action: 'delete', entityType: __entityName, id: __rowId, deleted: true });\n");
        code.push_str("              }\n");
        code.push_str("              __batchTouched.add(__entityName);\n");
        code.push_str("            } catch (__err) {\n");
        code.push_str("              __batchError = `Batch operation [${__action}, ${__entityName}] failed: ${__err instanceof Error ? __err.message : String(__err)}`;\n");
        code.push_str("              break;\n");
        code.push_str("            }\n");
        code.push_str("          }\n");
        code.push_str("          }\n");
        code.push_str("        }\n");

        code.push_str("        if (__batchError !== undefined) {\n");
        code.push_str("          effectsLog.warn('persist:batch-failed', { error: __batchError, completed: __batchDone.length });\n");
        code.push_str("          effectResults.push({ effect: 'persist', action: 'batch', success: false, error: __batchError });\n");
        code.push_str(&self.emit_failure_js_impl(emit, "__batchError", "", "          "));
        code.push_str("        } else {\n");
        code.push_str("          const __batchSummary: EventPayload = { operations: __batchDone, completedCount: __batchDone.length, totalCount: __batchList?.length ?? 0 };\n");
        code.push_str("          effectsLog.debug('persist:store-mutate', { action: 'batch', entityType: 'batch', success: true, completedCount: __batchDone.length });\n");
        code.push_str("          effectResults.push({ effect: 'persist', action: 'batch', success: true, data: __batchSummary });\n");
        code.push_str(&self.emit_success_js_impl(
            emit,
            "success",
            "__batchSummary",
            "          ",
            None,
        ));
        if let Some(success) = emit.as_ref().and_then(|c| c.success.as_deref()) {
            code.push_str(&format!(
                "          for (const __touched of __batchTouched) {{ broadcastBusEvent(clientId, {{ type: 'bus', event: '{}', payload: __batchSummary, source: __ORBITAL_SOURCE, timestamp: Date.now(), entityType: __touched }}); }}\n",
                success
            ));
        }
        code.push_str("        }\n");
        code.push_str("      }\n\n");
        code
    }
}
