use orbital_core_base::generate::{Backend, GeneratedOutput};
use orbital_core_base::ir::{
    OirBinaryOp, OirBinding, OirBindingRoot, OirEffect, OirEntity, OirEvent, OirExpr, OirField,
    OirFields, OirInterval, OirModule, OirPattern, OirPersistence, OirState, OirTick, OirTrait,
    OirTransition, OirType, OirValue,
};
use orbital_shell_typescript::{ServerFramework, TypeScriptBackend};
use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Copy)]
enum Location {
    TransitionGuard,
    Effect,
    TickEffect,
    TickGuard,
    Plain,
}

fn input() -> OirExpr {
    OirExpr::binding(OirBinding::new(
        OirBindingRoot::Payload,
        vec!["body".into()],
    ))
}

fn valid(value: OirExpr) -> OirExpr {
    OirExpr::call("xml/valid", vec![value])
}

fn parse(value: OirExpr) -> OirExpr {
    OirExpr::call("xml/parse", vec![value, OirExpr::string("Row")])
}

fn nested_guard(value: OirExpr) -> OirExpr {
    OirExpr::if_then_else(OirExpr::bool(true), valid(value), OirExpr::bool(false))
}

fn parsed_emit(event: &str, value: OirExpr) -> OirExpr {
    let mut payload = OirFields::new();
    payload.insert("parsed".into(), parse(value));
    OirExpr::effect(OirEffect::emit_with_payload(
        event,
        OirExpr::object(payload),
    ))
}

fn module(location: Location, shared: bool) -> OirModule {
    let mut entity = OirEntity::new("XmlState");
    entity.persistence = OirPersistence::Runtime;
    entity.shared = shared;
    entity.fields = vec![
        OirField::new("id", OirType::String),
        OirField::new("text", OirType::String),
    ];
    let mut trait_def = OirTrait::new("XmlProbe");
    trait_def.orbital_name = "XmlApp".into();
    trait_def.linked_entity = Some(entity.name.clone());
    trait_def.states = vec![OirState::initial("idle")];
    trait_def.events = vec![OirEvent::new("GO")];
    let mut transition = OirTransition::new("idle", "idle", "GO");
    match location {
        Location::TransitionGuard => transition.guard = Some(nested_guard(input())),
        Location::Effect => {
            transition.effects = vec![parsed_emit("XML_PARSED", input())];
        }
        Location::TickEffect | Location::TickGuard => {
            let mut tick = OirTick::new("parseClock", OirInterval::Milliseconds { value: 1000 });
            tick.effects = vec![OirExpr::effect(OirEffect::set(
                OirBinding::new(OirBindingRoot::Entity, vec!["text".into()]),
                if matches!(location, Location::TickEffect) {
                    parse(OirExpr::string("<a>tick</a>"))
                } else {
                    OirExpr::string("tick")
                },
            ))];
            if matches!(location, Location::TickGuard) {
                tick.guard = Some(nested_guard(OirExpr::string("<a/>")));
            }
            trait_def.ticks.push(tick);
        }
        Location::Plain => {
            transition.effects = vec![OirExpr::effect(OirEffect::set(
                OirBinding::new(OirBindingRoot::Entity, vec!["text".into()]),
                OirExpr::string("plain"),
            ))]
        }
    }
    trait_def.transitions = vec![transition];
    let mut module = OirModule::new("XmlApp", "1.0.0");
    module.entities.push(entity);
    module.traits.push(trait_def);
    module
}

fn generate(module: &OirModule, framework: ServerFramework) -> GeneratedOutput {
    TypeScriptBackend {
        server_framework: framework,
        ..TypeScriptBackend::default()
    }
    .generate(module)
}

fn file<'a>(output: &'a GeneratedOutput, path: &str) -> &'a str {
    output
        .files
        .iter()
        .find(|file| file.path == path)
        .map(|file| file.content.as_str())
        .unwrap_or_else(|| panic!("{path} was not generated"))
}

fn core_value_symbols(source: &str) -> Vec<&str> {
    source
        .lines()
        .filter_map(|line| {
            line.strip_prefix("import { ")
                .and_then(|line| line.strip_suffix(" } from '@almadar/core';"))
        })
        .flat_map(|clause| clause.split(',').map(str::trim))
        .collect()
}

#[test]
fn generated_server_files_and_both_real_client_hook_paths_import_xml_automatically() {
    for framework in [ServerFramework::Express, ServerFramework::Hono] {
        for shared in [false, true] {
            for location in [
                Location::TransitionGuard,
                Location::Effect,
                Location::TickEffect,
                Location::TickGuard,
                Location::Plain,
            ] {
                let output = generate(&module(location, shared), framework);
                let handler = file(
                    &output,
                    "packages/server/src/routes/features/xml-probe/handlers.ts",
                );
                let hook = file(
                    &output,
                    "packages/client/src/hooks/traits/useXmlProbeLogic.tsx",
                );
                let view = file(
                    &output,
                    "packages/client/src/components/traits/XmlProbeView.tsx",
                );
                let view_imports = core_value_symbols(view);
                assert!(
                    !view_imports.contains(&"xmlValid") && !view_imports.contains(&"parseXml"),
                    "non-render XML must not leak imports into a view:\n{view}"
                );
                assert_eq!(
                    hook.contains("[shared]-entity logic hook."),
                    shared,
                    "wrong hook path for {framework:?}, {location:?}, shared={shared}:\n{hook}"
                );
                for (path, source) in [("server", handler), ("client", hook)] {
                    let imports = core_value_symbols(source);
                    for (symbol, required) in [
                        (
                            "xmlValid",
                            matches!(location, Location::TransitionGuard | Location::TickGuard),
                        ),
                        (
                            "parseXml",
                            matches!(location, Location::Effect | Location::TickEffect),
                        ),
                    ] {
                        assert_eq!(
                            imports.iter().filter(|import| **import == symbol).count(),
                            usize::from(required),
                            "{framework:?}, {location:?}, shared={shared}, {path}: missing, duplicate or unnecessary {symbol} value import:\n{source}"
                        );
                    }
                    assert!(
                        !source.contains("function parseTree("),
                        "{path} must consume the core owner, not embed a parser:\n{source}"
                    );
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum RenderLocation {
    Valid,
    Parse,
    Both,
    Plain,
}

fn render_effect(content: &str) -> OirExpr {
    OirExpr::effect(OirEffect::render_ui(
        "main",
        OirPattern::new("typography").with_config("content", OirValue::String(content.into())),
    ))
}

fn parsed_condition() -> OirExpr {
    OirExpr::BinaryOp {
        op: OirBinaryOp::Eq,
        left: Box::new(parse(OirExpr::string("<a>shown</a>"))),
        right: Box::new(parse(OirExpr::string("<b>shown</b>"))),
    }
}

fn render_conditional(condition: OirExpr) -> OirExpr {
    OirExpr::if_then_else(condition, render_effect("shown"), render_effect("hidden"))
}

#[derive(Debug, Clone, Copy)]
struct CodecCase {
    event: &'static str,
    operator: &'static str,
    prefix: &'static [&'static str],
    suffix: &'static [&'static str],
    input: &'static str,
    expected: &'static str,
    imports: &'static [&'static str],
}

const CODEC_CASES: [CodecCase; 5] = [
    CodecCase {
        event: "URI",
        operator: "str/encode-uri-component",
        prefix: &[],
        suffix: &[],
        input: "a b/é",
        expected: "a%20b%2F%C3%A9",
        imports: &["encodeUriComponent"],
    },
    CodecCase {
        event: "BASE64_ENCODE",
        operator: "base64/encode",
        prefix: &[],
        suffix: &[],
        input: "foo",
        expected: "Zm9v",
        imports: &["encodeBase64"],
    },
    CodecCase {
        event: "BASE64_DECODE",
        operator: "base64/decode",
        prefix: &[],
        suffix: &[],
        input: "Zm9v",
        expected: "foo",
        imports: &["decodeBase64"],
    },
    CodecCase {
        event: "SHA256",
        operator: "hash/sha256",
        prefix: &[],
        suffix: &["hex"],
        input: "abc",
        expected: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        imports: &["utf8Bytes", "sha256Bytes", "encodeDigest", "CodecError"],
    },
    CodecCase {
        event: "HMAC_SHA256",
        operator: "hmac/sha256",
        prefix: &["key"],
        suffix: &["hex"],
        input: "The quick brown fox jumps over the lazy dog",
        expected: "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
        imports: &["utf8Bytes", "hmacSha256Bytes", "encodeDigest", "CodecError"],
    },
];

const CODEC_SYMBOLS: [&str; 11] = [
    "base64EncodeBytes",
    "base64DecodeBytes",
    "sha256Bytes",
    "hmacSha256Bytes",
    "encodeUriComponent",
    "encodeBase64",
    "decodeBase64",
    "hashSha256",
    "hmacSha256",
    "utf8Bytes",
    "encodeDigest",
];

impl CodecCase {
    fn expression(self, value: OirExpr) -> OirExpr {
        let mut args: Vec<OirExpr> = self
            .prefix
            .iter()
            .map(|value| OirExpr::string(*value))
            .collect();
        args.push(value);
        args.extend(self.suffix.iter().map(|value| OirExpr::string(*value)));
        OirExpr::call(self.operator, args)
    }

    fn predicate(self, value: OirExpr) -> OirExpr {
        OirExpr::if_then_else(
            OirExpr::bool(true),
            OirExpr::BinaryOp {
                op: OirBinaryOp::Eq,
                left: Box::new(self.expression(value)),
                right: Box::new(OirExpr::string(self.expected)),
            },
            OirExpr::bool(false),
        )
    }
}

fn codec_emit(case: CodecCase, value: OirExpr) -> OirExpr {
    let mut payload = OirFields::new();
    payload.insert("value".into(), case.expression(value));
    OirExpr::effect(OirEffect::emit_with_payload(
        "CODEC_RESULT",
        OirExpr::object(payload),
    ))
}

fn codec_module(case: CodecCase, location: Location, shared: bool) -> OirModule {
    let mut probe = module(Location::Plain, shared);
    match location {
        Location::TransitionGuard => {
            probe.traits[0].transitions[0].guard = Some(case.predicate(input()));
        }
        Location::Effect => {
            probe.traits[0].transitions[0].effects = vec![codec_emit(case, input())];
        }
        Location::TickEffect | Location::TickGuard => {
            let mut tick = OirTick::new("codecClock", OirInterval::Milliseconds { value: 1000 });
            tick.effects = vec![OirExpr::effect(OirEffect::set(
                OirBinding::new(OirBindingRoot::Entity, vec!["text".into()]),
                if matches!(location, Location::TickEffect) {
                    case.expression(OirExpr::string(case.input))
                } else {
                    OirExpr::string("plain")
                },
            ))];
            if matches!(location, Location::TickGuard) {
                tick.guard = Some(case.predicate(OirExpr::string(case.input)));
            }
            probe.traits[0].ticks.push(tick);
        }
        Location::Plain => {}
    }
    probe
}

fn assert_codec_imports(source: &str, required: &[&str], context: &str) {
    let imports = core_value_symbols(source);
    for symbol in CODEC_SYMBOLS.into_iter().chain(["CodecError"]) {
        assert_eq!(
            imports.iter().filter(|import| **import == symbol).count(),
            usize::from(required.contains(&symbol)),
            "{context}: missing, duplicate or unnecessary codec value import {symbol}:\n{source}"
        );
    }
}

#[test]
fn all_five_codec_operators_import_automatically_in_servers_and_both_hook_paths() {
    for framework in [ServerFramework::Express, ServerFramework::Hono] {
        for shared in [false, true] {
            for case in CODEC_CASES {
                for location in [
                    Location::TransitionGuard,
                    Location::Effect,
                    Location::TickEffect,
                    Location::TickGuard,
                    Location::Plain,
                ] {
                    let output = generate(&codec_module(case, location, shared), framework);
                    let handler = file(
                        &output,
                        "packages/server/src/routes/features/xml-probe/handlers.ts",
                    );
                    let hook = file(
                        &output,
                        "packages/client/src/hooks/traits/useXmlProbeLogic.tsx",
                    );
                    let view = file(
                        &output,
                        "packages/client/src/components/traits/XmlProbeView.tsx",
                    );
                    assert_eq!(
                        hook.contains("[shared]-entity logic hook."),
                        shared,
                        "{hook}"
                    );
                    let required = if matches!(location, Location::Plain) {
                        &[][..]
                    } else {
                        case.imports
                    };
                    for (path, source) in [("server", handler), ("client", hook)] {
                        assert_codec_imports(
                            source,
                            required,
                            &format!(
                                "{framework:?}, shared={shared}, {}, {location:?}, {path}",
                                case.operator
                            ),
                        );
                    }
                    assert_codec_imports(
                        view,
                        &[],
                        "codec used outside rendering must not leak into view imports",
                    );
                }
            }
        }
    }
}

#[test]
fn all_five_codec_render_conditions_and_nested_calls_import_without_plain_view_leaks() {
    for framework in [ServerFramework::Express, ServerFramework::Hono] {
        for shared in [false, true] {
            for case in CODEC_CASES {
                let mut probe = module(Location::Plain, shared);
                probe.traits[0].transitions[0].effects = vec![render_conditional(
                    case.predicate(OirExpr::string(case.input)),
                )];
                let mut plain = probe.traits[0].clone();
                plain.name = "PlainRender".into();
                plain.transitions[0].effects = vec![render_conditional(OirExpr::bool(true))];
                probe.traits.push(plain);
                let output = generate(&probe, framework);
                let view = file(
                    &output,
                    "packages/client/src/components/traits/XmlProbeView.tsx",
                );
                assert_codec_imports(
                    view,
                    case.imports,
                    &format!("render {framework:?}, shared={shared}, {}", case.operator),
                );
                assert!(
                    case.imports
                        .iter()
                        .filter(|symbol| **symbol != "CodecError")
                        .all(|symbol| view.contains(&format!("{symbol}("))),
                    "rendered codec calls must survive in the real view:\n{view}"
                );
                assert_codec_imports(
                    file(
                        &output,
                        "packages/client/src/components/traits/PlainRenderView.tsx",
                    ),
                    &[],
                    "codec render accumulator must not leak into later plain view",
                );
            }
            let mut nested = module(Location::Plain, shared);
            let expression = OirExpr::call(
                "base64/decode",
                vec![OirExpr::call(
                    "base64/encode",
                    vec![OirExpr::call(
                        "str/encode-uri-component",
                        vec![OirExpr::string("a b")],
                    )],
                )],
            );
            nested.traits[0].transitions[0].effects = vec![render_conditional(OirExpr::BinaryOp {
                op: OirBinaryOp::Eq,
                left: Box::new(expression),
                right: Box::new(OirExpr::string("a%20b")),
            })];
            let output = generate(&nested, framework);
            assert_codec_imports(
                file(
                    &output,
                    "packages/client/src/components/traits/XmlProbeView.tsx",
                ),
                &["decodeBase64", "encodeBase64", "encodeUriComponent"],
                "nested render operators must collect every required core value exactly once",
            );
        }
    }
}

#[test]
fn rendered_xml_conditions_import_each_core_value_once_without_leaking_to_plain_views() {
    for framework in [ServerFramework::Express, ServerFramework::Hono] {
        for shared in [false, true] {
            for location in [
                RenderLocation::Valid,
                RenderLocation::Parse,
                RenderLocation::Both,
                RenderLocation::Plain,
            ] {
                let condition = match location {
                    RenderLocation::Valid => OirExpr::if_then_else(
                        valid(OirExpr::string("<a/>")),
                        valid(OirExpr::string("<b/>")),
                        OirExpr::bool(false),
                    ),
                    RenderLocation::Parse => parsed_condition(),
                    RenderLocation::Both => OirExpr::if_then_else(
                        valid(OirExpr::string("<a/>")),
                        parsed_condition(),
                        OirExpr::bool(false),
                    ),
                    RenderLocation::Plain => OirExpr::bool(true),
                };
                let mut module = module(Location::Plain, shared);
                module.traits[0].transitions[0].effects = vec![render_conditional(condition)];
                let mut plain = module.traits[0].clone();
                plain.name = "PlainRender".into();
                plain.transitions[0].effects = vec![render_conditional(OirExpr::bool(true))];
                module.traits.push(plain);
                let output = generate(&module, framework);
                let view = file(
                    &output,
                    "packages/client/src/components/traits/XmlProbeView.tsx",
                );
                let imports = core_value_symbols(view);
                for (symbol, required) in [
                    (
                        "xmlValid",
                        matches!(location, RenderLocation::Valid | RenderLocation::Both),
                    ),
                    (
                        "parseXml",
                        matches!(location, RenderLocation::Parse | RenderLocation::Both),
                    ),
                ] {
                    assert_eq!(
                        imports.iter().filter(|import| **import == symbol).count(),
                        usize::from(required),
                        "render {framework:?}, {location:?}, shared={shared}: missing, duplicate or unnecessary {symbol}:\n{view}"
                    );
                    assert_eq!(
                        view.contains(&format!("{symbol}(")),
                        required,
                        "rendered XML expression must survive in the actual view:\n{view}"
                    );
                }
                let plain_view = file(
                    &output,
                    "packages/client/src/components/traits/PlainRenderView.tsx",
                );
                let plain_imports = core_value_symbols(plain_view);
                assert!(
                    !plain_imports.contains(&"xmlValid") && !plain_imports.contains(&"parseXml"),
                    "view import accumulator leaked into a later plain sibling:\n{plain_view}"
                );
            }
        }
    }
}

fn executable_module() -> OirModule {
    let mut trait_def = OirTrait::new("XmlExec");
    trait_def.orbital_name = "XmlApp".into();
    trait_def.states = vec![OirState::initial("idle")];
    trait_def.events = vec![OirEvent::new("GO"), OirEvent::new("PARSE")];
    trait_def.transitions = vec![
        OirTransition::new("idle", "idle", "GO")
            .with_guard(nested_guard(input()))
            .with_effects(vec![parsed_emit("XML_PARSED", input())]),
        OirTransition::new("idle", "idle", "PARSE")
            .with_effects(vec![parsed_emit("XML_PARSED", input())]),
    ];
    let mut tick = OirTick::new("parseClock", OirInterval::Milliseconds { value: 1000 });
    tick.background = true;
    tick.effects = vec![parsed_emit("XML_TICK", OirExpr::string("<a>tick</a>"))];
    trait_def.ticks.push(tick);
    let mut module = OirModule::new("XmlApp", "1.0.0");
    module.traits.push(trait_def);
    module
}

fn execute_handler(framework: ServerFramework, source: &str, body: &str) -> Value {
    let script = format!(
        r#"
import {{ stripTypeScriptTypes }} from 'node:module';
import {{ SourceTextModule, SyntheticModule }} from 'node:vm';
const core = await import('@almadar/core');
const source = {source};
let events = [];
const unused = () => {{ throw new Error('unexpected unrelated host call'); }};
const logger = {{ debug() {{}}, info() {{}}, warn() {{}}, error() {{}} }};
const server = {{
  getDataService: unused,
  getServerEventBus: () => ({{ emit(event, payload) {{ events.push({{ event, payload }}); }} }}),
  logger,
  createLogger: () => logger,
}};
const dependencies = new Map([
  ['@almadar/core', core],
  ['zod', {{ z: {{ object: () => ({{}}) }} }}],
  ['@almadar/server', server],
  ['@almadar/server-hono', server],
  ['../../../viewer.js', {{ viewerOf: unused }}],
  ['../../../mounts.js', {{ recordMount: unused }}],
]);
const generated = new SourceTextModule(stripTypeScriptTypes(source));
await generated.link((specifier) => {{
  const exports = dependencies.get(specifier);
  if (exports === undefined) throw new Error(`unexpected import ${{specifier}}`);
  return new SyntheticModule(Object.keys(exports), function() {{
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }});
}});
await generated.evaluate();
{body}
"#,
        source = serde_json::to_string(source).unwrap(),
    );
    let mut child = Command::new("node")
        .args(["--experimental-vm-modules", "--input-type=module", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Node 24 and installed @almadar/core are required");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(script.as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{framework:?}:\n{script}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn execute(framework: ServerFramework) -> Value {
    let output = generate(&executable_module(), framework);
    let source = file(
        &output,
        "packages/server/src/routes/features/xml-exec/handlers.ts",
    );
    execute_handler(
        framework,
        source,
        r#"
const results = [];
for (const body of ['<r><name>Ada</name></r>', '<r/>', '<r>0</r>', '<r>', 17]) {
  events = [];
  let response = null, error = null;
  try { response = await generated.namespace.runEvent({ event: 'GO', payload: { body } }, { id: 'alice', role: 'member' }); }
  catch (caught) { error = caught instanceof Error ? caught.message : 'non-error rejection'; }
  results.push({ response, error, events });
}
events = [];
const tick = await generated.namespace.runTickParseclock(1000);
const tickEvents = events;
const parseResults = [];
for (const body of [17, '<r>', '<r/>']) {
  events = [];
  let response = null, error = null;
  try { response = await generated.namespace.runEvent({ event: 'PARSE', payload: { body } }, { id: 'alice' }); }
  catch (caught) { error = caught instanceof Error ? caught.message : 'non-error rejection'; }
  parseResults.push({ response, error, events });
}
events = [];
const failure = new Error('unexpected XML dependency defect');
const original = String.fromCodePoint;
let preserved = false;
let guardFaultResponse = null, guardFaultPreserved = false;
String.fromCodePoint = () => { throw failure; };
try { guardFaultResponse = await generated.namespace.runEvent({ event: 'GO', payload: { body: '<r>&#65;</r>' } }, { id: 'alice' }); }
catch (caught) { guardFaultPreserved = caught === failure; }
const guardFaultEvents = events;
events = [];
try { await generated.namespace.runEvent({ event: 'PARSE', payload: { body: '<r>&#65;</r>' } }, { id: 'alice' }); }
catch (caught) { preserved = caught === failure; }
finally { String.fromCodePoint = original; }
process.stdout.write(JSON.stringify({ results, tick, tickEvents, parseResults, guardFaultResponse, guardFaultPreserved, guardFaultEvents, preserved, faultEvents: events }));
"#,
    )
}

fn codec_executable_module() -> OirModule {
    let mut probe = executable_module();
    let trait_def = &mut probe.traits[0];
    trait_def.events.clear();
    trait_def.transitions.clear();
    trait_def.ticks.clear();
    for case in CODEC_CASES {
        trait_def.events.push(OirEvent::new(case.event));
        trait_def.transitions.push(
            OirTransition::new("idle", "idle", case.event)
                .with_effects(vec![codec_emit(case, input())]),
        );
        let guard_event = format!("GUARD_{}", case.event);
        trait_def.events.push(OirEvent::new(&guard_event));
        let mut payload = OirFields::new();
        payload.insert("operator".into(), OirExpr::string(case.operator));
        trait_def.transitions.push(
            OirTransition::new("idle", "idle", guard_event)
                .with_guard(case.predicate(input()))
                .with_effects(vec![OirExpr::effect(OirEffect::emit_with_payload(
                    "CODEC_ALLOWED",
                    OirExpr::object(payload),
                ))]),
        );
    }
    let mut tick = OirTick::new("codecClock", OirInterval::Milliseconds { value: 1000 });
    tick.background = true;
    tick.effects = CODEC_CASES
        .into_iter()
        .map(|case| codec_emit(case, OirExpr::string(case.input)))
        .collect();
    trait_def.ticks.push(tick);
    probe
}

#[test]
fn automatically_imported_codecs_link_and_run_in_both_generated_server_frameworks() {
    let cases: Vec<Value> = CODEC_CASES
        .iter()
        .map(|case| json!({ "event": case.event, "input": case.input, "expected": case.expected }))
        .collect();
    let body = format!(
        r#"
const cases = {cases};
const results = [];
for (const testCase of cases) {{
  const runs = [];
  for (const [event, body] of [[testCase.event, testCase.input], [`GUARD_${{testCase.event}}`, testCase.input], [testCase.event, 17], [`GUARD_${{testCase.event}}`, 17], [testCase.event, '\ud800']]) {{
    events = [];
    let response = null, error = null;
    try {{ response = await generated.namespace.runEvent({{ event, payload: {{ body }} }}, {{ id: 'alice', role: 'member' }}); }}
    catch (caught) {{ error = caught instanceof Error ? caught.message : 'non-error rejection'; }}
    runs.push({{ response, error, events }});
  }}
  results.push(runs);
}}
events = [];
const tick = await generated.namespace.runTickCodecclock(1000);
const tickEvents = events;
events = [];
const failure = new Error('unexpected generated codec dependency defect');
const original = TextEncoder.prototype.encode;
let preserved = false;
TextEncoder.prototype.encode = () => {{ throw failure; }};
try {{ await generated.namespace.runEvent({{ event: 'URI', payload: {{ body: ' ' }} }}, {{ id: 'alice' }}); }}
catch (caught) {{ preserved = caught === failure; }}
finally {{ TextEncoder.prototype.encode = original; }}
process.stdout.write(JSON.stringify({{ results, tick, tickEvents, preserved, faultEvents: events }}));
"#,
        cases = serde_json::to_string(&cases).unwrap(),
    );
    for framework in [ServerFramework::Express, ServerFramework::Hono] {
        let output = generate(&codec_executable_module(), framework);
        let source = file(
            &output,
            "packages/server/src/routes/features/xml-exec/handlers.ts",
        );
        let actual = execute_handler(framework, source, &body);
        let results = actual["results"].as_array().unwrap();
        assert_eq!(results.len(), CODEC_CASES.len(), "{framework:?}: {actual}");
        for (case, runs) in CODEC_CASES.iter().zip(results) {
            let runs = runs.as_array().unwrap();
            assert_eq!(runs.len(), 5, "{}: {runs:?}", case.operator);
            assert_eq!(runs[0]["error"], Value::Null, "{}: {runs:?}", case.operator);
            assert_eq!(
                runs[0]["response"]["transitioned"], true,
                "{}: {runs:?}",
                case.operator
            );
            assert_eq!(
                runs[0]["response"]["emittedEvents"][0]["payload"]["value"], case.expected,
                "{}: {runs:?}",
                case.operator
            );
            assert_eq!(
                runs[0]["events"],
                json!([{ "event": "CODEC_RESULT", "payload": { "value": case.expected } }]),
                "{}: {runs:?}",
                case.operator
            );
            assert_eq!(runs[1]["error"], Value::Null, "{}: {runs:?}", case.operator);
            assert_eq!(
                runs[1]["response"]["transitioned"], true,
                "{}: {runs:?}",
                case.operator
            );
            assert_eq!(
                runs[1]["events"],
                json!([{ "event": "CODEC_ALLOWED", "payload": { "operator": case.operator } }]),
                "{}: {runs:?}",
                case.operator
            );
            for index in [2, 4] {
                assert!(
                    runs[index]["error"].is_string(),
                    "{}: {runs:?}",
                    case.operator
                );
                assert_eq!(
                    runs[index]["response"],
                    Value::Null,
                    "{}: {runs:?}",
                    case.operator
                );
                assert_eq!(
                    runs[index]["events"],
                    json!([]),
                    "{}: {runs:?}",
                    case.operator
                );
            }
            assert_eq!(runs[3]["error"], Value::Null, "{}: {runs:?}", case.operator);
            assert_eq!(
                runs[3]["response"]["transitioned"], false,
                "{}: {runs:?}",
                case.operator
            );
            assert_eq!(runs[3]["events"], json!([]), "{}: {runs:?}", case.operator);
        }
        let tick = actual["tick"].as_array().unwrap();
        let tick_events = actual["tickEvents"].as_array().unwrap();
        assert_eq!(tick.len(), CODEC_CASES.len(), "{framework:?}: {actual}");
        assert_eq!(
            tick_events.len(),
            CODEC_CASES.len(),
            "{framework:?}: {actual}"
        );
        for (index, case) in CODEC_CASES.iter().enumerate() {
            assert_eq!(
                tick[index]["payload"]["value"], case.expected,
                "{framework:?}: {actual}"
            );
            assert_eq!(
                tick_events[index],
                json!({ "event": "CODEC_RESULT", "payload": { "value": case.expected } }),
                "{framework:?}: {actual}"
            );
        }
        assert_eq!(actual["preserved"], true, "{framework:?}: {actual}");
        assert_eq!(actual["faultEvents"], json!([]), "{framework:?}: {actual}");
    }
}

#[derive(Debug, Clone, Copy)]
enum CallbackSource {
    ChainedCall,
    BindingCall,
    CanonicalExpr,
}

#[derive(Debug, Clone, Copy)]
enum CallbackCase {
    Plain,
    Xml,
    Codec(CodecCase),
}

fn local(name: &str) -> OirExpr {
    OirExpr::binding(OirBinding::new(OirBindingRoot::Local(name.into()), vec![]))
}

fn callback_body(case: CallbackCase, map: bool, value: OirExpr) -> OirExpr {
    match case {
        CallbackCase::Plain => {
            if map {
                value
            } else {
                OirExpr::bool(true)
            }
        }
        CallbackCase::Xml => OirExpr::if_then_else(
            valid(value.clone()),
            if map {
                parse(value)
            } else {
                OirExpr::BinaryOp {
                    op: OirBinaryOp::Eq,
                    left: Box::new(parse(value)),
                    right: Box::new(OirExpr::string("shown")),
                }
            },
            if map {
                OirExpr::string("")
            } else {
                OirExpr::bool(false)
            },
        ),
        CallbackCase::Codec(case) => {
            if map {
                OirExpr::if_then_else(
                    OirExpr::bool(true),
                    case.expression(value),
                    OirExpr::string(""),
                )
            } else {
                case.predicate(value)
            }
        }
    }
}

fn nested_callback_body(case: CallbackCase, map: bool) -> OirExpr {
    OirExpr::call(
        "array/first",
        vec![OirExpr::call(
            "array/map",
            vec![
                OirExpr::call(
                    "array/concat",
                    vec![OirExpr::array(vec![local("item")]), OirExpr::array(vec![])],
                ),
                OirExpr::Lambda {
                    params: vec!["inner".into()],
                    body: Box::new(callback_body(case, map, local("inner"))),
                },
            ],
        )],
    )
}

fn callback_collection(
    source: CallbackSource,
    case: CallbackCase,
    map: bool,
    nested: bool,
) -> OirExpr {
    let binding = OirExpr::binding(OirBinding::new(
        OirBindingRoot::Entity,
        vec!["items".into()],
    ));
    let body = if nested {
        nested_callback_body(case, map)
    } else {
        callback_body(case, map, local("item"))
    };
    match source {
        CallbackSource::CanonicalExpr => {
            if map {
                OirExpr::Map {
                    source: Box::new(binding),
                    variable: "item".into(),
                    body: Box::new(body),
                }
            } else {
                OirExpr::Filter {
                    source: Box::new(binding),
                    variable: "item".into(),
                    predicate: Box::new(body),
                }
            }
        }
        CallbackSource::BindingCall | CallbackSource::ChainedCall => {
            let source = if matches!(source, CallbackSource::ChainedCall) {
                OirExpr::call(
                    "array/filter",
                    vec![
                        binding,
                        OirExpr::Lambda {
                            params: vec!["sourceItem".into()],
                            body: Box::new(OirExpr::bool(true)),
                        },
                    ],
                )
            } else {
                binding
            };
            OirExpr::call(
                if map { "array/map" } else { "array/filter" },
                vec![
                    source,
                    OirExpr::Lambda {
                        params: vec!["item".into()],
                        body: Box::new(body),
                    },
                ],
            )
        }
    }
}

fn assert_callback_render_imports(sources: &[CallbackSource], nested: bool) {
    let mut cases = vec![CallbackCase::Plain, CallbackCase::Xml];
    cases.extend(CODEC_CASES.into_iter().map(CallbackCase::Codec));
    for framework in [ServerFramework::Express, ServerFramework::Hono] {
        for shared in [false, true] {
            for map in [true, false] {
                for source in sources {
                    for case in &cases {
                        let mut probe = module(Location::Plain, shared);
                        probe.entities[0]
                            .fields
                            .push(OirField::new("items", OirType::array(OirType::String)));
                        let collection = callback_collection(*source, *case, map, nested);
                        probe.traits[0].transitions[0].effects =
                            vec![render_conditional(OirExpr::BinaryOp {
                                op: OirBinaryOp::Gt,
                                left: Box::new(OirExpr::call("array/len", vec![collection])),
                                right: Box::new(OirExpr::number(0.0)),
                            })];
                        let mut plain = probe.traits[0].clone();
                        plain.name = "PlainRender".into();
                        plain.transitions[0].effects =
                            vec![render_conditional(OirExpr::bool(true))];
                        probe.traits.push(plain);
                        let output = generate(&probe, framework);
                        let view = file(
                            &output,
                            "packages/client/src/components/traits/XmlProbeView.tsx",
                        );
                        let context = format!("{framework:?}, shared={shared}, map={map}, {source:?}, {case:?}, nested={nested}");
                        assert!(
                            view.contains(if map { ".map(" } else { ".filter(" }),
                            "callback was dropped for {context}:\n{view}"
                        );
                        let codec_required = match case {
                            CallbackCase::Codec(case) => case.imports,
                            _ => &[],
                        };
                        assert_codec_imports(view, codec_required, &context);
                        for symbol in codec_required
                            .iter()
                            .filter(|symbol| **symbol != "CodecError")
                        {
                            assert!(
                                view.contains(&format!("{symbol}(")),
                                "callback helper {symbol} was not emitted for {context}:\n{view}"
                            );
                        }
                        let imports = core_value_symbols(view);
                        for symbol in ["xmlValid", "parseXml"] {
                            let required = matches!(case, CallbackCase::Xml);
                            assert_eq!(
                                imports.iter().filter(|import| **import == symbol).count(),
                                usize::from(required),
                                "missing, duplicate or unnecessary {symbol} for {context}:\n{view}"
                            );
                            assert_eq!(
                                view.contains(&format!("{symbol}(")),
                                required,
                                "callback helper emission differs for {context}:\n{view}"
                            );
                        }
                        let plain_view = file(
                            &output,
                            "packages/client/src/components/traits/PlainRenderView.tsx",
                        );
                        assert_codec_imports(
                            plain_view,
                            &[],
                            "callback imports must not leak into a later plain view",
                        );
                        let plain_imports = core_value_symbols(plain_view);
                        assert!(!plain_imports.contains(&"xmlValid") && !plain_imports.contains(&"parseXml"), "XML callback imports leaked into plain view for {context}:\n{plain_view}");
                    }
                }
            }
        }
    }
}

#[test]
fn ordinary_binding_and_canonical_render_callbacks_preserve_xml_and_codec_imports() {
    assert_callback_render_imports(
        &[CallbackSource::BindingCall, CallbackSource::CanonicalExpr],
        false,
    );
}

#[test]
fn chained_call_source_render_callbacks_preserve_xml_and_codec_imports() {
    assert_callback_render_imports(&[CallbackSource::ChainedCall], false);
}

#[test]
fn nested_render_callbacks_preserve_xml_and_codec_imports_through_every_source_form() {
    assert_callback_render_imports(
        &[
            CallbackSource::ChainedCall,
            CallbackSource::BindingCall,
            CallbackSource::CanonicalExpr,
        ],
        true,
    );
}

#[test]
fn automatically_imported_xml_links_and_runs_in_both_generated_server_frameworks() {
    for framework in [ServerFramework::Express, ServerFramework::Hono] {
        let actual = execute(framework);
        let results = actual["results"].as_array().unwrap();
        assert_eq!(results.len(), 5, "{framework:?}: {actual}");
        for (result, parsed) in
            results
                .iter()
                .take(3)
                .zip([json!({ "name": "Ada" }), json!(""), json!("0")])
        {
            assert_eq!(result["error"], Value::Null, "{framework:?}: {result}");
            assert_eq!(
                result["response"]["transitioned"], true,
                "{framework:?}: {result}"
            );
            assert_eq!(
                result["response"]["emittedEvents"][0]["payload"]["parsed"], parsed,
                "{framework:?}: {result}"
            );
            assert_eq!(
                result["events"],
                json!([{ "event": "XML_PARSED", "payload": { "parsed": parsed } }]),
                "{framework:?}: {result}"
            );
        }
        assert_eq!(results[3]["error"], Value::Null, "{framework:?}: {actual}");
        assert_eq!(
            results[3]["response"]["transitioned"], false,
            "{framework:?}: {actual}"
        );
        assert_eq!(results[3]["events"], json!([]), "{framework:?}: {actual}");
        assert_eq!(results[4]["error"], Value::Null, "{framework:?}: {actual}");
        assert_eq!(
            results[4]["response"]["transitioned"], false,
            "{framework:?}: {actual}"
        );
        assert_eq!(
            actual["guardFaultResponse"]["transitioned"], false,
            "{framework:?}: {actual}"
        );
        assert_eq!(
            actual["guardFaultPreserved"], false,
            "{framework:?}: {actual}"
        );
        assert_eq!(results[4]["events"], json!([]), "{framework:?}: {actual}");
        assert_eq!(
            actual["guardFaultEvents"],
            json!([]),
            "{framework:?}: {actual}"
        );
        let parses = actual["parseResults"].as_array().unwrap();
        assert_eq!(parses.len(), 3, "{framework:?}: {actual}");
        for result in &parses[..2] {
            assert!(result["error"].is_string(), "{framework:?}: {result}");
            assert_eq!(result["response"], Value::Null, "{framework:?}: {result}");
            assert_eq!(result["events"], json!([]), "{framework:?}: {result}");
        }
        assert_eq!(parses[2]["error"], Value::Null, "{framework:?}: {actual}");
        assert_eq!(
            parses[2]["response"]["transitioned"], true,
            "{framework:?}: {actual}"
        );
        assert_eq!(
            parses[2]["events"],
            json!([{ "event": "XML_PARSED", "payload": { "parsed": "" } }]),
            "{framework:?}: {actual}"
        );
        assert_eq!(
            actual["tick"][0]["payload"]["parsed"], "tick",
            "{framework:?}: {actual}"
        );
        assert_eq!(
            actual["tickEvents"],
            json!([{ "event": "XML_TICK", "payload": { "parsed": "tick" } }]),
            "{framework:?}: {actual}"
        );
        assert_eq!(actual["preserved"], true, "{framework:?}: {actual}");
        assert_eq!(actual["faultEvents"], json!([]), "{framework:?}: {actual}");
    }
}
