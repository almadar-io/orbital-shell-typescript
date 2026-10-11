//! `orb-shell-typescript`: the TypeScript shell as a program (`orbital_core::shell_protocol`).

use crate::{express_shell, hono_shell, ExtraComponentMapping, ServerFramework, TypeScriptBackend};
use orbital_core::project::{copy_public, resolve_public_dir, write_project};
use orbital_core::shell_protocol::{
    GenerateRequest, GenerateResponse, IrVersions, ShellDescription, ShellFailure, ShellOption, ShellProgram,
    CODE_BAD_REQUEST, CODE_GENERATE_FAILED, IR_VERSION,
};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

pub struct TypeScriptProgram;

const FRAMEWORK: &str = "framework";
const SCHEMA_LANGUAGE: &str = "schemaLanguage";
const DEV_LOGS: &str = "devLogs";
const BACKEND_URL: &str = "backendUrl";
const PROJECT_PATTERNS: &str = "projectPatterns";

fn option(name: &str, description: &str, values: Option<&[&str]>, default: Option<&str>) -> ShellOption {
    ShellOption {
        name: name.to_string(),
        description: description.to_string(),
        values: values.map(|v| v.iter().map(|s| s.to_string()).collect()),
        default: default.map(str::to_string),
    }
}

fn string_option<'a>(request: &'a GenerateRequest, name: &str) -> Result<Option<&'a str>, ShellFailure> {
    match request.options.get(name) {
        None => Ok(None),
        Some(Value::String(s)) => Ok(Some(s)),
        Some(other) => Err(ShellFailure::new(CODE_BAD_REQUEST, format!("option {name} must be a string, got {other}"))),
    }
}

/// A project's `patterns.json` as component mappings: each pattern's `component`
/// (else its PascalCase name) and `category` (else `display`).
pub fn component_mappings(patterns: &Value) -> Option<HashMap<String, ExtraComponentMapping>> {
    let mappings: HashMap<String, ExtraComponentMapping> = patterns
        .get("patterns")
        .and_then(Value::as_object)?
        .iter()
        .map(|(name, def)| {
            let component = def
                .get("component")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| orbital_core::str_utils::kebab_to_pascal(name));
            let category = def.get("category").and_then(Value::as_str).unwrap_or("display").to_string();
            (name.clone(), ExtraComponentMapping { component, category })
        })
        .collect();
    (!mappings.is_empty()).then_some(mappings)
}

/// Copy `{source_dir}/locales/*.json` into `{output}/locales/` (the generated
/// App.tsx imports `../../../locales/{locale}.json`), with an empty catalog for
/// each built-in locale the project does not provide.
pub fn copy_locales(source_path: &Path, output: &Path) -> std::io::Result<()> {
    let destination = output.join("locales");
    std::fs::create_dir_all(&destination)?;
    if let Some(source_locales) = source_path.parent().map(|d| d.join("locales")).filter(|d| d.is_dir()) {
        for entry in std::fs::read_dir(source_locales)?.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                std::fs::copy(&path, destination.join(entry.file_name()))?;
            }
        }
    }
    for lang in ["en", "ar", "sl"] {
        let path = destination.join(format!("{lang}.json"));
        if !path.exists() {
            std::fs::write(path, "{}")?;
        }
    }
    Ok(())
}

/// Set `VITE_API_URL` in `{output}/.env`, keeping every other line.
pub fn write_backend_url(output: &Path, url: &str) -> std::io::Result<()> {
    let path = output.join(".env");
    let line = format!("VITE_API_URL={url}");
    let content = if path.exists() {
        let existing = std::fs::read_to_string(&path)?;
        if existing.lines().any(|l| l.starts_with("VITE_API_URL=")) {
            existing
                .lines()
                .map(|l| if l.starts_with("VITE_API_URL=") { line.clone() } else { l.to_string() })
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            format!("{}\n# Backend API URL (auto-generated)\n{line}\n", existing.trim())
        }
    } else {
        format!("# Backend API URL (auto-generated)\n{line}\n")
    };
    std::fs::write(path, content)
}

impl ShellProgram for TypeScriptProgram {
    fn describe(&self) -> ShellDescription {
        ShellDescription {
            name: "typescript".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            ir_versions: IrVersions { min: IR_VERSION, max: IR_VERSION },
            needs_resolved: true,
            options: vec![
                option(FRAMEWORK, "Server framework", Some(&["express", "hono"]), Some("express")),
                option(SCHEMA_LANGUAGE, "Language the program is written in", None, Some("en")),
                option(DEV_LOGS, "Emit development logging", Some(&["true", "false"]), Some("false")),
                option(BACKEND_URL, "Backend URL written to .env as VITE_API_URL", None, None),
                option(PROJECT_PATTERNS, "The project's patterns.json (component mappings)", None, None),
            ],
        }
    }

    fn generate(&self, request: &GenerateRequest, output: &Path) -> Result<GenerateResponse, ShellFailure> {
        let backend = backend(request)?;
        let shell = match backend.server_framework {
            ServerFramework::Express => express_shell(),
            ServerFramework::Hono => hono_shell(),
        };
        let generated = write_project(&request.module, output, &shell, &backend, &request.write)?;
        let failed = |what: &str, e: std::io::Error| ShellFailure::new(CODE_GENERATE_FAILED, format!("{what}: {e}"));
        if let Some(source) = &request.source_path {
            copy_locales(source, output).map_err(|e| failed("copy locales", e))?;
            if let Some(public) = request.resolved.as_ref().and_then(|r| r.public_dir.as_deref()) {
                let from = resolve_public_dir(source, public).map_err(|m| ShellFailure::new(CODE_GENERATE_FAILED, m))?;
                copy_public(&from, &output.join("packages/client/public")).map_err(|e| failed("copy public folder", e))?;
            }
        }
        let mut next_steps = Vec::new();
        if let Some(url) = string_option(request, BACKEND_URL)? {
            write_backend_url(output, url).map_err(|e| failed("write .env", e))?;
            next_steps.push(format!("Configured backend URL: {url}"));
        }
        Ok(GenerateResponse {
            files: generated.files.iter().map(|f| f.path.clone()).collect(),
            warnings: generated.warnings,
            next_steps,
        })
    }

    fn emit(&self, request: &GenerateRequest) -> Result<orbital_core::generate::GeneratedOutput, ShellFailure> {
        use orbital_core::generate::Backend as _;
        Ok(backend(request)?.generate(&request.module))
    }
}

/// The backend `request`'s options describe.
fn backend(request: &GenerateRequest) -> Result<TypeScriptBackend, ShellFailure> {
    let framework = match string_option(request, FRAMEWORK)?.unwrap_or("express") {
        "express" => ServerFramework::Express,
        "hono" => ServerFramework::Hono,
        other => return Err(ShellFailure::new(CODE_BAD_REQUEST, format!("framework must be express or hono, got {other}"))),
    };
    let dev_logs = match string_option(request, DEV_LOGS)?.unwrap_or("false") {
        "true" => true,
        "false" => false,
        other => return Err(ShellFailure::new(CODE_BAD_REQUEST, format!("devLogs must be true or false, got {other}"))),
    };
    Ok(TypeScriptBackend {
        extra_mappings: request.options.get(PROJECT_PATTERNS).and_then(component_mappings),
        schema_language: string_option(request, SCHEMA_LANGUAGE)?.unwrap_or("en").to_string(),
        dev_logs,
        server_framework: framework,
        browser_schema: request.resolved.clone(),
        ..TypeScriptBackend::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pattern_without_a_component_takes_its_pascal_case_name() {
        let m = component_mappings(&serde_json::json!({"patterns": {"signature-pad": {}, "map": {"component": "GeoMap", "category": "display"}}})).unwrap();
        assert_eq!(m["signature-pad"].component, "SignaturePad");
        assert_eq!(m["signature-pad"].category, "display");
        assert_eq!(m["map"].component, "GeoMap");
    }

    #[test]
    fn control_no_patterns_is_no_mappings() {
        assert!(component_mappings(&serde_json::json!({"patterns": {}})).is_none());
        assert!(component_mappings(&serde_json::json!({})).is_none());
    }

    #[test]
    fn the_backend_url_replaces_an_existing_line_and_keeps_the_rest() {
        let dir = std::env::temp_dir().join(format!("orb-ts-env-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(".env"), "A=1\nVITE_API_URL=http://old\nB=2").unwrap();
        write_backend_url(&dir, "http://new").unwrap();
        assert_eq!(std::fs::read_to_string(dir.join(".env")).unwrap(), "A=1\nVITE_API_URL=http://new\nB=2");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn edge_a_bad_framework_is_refused() {
        let request = GenerateRequest {
            ir_version: IR_VERSION,
            module: orbital_core::ir::OirModule::new("App", "1.0.0"),
            resolved: None,
            source_path: None,
            write: Default::default(),
            options: [(FRAMEWORK.to_string(), Value::String("koa".into()))].into_iter().collect(),
        };
        let err = TypeScriptProgram.generate(&request, Path::new("/tmp")).unwrap_err();
        assert_eq!(err.code, CODE_BAD_REQUEST);
    }
}
