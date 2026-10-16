use orbital_core::ir::{
    OirBinding, OirBindingRoot, OirEffect, OirEmitConfig, OirEvent, OirExpr, OirFields, OirModule,
    OirState, OirTrait, OirTransition,
};
use orbital_shell_typescript::{
    codegen::handler_header::module_has_http_effects, generate_service_clients, TypeScriptBackend,
};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::process::Command;

enum Selection {
    App,
    User,
    Bare,
    Raw,
}

fn sources(selection: Selection, routed: bool) -> (String, String) {
    let binding = |field: &str| {
        OirExpr::binding(OirBinding::new(OirBindingRoot::Payload, vec![field.into()]))
    };
    let credential = match selection {
        Selection::App | Selection::User => {
            let mut fields = OirFields::new();
            fields.insert("credential".into(), binding("credential"));
            fields.insert(
                "scope".into(),
                OirExpr::string(if matches!(selection, Selection::App) {
                    "app"
                } else {
                    "user"
                }),
            );
            OirExpr::object(fields)
        }
        Selection::Bare => binding("credential"),
        Selection::Raw => binding("selection"),
    };
    let emit = routed.then(|| OirEmitConfig {
        success: Some("STATUS".into()),
        failure: Some("FAILED".into()),
        ..Default::default()
    });
    let mut trait_def = OirTrait::new("CredentialStatus");
    trait_def.states = vec![OirState::initial("idle")];
    trait_def.events = vec![OirEvent::new("GO")];
    trait_def.transitions = vec![OirTransition::new("idle", "idle", "GO").with_effects(vec![
        OirExpr::effect(OirEffect::credential_status(credential, emit)),
    ])];
    let mut module = OirModule::new("CredentialApp", "1.0.0");
    module.traits.push(trait_def.clone());
    let handler = TypeScriptBackend::new().generate_trait_event_handler_text_hono(
        &trait_def,
        &module,
        "credential-status",
    );
    let clients = generate_service_clients(
        &[],
        &BTreeSet::new(),
        module_has_http_effects(&module).then_some(module.egress.as_slice()),
    );
    (handler, clients)
}

// The runtime port is the boundary: its canonical resolver/predicate are not reimplemented here.
fn execute(selection: Selection, routed: bool, cases: Value) -> Value {
    let (handler, clients) = sources(selection, routed);
    let script = format!(
        r#"
import {{ stripTypeScriptTypes }} from 'node:module';
import {{ SourceTextModule, SyntheticModule }} from 'node:vm';
const handlerSource = {handler};
const clientsSource = {clients};
const cases = {cases};
const ports = {{}};
let portsCreated = 0, activeCase, calls = [], emitted = [];
const unused = () => {{ throw new Error('unexpected unrelated host call'); }};
const dependencies = new Map([
  ['zod', {{ z: {{ object: () => ({{}}) }} }}],
  ['@almadar/server-hono', {{
    getDataService: unused,
    getServerEventBus: () => ({{ emit(event, payload) {{ emitted.push({{ event, payload }}); }} }}),
    logger: {{ debug() {{}}, error() {{}} }},
  }}],
  ['@almadar/core', {{ resolveEntityView: unused, omitFrameFields: unused, guardHolds: unused }}],
  ['../../../viewer.js', {{ viewerOf: unused }}],
  ['@almadar/integrations/runtime', {{ RuntimeIntegrationManager: class {{
    configureFromEnv() {{}}
    getCallServiceHandler() {{ return unused; }}
  }} }}],
  ['@almadar/integrations', {{ CredentialStore: class {{}} }}],
  ['node:module', {{ createRequire: unused }}],
  ['node:path', {{ dirname: unused, join: unused }}],
  ['@almadar/runtime/kernelNode', {{ loadHttpKernel: unused }}],
  ['@almadar/runtime/kernel', {{
    createHttpPorts() {{ portsCreated++; return ports; }},
    async credentialStatusPayload(actualPorts, selection, principal) {{
      calls.push({{
        selection,
        principal: principal ?? null,
        samePorts: actualPorts === ports,
        sameSelection: selection === activeCase.selection,
      }});
      if (Object.hasOwn(activeCase, 'failure')) throw new Error(activeCase.failure);
      return activeCase.reply;
    }},
    credentialForgetPayload: unused,
    randomBytesPayload: unused,
    runHttpCall: unused,
  }}],
]);
const modules = new Map();
for (const [specifier, exports] of dependencies) {{
  modules.set(specifier, new SyntheticModule(Object.keys(exports), function() {{
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }}));
}}
const clientModule = new SourceTextModule(stripTypeScriptTypes(clientsSource, {{ mode: 'transform' }}));
modules.set('../../../services/clients.js', clientModule);
const handlerModule = new SourceTextModule(stripTypeScriptTypes(handlerSource));
await handlerModule.link((specifier) => {{
  const dependency = modules.get(specifier);
  if (dependency === undefined) throw new Error(`unexpected import ${{specifier}}`);
  return dependency;
}});
await handlerModule.evaluate();
const results = [];
for (const testCase of cases) {{
  activeCase = testCase; calls = []; emitted = [];
  let credentialReads = 0, selectionReads = 0;
  const payload = {{
    principal: 'program-supplied-principal',
    get credential() {{ credentialReads++; return credentialReads === 1 ? testCase.credential : null; }},
    get selection() {{ selectionReads++; return selectionReads === 1 ? testCase.selection : null; }},
  }};
  const user = Object.hasOwn(testCase, 'principal') ? {{ id: testCase.principal, role: 'member' }} : undefined;
  let response = null, error = null;
  try {{
    response = await handlerModule.namespace.runEvent({{ event: 'GO', payload }}, user);
  }} catch (caught) {{
    error = caught instanceof Error ? caught.message : 'non-error rejection';
  }}
  results.push({{ name: testCase.name, calls, emitted, credentialReads, selectionReads, response, error, portsCreated }});
}}
process.stdout.write(JSON.stringify(results));
"#,
        handler = serde_json::to_string(&handler).unwrap(),
        clients = serde_json::to_string(&clients).unwrap(),
    );
    let output = Command::new("node")
        .args([
            "--experimental-vm-modules",
            "--input-type=module",
            "-e",
            &script,
        ])
        .output()
        .expect("Node 24 must be on PATH to execute the emitted handler and service clients");
    assert!(
        output.status.success(),
        "{script}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn assert_call(result: &Value, selection: Value, principal: Value) {
    assert_eq!(result["portsCreated"], 1, "{result}");
    assert_eq!(result["calls"].as_array().unwrap().len(), 1, "{result}");
    assert_eq!(result["calls"][0]["samePorts"], true, "{result}");
    assert_eq!(result["calls"][0]["selection"], selection, "{result}");
    assert_eq!(result["calls"][0]["principal"], principal, "{result}");
}

fn assert_status(result: &Value, connected: bool) {
    assert_eq!(result["error"], Value::Null, "{result}");
    assert_eq!(result["response"]["success"], true, "{result}");
    assert_eq!(
        result["emitted"],
        json!([{ "event": "STATUS", "payload": { "connected": connected } }]),
        "{result}"
    );
    assert_eq!(
        result["response"]["emittedEvents"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        result["response"]["emittedEvents"][0]["payload"]["connected"],
        connected
    );
    assert_eq!(result["response"]["effectResults"], json!([]), "{result}");
}

#[test]
fn app_status_keeps_closed_selection_and_canonical_false_without_a_viewer() {
    let results = execute(
        Selection::App,
        true,
        json!([
            { "name": "authoritative-empty", "credential": "KEY", "reply": { "connected": false } },
            { "name": "present", "credential": "KEY", "principal": "u1", "reply": { "connected": true } },
        ]),
    );
    for (result, (principal, connected)) in results
        .as_array()
        .unwrap()
        .iter()
        .zip([(Value::Null, false), (json!("u1"), true)])
    {
        assert_call(
            result,
            json!({ "credential": "KEY", "scope": "app" }),
            principal,
        );
        assert_eq!(result["credentialReads"], 1, "{result}");
        assert_eq!(result["selectionReads"], 0, "{result}");
        assert_status(result, connected);
    }
}

#[test]
fn user_and_bare_status_preserve_dispatch_principal_and_canonical_presence_reply() {
    for selection in [Selection::User, Selection::Bare] {
        let scoped = matches!(selection, Selection::User);
        let results = execute(
            selection,
            true,
            json!([
                { "name": "missing-no-fallback", "credential": "KEY", "principal": "u2", "reply": { "connected": false } },
                { "name": "empty-user-presence", "credential": "KEY", "principal": "", "reply": { "connected": true } },
            ]),
        );
        for (result, (principal, connected)) in results
            .as_array()
            .unwrap()
            .iter()
            .zip([("u2", false), ("", true)])
        {
            let expected = if scoped {
                json!({ "credential": "KEY", "scope": "user" })
            } else {
                json!("KEY")
            };
            assert_call(result, expected, json!(principal));
            assert_eq!(result["credentialReads"], 1, "{result}");
            assert_status(result, connected);
        }
    }
}

#[test]
fn raw_selection_reaches_canonical_owner_once_without_object_or_string_coercion() {
    let cases = json!([
        { "name": "app", "selection": { "credential": "KEY", "scope": "app" }, "reply": { "connected": false } },
        { "name": "user", "selection": { "credential": "KEY", "scope": "user" }, "principal": "u1", "reply": { "connected": true } },
        { "name": "bare", "selection": "KEY", "principal": "u1", "reply": { "connected": true } },
    ]);
    let results = execute(Selection::Raw, true, cases.clone());
    for (result, case) in results
        .as_array()
        .unwrap()
        .iter()
        .zip(cases.as_array().unwrap())
    {
        assert_call(result, case["selection"].clone(), case["principal"].clone());
        assert_eq!(result["calls"][0]["sameSelection"], true, "{result}");
        assert_eq!(result["selectionReads"], 1, "{result}");
        assert_eq!(result["credentialReads"], 0, "{result}");
        assert_status(result, case["reply"]["connected"].as_bool().unwrap());
    }
}

#[test]
fn canonical_status_refusals_route_failure_without_success_or_fallback() {
    let cases = json!([
        { "name": "anonymous-user", "selection": { "credential": "KEY", "scope": "user" }, "failure": "credential-status: nobody is signed in" },
        { "name": "forged-principal", "selection": { "credential": "KEY", "scope": "app", "principal": "evil" }, "principal": "u1", "failure": "credential-status: expected { credential, scope: app | user }" },
        { "name": "non-text", "selection": 7, "principal": "u1", "failure": "credential-status: the credential must be a secret knob's name" },
    ]);
    let results = execute(Selection::Raw, true, cases.clone());
    for (result, case) in results
        .as_array()
        .unwrap()
        .iter()
        .zip(cases.as_array().unwrap())
    {
        assert_call(result, case["selection"].clone(), case["principal"].clone());
        assert_eq!(result["calls"][0]["sameSelection"], true, "{result}");
        assert_eq!(result["selectionReads"], 1, "{result}");
        assert_eq!(result["error"], Value::Null, "{result}");
        assert_eq!(
            result["emitted"],
            json!([{ "event": "FAILED", "payload": { "error": case["failure"] } }]),
            "{result}"
        );
        assert_eq!(
            result["response"]["emittedEvents"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            result["response"]["emittedEvents"][0]["event"], "FAILED",
            "{result}"
        );
    }
}

#[test]
fn an_unrouted_canonical_status_failure_propagates_unchanged() {
    let results = execute(
        Selection::App,
        false,
        json!([
            { "name": "store-failure", "credential": "KEY", "failure": "credential store unavailable" },
        ]),
    );
    let result = &results[0];
    assert_call(
        result,
        json!({ "credential": "KEY", "scope": "app" }),
        Value::Null,
    );
    assert_eq!(result["credentialReads"], 1, "{result}");
    assert_eq!(result["error"], "credential store unavailable", "{result}");
    assert_eq!(result["response"], Value::Null, "{result}");
    assert_eq!(result["emitted"], json!([]), "{result}");
}
