//! The generated `seedMockData.ts` drives the compiled apps' mock store, which is the
//! same seeded store the runtime and orbital-core fill (`@almadar-io/parity`
//! `dataset.seeded.json`). It must hand that store what the runtime reads: every
//! entity (a later one on a shared collection backfills), each field exactly as
//! declared, and the access directives owner columns and the `@create` gate come from.

use orbital_core_base::ir::{OirEntity, OirExpr, OirField, OirPersistence, OirType};
use orbital_shell_typescript::TypeScriptBackend;
use serde_json::json;

fn entity(name: &str, collection: &str) -> OirEntity {
    let mut e = OirEntity::new(name);
    e.collection = collection.to_string();
    e.persistence = OirPersistence::Persistent;
    e.fields = vec![OirField::new("id", OirType::String)];
    e
}

fn declared(name: &str, shape: serde_json::Value) -> OirField {
    let mut f = OirField::new(name, OirType::String);
    f.declared = Some(shape);
    f
}

#[test]
fn entities_sharing_a_collection_each_get_an_entry_in_declaration_order() {
    let ts = TypeScriptBackend::new().render_seed_mock_data_content(&[
        entity("Ticket", "tickets"),
        entity("TicketCard", "tickets"),
    ]);
    let ticket = ts.find("name: 'Ticket',").expect("Ticket entry");
    let card = ts.find("name: 'TicketCard',").expect("TicketCard entry");
    assert!(ticket < card, "declaration order is the seed order:\n{ts}");
    assert!(ts.contains("const entitySchemas: SeedSchema[] = ["));
}

#[test]
fn a_declared_field_is_emitted_as_declared() {
    let mut e = entity("Ticket", "tickets");
    e.fields.push(declared(
        "tags",
        json!({ "name": "tags", "type": "array", "items": { "type": "string" }, "description": "not seed input" }),
    ));
    e.fields.push(declared(
        "vendor",
        json!({ "name": "vendor", "type": "string", "mock": "Acme, Globex" }),
    ));
    let ts = TypeScriptBackend::new().render_seed_mock_data_content(&[e]);
    assert!(
        ts.contains(r#"{"name":"tags","type":"array","items":{"type":"string"}}"#),
        "{ts}"
    );
    assert!(ts.contains(r#""mock":"Acme, Globex""#), "{ts}");
    assert!(
        !ts.contains("not seed input"),
        "only seed input is emitted:\n{ts}"
    );
}

#[test]
fn control_a_field_without_a_declared_shape_keeps_the_oir_mapping() {
    let ts = TypeScriptBackend::new().render_seed_mock_data_content(&[entity("Ticket", "tickets")]);
    assert!(
        ts.contains("{ name: 'id', type: 'string', required: true },"),
        "{ts}"
    );
}

#[test]
fn access_directives_are_passed_to_the_seeder() {
    let mut e = entity("Ticket", "tickets");
    e.create_policy = Some(OirExpr::Bool { value: true });
    let ts = TypeScriptBackend::new().render_seed_mock_data_content(&[e, entity("Tag", "tags")]);
    assert!(
        ts.contains("import { TICKET_CREATE_POLICY } from './access-policies.js';"),
        "{ts}"
    );
    assert!(ts.contains("createPolicy: TICKET_CREATE_POLICY,"), "{ts}");
    assert_eq!(
        ts.matches("Policy:").count(),
        1,
        "only a declared directive is passed:\n{ts}"
    );
}
