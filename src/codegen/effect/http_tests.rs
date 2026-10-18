use crate::TypeScriptBackend;
use orbital_core_base::ir::{OirEffect, OirEmitConfig, OirExpr};

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
