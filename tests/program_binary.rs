//! The built `orb-shell-typescript` executable speaks the shell protocol across
//! a real process boundary, as `orb` drives it.

use orbital_core::ir::OirModule;
use orbital_core::project::WriteOptions;
use orbital_core::shell_protocol::{describe, invoke, invoke_emit, GenerateRequest, CODE_IR_INCOMPATIBLE, IR_VERSION};
use std::collections::BTreeMap;
use std::path::Path;

const BINARY: &str = env!("CARGO_BIN_EXE_orb-shell-typescript");

fn request(ir_version: u32) -> GenerateRequest {
    GenerateRequest {
        ir_version,
        module: OirModule::new("App", "1.0.0"),
        resolved: None,
        source_path: None,
        write: WriteOptions::default(),
        options: BTreeMap::new(),
    }
}

#[test]
fn describe_names_the_shell_and_its_ir_range() {
    let description = describe(Path::new(BINARY)).unwrap();
    assert_eq!(description.name, "typescript");
    assert!(description.ir_versions.accepts(IR_VERSION));
}

#[test]
fn emit_returns_files_and_writes_nothing() {
    let output = invoke_emit(Path::new(BINARY), &request(IR_VERSION)).unwrap();
    assert!(!output.files.is_empty());
    assert!(output.files.iter().all(|f| !f.path.is_empty()));
}

#[test]
fn generate_writes_the_files_it_reports() {
    let out = std::env::temp_dir().join(format!("orb-shell-ts-bin-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let response = invoke(Path::new(BINARY), &request(IR_VERSION), &out).unwrap();
    assert!(!response.files.is_empty());
    let missing: Vec<&String> = response.files.iter().filter(|f| !out.join(f).is_file()).collect();
    std::fs::remove_dir_all(&out).unwrap();
    assert!(missing.is_empty(), "reported but not written: {missing:?}");
}

#[test]
fn control_an_ir_the_shell_does_not_accept_is_refused_by_code() {
    let err = invoke_emit(Path::new(BINARY), &request(IR_VERSION + 1)).unwrap_err();
    assert_eq!(err.code, CODE_IR_INCOMPATIBLE);
}

#[test]
fn edge_a_bad_option_is_refused_not_ignored() {
    let mut bad = request(IR_VERSION);
    bad.options.insert("framework".to_string(), serde_json::Value::from("koa"));
    let err = invoke_emit(Path::new(BINARY), &bad).unwrap_err();
    assert!(err.message.contains("framework must be express or hono"), "{}", err.message);
}

