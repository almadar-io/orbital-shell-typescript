use orbital_core_base::ir::{
    OirBinding, OirBindingRoot, OirEffect, OirEvent, OirExpr, OirFields, OirModule, OirState, OirTrait,
    OirTransition,
};
use orbital_core_base::fixtures::binding_path_cases;
use orbital_core_base::http_wire::HttpMethod;
use orbital_shell_typescript::TypeScriptBackend;
use serde_json::{json, Value};
use std::process::Command;

fn handler(keyed: bool) -> String {
    let mut auth = OirFields::new();
    auth.insert("scheme".into(), OirExpr::string("bearer"));
    auth.insert("credential".into(), OirExpr::string("API_KEY"));
    let mut request = OirFields::new();
    request.insert("auth".into(), OirExpr::object(auth));
    let mut trait_def = OirTrait::new("HttpCaller");
    trait_def.states = vec![OirState::initial("idle")];
    trait_def.events = vec![OirEvent::new("GO")];
    trait_def.transitions = vec![OirTransition::new("idle", "idle", "GO").with_effects(vec![
        OirExpr::effect(OirEffect::Http {
            method: HttpMethod::Get,
            origin: OirExpr::string("https://api.example.com"),
            path: OirExpr::string("/items"),
            request: Some(OirExpr::object(request)),
            key: keyed.then(|| {
                OirExpr::binding(OirBinding::new(OirBindingRoot::Payload, vec!["key".into()]))
            }),
            emit: None,
        }),
    ])];
    TypeScriptBackend::new().generate_trait_event_handler_text_hono(
        &trait_def,
        &OirModule::new("HttpApp", "1.0.0"),
        "http-caller",
    )
}

fn execute(keyed: bool, cases: Value) -> Value {
    let script = format!(
        r#"
import {{ stripTypeScriptTypes }} from 'node:module';
import {{ SourceTextModule, SyntheticModule }} from 'node:vm';
const source = {source};
const cases = {cases};
let begins = [], sends = [], ends = [];
const unused = () => {{ throw new Error('unexpected unrelated host call'); }};
const dependencies = new Map([
  ['zod', {{ z: {{ object: () => ({{}}) }} }}],
  ['@almadar/server-hono', {{ getDataService: unused, logger: {{ debug() {{}}, error() {{}} }} }}],
  ['@almadar/core', {{ resolveEntityView: unused, omitFrameFields: unused, guardHolds: unused }}],
  ['../../../viewer.js', {{ viewerOf: unused }}],
  ['../../../services/host.js', {{
    servicePorts: unused,
    beginKeyedCall(key) {{ begins.push(key); return new AbortController(); }},
    endKeyedCall(key) {{ ends.push(key); }},
  }}],
  ['../../../services/clients.js', {{
    HttpCallError: class HttpCallError extends Error {{}},
    async httpCall(call) {{ sends.push(call.key); return {{ status: 200, headers: {{}}, body: 'ok', key: call.key }}; }},
  }}],
]);
const module = new SourceTextModule(stripTypeScriptTypes(source));
await module.link((specifier) => {{
  const exports = dependencies.get(specifier);
  if (exports === undefined) throw new Error(`unexpected import ${{specifier}}`);
  return new SyntheticModule(Object.keys(exports), function() {{
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }});
}});
await module.evaluate();
const results = [];
for (const testCase of cases) {{
  begins = []; sends = []; ends = [];
  let reads = 0;
  const payload = {{ get key() {{ reads++; return reads === 1 ? testCase.value : null; }} }};
  let response = null, error = null;
  try {{
    response = await module.namespace.runEvent({{ event: 'GO', payload }}, {{ id: 'u1', role: 'member' }});
  }} catch (caught) {{
    error = caught instanceof Error ? caught.message : 'non-error rejection';
  }}
  results.push({{ name: testCase.name, reads, begins, sends, ends, response, error }});
}}
process.stdout.write(JSON.stringify(results));
"#,
        source = serde_json::to_string(&handler(keyed)).unwrap(),
    );
    let output = Command::new("node")
        .args([
            "--experimental-vm-modules",
            "--input-type=module",
            "-e",
            &script,
        ])
        .output()
        .expect("Node 24 must be on PATH to execute the emitted handler");
    assert!(
        output.status.success(),
        "{script}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn dynamic_invalid_http_keys_reject_before_registering_or_sending() {
    let results = execute(
        true,
        json!([
            { "name": "number", "value": 17 },
            { "name": "null", "value": null },
            { "name": "empty", "value": "" },
            { "name": "boolean", "value": false },
            { "name": "object", "value": {} },
            { "name": "undefined" },
        ]),
    );
    let results = results.as_array().unwrap();
    assert_eq!(results.len(), 6);
    for result in results {
        assert!(result["error"].is_string(), "{results:?}");
        assert_eq!(result["response"], Value::Null, "{result}");
        assert_eq!(result["reads"], 1, "{result}");
        assert_eq!(result["begins"], json!([]), "{result}");
        assert_eq!(result["sends"], json!([]), "{result}");
        assert_eq!(result["ends"], json!([]), "{result}");
    }
}

#[test]
fn dynamic_string_http_keys_are_read_once_and_preserved_through_completion() {
    let results = execute(
        true,
        json!([
            { "name": "ordinary", "value": "request-1" },
            { "name": "unicode", "value": "طلب:ž:1" },
        ]),
    );
    let results = results.as_array().unwrap();
    assert_eq!(results.len(), 2);
    for (result, key) in results
        .iter()
        .zip(["request-1", "طلب:ž:1"])
    {
        assert_eq!(result["error"], Value::Null, "{result}");
        assert_eq!(result["reads"], 1, "{result}");
        assert_eq!(result["begins"], json!([key]), "{result}");
        assert_eq!(result["sends"], json!([key]), "{result}");
        assert_eq!(result["ends"], json!([key]), "{result}");
        assert_eq!(result["response"]["success"], true, "{result}");
        assert_eq!(
            result["response"]["effectResults"][0]["data"]["key"], key,
            "{result}"
        );
    }
}

#[test]
fn control_an_unkeyed_http_does_not_read_or_register_a_payload_key() {
    let results = execute(false, json!([{ "name": "unkeyed", "value": 17 }]));
    assert_eq!(results.as_array().unwrap().len(), 1);
    let result = &results[0];
    assert_eq!(result["error"], Value::Null, "{result}");
    assert_eq!(result["reads"], 0, "{result}");
    assert_eq!(result["begins"], json!([]), "{result}");
    assert_eq!(result["ends"], json!([]), "{result}");
    assert_eq!(result["sends"], json!([null]), "{result}");
    assert_eq!(result["response"]["success"], true, "{result}");
}

// EXEC-EVAL-6: binding-path emission and execution against the shared fixture.

fn path_handler(binding: &str) -> String {
    let mut trait_def = OirTrait::new("HttpCaller");
    trait_def.states = vec![OirState::initial("idle")];
    trait_def.events = vec![OirEvent::new("GO")];
    trait_def.transitions = vec![OirTransition::new("idle", "idle", "GO").with_effects(vec![
        OirExpr::effect(OirEffect::Http {
            method: HttpMethod::Get,
            origin: OirExpr::string("https://api.example.com"),
            path: OirExpr::string("/items"),
            request: None,
            key: Some(OirExpr::binding(
                OirBinding::parse(binding).expect("binding parses"),
            )),
            emit: None,
        }),
    ])];
    TypeScriptBackend::new().generate_trait_event_handler_text_hono(
        &trait_def,
        &OirModule::new("HttpApp", "1.0.0"),
        "http-caller",
    )
}

fn path_execute(source: &str, payload: &Value) -> Value {
    let script = format!(
        r#"
import {{ stripTypeScriptTypes }} from 'node:module';
import {{ SourceTextModule, SyntheticModule }} from 'node:vm';
const source = {source};
const payload = {payload};
let begins = [];
const unused = () => {{ throw new Error('unexpected unrelated host call'); }};
const dependencies = new Map([
  ['zod', {{ z: {{ object: () => ({{}}) }} }}],
  ['@almadar/server-hono', {{ getDataService: unused, logger: {{ debug() {{}}, error() {{}} }} }}],
  ['@almadar/core', {{ resolveEntityView: unused, omitFrameFields: unused, guardHolds: unused }}],
  ['../../../viewer.js', {{ viewerOf: unused }}],
  ['../../../services/host.js', {{
    servicePorts: unused,
    beginKeyedCall(key) {{ begins.push(key); return new AbortController(); }},
    endKeyedCall() {{}},
  }}],
  ['../../../services/clients.js', {{
    HttpCallError: class HttpCallError extends Error {{}},
    async httpCall(call) {{ return {{ status: 200, headers: {{}}, body: 'ok', key: call.key }}; }},
  }}],
]);
const module = new SourceTextModule(stripTypeScriptTypes(source));
await module.link((specifier) => {{
  const exports = dependencies.get(specifier);
  if (exports === undefined) throw new Error(`unexpected import ${{specifier}}`);
  return new SyntheticModule(Object.keys(exports), function() {{
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }});
}});
await module.evaluate();
let error = null;
try {{ await module.namespace.runEvent({{ event: 'GO', payload }}, {{ id: 'u1', role: 'member' }}); }}
catch (caught) {{ error = caught instanceof Error ? caught.message : 'non-error rejection'; }}
process.stdout.write(JSON.stringify({{ begins, error }}));
"#,
        source = serde_json::to_string(source).unwrap(),
        payload = payload,
    );
    let output = Command::new("node")
        .args(["--experimental-vm-modules", "--input-type=module", "-e", &script])
        .output()
        .expect("Node 24 must be on PATH to execute the emitted handler");
    assert!(
        output.status.success(),
        "{script}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn emission_indexes_with_a_bracket_step_for_a_dotted_number() {
    let src = path_handler("@payload.items.0.id");
    assert!(src.contains("?.[0]"), "{src}");
    assert!(!src.contains("?.0"), "{src}");
}

#[test]
fn emission_reads_a_bracket_segment_as_one_literal_key() {
    let src = path_handler("@payload.items[0].id");
    assert!(src.contains(r#"?.["items[0]"]"#), "{src}");
    let repeated = path_handler("@payload.matrix[0][0].id");
    assert!(repeated.contains(r#"?.["matrix[0][0]"]"#), "{repeated}");
}

#[test]
fn control_an_identifier_segment_keeps_the_plain_member_form() {
    let src = path_handler("@payload.obj.k");
    assert!(src.contains("?.obj"), "{src}");
    assert!(src.contains("?.k"), "{src}");
    assert!(!src.contains(r#"?.["obj"]"#), "{src}");
}

#[test]
fn every_fixture_case_executes_as_the_fixture_says() {
    let fixture: Value = serde_json::from_str(binding_path_cases()).unwrap();
    let payload = &fixture["payload"];
    for case in fixture["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let binding = case["binding"].as_str().unwrap();
        let result = path_execute(&path_handler(binding), payload);
        match case["value"].as_str() {
            Some(expected) if case["found"] == json!(true) => {
                assert_eq!(result["begins"], json!([expected]), "`{name}`: {result}");
                assert_eq!(result["error"], Value::Null, "`{name}`: {result}");
            }
            _ => {
                assert_eq!(result["begins"], json!([]), "`{name}`: {result}");
                assert!(result["error"].is_string(), "`{name}`: {result}");
            }
        }
    }
}

const COLLECTOR: &str = "https://collector.example.com";

fn beacon_module() -> OirModule {
    let mut request = OirFields::new();
    request.insert("text".into(), OirExpr::string("{\"n\":\"pageview\"}"));
    let mut trait_def = OirTrait::new("Beaconer");
    trait_def.states = vec![OirState::initial("idle")];
    trait_def.events = vec![OirEvent::new("GO")];
    trait_def.transitions = vec![OirTransition::new("idle", "idle", "GO").with_effects(vec![
        OirExpr::effect(OirEffect::BrowserBeacon {
            url: OirExpr::string(format!("{COLLECTOR}/api/event?v=1")),
            request: OirExpr::object(request),
            key: None,
            emit: None,
        }),
    ])];
    let mut module = OirModule::new("BeaconApp", "1.0.0");
    module.traits.push(trait_def);
    module.egress = vec![COLLECTOR.to_string()];
    module
}

fn generated_files(module: &OirModule) -> Vec<(String, String)> {
    use orbital_core_base::generate::Backend;
    TypeScriptBackend::default()
        .generate(module)
        .files
        .into_iter()
        .map(|f| (f.path, f.content))
        .collect()
}

/// Runs the emitted `browserHttp.ts` (its imports bound to the real runtime `dist` and the real wasm kernel) and
/// sends the beacon cases through the `browserHttp` ports it exports.
fn execute_beacon(browser_http: &str, cases: Value) -> Value {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let root = root.canonicalize().expect("monorepo root");
    let script = format!(
        r#"
import {{ stripTypeScriptTypes }} from 'node:module';
import {{ SourceTextModule, SyntheticModule }} from 'node:vm';
import {{ pathToFileURL }} from 'node:url';
import {{ readFile }} from 'node:fs/promises';
const root = {root};
const source = {source};
const cases = {cases};
const runtimeDist = (name) => import(pathToFileURL(`${{root}}/packages/almadar-runtime/dist/${{name}}`).href);
const runtimeKernel = await runtimeDist('kernel.js');
const wasmDir = `${{root}}/orbital-rust/crates/orbital-wasm/js/pkg`;
const wasm = await import(pathToFileURL(`${{wasmDir}}/orbital_wasm.js`).href);
wasm.initSync({{ module: await readFile(`${{wasmDir}}/orbital_wasm_bg.wasm`) }});
let current = null;
Object.defineProperty(globalThis, 'navigator', {{ configurable: true, value: {{ sendBeacon: (url, blob) => current.queue(url, blob) }} }});
globalThis.fetch = (url, init) => current.fetch(url, init);
const wasmExports = Object.fromEntries(Object.entries(wasm).filter(([name]) => name !== 'default'));
const dependencies = new Map([
  ['@almadar/kernel', {{ ...wasmExports, default: async () => undefined }}],
  ['@almadar/kernel/kernel.wasm?url', {{ default: 'kernel.wasm' }}],
  ['@almadar/runtime/kernel', runtimeKernel],
]);
const module = new SourceTextModule(stripTypeScriptTypes(source));
await module.link((specifier) => {{
  const exports = dependencies.get(specifier);
  if (exports === undefined) throw new Error(`unexpected import ${{specifier}}`);
  return new SyntheticModule(Object.keys(exports), function() {{
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }});
}});
await module.evaluate();
const {{ browserHttp }} = module.namespace;
const results = [];
for (const testCase of cases) {{
  const queued = [], fetched = [];
  current = {{
    queue(url, blob) {{ if (testCase.queue === 'throw') throw new Error('blocked'); queued.push(url); return testCase.queue === 'accept'; }},
    fetch(url, init) {{
      fetched.push({{ url, keepalive: init.keepalive, body: init.body }});
      if (testCase.fetch === 'hang') return new Promise(() => undefined);
      return Promise.resolve({{ status: testCase.fetch }});
    }},
  }};
  const controller = new AbortController();
  if (testCase.abort === 'before') controller.abort();
  const call = {{ method: 'POST', origin: testCase.url ?? '{collector}/api/event?v=1', path: '', request: {{ text: '{{"n":"pageview"}}' }}, delivery: 'beacon', ...(testCase.key !== undefined ? {{ key: testCase.key }} : {{}}) }};
  const running = runtimeKernel.runHttpCall(browserHttp, call, {{ signal: controller.signal }});
  if (testCase.abort === 'during') {{ await new Promise((resolve) => setTimeout(resolve, 20)); controller.abort(); }}
  let outcome = null, rejected = false;
  try {{ outcome = await running; }} catch {{ rejected = true; }}
  results.push({{ name: testCase.name, outcome, rejected, queued: queued.length, fetched }});
}}
process.stdout.write(JSON.stringify(results));
"#,
        root = serde_json::to_string(root.to_str().unwrap()).unwrap(),
        source = serde_json::to_string(browser_http).unwrap(),
        cases = cases,
        collector = COLLECTOR,
    );
    let output = Command::new("node")
        .args([
            "--experimental-vm-modules",
            "--input-type=module",
            "-e",
            &script,
        ])
        .output()
        .expect("Node 24 must be on PATH to execute the emitted browser http module");
    assert!(
        output.status.success(),
        "needs a built @almadar/runtime dist with browser/beacon\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn emitted_browser_http() -> String {
    let files = generated_files(&beacon_module());
    let (_, content) = files
        .iter()
        .find(|(path, _)| path == "packages/client/src/browserHttp.ts")
        .expect("a beacon needs the browser request driver wired");
    content.clone()
}

fn by_name<'a>(results: &'a Value, name: &str) -> &'a Value {
    results
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["name"] == name)
        .unwrap_or_else(|| panic!("no case {name}: {results}"))
}

#[test]
fn beacon_the_compiled_client_wires_the_browser_driver_and_transpiles_no_delivery_of_its_own() {
    let http = emitted_browser_http();
    assert!(http.contains(&format!("egress: ['{COLLECTOR}']")), "{http}");
    assert!(http.contains("createBrowserHttpPorts"), "{http}");
    for (path, content) in generated_files(&beacon_module()) {
        if path.starts_with("packages/client/") {
            assert!(!content.contains("sendBeacon"), "{path} delivers a beacon itself");
            assert!(!content.contains("not transpiled on the compiled client"), "{path}");
        }
    }
}

#[test]
fn beacon_control_a_program_without_one_gets_no_browser_driver() {
    let mut module = beacon_module();
    module.traits[0].transitions[0].effects = vec![OirExpr::effect(OirEffect::Log {
        level: orbital_core_base::ir::OirLogLevel::Info,
        message: OirExpr::string("hi"),
    })];
    let files = generated_files(&module);
    assert!(files.iter().all(|(path, _)| path != "packages/client/src/browserHttp.ts"));
}

#[test]
fn beacon_through_the_emitted_ports_queues_falls_back_refuses_and_cancels() {
    let results = execute_beacon(
        &emitted_browser_http(),
        json!([
            { "name": "queue", "queue": "accept", "fetch": 200, "key": "k" },
            { "name": "fallback", "queue": "decline", "fetch": 204 },
            { "name": "rejected-status", "queue": "decline", "fetch": 500 },
            { "name": "egress", "queue": "accept", "fetch": 200, "url": "https://elsewhere.example.com/e" },
            { "name": "relative", "queue": "accept", "fetch": 200, "url": "/api/event" },
            { "name": "cancel-before", "queue": "accept", "fetch": 200, "abort": "before" },
            { "name": "cancel-during", "queue": "decline", "fetch": "hang", "abort": "during" },
        ]),
    );
    let queue = by_name(&results, "queue");
    assert_eq!(queue["outcome"], json!({ "ok": { "sent": true, "via": "queue", "status": null, "key": "k" } }), "{queue}");
    assert_eq!(queue["fetched"], json!([]));
    let fallback = by_name(&results, "fallback");
    assert_eq!(fallback["outcome"], json!({ "ok": { "sent": true, "via": "fetch", "status": 204, "key": null } }), "{fallback}");
    assert_eq!(fallback["fetched"].as_array().unwrap().len(), 1);
    assert_eq!(fallback["fetched"][0]["keepalive"], true);
    assert_eq!(
        by_name(&results, "rejected-status")["outcome"],
        json!({ "ok": { "sent": false, "via": "fetch", "status": 500, "key": null } })
    );
    for name in ["egress", "relative"] {
        let refused = by_name(&results, name);
        assert_eq!(refused["outcome"]["error"]["kind"], "refused", "{refused}");
        assert_eq!(refused["queued"], 0, "{refused}");
        assert_eq!(refused["fetched"], json!([]), "{refused}");
    }
    let before = by_name(&results, "cancel-before");
    assert_eq!((before["rejected"].clone(), before["queued"].clone(), before["fetched"].clone()), (json!(true), json!(0), json!([])));
    let during = by_name(&results, "cancel-during");
    assert_eq!(during["rejected"], true, "{during}");
    assert_eq!(during["fetched"].as_array().unwrap().len(), 1, "the fetch the browser already has is not aborted");
}
