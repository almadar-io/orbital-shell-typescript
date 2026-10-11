// Compiled path of the dispatch roots (Runtime Spec Clauses 3.3, 5.5): scope plumbing, literal targets, and no change for apps that don't read them.
use crate::backend::*;
use orbital_core::ir::{OirBinding, OirField, OirListener, OirState};

fn bind(s: &str) -> OirExpr {
    OirExpr::binding(OirBinding::parse(s).unwrap())
}

fn probe(persistence: OirPersistence) -> OirEntity {
    OirEntity {
        shared: false,
        identity: false,
        local: false,
        seed_mock: false,
        id: None,
        name: "Probe".to_string(),
        description: None,
        collection: "probes".to_string(),
        persistence,
        fields: vec![
            OirField::new("id", OirType::String),
            OirField::new("heard", OirType::String),
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

/// `Once` listens `Src.X` once, then records what the delivery was.
fn once(reads_scope: bool) -> OirTrait {
    let mut t = OirTrait::new("Once");
    t.orbital_name = "Main".to_string();
    t.linked_entity = Some("Probe".to_string());
    t.states.push(OirState::initial("idle"));
    t.states.push(OirState::new("seen"));
    let mut got = OirTransition::new("idle", "seen", "GOT");
    got.guard = Some(OirExpr::eq(bind("@toState"), OirExpr::string("seen")));
    got.effects.push(OirExpr::effect(OirEffect::set(
        OirBinding::parse("@entity.heard").unwrap(),
        if reads_scope {
            bind("@event.source.trait")
        } else {
            OirExpr::string("x")
        },
    )));
    got.effects.push(OirExpr::effect(OirEffect::Emit {
        event: "SAW".to_string(),
        payload: Some(OirExpr::object(
            [
                ("to".to_string(), bind("@state")),
                ("from".to_string(), bind("@fromState")),
            ]
            .into_iter()
            .collect(),
        )),
    }));
    t.transitions.push(got);
    t.events.push(OirEvent::new("GOT"));
    let mut listen = OirListener::new("X", "GOT");
    listen.source_trait = Some("Src".to_string());
    if reads_scope {
        listen.guard = Some(OirExpr::not(OirExpr::call(
            "array/includes",
            vec![bind("@prevStates"), OirExpr::string("seen")],
        )));
    }
    t.listeners.push(listen);
    t
}

fn module(t: &OirTrait, persistence: OirPersistence) -> OirModule {
    let mut m = OirModule::new("RootsApp", "0.1.0");
    m.entities.push(probe(persistence));
    m.traits.push(t.clone());
    m
}

#[test]
fn a_trait_reading_the_scope_gets_it_from_the_request_on_both_servers() {
    let backend = TypeScriptBackend::new();
    let t = once(true);
    let m = module(&t, OirPersistence::Persistent);
    let express = backend
        .generate_trait_event_handler_file(&t, &m, "once")
        .content;
    let hono = backend
        .generate_trait_event_handler_file_hono(&t, &m, "once")
        .content;
    for (name, js, body) in [("Express", &express, "body"), ("Hono", &hono, "body")] {
        assert!(
            js.contains(&format!("const __dispatch: DispatchScope = dispatchScopeOf({body}.delivery, {body}.dispatchLog, event, payload);")),
            "{name}: one scope per request:\n{js}"
        );
        assert!(
            js.contains("entityFrame, __dispatch);"),
            "{name}: passed to the handler:\n{js}"
        );
        assert!(
            js.contains("__dispatch: DispatchScope"),
            "{name}: handler takes it:\n{js}"
        );
        assert!(
            js.contains("((__dispatch.event as EventPayload | undefined)?.source as EventPayload | undefined)?.trait"),
            "{name}: @event.source.trait reads the scope:\n{js}"
        );
    }
}

#[test]
fn a_trait_that_never_reads_the_scope_compiles_as_before() {
    let backend = TypeScriptBackend::new();
    let t = once(false);
    let m = module(&t, OirPersistence::Persistent);
    for js in [
        backend
            .generate_trait_event_handler_file(&t, &m, "once")
            .content,
        backend
            .generate_trait_event_handler_file_hono(&t, &m, "once")
            .content,
    ] {
        assert!(
            !js.contains("__dispatch") && !js.contains("dispatchScopeOf"),
            "{js}"
        );
    }
}

#[test]
fn transition_ends_are_static_a_committed_state_is_the_target_and_a_guard_state_is_the_source() {
    let backend = TypeScriptBackend::new();
    let t = once(true);
    let js = backend
        .generate_trait_event_handler_file(&t, &module(&t, OirPersistence::Persistent), "once")
        .content;
    assert!(
        js.contains("('seen' === \"seen\")"),
        "@toState in the guard is the target:\n{js}"
    );
    assert!(
        js.contains("to: 'seen'"),
        "@state in an effect is the committed target:\n{js}"
    );
    assert!(
        js.contains("from: state"),
        "@fromState is the incoming state:\n{js}"
    );
    assert!(
        !js.contains("String('seen' ?? '')"),
        "a literal is never coerced (TS2869):\n{js}"
    );

    let scope = backend.current_transition.snapshot();
    assert!(
        scope.is_none(),
        "the transition scope is cleared after compile"
    );
    assert_eq!(
        backend.compile_guard_to_ts(&bind("@state")),
        "state",
        "outside a transition `state` is the live state"
    );
}

#[test]
fn the_client_carries_the_dispatch_only_when_the_module_reads_it() {
    for (reads, framework) in [
        (true, ServerFramework::Express),
        (false, ServerFramework::Hono),
    ] {
        let backend = TypeScriptBackend::new();
        backend.dispatch_scope.set(reads);
        let t = once(reads);
        let m = module(&t, OirPersistence::Persistent);
        let hook = backend.generate_trait_logic_hook(&t, &m).content;
        let bridge = backend.generate_orbital_bridge_hook_impl(framework).content;
        assert_eq!(hook.contains("__viaIn?: DispatchVia"), reads, "{hook}");
        assert_eq!(
            hook.contains("recordDelivery('Once', __via.delivery)"),
            reads,
            "{hook}"
        );
        assert_eq!(
            bridge.contains("dispatchLog: continuation?.dispatchLog"),
            reads,
            "{bridge}"
        );
        assert_eq!(
            bridge.contains("withinDispatch(continuation.ctx, __reemit)"),
            reads,
            "{bridge}"
        );
        if reads {
            assert!(
                hook.contains("enqueueEvent('GOT', event.payload, { delivery: { event: 'X', ...(event.payload !== undefined ? { payload: event.payload } : {}), source: event.source ?? {} }, ctx: currentDispatch() ?? beginDispatch(), listenWhen: (fromState: string, __dispatch: DispatchScope) =>"),
                "the listens `when` is deferred to delivery:\n{hook}"
            );
            assert!(
                !hook.contains("      if (!("),
                "no enqueue-time listens `when`:\n{hook}"
            );
        }
    }
}

#[test]
fn the_dispatch_module_ships_only_with_a_module_that_reads_the_scope() {
    for (reads, expected) in [(true, true), (false, false)] {
        let m = module(&once(reads), OirPersistence::Persistent);
        let mut backend = TypeScriptBackend::new();
        backend.target = "client".to_string();
        let files = backend.generate(&m).files;
        let shipped = files.iter().any(|f| {
            f.path
                .ends_with("packages/client/src/hooks/dispatchContext.ts")
        });
        assert_eq!(shipped, expected, "reads={reads}");
    }
}
