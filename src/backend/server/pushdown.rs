//! Store push-down in a `--host generated` server. The generated handlers decide at codegen time WHICH reads and
//! writes may be pushed (a collection fetch, a persist update/delete, a persist batch, the ref refresh); the run-time
//! half, which decides WHETHER the store can take them, is `@almadar/db/pushdown`, the one driver the JS engine
//! (`@almadar/runtime`) shares. The handlers import it, and inject the interpreter with `rowAccess` from
//! `@almadar/evaluator/entityAccess`; this crate emits no push-down module of its own.

/// The driver functions of `@almadar/db/pushdown` the handlers import, in the order the import lists them.
pub(crate) const PUSHDOWN_HELPERS: [&str; 7] = [
    "pushFetch",
    "refreshRows",
    "pushCreate",
    "pushUpsert",
    "pushUpdate",
    "pushDelete",
    "pushBatch",
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::*;
    use orbital_core::ir::{
        OirBinding, OirEffect, OirEvent, OirExpr, OirField, OirModule, OirPersistOp, OirTrait,
        OirTransition, OirType,
    };

    fn task_module() -> OirModule {
        let mut m = OirModule::new("TestApp", "0.1.0");
        let mut task = OirEntity::new("Task");
        task.collection = "tasks".to_string();
        let mut title = OirField::new("title", OirType::String);
        title.required = true;
        task.fields = vec![OirField::new("id", OirType::String), title];
        task.read_policy = Some(OirExpr::bool(true));
        task.update_policy = Some(OirExpr::bool(true));
        m.entities.push(task);
        m
    }

    fn fetch(
        id: Option<OirExpr>,
        filter: Option<OirExpr>,
        order_by: Option<OirExpr>,
        limit: Option<OirExpr>,
    ) -> OirEffect {
        OirEffect::Fetch {
            entity_type: "Task".to_string(),
            id,
            filter,
            order_by,
            offset: None,
            limit,
            include: None,
            emit: None,
        }
    }

    fn fetch_js(effect: &OirEffect) -> String {
        TypeScriptBackend::new().generate_server_effect_code(effect, &task_module(), None)
    }

    fn done_filter() -> OirExpr {
        OirExpr::eq(
            OirExpr::binding(OirBinding::entity(vec!["title".to_string()])),
            OirExpr::string("x"),
        )
    }

    #[test]
    fn the_handlers_import_the_driver_and_the_interpreter_from_packages_and_the_crate_emits_no_module() {
        let body = format!(
            "{}await pushFetch(getDataService(), {{ entityType: 'tasks', access: rowAccess({{ user, now }}) }});\n",
            crate::backend::server::handlers::ACCESS_IMPORT_MARKER
        );
        let js = crate::backend::server::handlers::resolve_access_imports(body, &task_module().entities);
        assert!(js.contains("import { pushFetch } from '@almadar/db/pushdown';"), "{js}");
        assert!(js.contains("import { rowAccess } from '@almadar/evaluator/entityAccess';"), "{js}");
        assert!(!js.contains("pushdown.js"), "no relative push-down module is imported:\n{js}");
    }

    #[test]
    fn control_a_body_with_no_push_down_imports_neither_package() {
        let body = format!("{}const x = 1;\n", crate::backend::server::handlers::ACCESS_IMPORT_MARKER);
        let js = crate::backend::server::handlers::resolve_access_imports(body, &task_module().entities);
        assert!(!js.contains("@almadar/db/pushdown") && !js.contains("rowAccess"), "{js}");
    }

    /// EXEC-FETCH-1 on the generated server: a fetch or ref with no order sorts its plain-path rows by the core's
    /// default order (`createdAt` then `id`), a fetch that authors one keeps its own sort, and a by-id load sorts nothing.
    #[test]
    fn an_unordered_fetch_and_ref_sort_the_listed_rows_by_the_default_order_and_an_ordered_one_does_not() {
        let unordered = fetch_js(&fetch(None, Some(done_filter()), None, Some(OirExpr::number(5.0))));
        assert!(unordered.contains("data['Task'] = orderRows(data['Task'], undefined);"), "{unordered}");
        let sort = unordered.find("orderRows(").expect("sort");
        assert!(sort > unordered.find("getDataService().list<Task>('tasks')").expect("listing"), "{unordered}");
        assert!(sort < unordered.find("__totalCount_Task = data['Task'].length").expect("total"), "{unordered}");
        let reference = fetch_js(&ref_effect(Some(own_filter()), None));
        assert!(reference.contains("data['Task'] = orderRows(data['Task'], undefined);"), "{reference}");
        // controls
        let ordered = fetch_js(&fetch(None, None, Some(OirExpr::string("title:desc")), None));
        assert!(!ordered.contains("orderRows("), "{ordered}");
        let by_id = fetch_js(&fetch(Some(OirExpr::string("t1")), None, None, None));
        assert!(!by_id.contains("orderRows("), "{by_id}");
    }

    #[test]
    fn a_handler_that_sorts_by_the_default_order_imports_it_from_core_and_one_that_does_not_does_not() {
        use crate::backend::server::{resolve_access_imports, ACCESS_IMPORT_MARKER};
        let with = resolve_access_imports(format!("{ACCESS_IMPORT_MARKER}x = orderRows(y, undefined);"), &[]);
        assert!(with.starts_with("import { orderRows } from '@almadar/core';\n"), "{with}");
        let without = resolve_access_imports(format!("{ACCESS_IMPORT_MARKER}x = y;"), &[]);
        assert_eq!(without, "x = y;");
    }

    #[test]
    fn a_collection_fetch_emits_one_query_page_request_with_policy_filter_order_and_window() {
        let js = fetch_js(&fetch(
            None,
            Some(done_filter()),
            Some(OirExpr::string("title:desc")),
            Some(OirExpr::number(20.0)),
        ));
        assert!(js.contains("await pushFetch(getDataService(), { entityType: 'tasks', readPolicy: TASK_READ_POLICY, filter: "), "{js}");
        assert!(js.contains(r#"orderBy: String("title:desc")"#), "{js}");
        assert!(js.contains("limit: Number(20)"), "{js}");
        assert!(js.contains("requiredFields: ['id', 'title']"), "{js}");
        assert!(js.contains("if (__pushed_Task !== null) {"), "{js}");
        assert!(js.contains("__totalCount_Task = __pushed_Task.total;"), "{js}");
        assert!(
            js.contains("const aVal = a['title'];"),
            "the legacy static sort must read the field, not a quoted name:\n{js}"
        );
    }

    #[test]
    fn the_fallback_is_the_legacy_list_and_filter_inside_the_else_branch() {
        let js = fetch_js(&fetch(None, Some(done_filter()), None, Some(OirExpr::number(20.0))));
        let pushed = js.find("if (__pushed_Task !== null) {").expect("pushed branch");
        let list = js
            .find("await getDataService().list<Task>('tasks')")
            .expect("legacy list");
        assert!(pushed < list, "the list must sit after the pushed branch:\n{js}");
        assert!(js.contains("} else {"), "{js}");
        assert!(js.contains("__totalCount_Task = data['Task'].length;"), "{js}");
        assert!(!js.contains("const __totalCount_Task"), "{js}");
    }

    #[test]
    fn control_a_fetch_by_id_keeps_the_legacy_path_alone() {
        let js = fetch_js(&fetch(Some(OirExpr::string("t1")), None, None, None));
        assert!(!js.contains("pushFetch("), "{js}");
        assert!(js.contains("const __totalCount_Task = data['Task'].length;"), "{js}");
    }

    #[test]
    fn control_a_filter_reading_the_issuing_frame_is_not_pushed() {
        let backend = TypeScriptBackend::new();
        let module = task_module();
        let effect = fetch(None, Some(done_filter()), None, None);
        let pushed = backend.generate_server_effect_code(&effect, &module, None);
        assert!(pushed.contains("pushFetch("), "{pushed}");
        let framed = backend.generate_server_effect_code(&effect, &module, Some("Task"));
        assert!(
            !framed.contains("pushFetch("),
            "a bare @entity filter in a linked trait reads the issuer's frame, not the row:\n{framed}"
        );
    }

    fn persist_js(operation: OirPersistOp, with_policy: bool) -> String {
        let mut module = task_module();
        if with_policy {
            module.entities[0].delete_policy = Some(OirExpr::bool(true));
        } else {
            module.entities[0].update_policy = None;
        }
        let effect = OirEffect::Persist {
            operation,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: None,
        };
        TypeScriptBackend::new().generate_server_effect_code(&effect, &module, Some("Task"))
    }

    #[test]
    fn persist_update_and_delete_hand_their_policy_to_the_guarded_write() {
        let update = persist_js(OirPersistOp::Update, true);
        assert!(update.contains("await pushUpdate<Task>(getDataService(), { collection: 'tasks', id: updateId, data: updateData ?? {}, policy: TASK_UPDATE_POLICY,"), "{update}");
        assert!(!update.contains("getById"), "no pre-read in the handler:\n{update}");
        let delete = persist_js(OirPersistOp::Delete, true);
        assert!(delete.contains("await pushDelete<Task>(getDataService(), { collection: 'tasks', id: deleteId, data: {}, policy: TASK_DELETE_POLICY,"), "{delete}");
        assert!(!delete.contains("getById"), "{delete}");
    }

    #[test]
    fn persist_create_goes_through_the_driver_and_a_taken_id_fails_duplicate_id() {
        let create = persist_js(OirPersistOp::Create, false);
        assert!(create.contains("await pushCreate<Task>(getDataService(), { collection: 'tasks', data: createData })"), "{create}");
        assert!(create.contains("__write.kind === 'duplicate-id'"), "{create}");
        assert!(create.contains("code: 'duplicate-id'"), "{create}");
        assert!(!create.contains("getDataService().create<"), "the handler no longer calls the store create itself:\n{create}");
    }

    #[test]
    fn persist_upsert_names_the_update_directive_it_must_pass_on_the_row_it_replaces() {
        let guarded = persist_js(OirPersistOp::Upsert, true);
        assert!(guarded.contains("await pushUpsert<Task>(getDataService(), { collection: 'tasks', data: createData, updatePolicy: TASK_UPDATE_POLICY, access: rowAccess("), "{guarded}");
        assert!(guarded.contains("__write.kind === 'denied'"), "{guarded}");
        assert!(guarded.contains("__write.kind === 'no-row-key'"), "{guarded}");
        assert!(guarded.contains("action: 'upsert'"), "{guarded}");
        let open = persist_js(OirPersistOp::Upsert, false);
        assert!(open.contains("updatePolicy: undefined,"), "control: no @update directive, nothing to test:\n{open}");
    }

    #[test]
    fn a_handler_calling_the_create_and_upsert_drivers_imports_them() {
        let body = format!(
            "{}await pushCreate<Task>(getDataService(), {{}}); await pushUpsert<Task>(getDataService(), {{}});\n",
            crate::backend::server::handlers::ACCESS_IMPORT_MARKER
        );
        let js = crate::backend::server::handlers::resolve_access_imports(body, &task_module().entities);
        assert!(js.contains("import { pushCreate, pushUpsert } from '@almadar/db/pushdown';"), "{js}");
    }

    #[test]
    fn control_an_unpolicied_update_still_goes_through_the_helper_without_a_guard() {
        let update = persist_js(OirPersistOp::Update, false);
        assert!(update.contains("policy: undefined,"), "{update}");
        assert!(!update.contains("__updWrite.kind === 'denied'"), "{update}");
    }

    #[test]
    fn persist_batch_is_one_atomic_write_with_the_per_op_loop_as_the_fallback() {
        let module = task_module();
        let effect = OirEffect::PersistBatch {
            ops: OirExpr::binding(OirBinding::payload(vec!["ops".to_string()])),
            entities: vec!["Task".to_string()],
            emit: None,
        };
        let js = TypeScriptBackend::new().generate_server_effect_code(&effect, &module, None);
        let pushed = js.find("await pushBatch(getDataService(), __batchList,").expect("pushBatch");
        let loop_at = js.find("for (const __op of __batchList)").expect("fallback loop");
        assert!(pushed < loop_at, "{js}");
        assert!(js.contains("__batchError = __pushedBatch.error;"), "{js}");
    }

    #[test]
    fn a_mutated_ref_target_is_re_sent_as_a_policy_scoped_page_not_the_whole_table() {
        let backend = TypeScriptBackend::new();
        let module = {
            let mut m = task_module();
            let mut lifecycle = OirTrait::new("TaskLifecycle");
            lifecycle.linked_entity = Some("Task".to_string());
            let mut t = OirTransition::new("idle", "idle", "SAVE");
            t.effects.push(OirExpr::effect(OirEffect::Ref {
                entity_type: "Task".to_string(),
                id: None,
                filter: None,
                order_by: None,
                limit: Some(OirExpr::number(25.0)),
                include: None,
                emit: None,
            }));
            t.effects.push(OirExpr::effect(OirEffect::Persist {
                operation: OirPersistOp::Update,
                entity_type: "Task".to_string(),
                data: OirExpr::binding(OirBinding::entity(vec![])),
                emit: None,
            }));
            lifecycle.transitions.push(t);
            lifecycle.events.push(OirEvent::new("SAVE"));
            m.traits.push(lifecycle);
            m
        };
        let trait_def = module.traits[0].clone();
        let event = trait_def.events[0].clone();
        let js = backend.generate_event_handler_function(&trait_def, &event, &module, "handleSave");
        assert!(
            js.contains("data['Task'] = await refreshRows<Task>(getDataService(), { collection: 'tasks', readPolicy: TASK_READ_POLICY, filter: undefined, limit: 25,"),
            "{js}"
        );
        assert!(!js.contains("data['Task'] = await getDataService().list"), "{js}");
    }

    #[test]
    fn a_ref_with_a_filter_re_sends_every_readable_row() {
        let backend = TypeScriptBackend::new();
        let mut module = task_module();
        let mut lifecycle = OirTrait::new("TaskLifecycle");
        lifecycle.linked_entity = Some("Task".to_string());
        let mut t = OirTransition::new("idle", "idle", "SAVE");
        t.effects.push(OirExpr::effect(OirEffect::Ref {
            entity_type: "Task".to_string(),
            id: None,
            filter: Some(done_filter()),
            order_by: None,
            limit: Some(OirExpr::number(25.0)),
            include: None,
            emit: None,
        }));
        t.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Update,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: None,
        }));
        lifecycle.transitions.push(t);
        lifecycle.events.push(OirEvent::new("SAVE"));
        module.traits.push(lifecycle);
        let trait_def = module.traits[0].clone();
        let event = trait_def.events[0].clone();
        let js = backend.generate_event_handler_function(&trait_def, &event, &module, "handleSave");
        assert!(js.contains("readPolicy: TASK_READ_POLICY, filter: undefined, limit: 0,"), "{js}");
    }
    fn ref_effect(filter: Option<OirExpr>, id: Option<OirExpr>) -> OirEffect {
        OirEffect::Ref {
            entity_type: "Task".to_string(),
            id,
            filter,
            order_by: None,
            limit: Some(OirExpr::number(10.0)),
            include: None,
            emit: None,
        }
    }

    fn own_filter() -> OirExpr {
        OirExpr::eq(
            OirExpr::binding(OirBinding::entity(vec!["title".to_string()])),
            OirExpr::binding(OirBinding::new(orbital_core::ir::OirBindingRoot::User, vec!["id".to_string()])),
        )
    }

    #[test]
    fn a_ref_loads_through_push_fetch_with_its_own_filter_limit_and_read_policy() {
        let js = fetch_js(&ref_effect(Some(own_filter()), None));
        assert!(js.contains("await pushFetch(getDataService(), { entityType: 'tasks', readPolicy: TASK_READ_POLICY, filter: "), "{js}");
        assert!(js.contains("limit: Number(10)"), "{js}");
        assert!(js.contains("orderBy: undefined"), "a ref declares no order:\n{js}");
        assert!(!js.contains("__totalCount"), "a ref reports no total:\n{js}");
        let pushed = js.find("if (__pushed_Task !== null) {").expect("pushed");
        assert!(pushed < js.find("getDataService().list<Task>('tasks')").expect("legacy"), "{js}");
    }

    #[test]
    fn control_a_ref_by_id_keeps_the_legacy_load() {
        let js = fetch_js(&ref_effect(None, Some(OirExpr::string("t1"))));
        assert!(!js.contains("pushFetch("), "{js}");
    }

    fn refresh_js(ref_filter: Option<OirExpr>) -> String {
        let backend = TypeScriptBackend::new();
        let mut module = task_module();
        let mut lifecycle = OirTrait::new("TaskLifecycle");
        lifecycle.linked_entity = Some("Task".to_string());
        let mut t = OirTransition::new("idle", "idle", "SAVE");
        t.effects.push(OirExpr::effect(ref_effect(ref_filter, None)));
        t.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Update,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: None,
        }));
        lifecycle.transitions.push(t);
        lifecycle.events.push(OirEvent::new("SAVE"));
        module.traits.push(lifecycle);
        let trait_def = module.traits[0].clone();
        let event = trait_def.events[0].clone();
        backend.generate_event_handler_function(&trait_def, &event, &module, "handleSave")
    }

    #[test]
    fn the_refresh_is_the_refs_own_filtered_page_when_the_filter_reads_only_the_viewer() {
        let viewer_only = OirExpr::eq(
            OirExpr::binding(OirBinding::new(orbital_core::ir::OirBindingRoot::User, vec!["id".to_string()])),
            OirExpr::string("u1"),
        );
        let js = refresh_js(Some(viewer_only));
        assert!(js.contains("readPolicy: TASK_READ_POLICY, filter: [\"==\",\"@user.id\",\"u1\"], limit: 10,"), "{js}");
    }

    #[test]
    fn control_a_filter_reading_the_request_is_not_replayed_in_another_handler() {
        let js = refresh_js(Some(own_filter()));
        assert!(js.contains("readPolicy: TASK_READ_POLICY, filter: undefined, limit: 0,"), "{js}");
    }

    fn auto_persist_js(with_policy: bool) -> String {
        let backend = TypeScriptBackend::new();
        let mut module = task_module();
        module.entities[0].update_policy = with_policy.then(|| OirExpr::bool(false));
        let mut lifecycle = OirTrait::new("TaskLifecycle");
        lifecycle.linked_entity = Some("Task".to_string());
        let mut t = OirTransition::new("idle", "idle", "RENAME");
        t.effects.push(OirExpr::effect(OirEffect::Set {
            target: OirBinding::entity(vec!["title".to_string()]),
            value: OirExpr::string("x"),
            emit: None,
        }));
        lifecycle.transitions.push(t);
        lifecycle.events.push(OirEvent::new("RENAME"));
        module.traits.push(lifecycle);
        let trait_def = module.traits[0].clone();
        let event = trait_def.events[0].clone();
        backend.generate_event_handler_function(&trait_def, &event, &module, "handleRename")
    }

    #[test]
    fn the_auto_persist_after_a_set_checks_update_like_an_explicit_persist() {
        let js = auto_persist_js(true);
        assert!(js.contains("const __autoWrite = await pushUpdate<Task>(getDataService(), { collection: 'tasks', id: entityId, data: omitFrameFields(entity, __FRAME_KEYS) as Partial<Task>, policy: TASK_UPDATE_POLICY,"), "{js}");
        let denied = js.find("if (__autoWrite.kind === 'denied') {").expect("denied branch");
        let ok = js.find("data: entity,").expect("success report");
        assert!(denied < ok, "{js}");
        assert!(js.contains("error: \"@update denied: the declared access policy for 'Task' rejected this row\""), "{js}");
    }

    #[test]
    fn control_an_unpolicied_auto_persist_carries_no_policy() {
        let js = auto_persist_js(false);
        assert!(js.contains("policy: undefined,"), "{js}");
        assert!(!js.contains("TASK_UPDATE_POLICY"), "{js}");
    }
}
