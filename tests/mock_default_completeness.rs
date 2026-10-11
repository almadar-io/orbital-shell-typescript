//! Mock-default emission policy: honor ANY declared default, and emit the
//! canonical field vocabulary.
//!
//! The header used to claim this while the code it locked did the opposite —
//! `field_schema_default_literal` dropped every array/object/`""` default because
//! `FieldSchema.default` was typed `string | number | boolean`. `FieldSchema` is
//! now the canonical `EntityField`, so:
//!
//! - every declared default is emitted, including `""` (the vocabulary-membership
//!   gate must be able to see it) and arrays/objects (which is what kept authored
//!   `ui-*` content out of generated apps);
//! - the vocabulary key is `values:`, not the non-canonical `enumValues:`;
//! - a `[runtime]` entity emits `seedCount: 1` in BOTH frameworks, where Express
//!   used to skip it entirely and Hono used to emit 10.

use orbital_core::ir::{OirEntity, OirField, OirPersistence, OirType, OirValue};
use orbital_shell_typescript::TypeScriptBackend;

fn entity(name: &str, persistence: OirPersistence, fields: Vec<OirField>) -> OirEntity {
    OirEntity {
        shared: false,
        identity: false,
        local: false,
        seed_mock: false,
        id: None,
        name: name.to_string(),
        description: None,
        collection: format!("{}s", name.to_lowercase()),
        persistence,
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

fn with_default(name: &str, ty: OirType, default: OirValue) -> OirField {
    let mut f = OirField::new(name, ty);
    f.default = Some(default);
    f
}

fn render(e: OirEntity) -> String {
    TypeScriptBackend::new().render_seed_mock_data_content(&[e])
}

fn line_for(content: &str, field: &str) -> String {
    content
        .lines()
        .find(|line| line.contains(&format!("name: '{field}'")))
        .unwrap_or_else(|| panic!("seed schema should contain a row for `{field}`:\n{content}"))
        .to_string()
}

#[test]
fn scalar_defaults_are_emitted_including_the_falsy_ones() {
    let content = render(entity(
        "Task",
        OirPersistence::Persistent,
        vec![
            with_default("status", OirType::String, OirValue::String("active".into())),
            with_default("count", OirType::Number, OirValue::Number(0.0)),
            with_default("enabled", OirType::Boolean, OirValue::Bool(false)),
        ],
    ));
    assert!(line_for(&content, "status").contains("default: \"active\""));
    assert!(line_for(&content, "count").contains("default: 0"));
    assert!(line_for(&content, "enabled").contains("default: false"));
}

#[test]
fn an_empty_string_default_is_emitted_not_suppressed() {
    // The gate that decides whether `""` is a placeholder or a declared
    // vocabulary member cannot run if codegen swallows the value.
    let content = render(entity(
        "Task",
        OirPersistence::Persistent,
        vec![with_default(
            "email",
            OirType::String,
            OirValue::String(String::new()),
        )],
    ));
    assert!(
        line_for(&content, "email").contains("default: \"\""),
        "an empty-string default must reach the seed schema:\n{content}"
    );
}

#[test]
fn array_and_object_defaults_reach_the_generated_app() {
    // This is the authored ui-* factory content that the scalar-only gate
    // silently dropped for the entire life of that gate.
    let content = render(entity(
        "Plan",
        OirPersistence::Persistent,
        vec![
            with_default(
                "features",
                OirType::array(OirType::String),
                OirValue::Array(vec![
                    OirValue::String("Item".into()),
                    OirValue::String("Item 2".into()),
                ]),
            ),
            with_default(
                "hero",
                OirType::Json,
                OirValue::Object(std::collections::HashMap::from([(
                    "label".to_string(),
                    OirValue::String("Label".into()),
                )])),
            ),
        ],
    ));
    let features = line_for(&content, "features");
    assert!(
        features.contains("Item") && features.contains("Item 2"),
        "array default must be emitted verbatim:\n{features}"
    );
    assert!(
        line_for(&content, "hero").contains("Label"),
        "object default must be emitted verbatim:\n{content}"
    );
}

#[test]
fn a_vocabulary_is_emitted_under_the_canonical_key() {
    let mut tier = OirField::new("tier", OirType::String);
    tier.enum_values = Some(vec!["basic".into(), "premium".into()]);
    let content = render(entity("Member", OirPersistence::Persistent, vec![tier]));
    let line = line_for(&content, "tier");
    assert!(
        line.contains("values: ['basic', 'premium']"),
        "vocabulary must use the canonical `values:` key:\n{line}"
    );
    assert!(
        !line.contains("enumValues"),
        "the non-canonical `enumValues:` key must be gone:\n{line}"
    );
}

#[test]
fn fields_without_a_default_emit_no_default_key() {
    let content = render(entity(
        "Task",
        OirPersistence::Persistent,
        vec![OirField::new("id", OirType::String)],
    ));
    assert!(
        !line_for(&content, "id").contains("default:"),
        "a field without a declared default must not emit a `default:` key"
    );
}

#[test]
fn a_runtime_entity_seeds_exactly_one_row() {
    let content = render(entity(
        "BoardState",
        OirPersistence::Runtime,
        vec![with_default(
            "result",
            OirType::String,
            OirValue::String("none".into()),
        )],
    ));
    assert!(
        content.contains("seedCount: 1"),
        "a [runtime] singleton must emit seedCount: 1, not 10 or nothing:\n{content}"
    );
}
