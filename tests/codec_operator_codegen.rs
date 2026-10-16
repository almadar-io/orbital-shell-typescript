use orbital_core::ir::{OirBinding, OirBindingRoot, OirExpr};
use orbital_core::lower::lower_sexpr;
use orbital_core::schema::SExpression;
use orbital_shell_typescript::codegen::handler_header::core_value_imports_clause;
use orbital_shell_typescript::TypeScriptBackend;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

const VECTORS: &str = include_str!("fixtures/operators/codec-vectors.json");
const VALUE_TYPE: &str =
    "import type { EventPayload, EventPayloadValue, RuntimeValue } from '@almadar/core';";
const CAPTURE: &str = "const capture = (run: () => string) => { try { const value = run(); return typeof value === 'string' || typeof value === 'boolean' ? { value } : { unexpectedType: typeof value }; } catch (error) { return { error: error instanceof Error ? error.message : String(error), name: error instanceof Error ? error.name : null, codec: error instanceof CodecError, reason: error instanceof CodecError ? error.reason : null }; } };";
const OPERATORS: [(&str, usize); 6] = [
    ("str/encode-uri-component", 1),
    ("base64/encode", 1),
    ("base64/decode", 1),
    ("base64/valid", 1),
    ("hash/sha256", 2),
    ("hmac/sha256", 3),
];

#[derive(Deserialize)]
struct Case {
    op: String,
    args: Vec<Value>,
    expect: Option<Value>,
    #[serde(default)]
    error: bool,
    source: String,
}

fn emit(expr: Value) -> String {
    let sexpr: SExpression = serde_json::from_value(expr).unwrap();
    TypeScriptBackend::new().expr_to_ts(&lower_sexpr(&sexpr).unwrap())
}

fn dynamic(op: &str, fields: &[&str]) -> String {
    let arguments = fields
        .iter()
        .map(|field| {
            OirExpr::binding(OirBinding::new(
                OirBindingRoot::Local("input".into()),
                vec![(*field).into()],
            ))
        })
        .collect();
    TypeScriptBackend::new().expr_to_ts(&OirExpr::call(op, arguments))
}

fn run(body: &str) -> Value {
    let symbols: BTreeSet<&str> = [
        "base64EncodeBytes",
        "base64DecodeBytes",
        "sha256Bytes",
        "hmacSha256Bytes",
        "md5Bytes",
        "encodeUriComponent",
        "encodeBase64",
        "decodeBase64",
        "decodeUriComponent",
        "hashSha256",
        "hmacSha256",
        "utf8Bytes",
        "encodeDigest",
        "CodecError",
    ]
    .into_iter()
    .collect();
    let imports = core_value_imports_clause(&symbols);
    let script = format!("{imports}{VALUE_TYPE} {CAPTURE} {body}");
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
fn codec_codegen_consumes_the_installed_public_core_exports() {
    assert_eq!(
        run("process.stdout.write(JSON.stringify([base64EncodeBytes, base64DecodeBytes, sha256Bytes, hmacSha256Bytes, encodeUriComponent, encodeBase64, decodeBase64, hashSha256, hmacSha256, utf8Bytes, encodeDigest, CodecError].map(value => typeof value)));"),
        json!(["function", "function", "function", "function", "function", "function", "function", "function", "function", "function", "function", "function"])
    );
}

#[test]
fn codec_codegen_uses_the_core_owner_without_string_coercion_or_crypto_copies() {
    for (expression, helpers) in [
        (
            json!(["str/encode-uri-component", "a b"]),
            vec!["encodeUriComponent("],
        ),
        (json!(["base64/encode", "f"]), vec!["encodeBase64("]),
        (json!(["base64/decode", "Zg=="]), vec!["decodeBase64("]),
        (
            json!(["hash/sha256", "abc", "hex"]),
            vec!["utf8Bytes(", "sha256Bytes(", "encodeDigest("],
        ),
        (
            json!(["hmac/sha256", "key", "message", "base64"]),
            vec!["utf8Bytes(", "hmacSha256Bytes(", "encodeDigest("],
        ),
    ] {
        let generated = emit(expression);
        assert!(!generated.contains("UNSUPPORTED"), "{generated}");
        for helper in helpers {
            assert!(generated.contains(helper), "{helper}: {generated}");
        }
        assert!(generated.contains("typeof"), "{generated}");
        for forbidden in [
            "String(",
            "TextEncoder",
            "TextDecoder",
            "DataView",
            "0x428a2f98",
            "@almadar/evaluator",
        ] {
            assert!(!generated.contains(forbidden), "{forbidden}: {generated}");
        }
    }
}

#[test]
fn codec_codegen_executes_every_shared_vector() {
    let cases: Vec<Case> = serde_json::from_str(VECTORS).unwrap();
    assert_eq!(cases.len(), 83);
    assert_eq!(cases.iter().filter(|case| case.error).count(), 18);
    assert_eq!(
        cases
            .iter()
            .map(|case| case.op.as_str())
            .collect::<BTreeSet<_>>(),
        OPERATORS.iter().map(|(op, _)| *op).collect()
    );
    let expressions: Vec<String> = cases
        .iter()
        .map(|case| {
            let mut expression = vec![json!(case.op)];
            expression.extend(case.args.clone());
            format!("() => ({})", emit(Value::Array(expression)))
        })
        .collect();
    let output = run(&format!(
        "const results = [{}].map(capture); process.stdout.write(JSON.stringify(results));",
        expressions.join(", ")
    ));
    let results = output.as_array().unwrap();
    assert_eq!(results.len(), cases.len());
    for (index, (case, actual)) in cases.iter().zip(results).enumerate() {
        if case.error {
            if case.args[0].is_number() {
                assert_eq!(
                    actual["name"],
                    json!("TypeError"),
                    "{index}: {}",
                    case.source
                );
                assert_eq!(
                    actual["error"],
                    json!("Type mismatch: expected string, got number"),
                    "{index}: {}",
                    case.source
                );
                assert_eq!(actual["codec"], json!(false), "{index}: {}", case.source);
            } else {
                let reason = match case.op.as_str() {
                    "base64/decode" => match case.args[0].as_str().unwrap() {
                        "Zg" | "Zm9" | "Zm9v!" | "Zm 9v" | "Zm9v\n" | "Z" => {
                            "base64 length must be a multiple of 4".to_string()
                        }
                        "Zg=a" => "base64 contains an invalid character at 2".to_string(),
                        "=Zg=" | "-_8=" => "base64 contains an invalid character at 0".to_string(),
                        "Zh==" => "base64 has non-canonical trailing bits".to_string(),
                        "/w==" | "gA==" => "base64 does not decode to valid UTF-8".to_string(),
                        text => panic!("{index}: unaccounted-for base64 failure {text}"),
                    },
                    "hash/sha256" => format!(
                        "encoding must be \"hex\" or \"base64\", got \"{}\"",
                        case.args[1].as_str().unwrap()
                    ),
                    "hmac/sha256" => format!(
                        "encoding must be \"hex\" or \"base64\", got \"{}\"",
                        case.args[2].as_str().unwrap()
                    ),
                    op => panic!("{index}: unaccounted-for codec failure {op}"),
                };
                assert_eq!(
                    actual["name"],
                    json!("CodecError"),
                    "{index}: {}",
                    case.source
                );
                assert_eq!(actual["codec"], json!(true), "{index}: {}", case.source);
                assert_eq!(actual["reason"], json!(reason), "{index}: {}", case.source);
                assert_eq!(
                    actual["error"],
                    json!(format!("Invalid argument: {reason}")),
                    "{index}: {}",
                    case.source
                );
            }
        } else {
            assert_eq!(
                Some(&actual["value"]),
                case.expect.as_ref(),
                "{index}: {}: {actual}",
                case.source
            );
            assert!(
                actual["unexpectedType"].is_null(),
                "{index}: {}: {actual}",
                case.source
            );
        }
    }
}

#[test]
fn codec_codegen_keeps_strict_types_in_every_operand_position() {
    let calls = [
        dynamic("str/encode-uri-component", &["value"]),
        dynamic("base64/encode", &["value"]),
        dynamic("base64/decode", &["value"]),
        dynamic("hash/sha256", &["value", "encoding"]),
        dynamic("hash/sha256", &["message", "value"]),
        dynamic("hmac/sha256", &["value", "message", "encoding"]),
        dynamic("hmac/sha256", &["key", "value", "encoding"]),
        dynamic("hmac/sha256", &["key", "message", "value"]),
    ];
    let body = format!(
        "let current: RuntimeValue; let reads = 0; const input = {{ key: 'key', message: 'message', encoding: 'hex', get value(): RuntimeValue {{ reads++; return current; }} }}; const values: RuntimeValue[] = [undefined, null, 17, true, [], {{ a: 'b' }}, new Date(0), () => 'value', 1n, Symbol('value')]; const results = values.map(value => {{ current = value; return [{}].map(capture); }}); process.stdout.write(JSON.stringify({{ results, reads }}));",
        calls.iter().map(|call| format!("() => ({call})")).collect::<Vec<_>>().join(", ")
    );
    let output = run(&body);
    assert_eq!(output["reads"], json!(80));
    let type_names = [
        "null", "null", "number", "boolean", "array", "object", "object", "function", "bigint",
        "symbol",
    ];
    for (results, type_name) in output["results"].as_array().unwrap().iter().zip(type_names) {
        assert_eq!(results.as_array().unwrap().len(), calls.len());
        for result in results.as_array().unwrap() {
            assert_eq!(
                result["error"],
                json!(format!("Type mismatch: expected string, got {type_name}"))
            );
            assert_eq!(result["codec"], json!(false));
            assert_eq!(result["name"], json!("TypeError"));
        }
    }
}

#[test]
fn codec_codegen_rejects_bad_types_before_hostile_later_getters() {
    let sha = dynamic("hash/sha256", &["message", "encoding"]);
    let hmac = dynamic("hmac/sha256", &["key", "message", "encoding"]);
    let output = run(&format!(
        "let current: RuntimeValue; let invalidAt = 'message'; let seen: string[] = []; const input = {{ get key(): RuntimeValue {{ seen.push('key'); return invalidAt === 'key' ? current : 'key'; }}, get message(): RuntimeValue {{ seen.push('message'); if (invalidAt === 'key') throw new Error('hostile later message getter'); return current; }}, get encoding(): string {{ seen.push('encoding'); throw new Error('hostile later encoding getter'); }} }}; const values: RuntimeValue[] = [undefined, null, 17, true, [], {{ a: 'b' }}, new Date(0), () => 'value', 1n, Symbol('value')]; const calls = [{{ invalidAt: 'message', run: () => ({sha}) }}, {{ invalidAt: 'key', run: () => ({hmac}) }}, {{ invalidAt: 'message', run: () => ({hmac}) }}]; const results = values.map(value => {{ current = value; return calls.map(call => {{ invalidAt = call.invalidAt; seen = []; const result = capture(call.run); return {{ result, seen }}; }}); }}); process.stdout.write(JSON.stringify(results));"
    ));
    let type_names = [
        "null", "null", "number", "boolean", "array", "object", "object", "function", "bigint",
        "symbol",
    ];
    for (results, type_name) in output.as_array().unwrap().iter().zip(type_names) {
        assert_eq!(results.as_array().unwrap().len(), 3);
        for (actual, expected_seen) in results.as_array().unwrap().iter().zip([
            vec!["message"],
            vec!["key"],
            vec!["key", "message"],
        ]) {
            assert_eq!(actual["seen"], json!(expected_seen));
            assert_eq!(actual["result"]["name"], json!("TypeError"));
            assert_eq!(actual["result"]["codec"], json!(false));
            assert_eq!(
                actual["result"]["error"],
                json!(format!("Type mismatch: expected string, got {type_name}"))
            );
        }
    }
}

#[test]
fn codec_codegen_preserves_codec_reasons_and_encoding_case_sensitivity() {
    let sha = dynamic("hash/sha256", &["message", "encoding"]);
    let hmac = dynamic("hmac/sha256", &["key", "message", "encoding"]);
    let uri = dynamic("str/encode-uri-component", &["message"]);
    let base64 = dynamic("base64/encode", &["message"]);
    let decode = dynamic("base64/decode", &["message"]);
    let output = run(&format!(
        "let message = 'abc'; let encoding = 'HEX'; const input = {{ key: 'key', get message() {{ return message; }}, get encoding() {{ return encoding; }} }}; const encodings = ['HEX', 'base32', ''].map(value => {{ encoding = value; return [capture(() => ({sha})), capture(() => ({hmac}))]; }}); const surrogates = ['\\ud800', 'a\\udc00'].map(value => {{ message = value; return [capture(() => ({uri})), capture(() => ({base64}))]; }}); message = '/w=='; const invalidUtf8 = capture(() => ({decode})); message = 'Zg='; const invalidPadding = capture(() => ({decode})); process.stdout.write(JSON.stringify({{ encodings, surrogates, invalidUtf8, invalidPadding }}));"
    ));
    for (results, encoding) in output["encodings"]
        .as_array()
        .unwrap()
        .iter()
        .zip(["HEX", "base32", ""])
    {
        for result in results.as_array().unwrap() {
            assert_eq!(result["name"], json!("CodecError"));
            assert_eq!(result["codec"], json!(true));
            assert_eq!(
                result["reason"],
                json!(format!(
                    "encoding must be \"hex\" or \"base64\", got \"{encoding}\""
                ))
            );
            assert_eq!(
                result["error"],
                json!(format!(
                    "Invalid argument: encoding must be \"hex\" or \"base64\", got \"{encoding}\""
                ))
            );
        }
    }
    for results in output["surrogates"].as_array().unwrap() {
        for result in results.as_array().unwrap() {
            assert_eq!(result["codec"], json!(true));
            assert_eq!(
                result["reason"],
                json!("string contains an unpaired surrogate")
            );
            assert_eq!(
                result["error"],
                json!("Invalid argument: string contains an unpaired surrogate")
            );
        }
    }
    assert_eq!(output["invalidUtf8"]["codec"], json!(true));
    assert_eq!(
        output["invalidUtf8"]["reason"],
        json!("base64 does not decode to valid UTF-8")
    );
    assert_eq!(
        output["invalidUtf8"]["error"],
        json!("Invalid argument: base64 does not decode to valid UTF-8")
    );
    assert_eq!(
        output["invalidPadding"]["reason"],
        json!("base64 length must be a multiple of 4")
    );
    assert_eq!(
        output["invalidPadding"]["error"],
        json!("Invalid argument: base64 length must be a multiple of 4")
    );
}

#[test]
fn codec_codegen_preserves_nul_unicode_and_strict_utf8_decoding() {
    let expressions = [
        emit(json!(["str/encode-uri-component", "\0é😀"])),
        emit(json!(["base64/encode", "\0é😀"])),
        emit(json!(["base64/decode", "AMOp8J+YgA=="])),
        emit(json!(["base64/decode", "Zg=="])),
        emit(json!(["base64/decode", "/w=="])),
        emit(json!(["base64/decode", "gA=="])),
        emit(json!(["base64/decode", "wK8="])),
        emit(json!(["base64/decode", "7aCA"])),
        emit(json!(["base64/decode", "9JCAgA=="])),
    ];
    let output = run(&format!(
        "const results = [{}].map(capture); process.stdout.write(JSON.stringify(results));",
        expressions
            .iter()
            .map(|expression| format!("() => ({expression})"))
            .collect::<Vec<_>>()
            .join(", ")
    ));
    for (index, expected) in ["%00%C3%A9%F0%9F%98%80", "AMOp8J+YgA==", "\0é😀", "f"]
        .into_iter()
        .enumerate()
    {
        assert_eq!(output[index]["value"], json!(expected));
    }
    for result in output.as_array().unwrap().iter().skip(4) {
        assert_eq!(result["codec"], json!(true));
        assert_eq!(
            result["reason"],
            json!("base64 does not decode to valid UTF-8")
        );
        assert_eq!(
            result["error"],
            json!("Invalid argument: base64 does not decode to valid UTF-8")
        );
    }
}

#[test]
fn codec_codegen_reads_each_required_operand_once_in_original_order() {
    let calls = [
        (
            dynamic("str/encode-uri-component", &["message"]),
            vec!["message"],
            "message",
        ),
        (
            dynamic("base64/encode", &["message"]),
            vec!["message"],
            "bWVzc2FnZQ==",
        ),
        (dynamic("base64/decode", &["encoded"]), vec!["encoded"], "f"),
        (
            dynamic("hash/sha256", &["message", "encoding"]),
            vec!["message", "encoding"],
            "ab530a13e45914982b79f9b7e3fba994cfd1f3fb22f71cea1afbf02b460c6d1d",
        ),
        (
            dynamic("hmac/sha256", &["key", "message", "encoding"]),
            vec!["key", "message", "encoding"],
            "6e9ef29b75fffc5b7abae527d58fdadb2fe42e7219011976917343065f58ed4a",
        ),
    ];
    let body = format!(
        "let seen: string[] = []; const input = {{ get key() {{ seen.push('key'); return 'key'; }}, get message() {{ seen.push('message'); return 'message'; }}, get encoding() {{ seen.push('encoding'); return 'hex'; }}, get encoded() {{ seen.push('encoded'); return 'Zg=='; }} }}; const results = [{}].map(run => {{ seen = []; const result = capture(run); return {{ result, seen }}; }}); process.stdout.write(JSON.stringify(results));",
        calls.iter().map(|(call, _, _)| format!("() => ({call})")).collect::<Vec<_>>().join(", ")
    );
    let output = run(&body);
    for (actual, (_, seen, expected)) in output.as_array().unwrap().iter().zip(calls) {
        assert_eq!(actual["seen"], json!(seen));
        assert_eq!(actual["result"]["value"], json!(expected));
    }
}

#[test]
fn codec_codegen_rejects_nonexact_arity_without_reading_operands() {
    let mut calls = Vec::new();
    let mut expected_errors = Vec::new();
    for (op, arity) in OPERATORS {
        let mut excess = vec![json!(op)];
        excess.extend(vec![json!("argument"); arity + 1]);
        let sexpr: SExpression = serde_json::from_value(Value::Array(excess)).unwrap();
        assert!(
            lower_sexpr(&sexpr).is_err(),
            "{op}: public lowering must reject excess arguments"
        );
        let expected_arity = match arity {
            1 => "one argument",
            2 => "two arguments",
            3 => "three arguments",
            _ => unreachable!(),
        };
        for length in (0..arity).chain(std::iter::once(arity + 1)) {
            calls.push(dynamic(op, &vec!["operand"; length]));
            expected_errors.push(format!(
                "Invalid argument: {op}: expected exactly {expected_arity}"
            ));
        }
    }
    let output = run(&format!(
        "let reads = 0; const input = {{ get operand() {{ reads++; throw new Error('invalid arity must not read an operand'); }} }}; const results = [{}].map(capture); process.stdout.write(JSON.stringify({{ results, reads }}));",
        calls.iter().map(|call| format!("() => ({call})")).collect::<Vec<_>>().join(", ")
    ));
    assert_eq!(output["reads"], json!(0));
    assert_eq!(output["results"].as_array().unwrap().len(), 13);
    for (result, expected) in output["results"]
        .as_array()
        .unwrap()
        .iter()
        .zip(expected_errors)
    {
        assert_eq!(result["name"], json!("Error"), "{result}");
        assert_eq!(result["error"], json!(expected), "{result}");
        assert_eq!(result["codec"], json!(false), "{result}");
    }
}

#[test]
fn codec_codegen_validates_earlier_utf8_before_reading_later_operands() {
    let sha = dynamic("hash/sha256", &["message", "encoding"]);
    let hmac = dynamic("hmac/sha256", &["key", "message", "encoding"]);
    let output = run(&format!(
        "let seen: string[] = []; let key = 'key'; let message = '\\ud800'; const input = {{ get key() {{ seen.push('key'); return key; }}, get message() {{ seen.push('message'); return message; }}, get encoding() {{ seen.push('encoding'); throw new Error('later encoding must not be read'); }} }}; const sha = capture(() => ({sha})); const shaSeen = seen; seen = []; key = '\\ud800'; message = 'message'; const keyResult = capture(() => ({hmac})); const keySeen = seen; seen = []; key = 'key'; message = '\\udc00'; const messageResult = capture(() => ({hmac})); const messageSeen = seen; process.stdout.write(JSON.stringify({{ sha, shaSeen, keyResult, keySeen, messageResult, messageSeen }}));"
    ));
    assert_eq!(output["shaSeen"], json!(["message"]));
    assert_eq!(output["keySeen"], json!(["key"]));
    assert_eq!(output["messageSeen"], json!(["key", "message"]));
    for result in ["sha", "keyResult", "messageResult"] {
        assert_eq!(
            output[result]["error"],
            json!("Invalid argument: string contains an unpaired surrogate")
        );
        assert_eq!(output[result]["codec"], json!(true));
    }
}

#[test]
fn codec_codegen_computes_the_digest_before_encoding_evaluation_or_fault() {
    let sha = dynamic("hash/sha256", &["message", "encoding"]);
    let hmac = dynamic("hmac/sha256", &["key", "message", "encoding"]);
    let output = run(&format!(
        "let events: string[] = []; let computed = false; let mode = 'ok'; const digestFailure = new Error('unexpected digest defect'); const encodingFailure = new Error('encoding getter defect'); const originalDigest = DataView.prototype.setUint32; const originalEncoder = TextEncoder.prototype.encode; const input = {{ get key() {{ events.push('key'); return 'key'; }}, get message() {{ events.push('message'); return 'message'; }}, get encoding() {{ events.push('encoding'); if (!computed) throw new Error('encoding evaluated before digest'); if (mode === 'encoding-fault') throw encodingFailure; return 'hex'; }} }}; DataView.prototype.setUint32 = function(...args) {{ if (!computed) {{ events.push('digest'); computed = true; }} if (mode === 'digest-fault') throw digestFailure; return originalDigest.apply(this, args); }}; TextEncoder.prototype.encode = function(text) {{ events.push('utf8:' + text); return originalEncoder.call(this, text); }}; const calls = [() => ({sha}), () => ({hmac})]; const results = []; try {{ for (const selected of ['ok', 'digest-fault', 'encoding-fault']) {{ mode = selected; results.push(calls.map(call => {{ events = []; computed = false; let value; let preserved = false; try {{ value = call(); }} catch (error) {{ preserved = error === (mode === 'digest-fault' ? digestFailure : encodingFailure); }} return {{ value, preserved, events }}; }})); }} }} finally {{ DataView.prototype.setUint32 = originalDigest; TextEncoder.prototype.encode = originalEncoder; }} process.stdout.write(JSON.stringify(results));"
    ));
    let results = output.as_array().unwrap();
    for (index, prefix) in [
        vec!["message", "utf8:message"],
        vec!["key", "utf8:key", "message", "utf8:message"],
    ]
    .into_iter()
    .enumerate()
    {
        let mut success = prefix.clone();
        success.extend(["digest", "encoding"]);
        assert_eq!(results[0][index]["events"], json!(success));
        assert!(results[0][index]["value"].is_string());
        let mut failure = prefix.clone();
        failure.push("digest");
        assert_eq!(results[1][index]["events"], json!(failure));
        assert_eq!(results[1][index]["preserved"], json!(true));
        assert_eq!(results[2][index]["events"], json!(success));
        assert_eq!(results[2][index]["preserved"], json!(true));
    }
}

#[test]
fn codec_codegen_preserves_encoder_faults_and_legacy_decoder_fault_mapping() {
    let calls = [
        dynamic("str/encode-uri-component", &["message"]),
        dynamic("base64/encode", &["message"]),
        dynamic("hash/sha256", &["message", "encoding"]),
        dynamic("hmac/sha256", &["key", "message", "encoding"]),
    ];
    let decode = emit(json!(["base64/decode", "Zg=="]));
    let output = run(&format!(
        "let seen: string[] = []; const input = {{ get key() {{ seen.push('key'); return 'key'; }}, get message() {{ seen.push('message'); return 'é'; }}, get encoding() {{ seen.push('encoding'); return 'hex'; }} }}; const failure = new Error('unexpected encoder defect'); const originalEncoder = TextEncoder.prototype.encode; const originalDecoder = TextDecoder.prototype.decode; let encoderResults; let decoderResult; TextEncoder.prototype.encode = () => {{ throw failure; }}; try {{ encoderResults = [{}].map(call => {{ seen = []; let preserved = false; try {{ call(); }} catch (error) {{ preserved = error === failure; }} return {{ preserved, seen }}; }}); }} finally {{ TextEncoder.prototype.encode = originalEncoder; }} TextDecoder.prototype.decode = () => {{ throw new Error('unexpected decoder defect'); }}; try {{ decoderResult = capture(() => ({decode})); }} finally {{ TextDecoder.prototype.decode = originalDecoder; }} process.stdout.write(JSON.stringify({{ encoderResults, decoderResult }}));",
        calls.iter().map(|call| format!("() => ({call})")).collect::<Vec<_>>().join(", ")
    ));
    for (index, result) in output["encoderResults"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
    {
        assert_eq!(result["preserved"], json!(true));
        assert_eq!(
            result["seen"],
            json!([if index == 3 { "key" } else { "message" }])
        );
    }
    assert_eq!(output["decoderResult"]["codec"], json!(true));
    assert_eq!(
        output["decoderResult"]["reason"],
        json!("base64 does not decode to valid UTF-8")
    );
    assert_eq!(
        output["decoderResult"]["error"],
        json!("Invalid argument: base64 does not decode to valid UTF-8")
    );
}

#[test]
fn codec_codegen_mirror_matches_the_canonical_corpus() {
    let canonical = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/almadar-parity/fixtures/operators/codec-vectors.json");
    if canonical.exists() {
        assert_eq!(std::fs::read(canonical).unwrap(), VECTORS.as_bytes());
    }
}

#[test]
fn codec_codegen_sha_lambdas_preserve_author_names_colliding_with_wrapper_temporaries() {
    let mut cases = Vec::new();
    for name in ["ordinaryEncoding", "__message", "__digest", "__encoding"] {
        for property in [false, true] {
            let binding = format!("@{name}{}", if property { ".encoding" } else { "" });
            let lambda = emit(json!(["fn", name, ["hash/sha256", "abc", binding]]));
            let argument = if property { "input" } else { "'hex'" };
            cases.push((
                format!("{name}: property={property}"),
                format!("() => (({lambda})({argument}))"),
                usize::from(property),
            ));
        }
    }
    let output = run(&format!(
        "let reads = 0; const input = {{ get encoding() {{ reads++; return 'hex'; }} }}; const results = [{}].map(run => {{ reads = 0; const result = capture(run); return {{ result, reads }}; }}); process.stdout.write(JSON.stringify(results));",
        cases.iter().map(|(_, call, _)| call.as_str()).collect::<Vec<_>>().join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 8);
    for (actual, (label, _, expected_reads)) in output.as_array().unwrap().iter().zip(cases) {
        assert_eq!(
            actual["result"]["value"],
            json!("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
            "{label}: {actual}"
        );
        assert_eq!(actual["reads"], json!(expected_reads), "{label}: {actual}");
    }
}

#[test]
fn codec_codegen_hmac_lambdas_preserve_author_names_in_later_operands() {
    let mut cases = Vec::new();
    for name in [
        "ordinaryValue",
        "__key",
        "__keyBytes",
        "__message",
        "__digest",
        "__encoding",
    ] {
        for operand in ["message", "encoding"] {
            for property in [false, true] {
                let binding = format!(
                    "@{name}{}",
                    if property {
                        format!(".{operand}")
                    } else {
                        String::new()
                    }
                );
                let body = if operand == "message" {
                    json!(["hmac/sha256", "key", binding, "hex"])
                } else {
                    json!(["hmac/sha256", "key", "message", binding])
                };
                let lambda = emit(json!(["fn", name, body]));
                let argument = if property {
                    "input"
                } else if operand == "message" {
                    "'message'"
                } else {
                    "'hex'"
                };
                cases.push((
                    format!("{name}: {operand}: property={property}"),
                    format!("() => (({lambda})({argument}))"),
                    if property { vec![operand] } else { Vec::new() },
                ));
            }
        }
    }
    let output = run(&format!(
        "let seen: string[] = []; const input = {{ get message() {{ seen.push('message'); return 'message'; }}, get encoding() {{ seen.push('encoding'); return 'hex'; }} }}; const results = [{}].map(run => {{ seen = []; const result = capture(run); return {{ result, seen }}; }}); process.stdout.write(JSON.stringify(results));",
        cases.iter().map(|(_, call, _)| call.as_str()).collect::<Vec<_>>().join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 24);
    for (actual, (label, _, expected_seen)) in output.as_array().unwrap().iter().zip(cases) {
        assert_eq!(
            actual["result"]["value"],
            json!("6e9ef29b75fffc5b7abae527d58fdadb2fe42e7219011976917343065f58ed4a"),
            "{label}: {actual}"
        );
        assert_eq!(actual["seen"], json!(expected_seen), "{label}: {actual}");
    }
}

#[test]
fn codec_codegen_author_lambda_parameters_do_not_shadow_core_value_helpers() {
    let mut cases = Vec::new();
    for name in [
        "ordinaryValue",
        "encodeUriComponent",
        "encodeBase64",
        "decodeBase64",
        "utf8Bytes",
        "sha256Bytes",
        "hmacSha256Bytes",
        "encodeDigest",
        "CodecError",
        "base64EncodeBytes",
        "base64DecodeBytes",
        "hashSha256",
        "hmacSha256",
    ] {
        for (body, expected) in [
            (json!(["str/encode-uri-component", "a b"]), "a%20b"),
            (json!(["base64/encode", "f"]), "Zg=="),
            (json!(["base64/decode", "Zg=="]), "f"),
            (
                json!(["hash/sha256", "abc", "hex"]),
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ),
            (
                json!(["hmac/sha256", "key", "message", "hex"]),
                "6e9ef29b75fffc5b7abae527d58fdadb2fe42e7219011976917343065f58ed4a",
            ),
        ] {
            let label = format!("{name}: {}", body[0]);
            let lambda = emit(json!(["fn", name, body]));
            cases.push((
                label,
                format!("() => (({lambda})('author value'))"),
                expected,
            ));
        }
    }
    let output = run(&format!(
        "const results = [{}].map(capture); process.stdout.write(JSON.stringify(results));",
        cases
            .iter()
            .map(|(_, call, _)| call.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 65);
    for (actual, (label, _, expected)) in output.as_array().unwrap().iter().zip(cases) {
        assert_eq!(actual["value"], json!(expected), "{label}: {actual}");
    }
}

#[test]
fn codec_codegen_author_codec_error_parameter_preserves_encoding_failure_identity() {
    let mut cases = Vec::new();
    for name in ["ordinaryValue", "CodecError"] {
        for body in [
            json!(["hash/sha256", "abc", "HEX"]),
            json!(["hmac/sha256", "key", "message", "HEX"]),
        ] {
            let label = format!("{name}: {}", body[0]);
            let lambda = emit(json!(["fn", name, body]));
            cases.push((label, format!("() => (({lambda})('author value'))")));
        }
    }
    let output = run(&format!(
        "const results = [{}].map(capture); process.stdout.write(JSON.stringify(results));",
        cases
            .iter()
            .map(|(_, call)| call.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 4);
    for (actual, (label, _)) in output.as_array().unwrap().iter().zip(cases) {
        assert_eq!(actual["name"], json!("CodecError"), "{label}: {actual}");
        assert_eq!(actual["codec"], json!(true), "{label}: {actual}");
        assert_eq!(
            actual["reason"],
            json!("encoding must be \"hex\" or \"base64\", got \"HEX\""),
            "{label}: {actual}"
        );
        assert_eq!(
            actual["error"],
            json!("Invalid argument: encoding must be \"hex\" or \"base64\", got \"HEX\""),
            "{label}: {actual}"
        );
    }
}

#[test]
fn codec_codegen_preserves_let_and_nested_lambda_lexical_scope() {
    let mut cases = Vec::new();
    let sha = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    let hmac = "6e9ef29b75fffc5b7abae527d58fdadb2fe42e7219011976917343065f58ed4a";
    for name in [
        "ordinaryEncoding",
        "__message",
        "__key",
        "__keyBytes",
        "__digest",
        "__encoding",
        "encodeDigest",
        "CodecError",
    ] {
        for (body, expected) in [
            (json!(["hash/sha256", "abc", format!("@{name}")]), sha),
            (
                json!(["hmac/sha256", "key", "message", format!("@{name}")]),
                hmac,
            ),
        ] {
            let expression = emit(json!(["let", [[name, "hex"]], body]));
            cases.push((
                format!("let {name}: {expected}"),
                format!("() => ({expression})"),
                expected,
            ));
        }
    }
    for name in ["ordinaryEncoding", "__message", "__digest", "encodeDigest"] {
        let inner_let = emit(json!([
            "fn",
            name,
            [
                "let",
                [[name, "hex"]],
                ["hash/sha256", "abc", format!("@{name}")]
            ]
        ]));
        cases.push((
            format!("inner let shadows lambda {name}"),
            format!("() => (({inner_let})('base64'))"),
            sha,
        ));
        let inner_lambda = emit(json!([
            "let",
            [[name, "base64"]],
            ["fn", name, ["hash/sha256", "abc", format!("@{name}")]]
        ]));
        cases.push((
            format!("inner lambda shadows let {name}"),
            format!("() => (({inner_lambda})('hex'))"),
            sha,
        ));
        let nested_lambda = emit(json!([
            "fn",
            name,
            ["fn", name, ["hash/sha256", "abc", format!("@{name}")]]
        ]));
        cases.push((
            format!("inner lambda shadows lambda {name}"),
            format!("() => (({nested_lambda})('base64')('hex'))"),
            sha,
        ));
    }
    let helper_let = emit(json!([
        "let",
        [["encodeBase64", "f"]],
        ["base64/encode", "@encodeBase64"]
    ]));
    cases.push((
        "author let helper-name binding remains readable".to_string(),
        format!("() => ({helper_let})"),
        "Zg==",
    ));
    let nested_helper = emit(json!([
        "fn",
        "encodeBase64",
        ["fn", "ordinaryValue", ["base64/encode", "@encodeBase64"]]
    ]));
    cases.push((
        "inner lambda retains outer helper-name binding".to_string(),
        format!("() => (({nested_helper})('f')('ignored'))"),
        "Zg==",
    ));
    let output = run(&format!(
        "const results = [{}].map(capture); process.stdout.write(JSON.stringify(results));",
        cases
            .iter()
            .map(|(_, call, _)| call.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 30);
    for (actual, (label, _, expected)) in output.as_array().unwrap().iter().zip(cases) {
        assert_eq!(actual["value"], json!(expected), "{label}: {actual}");
    }
}

#[test]
fn codec_codegen_implicit_index_uses_the_callback_binding_not_an_outer_local() {
    let callback = json!([
        "fn",
        "value",
        [
            "str/concat",
            ["base64/encode", "@value"],
            ["json/stringify", "@index"]
        ]
    ]);
    let map = json!(["array/map", "@input.values", callback]);
    let explicit = json!([
        "array/map",
        "@input.values",
        [
            "fn",
            ["value", "index"],
            [
                "str/concat",
                ["base64/encode", "@value"],
                ["json/stringify", "@index"]
            ]
        ]
    ]);
    let cases = [
        (
            "implicit",
            format!("() => JSON.stringify({})", emit(map.clone())),
        ),
        (
            "outer lambda index",
            format!(
                "() => JSON.stringify(({})(99))",
                emit(json!(["fn", "index", map.clone()]))
            ),
        ),
        (
            "outer let index",
            format!(
                "() => JSON.stringify({})",
                emit(json!(["let", [["index", 99]], map]))
            ),
        ),
        (
            "explicit index control",
            format!("() => JSON.stringify({})", emit(explicit)),
        ),
    ];
    let output = run(&format!(
        "let reads = 0; const input = {{ get values() {{ reads++; return ['a', 'b']; }} }}; const results = [{}].map(call => {{ reads = 0; return {{ result: capture(call), reads }}; }}); process.stdout.write(JSON.stringify(results));",
        cases.iter().map(|(_, call)| call.as_str()).collect::<Vec<_>>().join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), cases.len());
    for (actual, (label, _)) in output.as_array().unwrap().iter().zip(cases) {
        assert_eq!(
            actual["result"]["value"],
            json!("[\"YQ==0\",\"Yg==1\"]"),
            "{label}: {actual}"
        );
        assert_eq!(actual["reads"], 1, "{label}: {actual}");
    }
}

#[test]
fn codec_codegen_sequential_let_rhs_keeps_outer_and_preceding_bindings() {
    let mut cases = Vec::new();
    for name in ["ordinaryEncoding", "encodeDigest", "Encoding", "__message"] {
        let own_rhs = emit(json!([
            "fn",
            name,
            [
                "let",
                [
                    [name, format!("@{name}.encoding")],
                    ["alias", format!("@{name}")]
                ],
                ["hash/sha256", "abc", "@alias"]
            ]
        ]));
        cases.push((
            format!("{name}: initializer sees outer binder"),
            format!("() => (({own_rhs})(input))"),
            1,
        ));
        let preceding = emit(json!([
            "let",
            [
                ["first", "hex"],
                [name, "@first"],
                ["alias", format!("@{name}")]
            ],
            ["hash/sha256", "abc", "@alias"]
        ]));
        cases.push((
            format!("{name}: initializer sees preceding alias"),
            format!("() => ({preceding})"),
            0,
        ));
        let local = emit(json!([
            "fn",
            name,
            ["hash/sha256", "abc", format!("@{name}")]
        ]));
        cases.push((
            format!("{name}: declared local precedes unbound-root inference"),
            format!("() => (({local})('hex'))"),
            0,
        ));
    }
    let output = run(&format!(
        "let reads = 0; const input = {{ get encoding() {{ reads++; return reads === 1 ? 'hex' : 'base64'; }} }}; const results = [{}].map(call => {{ reads = 0; return {{ result: capture(call), reads }}; }}); process.stdout.write(JSON.stringify(results));",
        cases.iter().map(|(_, call, _)| call.as_str()).collect::<Vec<_>>().join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 12);
    for (actual, (label, _, reads)) in output.as_array().unwrap().iter().zip(cases) {
        assert_eq!(
            actual["result"]["value"],
            json!("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
            "{label}: {actual}"
        );
        assert_eq!(actual["reads"], reads, "{label}: {actual}");
    }
}

#[test]
fn codec_codegen_fresh_temporaries_reserve_structured_free_operand_candidates() {
    let mut cases = Vec::new();
    for (op, base, operand) in [
        ("hash/sha256", "ordinaryFree", "encoding"),
        ("hash/sha256", "__message", "encoding"),
        ("hash/sha256", "__digest", "encoding"),
        ("hmac/sha256", "__key", "message"),
        ("hmac/sha256", "__keyBytes", "message"),
        ("hmac/sha256", "__message", "encoding"),
        ("hmac/sha256", "__digest", "encoding"),
        ("hmac/sha256", "__encoding", "encoding"),
    ] {
        let candidate = format!("{base}__1");
        let field = |root: &str, path: &str| {
            OirExpr::binding(OirBinding::new(
                OirBindingRoot::Local(root.into()),
                vec![path.into()],
            ))
        };
        let selected = OirExpr::Conditional {
            condition: Box::new(field("input", "choose")),
            then_branch: Box::new(field(base, "value")),
            else_branch: Box::new(field(&candidate, "value")),
        };
        let args = if op == "hash/sha256" {
            vec![OirExpr::string("abc"), selected]
        } else if operand == "message" {
            vec![OirExpr::string("key"), selected, OirExpr::string("hex")]
        } else {
            vec![OirExpr::string("key"), OirExpr::string("message"), selected]
        };
        let expression = TypeScriptBackend::new().expr_to_ts(&OirExpr::call(op, args));
        let value = if operand == "message" {
            "message"
        } else {
            "hex"
        };
        for choose in [true, false] {
            let call = format!(
                "() => {{ let seen: string[] = []; const input = {{ get choose() {{ seen.push('choose'); return {choose}; }} }}; const {base} = {{ get value() {{ seen.push('preferred'); return '{value}'; }} }}; const {candidate} = {{ get value() {{ seen.push('candidate'); return '{value}'; }} }}; return {{ result: capture(() => ({expression})), seen }}; }}"
            );
            cases.push((
                format!("{op}: {base}: choose={choose}"),
                call,
                op,
                if choose { "preferred" } else { "candidate" },
            ));
        }
    }
    let output = run(&format!(
        "process.stdout.write(JSON.stringify([{}].map(call => call())));",
        cases
            .iter()
            .map(|(_, call, _, _)| call.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 16);
    for (actual, (label, _, op, selected)) in output.as_array().unwrap().iter().zip(cases) {
        let expected = if op == "hash/sha256" {
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        } else {
            "6e9ef29b75fffc5b7abae527d58fdadb2fe42e7219011976917343065f58ed4a"
        };
        assert_eq!(
            actual["result"]["value"],
            json!(expected),
            "{label}: {actual}"
        );
        assert_eq!(
            actual["seen"],
            json!(["choose", selected]),
            "{label}: {actual}"
        );
    }
}

#[test]
fn codec_codegen_authored_constructor_names_preserve_strict_type_failures() {
    let mut cases = Vec::new();
    for name in ["ordinaryValue", "TypeError", "Array"] {
        for (value, kind) in [(json!(17), "number"), (json!([]), "array")] {
            for body in [
                json!(["str/encode-uri-component", value]),
                json!(["base64/encode", value]),
                json!(["base64/decode", value]),
                json!(["hash/sha256", value, "hex"]),
                json!(["hash/sha256", "abc", value]),
                json!(["hmac/sha256", value, "message", "hex"]),
                json!(["hmac/sha256", "key", value, "hex"]),
                json!(["hmac/sha256", "key", "message", value]),
            ] {
                let label = format!("{name}: {kind}: {body}");
                let lambda = emit(json!(["fn", name, body]));
                cases.push((
                    label,
                    format!("() => (({lambda})('authored constructor value'))"),
                    kind,
                ));
            }
        }
    }
    let output = run(&format!(
        "process.stdout.write(JSON.stringify([{}].map(capture)));",
        cases
            .iter()
            .map(|(_, call, _)| call.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 48);
    for (actual, (label, _, kind)) in output.as_array().unwrap().iter().zip(cases) {
        assert_eq!(actual["name"], "TypeError", "{label}: {actual}");
        assert_eq!(
            actual["error"],
            json!(format!("Type mismatch: expected string, got {kind}")),
            "{label}: {actual}"
        );
        assert_eq!(actual["codec"], false, "{label}: {actual}");
    }
}

#[test]
fn codec_codegen_authored_error_parameter_preserves_arity_error_construction() {
    let mut cases = Vec::new();
    for name in ["ordinaryValue", "Error"] {
        for (op, arity) in OPERATORS {
            let body = OirExpr::call(op, vec![OirExpr::string("unread"); arity - 1]);
            let lambda =
                TypeScriptBackend::new().expr_to_ts(&OirExpr::lambda(vec![name.into()], body));
            let count = match arity {
                1 => "one",
                2 => "two",
                3 => "three",
                _ => unreachable!(),
            };
            cases.push((
                format!("{name}: {op}"),
                format!("() => (({lambda})('authored error value'))"),
                format!(
                    "Invalid argument: {op}: expected exactly {count} argument{}",
                    if arity == 1 { "" } else { "s" }
                ),
            ));
        }
    }
    let output = run(&format!(
        "process.stdout.write(JSON.stringify([{}].map(capture)));",
        cases
            .iter()
            .map(|(_, call, _)| call.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 10);
    for (actual, (label, _, error)) in output.as_array().unwrap().iter().zip(cases) {
        assert_eq!(actual["name"], "Error", "{label}: {actual}");
        assert_eq!(actual["error"], json!(error), "{label}: {actual}");
        assert_eq!(actual["codec"], false, "{label}: {actual}");
    }
}

#[test]
fn codec_codegen_duplicate_authored_parameters_keep_the_last_supplied_binding() {
    let mut cases = Vec::new();
    for name in [
        "ordinaryValue",
        "__message",
        "encodeBase64",
        "CodecError",
        "Value",
        "index",
    ] {
        let duplicate = emit(json!([
            "fn",
            [name, name],
            ["base64/encode", format!("@{name}")]
        ]));
        cases.push((
            format!("duplicate {name}"),
            format!("() => (({duplicate})('first', 'f'))"),
        ));
        let control = emit(json!([
            "fn",
            [format!("{name}First"), name],
            ["base64/encode", format!("@{name}")]
        ]));
        cases.push((
            format!("distinct control {name}"),
            format!("() => (({control})('first', 'f'))"),
        ));
        let nested = emit(json!([
            "fn",
            name,
            ["fn", [name, name], ["base64/encode", format!("@{name}")]]
        ]));
        cases.push((
            format!("nested duplicate {name}"),
            format!("() => (({nested})('outer')('first', 'f'))"),
        ));
    }
    let output = run(&format!(
        "process.stdout.write(JSON.stringify([{}].map(capture)));",
        cases
            .iter()
            .map(|(_, call)| call.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 18);
    for (actual, (label, _)) in output.as_array().unwrap().iter().zip(cases) {
        assert_eq!(actual["value"], "Zg==", "{label}: {actual}");
    }
}

#[test]
fn codec_codegen_public_backend_default_scope_field_initialization_remains_usable() {
    let expression: SExpression = serde_json::from_value(json!([
        "fn",
        "encodeBase64",
        ["base64/encode", "@encodeBase64"]
    ]))
    .unwrap();
    let expression = lower_sexpr(&expression).unwrap();
    let external = TypeScriptBackend {
        local_scopes: Default::default(),
        ..TypeScriptBackend::default()
    };
    let calls = [
        TypeScriptBackend::default().expr_to_ts(&expression),
        external.expr_to_ts(&expression),
    ];
    let output = run(&format!(
        "process.stdout.write(JSON.stringify([{}].map(capture)));",
        calls
            .iter()
            .map(|lambda| format!("() => (({lambda})('f'))"))
            .collect::<Vec<_>>()
            .join(", ")
    ));
    assert_eq!(output, json!([{ "value": "Zg==" }, { "value": "Zg==" }]));
}

#[test]
fn codec_codegen_binder_aliases_do_not_capture_structured_free_operand_roots() {
    let mut cases = Vec::new();
    for free_root in ["ordinaryFreeEncoding", "encodeDigest__1"] {
        let binding = |root: &str, path: &str| {
            OirExpr::binding(OirBinding::new(
                OirBindingRoot::Local(root.into()),
                vec![path.into()],
            ))
        };
        let body = OirExpr::call(
            "hash/sha256",
            vec![OirExpr::string("abc"), binding(free_root, "encoding")],
        );
        for callback in [false, true] {
            let expression = if callback {
                OirExpr::Map {
                    source: Box::new(binding("input", "values")),
                    variable: "encodeDigest".into(),
                    body: Box::new(body.clone()),
                }
            } else {
                OirExpr::lambda(vec!["encodeDigest".into()], body.clone())
            };
            let generated = TypeScriptBackend::new().expr_to_ts(&expression);
            let result = if callback {
                format!("JSON.stringify({generated})")
            } else {
                format!("({generated})('authored parameter value')")
            };
            let call = format!(
                "() => {{ let seen: string[] = []; const {free_root} = {{ get encoding() {{ seen.push('encoding'); return 'hex'; }} }}; const input = {{ get values() {{ seen.push('source'); return ['first', 'second']; }} }}; return {{ result: capture(() => ({result})), seen }}; }}"
            );
            cases.push((format!("{free_root}: callback={callback}"), call, callback));
        }
    }
    let output = run(&format!(
        "process.stdout.write(JSON.stringify([{}].map(call => call())));",
        cases
            .iter()
            .map(|(_, call, _)| call.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 4);
    let digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    for (actual, (label, _, callback)) in output.as_array().unwrap().iter().zip(cases) {
        let expected = if callback {
            serde_json::to_string(&[digest, digest]).unwrap()
        } else {
            digest.to_string()
        };
        assert_eq!(
            actual["result"]["value"],
            json!(expected),
            "{label}: {actual}"
        );
        let seen = if callback {
            vec!["source", "encoding", "encoding"]
        } else {
            vec!["encoding"]
        };
        assert_eq!(actual["seen"], json!(seen), "{label}: {actual}");
    }
}

#[test]
fn codec_codegen_authored_binders_do_not_capture_canonical_host_binding_roots() {
    let mut cases = Vec::new();
    for (root, host_name, field_name) in [
        (OirBindingRoot::Entity, "fields", "value"),
        (OirBindingRoot::Payload, "payload", "value"),
        (OirBindingRoot::User, "user", "id"),
    ] {
        let body = OirExpr::call(
            "base64/encode",
            vec![OirExpr::binding(OirBinding::new(
                root,
                vec![field_name.into()],
            ))],
        );
        for authored in ["ordinaryValue", host_name] {
            for callback in [false, true] {
                let expression = if callback {
                    OirExpr::Map {
                        source: Box::new(OirExpr::binding(OirBinding::new(
                            OirBindingRoot::Local("input".into()),
                            vec!["values".into()],
                        ))),
                        variable: authored.into(),
                        body: Box::new(body.clone()),
                    }
                } else {
                    OirExpr::lambda(vec![authored.into()], body.clone())
                };
                let generated = TypeScriptBackend::new().expr_to_ts(&expression);
                let result = if callback {
                    format!("JSON.stringify({generated})")
                } else {
                    format!("({generated})(author)")
                };
                let call = format!(
                    "() => {{ let seen: string[] = []; const {host_name} = {{ get {field_name}() {{ seen.push('host'); return 'f'; }} }}; const author = {{ get {field_name}() {{ seen.push('author'); return 'wrong'; }} }}; const input = {{ get values() {{ seen.push('source'); return [author, author]; }} }}; return {{ result: capture(() => ({result})), seen }}; }}"
                );
                cases.push((
                    format!("{host_name}: authored={authored}: callback={callback}"),
                    call,
                    callback,
                ));
            }
        }
    }
    let output = run(&format!(
        "process.stdout.write(JSON.stringify([{}].map(call => call())));",
        cases
            .iter()
            .map(|(_, call, _)| call.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 12);
    for (actual, (label, _, callback)) in output.as_array().unwrap().iter().zip(cases) {
        let expected = if callback {
            "[\"Zg==\",\"Zg==\"]"
        } else {
            "Zg=="
        };
        assert_eq!(actual["result"]["value"], expected, "{label}: {actual}");
        let seen = if callback {
            vec!["source", "host", "host"]
        } else {
            vec!["host"]
        };
        assert_eq!(actual["seen"], json!(seen), "{label}: {actual}");
    }
}

#[test]
fn codec_codegen_current_plan_number_operator_preserves_intrinsics_and_strict_type_errors() {
    let inputs = [
        ("hex string", json!("0x10"), json!({ "value": "16" })),
        (
            "number",
            json!(17),
            json!({ "error": "Type mismatch: expected string, got number", "name": "TypeError", "codec": false, "reason": null }),
        ),
        (
            "array",
            json!([]),
            json!({ "error": "Type mismatch: expected string, got array", "name": "TypeError", "codec": false, "reason": null }),
        ),
    ];
    let control = dynamic("str/to-number", &["value"]);
    let controls = inputs
        .iter()
        .map(|(_, value, _)| {
            format!(
                "() => {{ let seen: string[] = []; const input = {{ get value(): RuntimeValue {{ seen.push('operand'); if (seen.length !== 1) throw new Error('operand read twice'); return {value}; }} }}; return {{ result: capture(() => JSON.stringify({control})), seen }}; }}"
            )
        })
        .collect::<Vec<_>>();
    let output = run(&format!(
        "process.stdout.write(JSON.stringify([{}].map(call => call())));",
        controls.join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 3);
    for (actual, (label, _, expected)) in output.as_array().unwrap().iter().zip(&inputs) {
        assert_eq!(&actual["result"], expected, "control {label}: {actual}");
        assert_eq!(actual["seen"], json!(["operand"]), "control {label}: {actual}");
    }

    let mut cases = Vec::new();
    for authored in ["ordinaryValue", "Number", "JSON", "TypeError", "Array"] {
        for free_root in ["input".to_string(), format!("{authored}__1")] {
            let operand = OirExpr::binding(OirBinding::new(
                OirBindingRoot::Local(free_root.clone()),
                vec!["value".into()],
            ));
            let expression = OirExpr::lambda(
                vec![free_root.clone()],
                OirExpr::lambda(
                    vec![authored.into()],
                    OirExpr::call("str/to-number", vec![operand]),
                ),
            );
            let generated = TypeScriptBackend::new().expr_to_ts(&expression);
            for (kind, value, expected) in &inputs {
                let call = format!(
                    "() => {{ let seen: string[] = []; const operand = {{ get value(): RuntimeValue {{ seen.push('operand'); if (seen.length !== 1) throw new Error('operand read twice'); return {value}; }} }}; const author = {{ get value() {{ seen.push('author'); return 'wrong'; }} }}; return {{ result: capture(() => JSON.stringify(({generated})(operand)(author))), seen }}; }}"
                );
                cases.push((
                    format!("authored={authored}, free={free_root}, input={kind}"),
                    call,
                    expected.clone(),
                ));
            }
        }
    }
    let output = run(&format!(
        "process.stdout.write(JSON.stringify([{}].map(call => call())));",
        cases.iter().map(|(_, call, _)| call.as_str()).collect::<Vec<_>>().join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 30);
    for (actual, (label, _, expected)) in output.as_array().unwrap().iter().zip(cases) {
        assert_eq!(actual["result"], expected, "{label}: {actual}");
        assert_eq!(actual["seen"], json!(["operand"]), "{label}: {actual}");
    }
}

#[test]
fn codec_codegen_current_plan_json_valid_preserves_intrinsics_and_strict_type_errors() {
    let inputs = [
        ("valid JSON", json!("null"), json!({ "value": "true" })),
        ("malformed JSON", json!("{"), json!({ "value": "false" })),
        (
            "number",
            json!(17),
            json!({ "error": "Type mismatch: expected string, got number", "name": "TypeError", "codec": false, "reason": null }),
        ),
        (
            "array",
            json!([]),
            json!({ "error": "Type mismatch: expected string, got array", "name": "TypeError", "codec": false, "reason": null }),
        ),
    ];
    let control = dynamic("json/valid", &["value"]);
    let controls = inputs
        .iter()
        .map(|(_, value, _)| {
            format!(
                "() => {{ let seen: string[] = []; const input = {{ get value(): RuntimeValue {{ seen.push('operand'); if (seen.length !== 1) throw new Error('operand read twice'); return {value}; }} }}; return {{ result: capture(() => JSON.stringify({control})), seen }}; }}"
            )
        })
        .collect::<Vec<_>>();
    let output = run(&format!(
        "process.stdout.write(JSON.stringify([{}].map(call => call())));",
        controls.join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 4);
    for (actual, (label, _, expected)) in output.as_array().unwrap().iter().zip(&inputs) {
        assert_eq!(&actual["result"], expected, "control {label}: {actual}");
        assert_eq!(actual["seen"], json!(["operand"]), "control {label}: {actual}");
    }

    let mut cases = Vec::new();
    for authored in ["ordinaryValue", "Number", "JSON", "TypeError", "Array"] {
        for free_root in ["input".to_string(), format!("{authored}__1")] {
            let operand = OirExpr::binding(OirBinding::new(
                OirBindingRoot::Local(free_root.clone()),
                vec!["value".into()],
            ));
            let expression = OirExpr::lambda(
                vec![free_root.clone()],
                OirExpr::lambda(
                    vec![authored.into()],
                    OirExpr::call("json/valid", vec![operand]),
                ),
            );
            let generated = TypeScriptBackend::new().expr_to_ts(&expression);
            for (kind, value, expected) in &inputs {
                let call = format!(
                    "() => {{ let seen: string[] = []; const operand = {{ get value(): RuntimeValue {{ seen.push('operand'); if (seen.length !== 1) throw new Error('operand read twice'); return {value}; }} }}; const author = {{ get value() {{ seen.push('author'); return 'wrong'; }} }}; return {{ result: capture(() => JSON.stringify(({generated})(operand)(author))), seen }}; }}"
                );
                cases.push((
                    format!("authored={authored}, free={free_root}, input={kind}"),
                    call,
                    expected.clone(),
                ));
            }
        }
    }
    let output = run(&format!(
        "process.stdout.write(JSON.stringify([{}].map(call => call())));",
        cases.iter().map(|(_, call, _)| call.as_str()).collect::<Vec<_>>().join(", ")
    ));
    assert_eq!(output.as_array().unwrap().len(), 40);
    for (actual, (label, _, expected)) in output.as_array().unwrap().iter().zip(cases) {
        assert_eq!(actual["result"], expected, "{label}: {actual}");
        assert_eq!(actual["seen"], json!(["operand"]), "{label}: {actual}");
    }
}

const URI_DECODE_VECTORS: &str = include_str!("fixtures/operators/uri-decode-vectors.json");
const CAPTURE_NULLABLE: &str = "const captureNullable = (run: () => string | null) => { try { return { value: run() }; } catch (error) { return { error: error instanceof Error ? error.message : String(error), name: error instanceof Error ? error.name : null, reason: error instanceof CodecError ? error.reason : null }; } };";

#[derive(Deserialize)]
struct UriCase {
    op: String,
    args: Vec<Value>,
    expect: Option<Value>,
    #[serde(default)]
    error: bool,
    source: String,
}

#[test]
fn uri_decode_codegen_uses_the_core_owner() {
    let valid = emit(json!(["str/uri-component-valid", "a%20b"]));
    assert!(!valid.contains("UNSUPPORTED"), "{valid}");
    assert!(valid.contains("decodeUriComponent(") && valid.contains("CodecError"), "{valid}");
    let generated = emit(json!(["str/decode-uri-component", "a%20b"]));
    assert!(!generated.contains("UNSUPPORTED"), "{generated}");
    assert!(generated.contains("decodeUriComponent("), "{generated}");
    assert!(generated.contains("typeof"), "{generated}");
    for forbidden in ["decodeURIComponent", "String(", "@almadar/evaluator"] {
        assert!(!generated.contains(forbidden), "{forbidden}: {generated}");
    }
}

#[test]
fn uri_decode_codegen_executes_every_shared_vector() {
    let cases: Vec<UriCase> = serde_json::from_str(URI_DECODE_VECTORS).unwrap();
    assert!(cases.iter().any(|case| case.error));
    assert!(cases.iter().any(|case| case.op == "str/uri-component-valid"));
    let expressions: Vec<String> = cases
        .iter()
        .map(|case| {
            let mut expression = vec![json!(case.op)];
            expression.extend(case.args.clone());
            format!("() => ({})", emit(Value::Array(expression)))
        })
        .collect();
    let valid_twins: Vec<String> = cases
        .iter()
        .filter(|case| case.op == "str/decode-uri-component" && !case.args[0].is_number())
        .map(|case| {
            let mut expression = vec![json!("str/uri-component-valid")];
            expression.extend(case.args.clone());
            format!("() => ({})", emit(Value::Array(expression)))
        })
        .collect();
    let twin_output = run(&format!(
        "{CAPTURE_NULLABLE} const results = [{}].map(captureNullable); process.stdout.write(JSON.stringify(results));",
        valid_twins.join(", ")
    ));
    let twins = twin_output.as_array().unwrap();
    let decode_cases: Vec<&UriCase> = cases
        .iter()
        .filter(|case| case.op == "str/decode-uri-component" && !case.args[0].is_number())
        .collect();
    assert_eq!(twins.len(), decode_cases.len());
    for (case, actual) in decode_cases.iter().zip(twins) {
        let expected = !case.error && !case.args[0].is_null();
        assert_eq!(actual["value"], json!(expected), "valid twin: {}", case.source);
    }
    let output = run(&format!(
        "{CAPTURE_NULLABLE} const results = [{}].map(captureNullable); process.stdout.write(JSON.stringify(results));",
        expressions.join(", ")
    ));
    let results = output.as_array().unwrap();
    assert_eq!(results.len(), cases.len());
    for (index, (case, actual)) in cases.iter().zip(results).enumerate() {
        if case.error {
            if case.args[0].is_number() {
                assert_eq!(actual["name"], json!("TypeError"), "{index}: {}", case.source);
                assert_eq!(
                    actual["error"],
                    json!("Type mismatch: expected string, got number"),
                    "{index}: {}",
                    case.source
                );
            } else {
                assert_eq!(actual["reason"], json!("URI malformed"), "{index}: {}", case.source);
            }
        } else {
            assert_eq!(actual["value"], case.expect.clone().unwrap_or(Value::Null), "{index}: {}", case.source);
        }
    }
}

const MD5_VECTORS: &str = include_str!("fixtures/operators/md5-vectors.json");

#[test]
fn md5_codegen_uses_the_core_owner() {
    let generated = emit(json!(["hash/md5", "YWJj", "hex"]));
    assert!(!generated.contains("UNSUPPORTED"), "{generated}");
    assert!(generated.contains("md5Bytes(base64DecodeBytes("), "{generated}");
    for forbidden in ["createHash", "crypto", "Buffer", "@almadar/evaluator"] {
        assert!(!generated.contains(forbidden), "{forbidden}: {generated}");
    }
}

#[test]
fn md5_codegen_executes_every_shared_vector() {
    let cases: Vec<UriCase> = serde_json::from_str(MD5_VECTORS).unwrap();
    assert!(cases.iter().any(|case| case.error));
    let expressions: Vec<String> = cases
        .iter()
        .map(|case| {
            let mut expression = vec![json!(case.op)];
            expression.extend(case.args.clone());
            format!("() => ({})", emit(Value::Array(expression)))
        })
        .collect();
    let output = run(&format!(
        "const results = [{}].map(capture); process.stdout.write(JSON.stringify(results));",
        expressions.join(", ")
    ));
    let results = output.as_array().unwrap();
    assert_eq!(results.len(), cases.len());
    for (index, (case, actual)) in cases.iter().zip(results).enumerate() {
        if case.error {
            assert!(actual["error"].is_string(), "{index}: {}: {actual}", case.source);
            if case.args[0].is_number() {
                assert_eq!(actual["name"], json!("TypeError"), "{index}: {}", case.source);
            } else {
                assert_eq!(actual["codec"], json!(true), "{index}: {}: {actual}", case.source);
            }
        } else {
            assert_eq!(actual["value"].as_str(), case.expect.as_ref().and_then(Value::as_str), "{index}: {}: {actual}", case.source);
        }
    }
}
