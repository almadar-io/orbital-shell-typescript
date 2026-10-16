use crate::TypeScriptBackend;
use orbital_core_base::ir::{OirEffect, OirEmitConfig, OirExpr, OirModule};
use orbital_core_base::os::OsOp;

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
fn a_keyed_random_bytes_passes_its_key_to_the_host_and_echoes_it_on_failure_and_an_unkeyed_one_does_not() {
    let keyed = server_js(&OirEffect::RandomBytes { bytes: OirExpr::number(32.0), key: Some(OirExpr::string("k")), emit: routed() });
    assert!(keyed.contains("const __randKey = \"k\";"), "{keyed}");
    assert!(keyed.contains("const hostResult = hostRandomBytes(32, __randKey);"), "{keyed}");
    let catch_block = &keyed[keyed.find("} catch (err) {").expect("a catch block")..];
    assert!(catch_block.contains("key: __randKey"), "{keyed}");
    let plain = server_js(&OirEffect::random_bytes(OirExpr::number(32.0), routed()));
    assert!(!plain.contains("__randKey"), "{plain}");
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

#[test]
fn oauth_effects_call_the_runtime_owners_with_the_viewer_id_and_route_code_and_reason() {
    let client = OirExpr::string("client");
    let options = OirExpr::string("options");
    let authorize = server_js(&OirEffect::OAuthAuthorize { client, options, key: None, emit: routed() });
    assert!(authorize.contains("const hostResult = await hostOAuthAuthorize(\"client\", \"options\", user?.id);"), "{authorize}");
    assert!(authorize.contains("getServerEventBus().emit('DRAWN'"), "{authorize}");
    let catch_block = &authorize[authorize.find("} catch (err) {").expect("a catch block")..];
    assert!(catch_block.contains("err instanceof OAuthEffectFailure ? { code: err.payload.code, reason: err.payload.reason } : {}"), "{authorize}");
    assert!(catch_block.contains("emittedEvents.push({ event: 'DRAW_FAILED'"), "{authorize}");
    for (effect, head) in [
        (OirEffect::OAuthConnectionStatus { provider: OirExpr::string("google"), emit: routed() }, "oauth-connection-status"),
        (OirEffect::OAuthConnectionForget { provider: OirExpr::string("google"), emit: routed() }, "oauth-connection-forget"),
    ] {
        let js = server_js(&effect);
        assert!(js.contains(&format!("const hostResult = await hostOAuthConnection('{head}', \"google\", user?.id);")), "{js}");
    }
}

#[test]
fn an_unrouted_oauth_failure_is_thrown_and_never_reported_as_an_http_result() {
    let js = server_js(&OirEffect::OAuthConnectionStatus { provider: OirExpr::string("google"), emit: None });
    let catch_block = &js[js.find("} catch (err) {").expect("a catch block")..];
    assert!(catch_block.contains("throw err;"), "{js}");
    assert!(!js.contains("effectResults.push"), "{js}");
}

#[test]
fn the_generated_service_clients_wire_the_oauth_port_and_the_two_host_functions() {
    let ts = crate::generate_service_clients(&[], &std::collections::BTreeSet::new(), Some(&[]));
    for needle in [
        "oauth: createOAuthPort({ pending: pendingGrantStore, connections: installedOAuthConnectionStore }),",
        "export function hostOAuthAuthorize(",
        "return oauthAuthorizePayload(httpPorts, client, options, principal, key);",
        "export function hostOAuthConnection(",
        "return oauthConnectionPayload(httpPorts, head, provider, principal);",
        "export { OAuthEffectFailure };",
    ] {
        assert!(ts.contains(needle), "missing {needle}: {ts}");
    }
}

#[test]
fn a_keyed_oauth_authorize_evaluates_the_key_once_passes_it_and_echoes_it_on_failure() {
    let js = server_js(&OirEffect::OAuthAuthorize {
        client: OirExpr::string("client"),
        options: OirExpr::string("options"),
        key: Some(OirExpr::string("job")),
        emit: routed(),
    });
    assert!(js.contains("const __authKey = \"job\";"), "{js}");
    assert!(js.trim_end().ends_with("}"), "the key is scoped to a block: {js}");
    assert!(js.contains("await hostOAuthAuthorize(\"client\", \"options\", user?.id, __authKey);"), "{js}");
    let catch_block = &js[js.find("} catch (err) {").expect("a catch block")..];
    assert!(catch_block.contains("key: __authKey"), "{js}");
}


#[test]
fn os_read_file_calls_the_host_os_surface_with_the_op_args_and_key() {
    let js = server_js(&OirEffect::os(OsOp::ReadFile, vec![OirExpr::string("/data/a")], None, routed()));
    assert!(js.contains("// os/read-file"), "{js}");
    assert!(js.contains("const hostResult = await hostOs('os/read-file', [\"/data/a\"], null, user?.id);"), "{js}");
    assert!(js.contains("getServerEventBus().emit('DRAWN'"), "{js}");
    let keyed = server_js(&OirEffect::os(OsOp::ReadFile, vec![OirExpr::string("/data/a")], Some(OirExpr::string("k")), None));
    assert!(keyed.contains("hostOs('os/read-file', [\"/data/a\"], \"k\", user?.id)"), "{keyed}");
}
