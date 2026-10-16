// Compiled path of the one-`now`-per-dispatch contract: every `@now`/time read compiles to the dispatch's `now`.
use crate::backend::*;
use orbital_core_base::ir::{
    OirBinding, OirField, OirInterval, OirPattern, OirState, OirTick, OirValue,
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

/// `STAMP` guarded on `@now` and setting `@entity.at` from `(time/now)`; `PLAIN` touches no clock.
fn clock_trait(reads_now: bool) -> OirTrait {
    let mut t = OirTrait::new("Clock");
    t.linked_entity = Some("Task".to_string());
    t.states.push(OirState::initial("idle"));
    let mut stamp = OirTransition::new("idle", "idle", "STAMP");
    if reads_now {
        stamp.guard = Some(OirExpr::gt(bind("@now"), OirExpr::number(0.0)));
        stamp.effects.push(OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.at").unwrap(),
            OirExpr::call("time/now", vec![]),
        )));
    } else {
        stamp.effects.push(OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.at").unwrap(),
            OirExpr::number(1.0),
        )));
    }
    t.transitions.push(stamp);
    t.events.push(OirEvent::new("STAMP"));
    t
}

#[test]
fn server_handler_takes_now_and_reads_it_instead_of_the_clock() {
    let backend = TypeScriptBackend::new();
    let t = clock_trait(true);
    let js = backend.generate_event_handler_function(
        &t,
        &t.events[0],
        &module(OirPersistence::Persistent),
        "handleStamp",
    );
    assert!(
        js.contains("  now: number,\n"),
        "handler must take the dispatch stamp:\n{js}"
    );
    assert!(
        !js.contains("Date.now()"),
        "handler must never read the wall clock:\n{js}"
    );
    assert!(
        js.contains("(now ?? 0) > 0"),
        "guard must read `now`:\n{js}"
    );
}

#[test]
fn every_request_entry_stamps_once_and_threads_now_to_the_handler() {
    let backend = TypeScriptBackend::new();
    let t = clock_trait(true);
    let m = module(OirPersistence::Persistent);
    let express = backend
        .generate_trait_event_handler_file(&t, &m, "clock")
        .content;
    let hono = backend
        .generate_trait_event_handler_file_hono(&t, &m, "clock")
        .content;
    for (name, js) in [("Express", &express), ("Hono", &hono)] {
        assert_eq!(
            js.matches("const now = Date.now();").count(),
            1,
            "{name}: one stamp per request:\n{js}"
        );
        assert!(
            js.contains("user, now, clientId, entityFrame)"),
            "{name}: dispatch passes now:\n{js}"
        );
    }
}

#[test]
fn time_operators_compile_against_the_stamp() {
    let backend = TypeScriptBackend::new();
    for (op, args) in [
        ("time/now", vec![]),
        ("time/isPast", vec![OirExpr::number(1.0)]),
        ("time/isFuture", vec![OirExpr::number(1.0)]),
        ("time/isToday", vec![OirExpr::number(1.0)]),
        ("time/today", vec![]),
    ] {
        let ts = backend.compile_guard_to_ts(&OirExpr::call(op, args));
        assert!(ts.contains("now"), "{op} must read `now`, got: {ts}");
        assert!(
            !ts.contains("Date.now()") && !ts.contains("new Date()"),
            "{op} must not read the wall clock, got: {ts}"
        );
    }
}

#[test]
fn a_plain_now_string_is_a_literal_not_the_clock() {
    let backend = TypeScriptBackend::new();
    let ts = backend.pattern_value_to_ts_server(&OirValue::String("now".to_string()));
    assert_eq!(ts, "\"now\"");
}

#[test]
fn client_hook_keeps_the_last_stamp_and_stamps_each_dispatch() {
    let backend = TypeScriptBackend::new();
    let hook = backend
        .generate_trait_logic_hook(&clock_trait(true), &module(OirPersistence::Persistent))
        .content;
    assert!(
        hook.contains("const __lastNow = useRef<number>(Date.now());"),
        "render stamp ref:\n{hook}"
    );
    assert!(
        hook.contains("const now = __lastNow.current;"),
        "render reads the last stamp:\n{hook}"
    );
    assert!(
        hook.contains("    const now = Date.now();\n    __lastNow.current = now;\n"),
        "dispatch stamps:\n{hook}"
    );
    assert!(
        hook.contains("    now,\n"),
        "hook returns the stamp for the view:\n{hook}"
    );
    assert!(
        hook.contains("  now: number;\n"),
        "the hook's return type declares the stamp:\n{hook}"
    );
}

#[test]
fn a_trait_that_never_reads_now_gets_no_stamp_plumbing() {
    let backend = TypeScriptBackend::new();
    let hook = backend
        .generate_trait_logic_hook(&clock_trait(false), &module(OirPersistence::Persistent))
        .content;
    assert!(
        !hook.contains("__lastNow"),
        "no stamp plumbing without a `now` read:\n{hook}"
    );
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

/// A view whose render-ui shows `(time/relative …)` or `@now` reads the stamp, so its hook declares `now`
/// and the view destructures it; a render-ui with neither does not.
#[test]
fn a_render_ui_time_read_makes_the_trait_read_now() {
    let with = |content: OirValue| {
        let mut t = clock_trait(false);
        t.transitions[0]
            .effects
            .push(OirExpr::effect(OirEffect::render_ui(
                "main",
                OirPattern::new("typography").with_config("content", content),
            )));
        t
    };
    let relative = with(OirValue::Array(vec![
        OirValue::String("time/relative".into()),
        OirValue::String("@entity.at".into()),
    ]));
    assert!(super::shared::trait_reads_now(&relative));
    assert!(super::shared::trait_reads_now(&with(OirValue::String(
        "@now".into()
    ))));
    assert!(
        !super::shared::trait_reads_now(&with(OirValue::String("@entity.at".into()))),
        "control: a render-ui with no time read gets no stamp"
    );
    assert!(
        !super::shared::trait_reads_now(&with(OirValue::String("now".into()))),
        "control: a plain \"now\" string is a literal"
    );
}
