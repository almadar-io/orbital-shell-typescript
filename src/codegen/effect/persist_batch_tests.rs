//! `persist batch` server codegen: routing by entity name, the single forms' gates per
//! op, first-failure stop, summary payload on success, `{ error }` on failure.

use crate::TypeScriptBackend;
use orbital_core::lower::lower_sexpr;
use orbital_core::ir::{OirEffect, OirEntity, OirExpr, OirField, OirModule, OirType};
use orbital_core::schema::SExpression;
use serde_json::json;

fn module() -> OirModule {
    let mut m = OirModule::new("TestApp", "0.1.0");
    let mut row = OirEntity::new("Row");
    row.collection = "rows".to_string();
    let mut title = OirField::new("title", OirType::String);
    title.required = true;
    row.fields = vec![OirField::new("id", OirType::String), title];
    row.update_policy = Some(OirExpr::bool(true));
    let mut draft = OirEntity::new("Draft");
    draft.collection = "drafts".to_string();
    draft.local = true;
    m.entities.push(row);
    m.entities.push(draft);
    m
}

fn effect(value: serde_json::Value) -> OirEffect {
    let sexpr: SExpression = serde_json::from_value(value).expect("sexpr");
    match lower_sexpr(&sexpr).expect("resolves") {
        OirExpr::Effect { effect } => *effect,
        other => panic!("not an effect: {other:?}"),
    }
}

fn emit() -> serde_json::Value {
    json!({ "emit": { "success": "SAVED", "failure": "FAILED" } })
}

fn server_js(effect: &OirEffect) -> String {
    TypeScriptBackend::new().generate_server_effect_code(effect, &module(), Some("Row"))
}

fn mapped_update() -> serde_json::Value {
    json!(["array/map", "@payload.rows", ["fn", "r", ["update", "Row", ["object/get", "@r", "id"], { "status": "done" }]]])
}

#[test]
fn a_literal_ops_list_resolves_to_a_batch_effect_naming_its_entities() {
    let e = effect(
        json!(["persist", "batch", [["create", "Row", { "title": "a" }], ["delete", "Row", "x"]], emit()]),
    );
    match e {
        OirEffect::PersistBatch { entities, emit, .. } => {
            assert_eq!(entities, vec!["Row".to_string()]);
            assert_eq!(emit.unwrap().success.as_deref(), Some("SAVED"));
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn op_tuples_lower_to_array_values_never_to_operator_calls() {
    let js = server_js(&effect(json!([
        "persist",
        "batch",
        mapped_update(),
        emit()
    ])));
    assert!(
        js.contains(r#"["update", "Row", getNestedValue(r, "id")"#),
        "{js}"
    );
    assert!(!js.contains("update('Row'"), "{js}");
}

#[test]
fn routing_is_by_entity_name_with_each_entitys_collection() {
    let js = server_js(&effect(json!([
        "persist",
        "batch",
        mapped_update(),
        emit()
    ])));
    assert!(js.contains("case 'Row': return 'rows';"), "{js}");
    assert!(
        !js.contains("case 'Draft'"),
        "a browser-stored entity is not routable on the server:\n{js}"
    );
}

#[test]
fn every_op_runs_the_single_forms_gates() {
    let js = server_js(&effect(json!([
        "persist",
        "batch",
        mapped_update(),
        emit()
    ])));
    assert!(
        js.contains("if (e === 'Row' && a === 'update') return ROW_UPDATE_POLICY;"),
        "{js}"
    );
    assert!(
        js.contains("checkMutationAccess(__existing, __policy, { user, now })"),
        "{js}"
    );
    assert!(
        js.contains("if (e === 'Row') return ['title'];"),
        "required create columns:\n{js}"
    );
    assert!(
        js.contains("getDataService().create<EntityRow>(__collection, __data)"),
        "{js}"
    );
    assert!(
        js.contains("getDataService().update<EntityRow>(__collection, __rowId as string"),
        "{js}"
    );
    assert!(
        js.contains("getDataService().delete(__collection, __rowId as string)"),
        "{js}"
    );
}

#[test]
fn the_first_failing_op_stops_the_batch_and_routes_failure_with_the_error() {
    let js = server_js(&effect(json!([
        "persist",
        "batch",
        mapped_update(),
        emit()
    ])));
    assert!(
        js.contains("__batchError = `Batch operation [${__action}, ${__entityName}] failed:"),
        "{js}"
    );
    assert!(js.contains("break;"), "{js}");
    assert!(
        js.contains("{ const __evF: EventPayload = { error: __batchError }; emittedEvents.push({ event: 'FAILED'"),
        "{js}"
    );
}

#[test]
fn success_emits_the_declared_summary_shape() {
    let js = server_js(&effect(json!([
        "persist",
        "batch",
        mapped_update(),
        emit()
    ])));
    assert!(
        js.contains("const __batchSummary: EventPayload = { operations: __batchDone, completedCount: __batchDone.length, totalCount: __batchList?.length ?? 0 };"),
        "{js}"
    );
    assert!(js.contains("getServerEventBus().emit('SAVED'"), "{js}");
    assert!(
        js.contains(
            "broadcastBusEvent(clientId, { type: 'bus', event: 'SAVED', payload: __batchSummary"
        ),
        "{js}"
    );
}

#[test]
fn a_batch_without_emit_still_writes_and_emits_nothing() {
    let js = server_js(&effect(json!(["persist", "batch", mapped_update()])));
    assert!(js.contains("getDataService().update<EntityRow>"), "{js}");
    assert!(!js.contains("getServerEventBus().emit("), "{js}");
    assert!(!js.contains("broadcastBusEvent("), "{js}");
}

#[test]
fn a_non_array_or_empty_ops_value_fails_the_batch_at_run_time() {
    let js = server_js(&effect(json!(["persist", "batch", "@payload.ops", emit()])));
    assert!(
        js.contains("persist batch operations must evaluate to an array"),
        "{js}"
    );
    assert!(
        js.contains("Batch requires a non-empty operations array"),
        "{js}"
    );
}

#[test]
fn a_batch_is_server_work_unless_every_entity_is_browser_stored() {
    use orbital_core::effects::Residence;
    use orbital_core::ir::OirEffect as E;
    let residence = Residence::of_module(&module());
    let server = effect(json!(["persist", "batch", [["create", "Row", { "title": "a" }]]]));
    let local = effect(json!(["persist", "batch", [["create", "Draft", {}]]]));
    let mixed = effect(json!([
        "persist",
        "batch",
        [["create", "Draft", {}], ["create", "Row", {}]]
    ]));
    assert_eq!(
        orbital_core::effects::ir_effect_site(&server, &residence),
        orbital_core::effects::RunsOn::Server
    );
    assert_eq!(
        orbital_core::effects::ir_effect_site(&local, &residence),
        orbital_core::effects::RunsOn::Client
    );
    assert_eq!(
        orbital_core::effects::ir_effect_site(&mixed, &residence),
        orbital_core::effects::RunsOn::Server
    );
    let _: Option<&E> = None;
}

#[test]
fn the_client_leg_has_no_inline_body_for_a_batch() {
    let e = effect(json!(["persist", "batch", [["create", "Draft", {}]]]));
    let js = TypeScriptBackend::new().transpile_client_effect(&e, "  ", None, None);
    assert!(js.is_none(), "{js:?}");
}
