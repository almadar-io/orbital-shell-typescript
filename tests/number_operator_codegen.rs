use orbital_core_base::ir::{OirBinding, OirBindingRoot, OirExpr};
use orbital_core_eval::lower::lower_sexpr;
use orbital_core_base::schema::SExpression;
use orbital_shell_typescript::TypeScriptBackend;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;

const TIME_VECTORS: &str = include_str!("fixtures/operators/time-vectors.json");
const VECTORS: &str = include_str!("fixtures/operators/number-vectors.json");
const VALUE_TYPE: &str = "type EventPayloadValue = string | number | boolean | null | Date | readonly EventPayloadValue[] | { readonly [k: string]: EventPayloadValue }; type EventPayload = { readonly [k: string]: EventPayloadValue | undefined };";

#[derive(Deserialize)]
struct Case {
    expr: Value,
    expect: Option<Value>,
    #[serde(default)]
    error: bool,
    source: String,
}

fn emit(expr: Value) -> String {
    let sexpr: SExpression = serde_json::from_value(expr).unwrap();
    TypeScriptBackend::new().expr_to_ts(&lower_sexpr(&sexpr).unwrap())
}

fn run(script: &str) -> Value {
    let out = Command::new("node")
        .args(["--input-type=module-typescript", "-e", script])
        .output()
        .expect("node must be on PATH to execute generated expressions");
    assert!(
        out.status.success(),
        "{script}\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

#[test]
fn number_codegen_uses_the_intrinsic_without_string_coercion() {
    let generated = emit(json!(["str/to-number", "12px"]));
    assert!(!generated.contains("UNSUPPORTED"), "{generated}");
    assert!(generated.contains("Number("), "{generated}");
    assert!(generated.contains("typeof"), "{generated}");
    assert!(!generated.contains("String("), "{generated}");
    let control = emit(json!(["str/concat", "1", "2"]));
    assert_eq!(control, "[\"1\", \"2\"].join('')");
}

#[test]
fn number_codegen_executes_every_shared_vector() {
    let cases: Vec<Case> = serde_json::from_str(VECTORS).unwrap();
    assert_eq!(cases.len(), 89);
    assert!(cases.iter().any(|case| case.error));
    assert!(cases
        .iter()
        .any(|case| matches!(&case.expect, Some(Value::Number(_)))));
    for tag in ["NaN", "Infinity", "-Infinity", "-0"] {
        assert!(cases
            .iter()
            .any(|case| case.expect.as_ref() == Some(&json!(tag))));
    }
    let expressions: Vec<String> = cases
        .iter()
        .map(|case| {
            let sexpr: SExpression = serde_json::from_value(case.expr.clone()).unwrap();
            let SExpression::Array(parts) = &sexpr else {
                panic!("{}: fixture must be a call", case.source);
            };
            assert!(matches!(&parts[0], SExpression::String(op) if op == "str/to-number"));
            let expression = if parts.len() > 2 {
                assert!(case.error, "{}: excess arity must be an error", case.source);
                assert!(lower_sexpr(&sexpr).is_err(), "{}", case.source);
                let arguments = parts
                    .iter()
                    .skip(1)
                    .map(|argument| lower_sexpr(argument).unwrap())
                    .collect();
                TypeScriptBackend::new().expr_to_ts(&OirExpr::call("str/to-number", arguments))
            } else {
                emit(case.expr.clone())
            };
            format!("() => ({expression})")
        })
        .collect();
    let script = format!(
        "{VALUE_TYPE} const runs = [{}]; const results = runs.map((run) => {{ try {{ const value = run(); if (typeof value !== 'number') return {{ unexpectedType: typeof value }}; return {{ value: Number.isNaN(value) ? 'NaN' : value === Infinity ? 'Infinity' : value === -Infinity ? '-Infinity' : Object.is(value, -0) ? '-0' : value }}; }} catch (error) {{ return {{ error: error instanceof Error ? error.message : String(error) }}; }} }}); const control = {}; process.stdout.write(JSON.stringify({{ results, control }}));",
        expressions.join(", "),
        emit(json!(["str/concat", "1", "2"]))
    );
    let output = run(&script);
    assert_eq!(output["control"], "12");
    let results = output["results"].as_array().unwrap();
    assert_eq!(results.len(), cases.len());
    for (case, actual) in cases.iter().zip(results) {
        if case.error {
            assert!(actual["error"].is_string(), "{}: {actual}", case.source);
        } else {
            let expected = case.expect.as_ref().unwrap();
            if let Some(expected) = expected.as_f64() {
                let actual = actual["value"]
                    .as_f64()
                    .unwrap_or_else(|| panic!("{}: {actual}", case.source));
                assert_eq!(actual.to_bits(), expected.to_bits(), "{}", case.source);
            } else {
                assert_eq!(&actual["value"], expected, "{}", case.source);
            }
        }
    }
}

#[test]
fn number_codegen_rejects_undefined_and_reads_a_dynamic_input_once() {
    let input = OirExpr::binding(OirBinding::new(
        OirBindingRoot::Local("input".into()),
        vec!["value".into()],
    ));
    let backend = TypeScriptBackend::new();
    let call = backend.expr_to_ts(&OirExpr::call("str/to-number", vec![input.clone()]));
    let extra = backend.expr_to_ts(&OirExpr::call("str/to-number", vec![input.clone(), input]));
    let script = format!(
        "{VALUE_TYPE} let reads = 0; let current: EventPayloadValue | undefined = '-0'; const input = {{ get value(): EventPayloadValue | undefined {{ reads++; return current; }} }}; const first = {call}; current = undefined; let rejected = false; try {{ {call}; }} catch (error) {{ rejected = error instanceof Error; }} let arityRejected = false; try {{ {extra}; }} catch (error) {{ arityRejected = error instanceof Error && error.message.includes('expected exactly one argument'); }} process.stdout.write(JSON.stringify({{ negativeZero: Object.is(first, -0), reads, rejected, arityRejected }}));"
    );
    assert_eq!(
        run(&script),
        json!({"negativeZero": true, "reads": 2, "rejected": true, "arityRejected": true})
    );
}

#[test]
fn number_codegen_mirror_matches_the_canonical_corpus() {
    let canonical = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/almadar-parity/fixtures/operators/number-vectors.json");
    if canonical.exists() {
        assert_eq!(std::fs::read(canonical).unwrap(), VECTORS.as_bytes());
    }
}

// ---- time/parse shared vectors ----
#[derive(Deserialize)]
struct TimeCase {
    expr: Value,
    expect: Option<Value>,
    #[serde(default)]
    error: bool,
    source: String,
}

fn emit_time(expr: &Value) -> String {
    let sexpr: SExpression = serde_json::from_value(expr.clone()).unwrap();
    TypeScriptBackend::new().expr_to_ts(&lower_sexpr(&sexpr).unwrap())
}

#[test]
fn time_parse_codegen_executes_every_shared_vector() {
    let cases: Vec<TimeCase> = serde_json::from_str(TIME_VECTORS).unwrap();
    assert!(cases.iter().any(|c| c.error) && cases.iter().any(|c| !c.error));
    let runs: Vec<String> = cases
        .iter()
        .map(|c| format!("() => ({})", emit_time(&c.expr)))
        .collect();
    let script = format!(
        "{VALUE_TYPE} const runs = [{}]; const results = runs.map((run) => {{ try {{ const value = run(); return typeof value === 'number' || typeof value === 'boolean' ? {{ value }} : {{ unexpectedType: typeof value }}; }} catch (error) {{ return {{ error: error instanceof Error ? error.message : String(error) }}; }} }}); process.stdout.write(JSON.stringify(results));",
        runs.join(", ")
    );
    let out = Command::new("node")
        .args(["--input-type=module-typescript", "-e", &script])
        .output()
        .expect("node must be on PATH to execute generated expressions");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let results: Vec<Value> = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(results.len(), cases.len());
    for (case, actual) in cases.iter().zip(&results) {
        if case.error {
            assert!(actual["error"].is_string(), "{}: {actual}", case.source);
        } else {
            assert_eq!(Some(&actual["value"]), case.expect.as_ref(), "{}: {actual}", case.source);
        }
    }
}

#[test]
fn time_parse_codegen_does_not_delegate_to_the_host_date_parser() {
    let generated = emit_time(&json!(["time/parse", "2028-03-01T13:45:10"]));
    assert!(!generated.contains("new Date(\"2028"), "{generated}");
}

#[test]
fn time_parse_codegen_mirror_matches_the_canonical_corpus() {
    let canonical = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/almadar-parity/fixtures/operators/time-vectors.json");
    if canonical.exists() {
        assert_eq!(std::fs::read(canonical).unwrap(), TIME_VECTORS.as_bytes());
    }
}
