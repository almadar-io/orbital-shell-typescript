//! Pillar B6 — the consolidation gate.
//!
//! Makes re-introducing a parallel expression→TS emitter a CI failure rather
//! than a code-review hope. After Pillar B there is exactly ONE expression
//! emitter (`expr_to_ts_flavored` + `call_to_ts_typed`); Pipeline 1
//! (`sexpr_to_ts/`, `compile_sexpr_to_ts`, `compile_operator_call`) and the
//! reverted `OirValue→TS` walker (`compile_render_prop_expr`) are gone. This
//! test fails if any of them comes back, or if the canonical emitter is
//! removed/duplicated.

use std::fs;
use std::path::Path;

mod common;
use common::grep_helpers::{count, strip_test_blocks, ts_escape_hatch_uses};

/// Recursively concatenate every `.rs` source file under `src/` (path + body),
/// so the assertions can grep the whole crate.
fn all_src() -> String {
    fn walk(dir: &Path, out: &mut String) {
        for entry in fs::read_dir(dir).expect("read_dir").flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
                out.push_str(&format!("\n// FILE: {}\n", path.display()));
                out.push_str(&fs::read_to_string(&path).unwrap_or_default());
            }
        }
    }
    let mut out = String::new();
    walk(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src").as_path(),
        &mut out,
    );
    out
}

#[test]
fn pipeline_1_stays_deleted() {
    let src = all_src();
    // Pipeline 1 (the SExpression emitter) and its entry points must not
    // return. The `sexpr_to_ts` token only appears in historical doc comments;
    // a re-added MODULE or its functions are what we ban.
    for banned in [
        "mod sexpr_to_ts",
        "fn compile_sexpr_to_ts",
        "fn compile_operator_call",
        "fn compile_sexpr(",
        "fn compile_sexpr_with_context",
    ] {
        assert!(
            !src.contains(banned),
            "Pillar-B gate: `{banned}` is back — Pipeline 1 (the second expression emitter) must stay deleted. \
             Lower expressions to OirExpr and emit via expr_to_ts_flavored / call_to_ts_typed instead."
        );
    }
}

#[test]
fn no_parallel_oirvalue_emitter() {
    let src = all_src();
    // The reverted render-prop walker emitted TS straight from OirValue,
    // bypassing OirExpr (and the would-be EmitTs seal). Render props lower via
    // resolve_sexpr_standalone → expr_to_ts_flavored(Render) instead.
    assert!(
        !src.contains("fn compile_render_prop_expr"),
        "Pillar-B gate: a parallel OirValue→TS walker is back. Render props must lower to OirExpr \
         (resolve_sexpr_standalone) and emit via the one emitter (expr_to_ts_flavored, BindingFlavor::Render)."
    );
}

#[test]
fn exactly_one_canonical_emitter() {
    let src = all_src();
    // Tripwire: the canonical emitter + operator table must exist and be unique.
    // (Duplicating them is how the twin pipelines re-grow.)
    assert_eq!(
        count(&src, "fn expr_to_ts_flavored"),
        1,
        "Pillar-B gate: there must be exactly ONE `expr_to_ts_flavored` (the single expression emitter)."
    );
    assert_eq!(
        count(&src, "fn call_to_ts_typed"),
        1,
        "Pillar-B gate: there must be exactly ONE `call_to_ts_typed` (the single operator table)."
    );
}

/// Pillar D — one canonical helper per mechanical concept. The literal
/// emitter, the JS-string escaper, and the `to_lowercase_nosep` case
/// converter each collapsed to a single definition; this fails if a fork
/// re-grows.
#[test]
fn pillar_d_helpers_stay_single() {
    let src = all_src();
    // The OirValue→TS literal emitter: one free function `oir_value_to_ts_literal`.
    // The two old forks (`fn value_to_ts` in entity_generator, the inline match
    // in `oir_value_to_ts`) are gone — `oir_value_to_ts` now delegates.
    assert_eq!(
        count(&src, "fn oir_value_to_ts_literal"),
        1,
        "Pillar-D gate: there must be exactly ONE OirValue→TS literal emitter (`oir_value_to_ts_literal`)."
    );
    assert!(
        !src.contains("pub fn value_to_ts(") && !src.contains("fn value_to_ts("),
        "Pillar-D gate: the entity_generator `value_to_ts` literal fork is back — delegate to `oir_value_to_ts_literal`."
    );
    // JS-string escaper must NOT be defined locally — it lives in `orbital_core::str_utils`.
    assert_eq!(
        count(&src, "fn escape_js_string"),
        0,
        "Pillar-D gate: a local `escape_js_string` is back — the canonical definition lives \
         in `orbital_core::str_utils`; re-export it from there instead."
    );
    // One `to_lowercase_nosep` (the test_generator byte-dup was removed).
    assert_eq!(
        count(&src, "fn to_lowercase_nosep"),
        1,
        "Pillar-D gate: there must be exactly ONE `to_lowercase_nosep` (no per-module copies)."
    );
    // One inline-struct-literal walker.
    assert_eq!(
        count(&src, "fn struct_fields_ts"),
        1,
        "Pillar-D gate: there must be exactly ONE inline-struct-literal walker (`struct_fields_ts`)."
    );
    // The dead `map_type_with_enum` fork in entity_generator was deleted; the
    // canonical one is the `TypeScriptBackend` method.
    assert_eq!(
        count(&src, "fn map_type_with_enum"),
        1,
        "Pillar-D gate: the entity_generator `map_type_with_enum` fork is back — keep only the TypeScriptBackend method."
    );
}

/// Pillar F2 — the array-coerce JSX idiom (`Array.isArray(x) ? <cast> : []`)
/// lives ONLY in `array_coerce_value` / `array_coerce_prop`. The inline copies
/// that re-spelled the entity-cast (TS2352/TS4104) surface — where EC-5b-style
/// fixes had to be mirrored by hand — now route through the one helper. A
/// re-inlined collection coerce re-introduces the JSX-closed tail `: []}}`.
#[test]
fn array_coerce_single_home() {
    let src = all_src();
    assert_eq!(
        count(&src, "fn array_coerce_value"),
        1,
        "Pillar-F2 gate: there must be exactly ONE array-coerce expression builder (`array_coerce_value`)."
    );
    assert_eq!(
        count(&src, "fn array_coerce_prop"),
        1,
        "Pillar-F2 gate: there must be exactly ONE array-coerce prop emitter (`array_coerce_prop`)."
    );
    assert_eq!(
        count(&src, ": []}}"),
        0,
        "Pillar-F2 gate: a collection array-coerce was re-inlined (the `: []}}` JSX tail is back). \
         Emit it through `array_coerce_prop` instead of a per-site format!."
    );
}

/// Extract the contents of every Rust string literal (plain, raw `r"…"`,
/// `r#"…"#`, byte variants) from `src`, skipping comments and char literals.
fn string_literals(src: &str) -> Vec<String> {
    let b = src.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == b'/' && i + 1 < b.len() && b[i + 1] == b'/' {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
        } else if c == b'/' && i + 1 < b.len() && b[i + 1] == b'*' {
            i += 2;
            while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                i += 1;
            }
            i += 2;
        } else if c == b'\'' {
            // char literal (`'x'`, `'\n'`, `'\u{..}'`) or a lifetime — skip a
            // char literal wholesale so its `'"'` form cannot open a string.
            if i + 1 < b.len() && b[i + 1] == b'\\' {
                let mut j = i + 2;
                while j < b.len() && b[j] != b'\'' {
                    j += 1;
                }
                i = j + 1;
            } else if i + 2 < b.len() && b[i + 2] == b'\'' {
                i += 3;
            } else {
                i += 1;
            }
        } else if c == b'"'
            || ((c == b'r' || c == b'b')
                && i + 1 < b.len()
                && (b[i + 1] == b'"' || b[i + 1] == b'#' || (c == b'b' && b[i + 1] == b'r')))
        {
            // Identify raw/plain by walking the prefix.
            let mut j = i;
            let mut raw = false;
            if b[j] == b'b' {
                j += 1;
            }
            if j < b.len() && b[j] == b'r' {
                raw = true;
                j += 1;
            }
            let mut hashes = 0;
            while j < b.len() && b[j] == b'#' {
                hashes += 1;
                j += 1;
            }
            if j >= b.len() || b[j] != b'"' {
                // `b` / `r` / `#` that was not a literal prefix (an identifier
                // ending in r, an attribute) — advance one byte.
                i += 1;
                continue;
            }
            j += 1;
            let start = j;
            if raw {
                loop {
                    if j >= b.len() {
                        break;
                    }
                    if b[j] == b'"' {
                        let mut k = 0;
                        while k < hashes && j + 1 + k < b.len() && b[j + 1 + k] == b'#' {
                            k += 1;
                        }
                        if k == hashes {
                            break;
                        }
                    }
                    j += 1;
                }
                out.push(String::from_utf8_lossy(&b[start..j.min(b.len())]).into_owned());
                i = j + 1 + hashes;
            } else {
                while j < b.len() && b[j] != b'"' {
                    if b[j] == b'\\' {
                        j += 1;
                    }
                    j += 1;
                }
                out.push(String::from_utf8_lossy(&b[start..j.min(b.len())]).into_owned());
                i = j + 1;
            }
        } else {
            i += 1;
        }
    }
    out
}

/// The emitted TypeScript is typed end-to-end: no `unknown`, no `any`.
/// Scans every string literal in the crate's non-test source (the emitter
/// templates) for the two escape-hatch type tokens (the static shell templates
/// are scanned by orbital-rust's `workspace_grepwall`), so a new `Record<string, unknown>` or `as any` fails CI instead
/// of waiting for code review. Ground a boundary in `@almadar/core`
/// (`EventPayload`, `EntityRow`, `FieldValue`, `JsonValue`, their zod twins)
/// instead.
#[test]
fn emitted_typescript_has_no_unknown_or_any() {
    let src = strip_test_blocks(&all_src());
    let mut hits: Vec<String> = Vec::new();
    for lit in string_literals(&src) {
        // The bare pattern-type placeholder `"unknown"` is a value, not a type.
        if lit == "unknown" {
            continue;
        }
        for u in ts_escape_hatch_uses(&lit) {
            hits.push(format!("emitter literal: {u}"));
        }
    }
    assert!(
        hits.is_empty(),
        "emitted TypeScript uses `unknown`/`any` as a type ({} hit(s)):\n{}",
        hits.len(),
        hits.join("\n")
    );
}

/// The detector behind `emitted_typescript_has_no_unknown_or_any` must flag
/// every type position and no prose, and the literal scanner must actually
/// see the emitter strings — otherwise the gate above is green for nothing.
#[test]
fn escape_hatch_detector_classifies_type_positions() {
    for flagged in [
        "Record<string, unknown>",
        "(value: unknown) => void",
        "let x: unknown;",
        "foo as any",
        "x as unknown as Y",
        "Array<any>",
        "const invalid: Record<string, unknown> = {};",
        "z.ZodType<any> = z.object({",
        "items: any[]",
        "payload: unknown | undefined,",
        "} catch (err: unknown) {",
    ] {
        assert!(
            !ts_escape_hatch_uses(flagged).is_empty(),
            "must flag: {flagged}"
        );
    }
    for prose in [
        "array/take must guard unknown sources",
        "  // Add any page-level props here",
        "'Unknown error'",
        "Record<string, z.ZodTypeAny>",
        "an unknown email signs in as a new end-user",
        "variant: 'any'",
        "company",
    ] {
        assert!(
            ts_escape_hatch_uses(prose).is_empty(),
            "must not flag: {prose}"
        );
    }
    let lits = string_literals(&strip_test_blocks(&all_src()));
    assert!(
        lits.len() > 5_000,
        "literal scanner saw only {} literals",
        lits.len()
    );
    assert!(
        lits.iter()
            .any(|l| l.contains("Record<string, z.ZodTypeAny>")),
        "literal scanner must see the Hono payload-schema map literal"
    );
    assert!(
        lits.iter()
            .any(|l| l.contains("const __payloadWide = payload as EventPayload | undefined")),
        "literal scanner must see ENTITY_ID_FROM_PAYLOAD_DECL"
    );
}
