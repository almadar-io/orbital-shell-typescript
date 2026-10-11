// The compiled client emits no body for a `runsOn: server` effect and keeps one for client and `any` effects.
use crate::backend::*;
use orbital_core::effects::{effect_runs_on, RunsOn};

fn client(effect: &OirEffect) -> Option<String> {
    TypeScriptBackend::new().transpile_client_effect(effect, "", Some("T"), None)
}

#[test]
fn server_effects_have_no_client_body() {
    let server = [
        OirEffect::fetch("Task"),
        OirEffect::swap("Task", OirExpr::string("t1"), OirExpr::number(1.0)),
    ];
    for e in &server {
        assert_eq!(effect_runs_on(e), RunsOn::Server);
        assert_eq!(client(e), None, "{}", e.kind());
    }
}

#[test]
fn client_and_any_effects_keep_theirs() {
    for e in [
        OirEffect::emit("SAVED"),
        OirEffect::navigate(OirExpr::string("/home")),
    ] {
        assert_ne!(effect_runs_on(&e), RunsOn::Server);
        assert!(client(&e).is_some(), "{}", e.kind());
    }
}
