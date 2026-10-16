use orbital_core_base::ir::{OirBinding, OirBindingRoot, OirExpr};
use orbital_core_eval::lower::lower_sexpr;
use orbital_core_base::schema::SExpression;
use orbital_shell_typescript::TypeScriptBackend;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

const VECTORS: &str = include_str!("fixtures/operators/json-valid-vectors.json");
const VALUE_TYPE: &str = "type EventPayloadValue = string | number | boolean | null | Date | readonly EventPayloadValue[] | { readonly [k: string]: EventPayloadValue }; type EventPayload = { readonly [k: string]: EventPayloadValue | undefined };";

#[derive(Deserialize)]
struct Case {
    expr: Value,
    expect: Option<bool>,
    #[serde(default)]
    error: bool,
    source: String,
}

fn emit(expr: Value) -> String {
    let sexpr: SExpression = serde_json::from_value(expr).unwrap();
    TypeScriptBackend::new().expr_to_ts(&lower_sexpr(&sexpr).unwrap())
}

fn run(script: &str) -> Value {
    let mut child = Command::new("node")
        .args(["--input-type=module-typescript", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("node must be on PATH to execute generated expressions");
    {
        let mut input = child.stdin.take().unwrap();
        input.write_all(script.as_bytes()).unwrap();
    }
    let out = child.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "{script}\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

#[test]
fn json_valid_codegen_uses_json_parse_without_string_coercion() {
    let generated = emit(json!(["json/valid", "null"]));
    assert!(!generated.contains("UNSUPPORTED"), "{generated}");
    assert!(generated.contains("JSON.parse("), "{generated}");
    assert!(generated.contains("typeof"), "{generated}");
    assert!(!generated.contains("String("), "{generated}");
}

#[test]
fn json_valid_codegen_executes_every_shared_vector() {
    let cases: Vec<Case> = serde_json::from_str(VECTORS).unwrap();
    assert_eq!(cases.len(), 86);
    assert_eq!(
        cases
            .iter()
            .filter(|case| case.expect == Some(true))
            .count(),
        39
    );
    assert_eq!(
        cases
            .iter()
            .filter(|case| case.expect == Some(false))
            .count(),
        40
    );
    assert_eq!(cases.iter().filter(|case| case.error).count(), 7);
    let expressions: Vec<String> = cases
        .iter()
        .map(|case| {
            let sexpr: SExpression = serde_json::from_value(case.expr.clone()).unwrap();
            let SExpression::Array(parts) = &sexpr else {
                panic!("{}: fixture must be a call", case.source);
            };
            assert!(matches!(&parts[0], SExpression::String(op) if op == "json/valid"));
            let expression = if parts.len() > 2 {
                assert!(case.error, "{}: excess arity must be an error", case.source);
                assert!(lower_sexpr(&sexpr).is_err(), "{}", case.source);
                let arguments = parts
                    .iter()
                    .skip(1)
                    .map(|argument| lower_sexpr(argument).unwrap())
                    .collect();
                TypeScriptBackend::new().expr_to_ts(&OirExpr::call("json/valid", arguments))
            } else {
                emit(case.expr.clone())
            };
            format!("() => ({expression})")
        })
        .collect();
    let script = format!(
        "{VALUE_TYPE} const runs = [{}]; const results = runs.map((run) => {{ try {{ const value = run(); return typeof value === 'boolean' ? {{ value }} : {{ unexpectedType: typeof value }}; }} catch (error) {{ return {{ error: error instanceof Error ? error.message : String(error) }}; }} }}); process.stdout.write(JSON.stringify(results));",
        expressions.join(", ")
    );
    let output = run(&script);
    let results = output.as_array().unwrap();
    assert_eq!(results.len(), cases.len());
    for (case, actual) in cases.iter().zip(results) {
        if case.error {
            assert!(actual["error"].is_string(), "{}: {actual}", case.source);
        } else {
            assert_eq!(
                actual["value"].as_bool(),
                case.expect,
                "{}: {actual}",
                case.source
            );
        }
    }
}

#[test]
fn json_valid_codegen_rejects_undefined_and_reads_a_dynamic_input_once() {
    let input = OirExpr::binding(OirBinding::new(
        OirBindingRoot::Local("input".into()),
        vec!["value".into()],
    ));
    let backend = TypeScriptBackend::new();
    let call = backend.expr_to_ts(&OirExpr::call("json/valid", vec![input.clone()]));
    let extra = backend.expr_to_ts(&OirExpr::call("json/valid", vec![input.clone(), input]));
    let script = format!(
        "{VALUE_TYPE} let reads = 0; let current: EventPayloadValue | undefined = 'null'; const input = {{ get value(): EventPayloadValue | undefined {{ reads++; return current; }} }}; const valid = {call}; current = '{{'; const invalid = {call}; current = undefined; let rejected = false; try {{ {call}; }} catch (error) {{ rejected = error instanceof Error; }} let arityRejected = false; try {{ {extra}; }} catch (error) {{ arityRejected = error instanceof Error && error.message.includes('expected exactly one argument'); }} process.stdout.write(JSON.stringify({{ valid, invalid, reads, rejected, arityRejected }}));"
    );
    assert_eq!(
        run(&script),
        json!({"valid": true, "invalid": false, "reads": 3, "rejected": true, "arityRejected": true})
    );
}

#[test]
fn json_valid_codegen_preserves_legacy_parse_semantics() {
    let inputs = [
        json!("null"),
        json!("malformed"),
        json!(""),
        json!(42),
        Value::Null,
        json!("{\"answer\":42}"),
    ];
    let expressions: Vec<String> = inputs
        .into_iter()
        .map(|input| emit(json!(["json/parse", input, "ParsedShape"])))
        .collect();
    let missing = TypeScriptBackend::new().expr_to_ts(&OirExpr::call("json/parse", vec![]));
    let overflow = emit(json!(["json/parse", "1e400", "ParsedShape"]));
    let script = format!(
        "{VALUE_TYPE} const values = [{}]; const missing = {missing}; const overflow = {overflow}; process.stdout.write(JSON.stringify({{ values, missing, overflowIsInfinity: overflow === Infinity }}));",
        expressions.join(", ")
    );
    assert_eq!(
        run(&script),
        json!({"values": [null, null, null, null, null, {"answer":42}], "missing": null, "overflowIsInfinity": true})
    );
}

#[test]
fn json_valid_codegen_mirror_matches_the_canonical_corpus() {
    let canonical = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/almadar-parity/fixtures/operators/json-valid-vectors.json");
    if canonical.exists() {
        assert_eq!(std::fs::read(canonical).unwrap(), VECTORS.as_bytes());
    }
}
