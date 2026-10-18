// Compiled path of the one-`now`-per-dispatch contract: every `@now`/time read compiles to the dispatch's `now`.
use crate::backend::*;
use orbital_core_base::ir::{
    OirBinding, OirField, OirInterval, OirTick, OirValue,
};

fn bind(s: &str) -> OirExpr {
    OirExpr::binding(OirBinding::parse(s).unwrap())
}

fn entity(persistence: OirPersistence) -> OirEntity {
    OirEntity {
        shared: false,
        identity: false,
        local: false,
        seed_mock: false,
        id: None,
        name: "Task".to_string(),
        description: None,
        collection: "tasks".to_string(),
        persistence,
        fields: vec![
            OirField::new("id", OirType::String),
            OirField::new("at", OirType::Number),
        ],
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

fn module(persistence: OirPersistence) -> OirModule {
    let mut m = OirModule::new("NowApp", "0.1.0");
    m.entities.push(entity(persistence));
    m
}

#[test]
fn a_plain_now_string_is_a_literal_not_the_clock() {
    let backend = TypeScriptBackend::new();
    let ts = backend.pattern_value_to_ts_server(&OirValue::String("now".to_string()));
    assert_eq!(ts, "\"now\"");
}

fn ticking_trait(interval: OirInterval, reads_now: bool) -> OirTrait {
    let mut tick = OirTick::new("beat", interval);
    tick.guard = Some(if reads_now {
        OirExpr::gt(bind("@now"), OirExpr::number(0.0))
    } else {
        OirExpr::bool(true)
    });
    tick.effects.push(OirExpr::effect(OirEffect::set(
        OirBinding::parse("@entity.at").unwrap(),
        if reads_now {
            bind("@now")
        } else {
            OirExpr::number(1.0)
        },
    )));
    let mut t = OirTrait::new("Beat");
    t.linked_entity = Some("Task".to_string());
    t.ticks.push(tick);
    t
}

#[test]
fn each_tick_firing_stamps_before_its_guard() {
    let backend = TypeScriptBackend::new();
    let m = module(OirPersistence::Runtime);
    for interval in [OirInterval::Milliseconds { value: 100 }, OirInterval::Frame] {
        let ts = backend.generate_tick_effects(&ticking_trait(interval, true), &m);
        let stamp = ts
            .find("const now = Date.now();")
            .unwrap_or_else(|| panic!("tick must stamp:\n{ts}"));
        let guard = ts
            .find("(now ?? 0) > 0")
            .unwrap_or_else(|| panic!("guard reads now:\n{ts}"));
        assert!(stamp < guard, "stamp must precede the guard:\n{ts}");
        assert!(
            ts.contains("__lastNow.current = now;"),
            "tick firing is a dispatch:\n{ts}"
        );
    }
}

#[test]
fn a_tick_that_never_reads_now_is_not_stamped() {
    let backend = TypeScriptBackend::new();
    let ts = backend.generate_tick_effects(
        &ticking_trait(OirInterval::Milliseconds { value: 100 }, false),
        &module(OirPersistence::Runtime),
    );
    assert!(
        !ts.contains("const now"),
        "no stamp without a `now` read:\n{ts}"
    );
}

#[test]
fn time_relative_reads_the_stamp() {
    let rel = OirExpr::call("time/relative", vec![bind("@entity.at")]);
    assert!(super::shared::expr_reads_now(&rel));
    let fmt = OirExpr::call(
        "time/format",
        vec![bind("@entity.at"), OirExpr::string("YYYY")],
    );
    assert!(
        !super::shared::expr_reads_now(&fmt),
        "control: time/format reads only its operand"
    );
}
