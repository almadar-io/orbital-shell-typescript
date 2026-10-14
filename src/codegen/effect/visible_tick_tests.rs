// A `[visible]` tick (`whileVisible`) pauses while its trait is off screen: the generated loop asks
// `useTickVisibility` before its guard; an untagged tick keeps firing (LOLO §11).
use crate::backend::*;
use orbital_core::ir::{OirBinding, OirField, OirInterval, OirState, OirTick};

fn module() -> OirModule {
    let mut m = OirModule::new("VisibleApp", "0.1.0");
    m.entities.push(OirEntity {
        shared: false,
        identity: false,
        local: false,
        seed_mock: false,
        id: None,
        name: "Spin".to_string(),
        description: None,
        collection: "spins".to_string(),
        persistence: OirPersistence::Runtime,
        fields: vec![
            OirField::new("id", OirType::String),
            OirField::new("n", OirType::Number),
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

fn spinning(interval: OirInterval, while_visible: bool) -> OirTrait {
    let mut tick = OirTick::new("turn", interval);
    tick.while_visible = while_visible;
    tick.effects.push(OirExpr::effect(OirEffect::set(
        OirBinding::parse("@entity.n").unwrap(),
        OirExpr::number(1.0),
    )));
    let mut t = OirTrait::new("Spinner");
    t.linked_entity = Some("Spin".to_string());
    t.states.push(OirState::initial("idle"));
    t.ticks.push(tick);
    t
}

#[test]
fn a_visible_tick_asks_before_its_guard() {
    let backend = TypeScriptBackend::new();
    for interval in [OirInterval::Milliseconds { value: 100 }, OirInterval::Frame] {
        let ts = backend.generate_tick_effects(&spinning(interval, true), &module());
        assert!(
            ts.contains("const _tickVisible = useTickVisibility([\"Spinner\"]);"),
            "{ts}"
        );
        assert!(ts.contains("if (_tickVisible() && (true)) {"), "{ts}");
    }
}

#[test]
fn control_an_untagged_tick_never_asks() {
    let ts = TypeScriptBackend::new().generate_tick_effects(
        &spinning(OirInterval::Milliseconds { value: 100 }, false),
        &module(),
    );
    assert!(!ts.contains("useTickVisibility"), "{ts}");
}

#[test]
fn the_trait_hook_imports_the_gate_only_when_a_tick_needs_it() {
    let backend = TypeScriptBackend::new();
    let with = backend
        .generate_trait_logic_hook(&spinning(OirInterval::Frame, true), &module())
        .content;
    assert!(
        with.contains("import { useTickVisibility } from '@almadar/ui/hooks';"),
        "{with}"
    );
    let without = backend
        .generate_trait_logic_hook(&spinning(OirInterval::Frame, false), &module())
        .content;
    assert!(!without.contains("useTickVisibility"), "{without}");
}
