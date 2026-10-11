//! The emitted `seedMockData.ts` must carry enough to resolve a viewer.
//!
//! A generated app's server keys every store by COLLECTION, so two facts have to
//! survive codegen or ownership silently breaks:
//!
//! - `identity: true` names the collection whose rows are the persona roster.
//!   Without it `ALMADAR_PERSONA` resolves against an empty roster, every bare
//!   id/role throws, and rows are left unowned.
//! - `name` maps a relation's target ENTITY (`assignee : Person`) to its store
//!   (`people`). Without it the lookup misses, every relation column seeds
//!   `null`, and every ownership-scoped view is empty regardless of viewer.
//!
//! The identity entity is also emitted FIRST, because `Object.entries` preserves
//! insertion order: everything seeded after it can resolve the viewer against
//! real rows, whereas in declaration order the viewer would not exist yet.

use orbital_core::ir::{OirCardinality, OirEntity, OirField, OirPersistence, OirRelation, OirType};
use orbital_shell_typescript::TypeScriptBackend;

fn relation_field(name: &str, target: &str, cardinality: OirCardinality) -> OirField {
    let mut field = OirField::new(name, OirType::reference(target));
    field.relation = Some(OirRelation {
        target_entity: target.to_string(),
        target_entity_id: None,
        cardinality,
        foreign_key: None,
    });
    field
}

/// A reference-TYPED field carrying no explicit `OirRelation` — the other of the
/// two shapes `oir_type_to_mock_type` renders as `'relation'`.
fn bare_reference_field(name: &str, target: &str) -> OirField {
    OirField::new(name, OirType::reference(target))
}

fn entity(name: &str, collection: &str, identity: bool) -> OirEntity {
    OirEntity {
        shared: false,
        identity,
        local: false,
        seed_mock: false,
        id: None,
        name: name.to_string(),
        description: None,
        collection: collection.to_string(),
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
    }
}

/// `entity Person [persistent: people, identity]` beside a `Ticket` that
/// references it — the exact `std-helpdesk` shape.
fn helpdesk_shaped() -> Vec<OirEntity> {
    let mut ticket = entity("Ticket", "tickets", false);
    ticket.fields.push(relation_field(
        "assignee",
        "Person",
        OirCardinality::ManyToOne,
    ));
    vec![ticket, entity("Person", "people", true)]
}

#[test]
fn the_identity_collection_is_marked() {
    let ts = TypeScriptBackend::new().render_seed_mock_data_content(&helpdesk_shaped());

    assert!(
        ts.contains("identity: true"),
        "the identity collection must be marked so the roster has a source:\n{ts}"
    );
    assert_eq!(
        ts.matches("identity: true").count(),
        1,
        "exactly one entity may be the identity:\n{ts}"
    );
}

#[test]
fn every_entity_carries_its_declared_name_for_relation_resolution() {
    let ts = TypeScriptBackend::new().render_seed_mock_data_content(&helpdesk_shaped());

    assert!(
        ts.contains("name: 'Person'"),
        "the declared entity name maps `assignee : Person` to the `people` store:\n{ts}"
    );
    assert!(
        ts.contains("name: 'Ticket'"),
        "missing Ticket's name:\n{ts}"
    );
}

#[test]
fn the_identity_entity_is_seeded_first() {
    let ts = TypeScriptBackend::new().render_seed_mock_data_content(&helpdesk_shaped());

    let people = ts.find("'people'").expect("people collection emitted");
    let tickets = ts.find("'tickets'").expect("tickets collection emitted");
    assert!(
        people < tickets,
        "the identity entity must be emitted before the rest — rows seeded before \
         the viewer exists are left unowned:\n{ts}"
    );
}

#[test]
fn a_relation_field_carries_its_target_entity() {
    let ts = TypeScriptBackend::new().render_seed_mock_data_content(&helpdesk_shaped());

    // Emitting a bare `type: 'relation'` is not just lossy, it is not even
    // type-valid: `RelationEntityField` REQUIRES `relation`. Without the target
    // the seeder cannot pick a sibling id, so the column seeds `null` and every
    // ownership-scoped view is empty regardless of viewer.
    assert!(
        ts.contains("relation: { entity: 'Person', cardinality: 'one' }"),
        "the relation target must survive codegen:\n{ts}"
    );
    assert!(
        !ts.contains("{ name: 'assignee', type: 'relation', required: true }"),
        "no relation field may be emitted without its target:\n{ts}"
    );
}

#[test]
fn many_cardinalities_map_to_the_typescript_vocabulary() {
    // OIR is camelCase (`oneToMany`); the TS `RelationCardinality` union is
    // `one`/`many` plus kebab pairs and has no `one-to-one` at all, so the
    // camelCase variants must be mapped, never passed through.
    let mut owner = entity("Board", "boards", false);
    owner
        .fields
        .push(relation_field("cards", "Card", OirCardinality::OneToMany));
    let ts = TypeScriptBackend::new().render_seed_mock_data_content(&[owner]);

    assert!(
        ts.contains("relation: { entity: 'Card', cardinality: 'many' }"),
        "expected the mapped TS cardinality:\n{ts}"
    );
    assert!(
        !ts.contains("oneToMany"),
        "OIR's camelCase cardinality is not a TS RelationCardinality:\n{ts}"
    );
}

#[test]
fn a_reference_typed_field_without_an_explicit_relation_still_carries_its_target() {
    let mut ticket = entity("Ticket", "tickets", false);
    ticket
        .fields
        .push(bare_reference_field("requester", "Person"));
    let ts = TypeScriptBackend::new()
        .render_seed_mock_data_content(&[ticket, entity("Person", "people", true)]);

    assert!(
        ts.contains("relation: { entity: 'Person', cardinality: 'one' }"),
        "the Reference field type carries the target too — keying off only \
         OirRelation would emit a bare `type: 'relation'` here:\n{ts}"
    );
}

#[test]
fn an_app_with_no_identity_entity_marks_nothing() {
    let entities = vec![entity("Ticket", "tickets", false)];
    let ts = TypeScriptBackend::new().render_seed_mock_data_content(&entities);

    assert!(
        !ts.contains("identity: true"),
        "an app declaring no [identity] entity must claim no roster source:\n{ts}"
    );
}
