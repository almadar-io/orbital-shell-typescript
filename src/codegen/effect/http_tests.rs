use crate::TypeScriptBackend;
use orbital_core_base::ir::{OirEffect, OirEmitConfig, OirExpr, OirFields, OirModule};
use orbital_core_base::http_wire::HttpMethod;

fn http(method: HttpMethod, key: Option<OirExpr>, emit: Option<OirEmitConfig>) -> OirEffect {
    let mut request = OirFields::new();
    request.insert("timeoutMs".to_string(), OirExpr::number(6000.0));
    OirEffect::Http {
        method,
        origin: OirExpr::string("https://api.iconify.design"),
        path: OirExpr::string("/search"),
        request: Some(OirExpr::object(request)),
        key,
        emit,
    }
}

fn full_emit() -> OirEmitConfig {
    OirEmitConfig {
        success: Some("SEARCHED".to_string()),
        failure: Some("SEARCH_FAILED".to_string()),
        cancelled: Some("SEARCH_CANCELLED".to_string()),
        ..Default::default()
    }
}

fn server_js(effect: &OirEffect) -> String {
    TypeScriptBackend::new().generate_server_effect_code(effect, &OirModule::new("TestApp", "0.1.0"), None)
}

#[test]
fn http_passes_the_existing_dispatch_stamp_and_preserves_the_whole_failure_payload() {
    for keyed in [false, true] {
        let js = server_js(&http(HttpMethod::Get, keyed.then(|| OirExpr::string("job")), Some(full_emit())));
        assert!(js.contains("nowMs: now"), "{js}");
        assert!(js.contains("...(err instanceof HttpCallError ? err.payload : { kind: 'failed', key: null, credential: null })"), "{js}");
        assert!(!js.contains("nowMs: Date.now()"), "{js}");
    }
}

#[test]
fn http_calls_the_one_helper_with_the_method_origin_path_and_request() {
    let js = server_js(&http(HttpMethod::Post, None, None));
    assert!(
        js.contains("await httpCall({ method: 'POST', origin: \"https://api.iconify.design\", path: \"/search\", request: "),
        "{js}"
    );
    assert!(js.contains("effect: 'http',"), "{js}");
    assert!(!js.contains("beginKeyedCall"), "{js}");
    assert!(!js.contains("callService("), "{js}");
}

#[test]
fn an_unkeyed_http_sends_a_null_key_and_a_keyed_one_its_call_key() {
    assert!(server_js(&http(HttpMethod::Get, None, None)).contains(", key: null, nowMs: now }, { principal: user?.id });"));
    let keyed = server_js(&http(HttpMethod::Get, Some(OirExpr::string("k")), None));
    assert!(keyed.contains(", key: __callKey, nowMs: now }, { signal: __callCtl.signal, principal: user?.id });"), "{keyed}");
}

#[test]
fn http_without_a_request_passes_an_empty_one() {
    let effect = OirEffect::http(
        HttpMethod::Get,
        OirExpr::string("https://api.example.com"),
        OirExpr::string("/x"),
    );
    assert!(server_js(&effect).contains("request: {}, key: null, nowMs: now }"));
}

#[test]
fn http_emits_success_and_failure_with_the_failure_kind() {
    let js = server_js(&http(HttpMethod::Get, None, Some(full_emit())));
    assert!(js.contains("getServerEventBus().emit('SEARCHED'"), "{js}");
    let catch_block = &js[js.find("} catch (err) {").expect("a catch block")..];
    assert!(
        catch_block.contains("{ error: err instanceof Error ? err.message : String(err), ...(err instanceof HttpCallError ? err.payload : { kind: 'failed', key: null, credential: null }) }"),
        "{js}"
    );
    assert!(catch_block.contains("emittedEvents.push({ event: 'SEARCH_FAILED'"), "{js}");
    assert!(!js.contains("SEARCH_CANCELLED"), "an unkeyed call cannot be cancelled: {js}");
}

#[test]
fn a_keyed_http_registers_its_controller_passes_the_signal_and_routes_cancellation() {
    let js = server_js(&http(
        HttpMethod::Get,
        Some(OirExpr::string("search-1")),
        Some(full_emit()),
    ));
    assert!(js.contains("const __callKey = \"search-1\";"), "{js}");
    assert!(js.contains("const __callCtl = beginKeyedCall(__callKey);"), "{js}");
    assert!(js.contains("{ signal: __callCtl.signal, principal: user?.id });"), "{js}");
    assert!(js.contains("if (__callCtl.signal.aborted) { throw new Error('call cancelled'); }"), "{js}");
    assert!(js.contains("emittedEvents.push({ event: 'SEARCH_CANCELLED'"), "{js}");
    let finally_idx = js.find("} finally {").expect("finally block");
    assert!(js.find("endKeyedCall(__callKey, __callCtl);").unwrap() > finally_idx, "{js}");
    let aborted = js.find("if (__callCtl.signal.aborted) {\n").expect("aborted branch");
    assert!(js[aborted..].find("SEARCH_FAILED").unwrap() > js[aborted..].find("} else {").unwrap(), "{js}");
}

#[test]
fn http_on_message_routes_live_messages_to_the_origin_tab() {
    let emit = OirEmitConfig {
        success: Some("DONE".to_string()),
        on_message: Some("CHUNK".to_string()),
        ..Default::default()
    };
    let js = server_js(&http(HttpMethod::Get, None, Some(emit)));
    assert!(
        js.contains("{ onMessage: (__message) => pushToOrigin(clientId, { type: 'bus', event: 'CHUNK', payload: __message, source: __ORBITAL_SOURCE, timestamp: Date.now(), target: 'origin' }), principal: user?.id });"),
        "{js}"
    );
}

#[test]
fn every_method_spells_its_verb() {
    for (method, verb) in [
        (HttpMethod::Get, "GET"),
        (HttpMethod::Post, "POST"),
        (HttpMethod::Put, "PUT"),
        (HttpMethod::Patch, "PATCH"),
        (HttpMethod::Delete, "DELETE"),
    ] {
        let js = server_js(&http(method, None, None));
        assert!(js.contains(&format!("method: '{verb}'")), "{js}");
    }
}

#[test]
fn control_http_is_not_a_client_effect() {
    let js = TypeScriptBackend::new().generate_server_effect_code_hono(
        &http(HttpMethod::Get, None, None),
        &OirModule::new("TestApp", "0.1.0"),
        None,
    );
    assert!(js.contains("httpCall("), "the hono server shares the arm: {js}");
}

#[test]
fn keyed_call_service_echoes_its_key_in_success_and_failure_and_unkeyed_does_not() {
    let backend = TypeScriptBackend::new();
    let module = OirModule::new("TestApp", "0.1.0");
    let call = |key: Option<OirExpr>| OirEffect::CallService {
        service: "llm".to_string(),
        method: "classifyMany".to_string(),
        args: OirExpr::object(OirFields::new()),
        key,
        emit: Some(full_emit()),
    };
    let keyed = backend.generate_server_effect_code(&call(Some(OirExpr::string("b1"))), &module, None);
    assert!(keyed.contains("{ ...serviceResult, key: __callKey }"), "{keyed}");
    assert!(keyed.contains("{ error: err instanceof Error ? err.message : String(err), key: __callKey }"), "{keyed}");
    let unkeyed = backend.generate_server_effect_code(&call(None), &module, None);
    assert!(!unkeyed.contains("key: __callKey"), "{unkeyed}");
}

#[test]
fn control_http_does_not_merge_a_key_again() {
    let js = server_js(&http(HttpMethod::Get, Some(OirExpr::string("k")), Some(full_emit())));
    assert!(!js.contains("...httpResult"), "{js}");
}

fn client_js(effect: &OirEffect) -> String {
    TypeScriptBackend::new()
        .transpile_client_effect(effect, "", Some("Probe"), None)
        .expect("a page-facts effect transpiles on the client")
}

fn facts_effect(key: Option<OirExpr>) -> OirEffect {
    OirEffect::BrowserPageFacts {
        fields: vec![orbital_core_base::ir::PageFactField::Referrer],
        key,
        emit: Some(OirEmitConfig {
            success: Some("FACTS".to_string()),
            failure: Some("FACTS_FAILED".to_string()),
            ..Default::default()
        }),
    }
}

#[test]
fn a_keyed_page_facts_echoes_its_key_on_success_and_failure_and_an_unkeyed_one_carries_none() {
    let keyed = client_js(&facts_effect(Some(OirExpr::string("k1"))));
    assert!(keyed.contains("{ ...__facts, key: __key }"), "{keyed}");
    assert!(keyed.contains("...(__key !== undefined ? { key: __key } : {})"), "{keyed}");
    assert!(keyed.contains("key must be a non-empty string"), "{keyed}");
    let unkeyed = client_js(&facts_effect(None));
    assert!(!unkeyed.contains("__key"), "{unkeyed}");
    assert!(unkeyed.contains("{ ...__result }"), "{unkeyed}");
}
