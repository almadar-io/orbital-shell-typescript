use orbital_core_base::ir::{OirBinding, OirBindingRoot, OirExpr};
use orbital_core_eval::lower::lower_sexpr;
use orbital_core_base::schema::SExpression;
use orbital_shell_typescript::core_value_imports_clause;
use orbital_shell_typescript::TypeScriptBackend;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

const VALID_VECTORS: &str = include_str!("fixtures/operators/xml-valid-vectors.json");
const PARSE_VECTORS: &str = include_str!("fixtures/operators/xml-vectors.json");
const VALUE_TYPE: &str = "type EventPayloadValue = string | number | boolean | null | Date | readonly EventPayloadValue[] | { readonly [k: string]: EventPayloadValue }; type EventPayload = { readonly [k: string]: EventPayloadValue | undefined };";

#[derive(Deserialize)]
struct ValidCase {
    expr: Value,
    expect: Option<bool>,
    #[serde(default)]
    error: bool,
    source: String,
}

#[derive(Deserialize)]
struct ParseCase {
    op: String,
    args: Vec<Value>,
    #[serde(default)]
    expect: Value,
    #[serde(default)]
    error: bool,
    source: String,
}

fn emit(expr: Value) -> String {
    let sexpr: SExpression = serde_json::from_value(expr).unwrap();
    TypeScriptBackend::new().expr_to_ts(&lower_sexpr(&sexpr).unwrap())
}

fn run(body: &str) -> Value {
    let symbols: BTreeSet<&str> = ["parseXml", "xmlValid"].into_iter().collect();
    let imports = core_value_imports_clause(&symbols);
    let script = format!("{imports}{VALUE_TYPE} {body}");
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
fn xml_codegen_consumes_the_installed_core_value_exports() {
    assert_eq!(
        run("process.stdout.write(JSON.stringify([typeof parseXml, typeof xmlValid]));"),
        json!(["function", "function"])
    );
}

#[test]
fn xml_codegen_calls_the_core_owner_without_string_coercion() {
    for (expression, helper) in [
        (json!(["xml/valid", "<a/>"]), "xmlValid("),
        (json!(["xml/parse", "<a/>", "Row"]), "parseXml("),
    ] {
        let generated = emit(expression);
        assert!(!generated.contains("UNSUPPORTED"), "{generated}");
        assert!(generated.contains(helper), "{generated}");
        assert!(generated.contains("typeof"), "{generated}");
        assert!(!generated.contains("String("), "{generated}");
    }
}

#[test]
fn xml_parse_codegen_passes_the_list_paths_through_and_a_bare_name_passes_none() {
    let with_paths = emit(json!([
        "xml/parse",
        "<a/>",
        "Row",
        ["list", ["list", "entry"], ["list", "entry", "author"]]
    ]));
    assert!(with_paths.contains("parseXml(__v, "), "{with_paths}");
    assert!(
        with_paths.contains(r#"[["entry"], ["entry", "author"]]"#),
        "{with_paths}"
    );
    let bare = emit(json!(["xml/parse", "<a/>", "Row"]));
    assert!(bare.contains("parseXml(__v)"), "{bare}");
}

#[test]
fn xml_valid_codegen_executes_every_shared_vector() {
    let cases: Vec<ValidCase> = serde_json::from_str(VALID_VECTORS).unwrap();
    assert_eq!(cases.len(), 68);
    assert_eq!(
        cases
            .iter()
            .filter(|case| case.expect == Some(true))
            .count(),
        33
    );
    assert_eq!(
        cases
            .iter()
            .filter(|case| case.expect == Some(false))
            .count(),
        28
    );
    assert_eq!(cases.iter().filter(|case| case.error).count(), 7);
    let expressions: Vec<String> = cases
        .iter()
        .map(|case| {
            let sexpr: SExpression = serde_json::from_value(case.expr.clone()).unwrap();
            let SExpression::Array(parts) = &sexpr else {
                panic!("{}: fixture must be a call", case.source);
            };
            assert!(matches!(&parts[0], SExpression::String(op) if op == "xml/valid"));
            let expression = if parts.len() > 2 {
                assert!(case.error, "{}: excess arity must be an error", case.source);
                assert!(lower_sexpr(&sexpr).is_err(), "{}", case.source);
                let arguments = parts
                    .iter()
                    .skip(1)
                    .map(|argument| lower_sexpr(argument).unwrap())
                    .collect();
                TypeScriptBackend::new().expr_to_ts(&OirExpr::call("xml/valid", arguments))
            } else {
                emit(case.expr.clone())
            };
            format!("() => ({expression})")
        })
        .collect();
    let body = format!(
        "const runs = [{}]; const results = runs.map((run) => {{ try {{ const value = run(); return typeof value === 'boolean' ? {{ value }} : {{ unexpectedType: typeof value }}; }} catch (error) {{ return {{ error: error instanceof Error ? error.message : String(error) }}; }} }}); process.stdout.write(JSON.stringify(results));",
        expressions.join(", ")
    );
    let output = run(&body);
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
fn xml_parse_codegen_executes_the_existing_parse_corpus() {
    let cases: Vec<ParseCase> = serde_json::from_str(PARSE_VECTORS).unwrap();
    assert_eq!(cases.len(), 45);
    assert_eq!(cases.iter().filter(|case| case.error).count(), 13);
    let expressions: Vec<String> = cases
        .iter()
        .map(|case| {
            assert_eq!(case.op, "xml/parse");
            let mut expression = vec![json!(case.op)];
            expression.extend(case.args.clone());
            format!("() => ({})", emit(Value::Array(expression)))
        })
        .collect();
    let body = format!(
        "const runs = [{}]; const results = runs.map((run) => {{ try {{ const value = run(); return value === undefined ? {{ unexpectedType: 'undefined' }} : {{ value }}; }} catch (error) {{ return {{ error: error instanceof Error ? error.message : String(error) }}; }} }}); process.stdout.write(JSON.stringify(results));",
        expressions.join(", ")
    );
    let output = run(&body);
    let results = output.as_array().unwrap();
    assert_eq!(results.len(), cases.len());
    for (case, actual) in cases.iter().zip(results) {
        if case.error {
            assert!(actual["error"].is_string(), "{}: {actual}", case.source);
        } else {
            assert_eq!(actual["value"], case.expect, "{}: {actual}", case.source);
            assert!(
                !actual["unexpectedType"].is_string(),
                "{}: {actual}",
                case.source
            );
        }
    }
}

#[test]
fn xml_valid_codegen_rejects_undefined_and_reads_a_dynamic_input_once() {
    let input = OirExpr::binding(OirBinding::new(
        OirBindingRoot::Local("input".into()),
        vec!["value".into()],
    ));
    let backend = TypeScriptBackend::new();
    let call = backend.expr_to_ts(&OirExpr::call("xml/valid", vec![input.clone()]));
    let extra = backend.expr_to_ts(&OirExpr::call("xml/valid", vec![input.clone(), input]));
    let body = format!(
        "let reads = 0; let current: EventPayloadValue | undefined = '<a/>'; const input = {{ get value(): EventPayloadValue | undefined {{ reads++; return current; }} }}; const valid = {call}; current = '<a>'; const invalid = {call}; current = undefined; let rejected = false; try {{ {call}; }} catch (error) {{ rejected = error instanceof Error; }} let arityRejected = false; try {{ {extra}; }} catch (error) {{ arityRejected = error instanceof Error && error.message.includes('expected exactly one argument'); }} process.stdout.write(JSON.stringify({{ valid, invalid, reads, rejected, arityRejected }}));"
    );
    assert_eq!(
        run(&body),
        json!({"valid": true, "invalid": false, "reads": 3, "rejected": true, "arityRejected": true})
    );
}

#[test]
fn xml_valid_codegen_preserves_unexpected_parser_dependency_faults() {
    let call = emit(json!(["xml/valid", "<a>&#65;</a>"]));
    let body = format!(
        "const original = String.fromCodePoint; const failure = new Error('unexpected XML dependency defect'); let preserved = false; String.fromCodePoint = () => {{ throw failure; }}; try {{ {call}; }} catch (error) {{ preserved = error === failure; }} finally {{ String.fromCodePoint = original; }} process.stdout.write(JSON.stringify({{ preserved }}));"
    );
    assert_eq!(run(&body), json!({"preserved": true}));
}

#[test]
fn xml_codegen_mirrors_match_the_canonical_corpora() {
    for (name, local) in [
        ("xml-valid-vectors.json", VALID_VECTORS),
        ("xml-vectors.json", PARSE_VECTORS),
    ] {
        let canonical = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/almadar-parity/fixtures/operators")
            .join(name);
        if canonical.exists() {
            assert_eq!(std::fs::read(canonical).unwrap(), local.as_bytes());
        }
    }
}
