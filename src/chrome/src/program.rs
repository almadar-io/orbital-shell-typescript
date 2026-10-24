//! What the chrome-extension shell requires of a program, checked on the resolved program before any
//! file is written. The extension's service worker is the program's only host, so every service it
//! calls must declare the browser runtime and every persistent entity must live in the browser. The
//! sites the program reads come from its `browser/tab-*` effects' `match` values, never from a guess.

use std::collections::{BTreeSet, HashMap};

use orbital_core_base::runs_on::{declares_runtime, http_auth, HttpAuth, SERVICE_RUNTIME_UNSUPPORTED};
use orbital_core_base::schema::SExpression;
use orbital_core_base::tab::{is_match_pattern, TabOp};
use serde_json::Value;

/// What the shell derives from an accepted program.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChromeProgram {
    /// URL match patterns the program's `browser/tab-*` effects read: the extension's host permissions and
    /// content-script matches.
    pub host_patterns: Vec<String>,
    /// The program drives the browser's tabs, so the worker needs the `tabs` permission and the content script.
    pub uses_tabs: bool,
    /// The program runs `browser/tab-capture`, so the extension needs `activeTab` to capture a page outside its host
    /// permissions once the user has invoked it.
    pub uses_tab_capture: bool,
    /// Services the program calls, each one declaring the browser runtime.
    pub services: Vec<String>,
    /// The program runs `browser/embed`, so the worker needs an on-device embedder.
    pub embeds_on_device: bool,
    /// Match patterns of every `egress` origin: the extension's host permissions for `http`.
    pub egress_patterns: Vec<String>,
    /// Every `egress` origin as the program declares it: the ports the worker's `http` effect enforces.
    pub egress_origins: Vec<String>,
    /// The program runs an `http` effect, so the worker needs the wasm kernel's request driver.
    pub uses_http: bool,
    /// The program runs an `http` effect with `auth` (or a request nothing is known about), `credential-status`,
    /// `credential-forget` or an OAuth effect, so the worker holds a credential store the kernel's asks are answered from:
    /// the program names a credential and never receives its value.
    pub uses_credentials: bool,
    /// The program runs `oauth-authorize`, so the worker runs the host's own Google sign-in through `chrome.identity` (a secret-less flow).
    pub uses_identity: bool,
}

/// One reason a program cannot compile to the chrome-extension shell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramError {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for ProgramError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

/// The tab effects whose `match` names the sites the program reads.
const TAB_MATCH_OPS: [TabOp; 3] = [TabOp::Watch, TabOp::List, TabOp::Open];

/// Check a resolved program (its `.orb` JSON) against the services' declared runtimes.
pub fn check_program(
    program: &Value,
    service_runtimes: &HashMap<String, Vec<String>>,
) -> Result<ChromeProgram, Vec<ProgramError>> {
    let mut errors = Vec::new();
    let mut patterns = BTreeSet::new();
    let mut services = BTreeSet::new();
    let mut embeds_on_device = false;
    let mut uses_tabs = false;
    let mut uses_tab_capture = false;
    let mut uses_http = false;
    let mut uses_credentials = false;
    let mut uses_identity = false;
    let mut egress_patterns = BTreeSet::new();
    let mut egress_origins = Vec::new();
    for entry in array(program, "egress") {
        match entry.as_str().and_then(|origin| egress_match_pattern(origin).map(|p| (origin, p))) {
            Some((origin, pattern)) => {
                egress_patterns.insert(pattern);
                egress_origins.push(origin.to_string());
            }
            None => errors.push(ProgramError {
                code: "ORB_SHELL_EGRESS_ENTRY_INVALID",
                message: format!("egress entry {entry} is not a scheme://host[:port] origin, so it cannot become a host permission."),
            }),
        }
    }

    for orbital in array(program, "orbitals") {
        let orbital_name = string(orbital, "name");
        if let Some(entity) = orbital.get("entity") {
            if string(entity, "persistence") == "persistent"
                && entity.get("browser") != Some(&Value::Bool(true))
            {
                errors.push(ProgramError {
                    code: "ORB_SHELL_SERVER_ENTITY_UNSUPPORTED",
                    message: format!(
                        "{}.{} is a server-stored entity; a chrome extension has no server. Declare it `[persistent: …, browser]` or `[runtime]`.",
                        orbital_name,
                        string(entity, "name")
                    ),
                });
            }
        }
        for t in array(orbital, "traits") {
            let trait_name = string(t, "name");
            let config = t.get("config");
            let mut https = Vec::new();
            collect_operator(t, "http", &mut https);
            for call in https {
                let args: Option<Vec<SExpression>> =
                    serde_json::from_value(Value::Array(call[1..].to_vec())).ok();
                uses_http = true;
                uses_credentials |= args.as_deref().map(http_auth) != Some(HttpAuth::Keyless);
            }
            for operator in ["credential-status", "credential-forget", "oauth-authorize", "oauth-connection-status", "oauth-connection-forget"] {
                let mut credentials = Vec::new();
                collect_operator(t, operator, &mut credentials);
                uses_credentials |= !credentials.is_empty();
                uses_identity |= operator == "oauth-authorize" && !credentials.is_empty();
            }
            let mut embeds = Vec::new();
            collect_operator(t, "browser/embed", &mut embeds);
            embeds_on_device |= !embeds.is_empty();
            for op in TabOp::ALL {
                let mut tab_calls = Vec::new();
                collect_operator(t, op.name(), &mut tab_calls);
                uses_tabs |= !tab_calls.is_empty();
                uses_tab_capture |= op == TabOp::Capture && !tab_calls.is_empty();
                if !TAB_MATCH_OPS.contains(&op) {
                    continue;
                }
                for call in tab_calls {
                    match call.get(1).and_then(|request| request.get("match")).map(|m| resolve(m, config)) {
                        Some(Some(pattern)) => {
                            patterns.insert(pattern);
                        }
                        Some(None) => errors.push(ProgramError {
                            code: "ORB_SHELL_TAB_MATCH_UNRESOLVED",
                            message: format!(
                                "{}.{} runs {} with a `match` that is not a literal URL pattern or a config knob holding one; the extension's site access must be known at build time.",
                                orbital_name,
                                trait_name,
                                op.name()
                            ),
                        }),
                        None => {}
                    }
                }
            }
            let mut calls = Vec::new();
            collect_call_services(t, &mut calls);
            for call in calls {
                let service = call.get(1).and_then(Value::as_str).unwrap_or_default();
                let browser = service_runtimes
                    .get(service)
                    .is_some_and(|r| declares_runtime(r, "browser"));
                if !browser {
                    errors.push(ProgramError {
                        code: SERVICE_RUNTIME_UNSUPPORTED,
                        message: format!(
                            "{}.{} calls service '{}', which declares no browser runtime; a chrome extension can only call services that run in the browser.",
                            orbital_name, trait_name, service
                        ),
                    });
                    continue;
                }
                services.insert(service.to_string());
            }
        }
    }

    let has_root =
        array(program, "orbitals").any(|o| array(o, "pages").any(|p| string(p, "path") == "/"));
    if !has_root {
        errors.push(ProgramError {
            code: "ORB_SHELL_ROOT_PAGE_MISSING",
            message: "A chrome extension shows and keeps running the program's `/` page (the side panel's page, mounted by the worker at start); declare a page at `/`.".to_string(),
        });
    }

    if errors.is_empty() {
        Ok(ChromeProgram {
            host_patterns: patterns.into_iter().collect(),
            uses_tabs,
            uses_tab_capture,
            services: services.into_iter().collect(),
            embeds_on_device,
            egress_patterns: egress_patterns.into_iter().collect(),
            egress_origins,
            uses_http,
            uses_credentials,
            uses_identity,
        })
    } else {
        Err(errors)
    }
}

/// The host permission an `egress` origin (`scheme://host[:port]`) grants. A match pattern names no
/// port (Chrome matches every port of the host), so the port is dropped.
fn egress_match_pattern(origin: &str) -> Option<String> {
    let (scheme, rest) = origin.split_once("://")?;
    if !matches!(scheme, "http" | "https") || rest.is_empty() || rest.contains(['/', '?', '#', '@', ' ']) {
        return None;
    }
    let host = match rest.strip_prefix('[') {
        Some(bracketed) => &rest[..bracketed.find(']')? + 2],
        None => rest.split(':').next()?,
    };
    let pattern = format!("{scheme}://{host}/*");
    is_match_pattern(&pattern).then_some(pattern)
}

/// A `match` value: a literal URL match pattern, or `@config.<knob>` whose default is one.
fn resolve(value: &Value, config: Option<&Value>) -> Option<String> {
    let s = value.as_str()?;
    let pattern = match s.strip_prefix("@config.") {
        None => s,
        Some(knob) => config?.get(knob)?.get("default")?.as_str()?,
    };
    is_match_pattern(pattern).then(|| pattern.to_string())
}

/// Every `["call-service", service, method, args, …]` form anywhere under `value`.
fn collect_call_services<'a>(value: &'a Value, out: &mut Vec<&'a Vec<Value>>) {
    collect_operator(value, "call-service", out);
}

fn collect_operator<'a>(value: &'a Value, operator: &str, out: &mut Vec<&'a Vec<Value>>) {
    match value {
        Value::Array(items) => {
            if items.first().and_then(Value::as_str) == Some(operator) {
                out.push(items);
            }
            for item in items {
                collect_operator(item, operator, out);
            }
        }
        Value::Object(map) => {
            for v in map.values() {
                collect_operator(v, operator, out);
            }
        }
        _ => {}
    }
}

fn array<'a>(value: &'a Value, key: &str) -> impl Iterator<Item = &'a Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

fn string<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn runtimes() -> HashMap<String, Vec<String>> {
        HashMap::from([
            ("browser-svc".to_string(), vec!["browser".to_string()]),
            ("test-svc".to_string(), vec!["node".to_string()]),
        ])
    }

    fn program(entity: Value, traits: Value) -> Value {
        json!({ "name": "app", "orbitals": [{ "name": "Feed", "entity": entity, "traits": traits, "pages": [{ "name": "Home", "path": "/" }] }] })
    }

    fn local_entity() -> Value {
        json!({ "name": "Item", "persistence": "persistent", "browser": true })
    }

    fn trait_with(effects: Value, config: Value) -> Value {
        json!([{ "name": "Watcher", "config": config, "stateMachine": { "transitions": [{ "event": "INIT", "effects": effects }] } }])
    }

    #[test]
    fn accepts_a_browser_local_program_and_collects_literal_and_config_match_patterns() {
        let p = program(
            local_entity(),
            trait_with(
                json!([
                    ["browser/tab-watch", { "match": "https://example.com/*", "selector": ".i", "fields": {}, "event": "ITEM" }],
                    ["if", true, ["browser/tab-list", { "match": "@config.site" }]],
                    ["call-service", "browser-svc", "status", {}]
                ]),
                json!({ "site": { "default": "https://*.example.org/*" } }),
            ),
        );
        let out = check_program(&p, &runtimes()).expect("accepted");
        assert_eq!(
            out.host_patterns,
            vec![
                "https://*.example.org/*".to_string(),
                "https://example.com/*".to_string()
            ]
        );
        assert_eq!(out.services, vec!["browser-svc".to_string()]);
        assert!(out.uses_tabs);
    }

    #[test]
    fn a_program_capturing_a_tab_needs_tab_capture_and_one_only_reading_tabs_does_not() {
        let capture = program(
            local_entity(),
            trait_with(json!([["if", true, ["browser/tab-capture", { "tab": 1 }, { "key": "k" }]]]), json!({})),
        );
        let out = check_program(&capture, &runtimes()).expect("accepted");
        assert!(out.uses_tab_capture && out.uses_tabs);
        let query = program(
            local_entity(),
            trait_with(json!([["browser/tab-query", { "tab": 1, "selector": ".a", "fields": {} }]]), json!({})),
        );
        let out = check_program(&query, &runtimes()).expect("accepted");
        assert!(out.uses_tabs && !out.uses_tab_capture, "control: reading a tab captures nothing");
    }

    #[test]
    fn a_program_running_browser_embed_needs_an_on_device_embedder_and_browser_prompt_does_not() {
        let embed = program(
            local_entity(),
            trait_with(json!([["if", true, ["browser/embed", ["a"], { "key": "k" }]]]), json!({})),
        );
        assert!(check_program(&embed, &runtimes()).expect("accepted").embeds_on_device);
        let prompt = program(
            local_entity(),
            trait_with(json!([["browser/prompt", "t", "{}", { "key": "k" }]]), json!({})),
        );
        assert!(!check_program(&prompt, &runtimes()).expect("accepted").embeds_on_device);
    }

    #[test]
    fn control_a_service_call_named_embed_does_not_need_an_embedder() {
        let p = program(
            local_entity(),
            trait_with(
                json!([
                    ["call-service", "browser-svc", "status", {}],
                    ["call-service", "browser-svc", "embed", {}]
                ]),
                json!({}),
            ),
        );
        assert!(
            !check_program(&p, &runtimes())
                .expect("accepted")
                .embeds_on_device
        );
    }

    #[test]
    fn refuses_a_service_without_a_browser_runtime() {
        let p = program(
            local_entity(),
            trait_with(
                json!([["call-service", "test-svc", "run", {}]]),
                json!({}),
            ),
        );
        let errs = check_program(&p, &runtimes()).unwrap_err();
        assert_eq!(
            errs.iter().map(|e| e.code).collect::<Vec<_>>(),
            vec!["ORB_SHELL_SERVICE_RUNTIME_UNSUPPORTED"]
        );
    }

    fn with_egress(mut program: Value, egress: Value) -> Value {
        program["egress"] = egress;
        program
    }

    #[test]
    fn an_http_effect_that_carries_auth_is_allowed_and_asks_for_the_credential_ports() {
        let p = with_egress(
            program(
                local_entity(),
                trait_with(
                    json!([["if", true, ["http", "GET", "https://api.example.com", "/x", { "auth": { "scheme": "bearer", "credential": "K" } }, {}]]]),
                    json!({}),
                ),
            ),
            json!(["https://api.example.com"]),
        );
        let checked = check_program(&p, &runtimes()).expect("accepted");
        assert!(checked.uses_http && checked.uses_credentials);
        assert!(!checked.uses_identity);
    }

    #[test]
    fn an_http_effect_whose_request_is_not_a_literal_object_is_allowed_and_asks_for_the_credential_ports() {
        let p = program(
            local_entity(),
            trait_with(json!([["http", "GET", "https://api.example.com", "/x", "@payload.request"]]), json!({})),
        );
        let checked = check_program(&p, &runtimes()).expect("accepted");
        assert!(checked.uses_http && checked.uses_credentials);
    }

    #[test]
    fn credential_and_oauth_effects_are_allowed_and_only_authorize_asks_for_the_native_sign_in() {
        for (operator, identity) in [
            ("credential-status", false),
            ("credential-forget", false),
            ("oauth-connection-status", false),
            ("oauth-connection-forget", false),
            ("oauth-authorize", true),
        ] {
            let p = program(local_entity(), trait_with(json!([[operator, "K", {}]]), json!({})));
            let checked = check_program(&p, &runtimes()).expect(operator);
            assert!(checked.uses_credentials, "{operator}");
            assert_eq!(checked.uses_identity, identity, "{operator}");
            assert!(!checked.uses_http, "{operator} makes no request of its own");
        }
    }

    #[test]
    fn a_keyless_http_effect_is_allowed_and_asks_for_the_request_driver() {
        let p = with_egress(
            program(
                local_entity(),
                trait_with(
                    json!([["http", "GET", "https://api.example.com", "/x", { "query": { "q": "a" } }, {}]]),
                    json!({}),
                ),
            ),
            json!(["https://api.example.com", "http://localhost:8080"]),
        );
        let checked = check_program(&p, &runtimes()).expect("accepted");
        assert!(checked.uses_http);
        assert!(!checked.uses_credentials, "a keyless request needs no credential store");
        assert_eq!(
            checked.egress_patterns,
            vec!["http://localhost/*".to_string(), "https://api.example.com/*".to_string()]
        );
        assert_eq!(
            checked.egress_origins,
            vec!["https://api.example.com".to_string(), "http://localhost:8080".to_string()]
        );
    }

    #[test]
    fn control_a_program_without_http_does_not_ask_for_the_request_driver() {
        let p = program(local_entity(), trait_with(json!([["call-service", "browser-svc", "status", {}]]), json!({})));
        let checked = check_program(&p, &runtimes()).expect("accepted");
        assert!(!checked.uses_http && !checked.uses_credentials && !checked.uses_identity);
    }

    #[test]
    fn edge_egress_entries_become_match_patterns_and_a_bad_one_is_refused() {
        assert_eq!(egress_match_pattern("https://api.example.com"), Some("https://api.example.com/*".to_string()));
        assert_eq!(egress_match_pattern("https://api.example.com:8443"), Some("https://api.example.com/*".to_string()));
        assert_eq!(egress_match_pattern("http://[::1]:3000"), Some("http://[::1]/*".to_string()));
        for bad in ["api.example.com", "ftp://x.com", "https://x.com/path", "https://", "https://u@x.com"] {
            assert_eq!(egress_match_pattern(bad), None, "{bad}");
        }
        let p = with_egress(program(local_entity(), trait_with(json!([]), json!({}))), json!(["nope"]));
        assert_eq!(check_program(&p, &runtimes()).unwrap_err()[0].code, "ORB_SHELL_EGRESS_ENTRY_INVALID");
    }

    #[test]
    fn control_a_browser_service_call_is_not_an_http_effect() {
        let p = program(
            local_entity(),
            trait_with(json!([["call-service", "browser-svc", "status", {}]]), json!({})),
        );
        assert!(check_program(&p, &runtimes()).is_ok());
    }

    #[test]
    fn the_knowledge_service_is_refused_because_no_registry_lists_it() {
        let knowledge = program(
            local_entity(),
            trait_with(json!([["call-service", "knowledge", "status", {}]]), json!({})),
        );
        let errs = check_program(&knowledge, &runtimes()).unwrap_err();
        assert_eq!(errs.iter().map(|e| e.code).collect::<Vec<_>>(), vec!["ORB_SHELL_SERVICE_RUNTIME_UNSUPPORTED"]);
        assert!(errs[0].message.contains("'knowledge'"));
    }

    #[test]
    fn edge_an_unregistered_service_is_refused_too() {
        let p = program(
            local_entity(),
            trait_with(json!([["call-service", "nope", "x", {}]]), json!({})),
        );
        assert_eq!(
            check_program(&p, &runtimes()).unwrap_err()[0].code,
            "ORB_SHELL_SERVICE_RUNTIME_UNSUPPORTED"
        );
    }

    #[test]
    fn refuses_a_program_without_a_root_page() {
        let p = json!({ "name": "app", "orbitals": [{ "name": "Feed", "entity": local_entity(), "traits": [], "pages": [{ "name": "P", "path": "/panel" }] }] });
        assert_eq!(
            check_program(&p, &runtimes()).unwrap_err()[0].code,
            "ORB_SHELL_ROOT_PAGE_MISSING"
        );
    }

    #[test]
    fn refuses_a_server_stored_entity() {
        let p = program(
            json!({ "name": "Item", "persistence": "persistent" }),
            json!([]),
        );
        assert_eq!(
            check_program(&p, &runtimes()).unwrap_err()[0].code,
            "ORB_SHELL_SERVER_ENTITY_UNSUPPORTED"
        );
    }

    #[test]
    fn control_runtime_entities_are_browser_resident() {
        let p = program(
            json!({ "name": "Item", "persistence": "runtime" }),
            json!([]),
        );
        assert!(check_program(&p, &runtimes()).is_ok());
    }

    #[test]
    fn refuses_a_page_match_it_cannot_resolve_at_build_time() {
        let p = program(
            local_entity(),
            trait_with(
                json!([["browser/tab-watch", { "match": "@entity.site" }]]),
                json!({}),
            ),
        );
        assert_eq!(
            check_program(&p, &runtimes()).unwrap_err()[0].code,
            "ORB_SHELL_TAB_MATCH_UNRESOLVED"
        );
    }

    #[test]
    fn refuses_a_literal_that_is_not_a_url_match_pattern() {
        for bad in [
            "example.com",
            "https://ex*ample.com/",
            "javascript://x/",
            "https://example.com",
        ] {
            let p = program(
                local_entity(),
                trait_with(
                    json!([["browser/tab-watch", { "match": bad }]]),
                    json!({}),
                ),
            );
            assert_eq!(
                check_program(&p, &runtimes()).unwrap_err()[0].code,
                "ORB_SHELL_TAB_MATCH_UNRESOLVED",
                "{bad}"
            );
        }
    }

    #[test]
    fn control_valid_patterns_are_accepted() {
        for good in [
            "<all_urls>",
            "*://example.com/*",
            "https://*.example.com/watch*",
            "file:///docs/*",
        ] {
            assert!(is_match_pattern(good), "{good}");
        }
    }

    #[test]
    fn an_open_tab_match_grants_access_to_the_pages_it_will_read() {
        let p = program(
            local_entity(),
            trait_with(
                json!([["browser/tab-open", { "url": "@config.searchUrl", "match": "@config.resultsMatch", "active": false }]]),
                json!({ "resultsMatch": { "default": "https://search.example.com/*" } }),
            ),
        );
        assert_eq!(
            check_program(&p, &runtimes()).unwrap().host_patterns,
            vec!["https://search.example.com/*".to_string()]
        );
    }

    #[test]
    fn control_an_open_tab_without_a_match_grants_nothing_and_is_not_an_error() {
        let p = program(
            local_entity(),
            trait_with(
                json!([["browser/tab-open", { "url": "@payload.url", "active": true }]]),
                json!({}),
            ),
        );
        assert_eq!(
            check_program(&p, &runtimes()).unwrap().host_patterns,
            Vec::<String>::new()
        );
    }

    #[test]
    fn control_tab_effects_without_a_match_add_no_pattern_but_still_need_the_tabs_permission() {
        let p = program(
            local_entity(),
            trait_with(
                json!([["browser/tab-apply", { "tab": 1, "elementId": "e", "treatment": "hide" }]]),
                json!({}),
            ),
        );
        let checked = check_program(&p, &runtimes()).unwrap();
        assert_eq!(checked.host_patterns, Vec::<String>::new());
        assert!(checked.uses_tabs);
    }

    #[test]
    fn control_a_service_call_named_like_a_tab_effect_reads_no_site_and_needs_no_tabs() {
        let p = program(
            local_entity(),
            trait_with(
                json!([["call-service", "browser-svc", "watch", { "match": "https://example.com/*" }]]),
                json!({}),
            ),
        );
        let checked = check_program(&p, &runtimes()).unwrap();
        assert_eq!(checked.host_patterns, Vec::<String>::new());
        assert!(!checked.uses_tabs);
    }
}
