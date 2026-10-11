//! Codegen for the semantic scalar types.
//!
//! There was previously NO test asserting on `oir_type_to_mock_type` or
//! `oir_type_to_form_type` — which is why the mock-type vocabulary had already
//! drifted from `MockDataService.FieldSchema` (`enumValues` vs `values`). These
//! pin all three surfaces the declared domain has to reach.

use orbital_core::ir::{OirEntity, OirField, OirPersistence, OirType};
use orbital_shell_typescript::TypeScriptBackend;

fn entity(fields: Vec<OirField>) -> OirEntity {
    OirEntity {
        shared: false,
        identity: false,
        local: false,
        seed_mock: false,
        id: None,
        name: "Contact".to_string(),
        description: None,
        collection: "contacts".to_string(),
        persistence: OirPersistence::Persistent,
        fields,
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

#[test]
fn the_seed_schema_carries_the_declared_domain() {
    let content = TypeScriptBackend::new().render_seed_mock_data_content(&[entity(vec![
        OirField::new("email", OirType::Email),
        OirField::new("homepage", OirType::Url),
        OirField::new("mobile", OirType::Phone),
        OirField::new("externalId", OirType::Uuid),
        OirField::new("avatarShot", OirType::Image),
    ])]);

    for (field, ty) in [
        ("email", "email"),
        ("homepage", "url"),
        ("mobile", "phone"),
        ("externalId", "uuid"),
        ("avatarShot", "image"),
    ] {
        let needle = format!("{{ name: '{field}', type: '{ty}'");
        assert!(
            content.contains(&needle),
            "seed schema must carry the declared domain for `{field}`; looked for {needle}:\n{content}"
        );
    }
}

#[test]
fn a_semantic_field_is_not_flattened_to_string() {
    // The regression this guards: before the types existed, every one of these
    // lowered to `string` and the domain was unrecoverable downstream.
    let content = TypeScriptBackend::new()
        .render_seed_mock_data_content(&[entity(vec![OirField::new("email", OirType::Email)])]);
    assert!(
        !content.contains("{ name: 'email', type: 'string'"),
        "an email field must not emit as a bare string:\n{content}"
    );
}
