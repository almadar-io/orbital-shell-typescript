use crate::TypeScriptBackend;
use orbital_core::ir::{OirEffect, OirEmitConfig, OirExpr, OirModule};

fn server_js(effect: &OirEffect) -> String {
    TypeScriptBackend::new().generate_server_effect_code(effect, &OirModule::new("TestApp", "0.1.0"), None)
}

fn routed() -> Option<OirEmitConfig> {
    Some(OirEmitConfig {
        success: Some("DRAWN".to_string()),
        failure: Some("DRAW_FAILED".to_string()),
        ..Default::default()
    })
}

#[test]
fn random_bytes_calls_the_one_host_function_and_emits_its_payload() {
    let js = server_js(&OirEffect::random_bytes(OirExpr::number(32.0), routed()));
    assert!(js.contains("const hostResult = hostRandomBytes(32);"), "{js}");
    assert!(js.contains("getServerEventBus().emit('DRAWN'"), "{js}");
    let catch_block = &js[js.find("} catch (err) {").expect("a catch block")..];
    assert!(catch_block.contains("emittedEvents.push({ event: 'DRAW_FAILED'"), "{js}");
    assert!(!catch_block.contains("throw err;"), "a routed failure is handled: {js}");
}

#[test]
fn credential_effects_pass_the_signed_in_viewers_id_and_never_a_program_value() {
    let status = server_js(&OirEffect::credential_status(OirExpr::string("tok"), routed()));
    assert!(status.contains("const hostResult = await hostCredentialStatus(\"tok\", user?.id);"), "{status}");
    let forget = server_js(&OirEffect::credential_forget(OirExpr::string("tok"), routed()));
    assert!(forget.contains("const hostResult = await hostCredentialForget(\"tok\", user?.id);"), "{forget}");
}

#[test]
fn a_failure_with_no_declared_route_is_thrown_like_the_kernel_path() {
    let js = server_js(&OirEffect::random_bytes(OirExpr::number(8.0), None));
    let catch_block = &js[js.find("} catch (err) {").expect("a catch block")..];
    assert!(catch_block.contains("throw err;"), "{js}");
    assert!(!js.contains("getServerEventBus().emit("), "no route, no emit: {js}");
}

#[test]
fn host_effects_are_not_reported_as_http_effects_in_the_effect_results() {
    let js = server_js(&OirEffect::random_bytes(OirExpr::number(8.0), routed()));
    assert!(!js.contains("effectResults.push"), "{js}");
}
