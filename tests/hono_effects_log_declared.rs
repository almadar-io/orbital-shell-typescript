//! Prevention gate for the `effectsLog is not defined` 500 (verified live on
//! `note-app-layout`'s `POST /events INIT`): the shared persist/emit codegen
//! (`codegen/effect/persist.rs`, `codegen/effect/shared.rs`,
//! `codegen/effect/server.rs`) references `effectsLog` unconditionally, and
//! the Hono handler header (`backend_hono.rs`) used to never declare it —
//! only the Express header (`backend/server/handlers.rs`) did. Any Hono
//! handler whose transition carries a persist effect, or a fetch/persist/
//! call-service/ref effect with an `emit:` config, threw a `ReferenceError`
//! on first event.
//!
//! Fixture shape mirrors NoteAppLayout's INIT transition: a single-state
//! self-transition whose effect is a `fetch` with `emit: { success }` — the
//! exact shape that reaches `emit_success_js_impl`'s
//! `effectsLog.debug('emit:push', ...)` call.

use orbital_core_base::ir::{
    OirEffect, OirEmitConfig, OirEvent, OirExpr, OirModule, OirState, OirTransition, OirTrait,
};
use orbital_shell_typescript::TypeScriptBackend;

fn fetch_with_success_emit_trait() -> OirTrait {
    let mut trait_def = OirTrait::new("NoteAppLayout");
    trait_def.states = vec![OirState::initial("composing")];
    trait_def.events = vec![OirEvent::new("INIT")];
    trait_def.transitions = vec![OirTransition::new("composing", "composing", "INIT")
        .with_effects(vec![OirExpr::effect(OirEffect::Fetch {
            entity_type: "Note".to_string(),
            id: None,
            filter: None,
            order_by: None,
            offset: None,
            limit: None,
            include: None,
            emit: Some(OirEmitConfig {
                success: Some("AppLayoutStateLoaded".to_string()),
                failure: None,
                on_change: None,
                on_message: None,
                cancelled: None,
            }),
        })])];
    trait_def
}

fn generated_handlers_text() -> String {
    let trait_def = fetch_with_success_emit_trait();
    let module = OirModule::new("NoteOrbital", "1.0.0");
    TypeScriptBackend::new().generate_trait_event_handler_text_hono(
        &trait_def,
        &module,
        "note-app-layout",
    )
}

#[test]
fn effects_log_is_declared_before_any_use() {
    let content = generated_handlers_text();
    assert!(
        content.contains("effectsLog.debug('emit:push'"),
        "fixture didn't reach the emit_success_js_impl codegen path — nothing to assert:\n{content}"
    );

    let decl_pos = content
        .find("const effectsLog")
        .unwrap_or_else(|| panic!("`effectsLog` is used but never declared:\n{content}"));
    let first_use_pos = content
        .find("effectsLog.")
        .expect("checked above that effectsLog.debug(...) is present");
    assert!(
        decl_pos < first_use_pos,
        "`effectsLog` is used at byte {first_use_pos} before it's declared at byte {decl_pos}:\n{content}"
    );
}
