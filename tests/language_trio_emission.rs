//! Language trio on the compiled path: the six program effects compile to the
//! shared host (`@almadar/integrations/program` `runProgramEffect`, the same
//! entry the interpreter's executor calls), and the pure `quasiquote` /
//! `behavior/apply` forms compile to the shared `@almadar/core` helpers.

use orbital_core_base::ir::{
    OirEffect, OirEmitConfig, OirEvent, OirExpr, OirModule, OirState, OirTrait, OirTransition,
};
use orbital_shell_typescript::TypeScriptBackend;

fn custom(name: &str, args: Vec<OirExpr>, emit: Option<OirEmitConfig>) -> OirExpr {
    let args: orbital_core_base::ir::OirFields = args
        .into_iter()
        .enumerate()
        .map(|(i, e)| (i.to_string(), e))
        .collect();
    OirExpr::effect(OirEffect::Custom {
        name: name.to_string(),
        args,
        emit,
    })
}

fn emit_cfg(success: &str, failure: Option<&str>) -> Option<OirEmitConfig> {
    Some(OirEmitConfig {
        success: Some(success.to_string()),
        failure: failure.map(str::to_string),
        on_change: None,
        on_message: None,
        cancelled: None,
    })
}

fn handlers(effects: Vec<OirExpr>) -> String {
    let mut trait_def = OirTrait::new("Builder");
    trait_def.states = vec![OirState::initial("idle")];
    trait_def.events = vec![OirEvent::new("BUILD")];
    trait_def.transitions = vec![OirTransition::new("idle", "idle", "BUILD").with_effects(effects)];
    let module = OirModule::new("BuilderOrbital", "1.0.0");
    TypeScriptBackend::new().generate_trait_event_handler_text_hono(&trait_def, &module, "builder")
}

#[test]
fn a_program_effect_calls_the_shared_host_with_result_and_failure_events() {
    let ts = handlers(vec![custom(
        "program/eval",
        vec![OirExpr::string("p")],
        emit_cfg("BUILT", Some("BUILD_FAILED")),
    )]);
    assert!(
        ts.contains("import { runProgramEffect } from '@almadar/integrations/program';"),
        "{ts}"
    );
    assert!(
        ts.contains("import type { JsonValue } from '@almadar/core';"),
        "{ts}"
    );
    assert!(
        ts.contains("await runProgramEffect('program/eval', ["),
        "{ts}"
    );
    assert!(
        ts.contains("process.env['ALMADAR_PROJECT_ROOT'] ?? process.cwd() }, user ? { principal: user.id, role: user.role } : undefined);"),
        "a program effect runs as the requesting viewer (its workspace, its access), as call-service does:\n{ts}"
    );
    assert!(ts.contains("emittedEvents.push({ event: 'BUILT'"), "{ts}");
    assert!(
        ts.contains(
            "const __evF: EventPayload = { error: __out.error, ...(__out.errors ? { errors: __out.errors } : {}) }; emittedEvents.push({ event: 'BUILD_FAILED', payload: __evF, source: __ORBITAL_SOURCE }); getServerEventBus().emit('BUILD_FAILED', __evF, __ORBITAL_SOURCE);"
        ),
        "the failure event must reach the client (emittedEvents), not only the server bus:\n{ts}"
    );
    assert!(
        !ts.contains("getSubstrateService"),
        "a program effect must not reach the generic substrate service:\n{ts}"
    );
}

#[test]
fn without_an_emit_config_a_failed_program_effect_throws() {
    let ts = handlers(vec![custom(
        "program/read",
        vec![OirExpr::string("orbital A {}")],
        None,
    )]);
    assert!(ts.contains("throw new Error(__out.error);"), "{ts}");
}

#[test]
fn quasiquote_and_behavior_apply_compile_to_core_helpers_and_import_them() {
    let template = OirExpr::call(
        "quasiquote",
        vec![OirExpr::string("[\"unquote\",0]"), OirExpr::string("w")],
    );
    let applied = OirExpr::call(
        "behavior/apply",
        vec![OirExpr::string("v"), OirExpr::string("o")],
    );
    let ts = handlers(vec![
        custom(
            "program/eval",
            vec![template],
            emit_cfg("BUILT", Some("BUILD_FAILED")),
        ),
        custom(
            "behavior/describe",
            vec![applied],
            emit_cfg("DESCRIBED", Some("DESCRIBE_FAILED")),
        ),
    ]);
    assert!(ts.contains("instantiateQuasiquote("), "{ts}");
    assert!(ts.contains("toProgramData("), "{ts}");
    assert!(
        ts.contains("applyBehaviorOverrides(BehaviorValueSchema.parse("),
        "{ts}"
    );
    assert!(
        ts.contains("import { BehaviorValueSchema, JsonValueSchema, applyBehaviorOverrides, instantiateQuasiquote, toProgramData } from '@almadar/core';"),
        "{ts}"
    );
}

#[test]
fn control_a_trait_without_the_trio_imports_nothing_extra() {
    let ts = handlers(vec![custom(
        "session/write-spec",
        vec![OirExpr::string("s")],
        None,
    )]);
    assert!(!ts.contains("runProgramEffect"), "{ts}");
    assert!(!ts.contains("instantiateQuasiquote"), "{ts}");
    assert!(!ts.contains("applyBehaviorOverrides"), "{ts}");
}

#[test]
fn program_compose_routes_through_the_shared_host_like_the_other_program_effects() {
    let ts = handlers(vec![custom(
        "program/compose",
        vec![OirExpr::string("programs"), OirExpr::string("opts")],
        emit_cfg("COMPOSED", Some("COMPOSE_FAILED")),
    )]);
    assert!(
        ts.contains("await runProgramEffect('program/compose', ["),
        "{ts}"
    );
    assert!(
        ts.contains("emittedEvents.push({ event: 'COMPOSED'"),
        "{ts}"
    );
    assert!(
        ts.contains("emittedEvents.push({ event: 'COMPOSE_FAILED'"),
        "{ts}"
    );
}

#[test]
fn behavior_resolve_routes_through_the_shared_host_like_behavior_source() {
    let ts = handlers(vec![custom(
        "behavior/resolve",
        vec![OirExpr::string("app")],
        emit_cfg("RESOLVED", Some("RESOLVE_FAILED")),
    )]);
    assert!(
        ts.contains("await runProgramEffect('behavior/resolve', ["),
        "{ts}"
    );
    assert!(
        ts.contains("emittedEvents.push({ event: 'RESOLVED'"),
        "{ts}"
    );
    assert!(
        ts.contains("emittedEvents.push({ event: 'RESOLVE_FAILED'"),
        "{ts}"
    );
    assert!(!ts.contains("getSubstrateService"), "{ts}");
}

#[test]
fn an_agent_port_effect_runs_over_the_host_ports_the_route_lends() {
    let ts = handlers(vec![custom(
        "program/dispatch",
        vec![OirExpr::string("a"), OirExpr::string("{}")],
        emit_cfg("DISPATCHED", Some("DISPATCH_FAILED")),
    )]);
    assert!(ts.contains("import { agentPortPayload, runAgentPort } from '@almadar/core';"), "{ts}");
    assert!(ts.contains("import type { AgentPortOutcome } from '@almadar/core';"), "{ts}");
    assert!(ts.contains("servicePorts"), "the route's host ports are imported:\n{ts}");
    assert!(
        ts.contains("const __ports = servicePorts(__ORBITAL_SOURCE, user);"),
        "{ts}"
    );
    assert!(
        ts.contains("await runAgentPort('program/dispatch', [(\"a\") as JsonValue, (\"{}\") as JsonValue], __ports)"),
        "{ts}"
    );
    assert!(ts.contains("emittedEvents.push({ event: 'DISPATCHED'"), "{ts}");
    assert!(
        ts.contains("const __evP: EventPayload = agentPortPayload(__out.result);"),
        "the success payload carries the result as JSON text:\n{ts}"
    );
    assert!(ts.contains("emittedEvents.push({ event: 'DISPATCH_FAILED'"), "{ts}");
    assert!(
        !ts.contains("runProgramEffect"),
        "an agent port is not the program host:\n{ts}"
    );
}

#[test]
fn without_an_emit_config_a_failed_agent_port_effect_throws() {
    let ts = handlers(vec![custom(
        "persist/read-named",
        vec![OirExpr::string("Note")],
        None,
    )]);
    assert!(ts.contains("throw new Error(__out.error);"), "{ts}");
    assert!(ts.contains("await runAgentPort('persist/read-named', ["), "{ts}");
}

#[test]
fn control_a_program_effect_next_to_an_agent_port_keeps_its_own_host() {
    let ts = handlers(vec![
        custom("program/read", vec![OirExpr::string("orbital A {}")], None),
        custom("program/inputs", vec![], None),
    ]);
    assert!(ts.contains("await runProgramEffect('program/read', ["), "{ts}");
    assert!(ts.contains("await runAgentPort('program/inputs', []"), "{ts}");
}
