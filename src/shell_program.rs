//! `orb-shell-typescript`: the TypeScript shell as a program (`orbital_core::shell_protocol`).

use crate::{
    express_shell, hono_shell, ExtraComponentMapping, ServerFramework, TypeScriptBackend, KERNEL_CLIENT_DEPENDENCIES,
    KERNEL_SERVER_DEPENDENCIES,
};
use orbital_core_base::project::{copy_public, resolve_public_dir, write_project};
use orbital_core_base::shell_protocol::{
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
const HOST: &str = "host";

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
                .unwrap_or_else(|| orbital_core_base::str_utils::kebab_to_pascal(name));
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

/// Add `dependencies` to a template `package.json`'s `"dependencies"` block, keeping every other
/// line; a package already listed is left as the template pins it.
pub fn add_dependencies(path: &Path, dependencies: &[(&str, &str)]) -> std::io::Result<()> {
    let existing = std::fs::read_to_string(path)?;
    let updated = with_dependencies(&existing, dependencies).ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, format!("{} has no \"dependencies\" block", path.display()))
    })?;
    std::fs::write(path, updated)
}

fn with_dependencies(package_json: &str, dependencies: &[(&str, &str)]) -> Option<String> {
    const ANCHOR: &str = "\"dependencies\": {\n";
    let at = package_json.find(ANCHOR)? + ANCHOR.len();
    let added: String = dependencies
        .iter()
        .filter(|(name, _)| !package_json.contains(&format!("\"{name}\":")))
        .map(|(name, version)| format!("    \"{name}\": \"{version}\",\n"))
        .collect();
    Some(format!("{}{}{}", &package_json[..at], added, &package_json[at..]))
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
                option(
                    HOST,
                    "Who runs the app's execution steps: the embedded @almadar/kernel",
                    Some(&["kernel"]),
                    Some("kernel"),
                ),
            ],
        }
    }

    fn generate(&self, request: &GenerateRequest, output: &Path) -> Result<GenerateResponse, ShellFailure> {
        language_ready(orbital_core_eval::language_loader::preflight)?;
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
        add_dependencies(&output.join("packages/server/package.json"), KERNEL_SERVER_DEPENDENCIES).map_err(|e| failed("add kernel dependencies to the server", e))?;
        add_dependencies(&output.join("packages/client/package.json"), KERNEL_CLIENT_DEPENDENCIES).map_err(|e| failed("add kernel dependencies to the client", e))?;
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

    fn emit(&self, request: &GenerateRequest) -> Result<orbital_core_base::generate::GeneratedOutput, ShellFailure> {
        use orbital_core_base::generate::Backend as _;
        language_ready(orbital_core_eval::language_loader::preflight)?;
        Ok(backend(request)?.generate(&request.module))
    }
}

/// The installed core and std must load for this shell before it generates: an incompatible
/// install (a std naming operators this shell predates) is a structured failure, never a panic.
fn language_ready(
    preflight: impl FnOnce() -> Result<(), orbital_core_base::language_data::LanguageDataError>,
) -> Result<(), ShellFailure> {
    preflight().map_err(|e| ShellFailure::new(e.code(), e.to_string()))
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
    match string_option(request, HOST)?.unwrap_or("kernel") {
        "kernel" => {}
        other => return Err(ShellFailure::new(CODE_BAD_REQUEST, format!("host must be kernel, got {other}: the generated handlers and hooks are retired"))),
    }
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

    fn request_with(options: &[(&str, &str)]) -> GenerateRequest {
        GenerateRequest {
            ir_version: IR_VERSION,
            module: orbital_core_base::ir::OirModule::new("App", "1.0.0"),
            resolved: None,
            source_path: None,
            write: Default::default(),
            options: options.iter().map(|(k, v)| (k.to_string(), Value::String(v.to_string()))).collect(),
        }
    }

    #[test]
    fn the_host_option_is_declared_with_the_kernel_as_its_only_value() {
        let host = TypeScriptProgram.describe().options.into_iter().find(|o| o.name == HOST).expect("host option");
        assert_eq!(host.default.as_deref(), Some("kernel"));
        assert_eq!(host.values, Some(vec!["kernel".to_string()]));
    }

    #[test]
    fn the_retired_generated_host_and_an_unknown_one_are_refused_and_a_hono_kernel_is_served() {
        let code = |options: &[(&str, &str)]| backend(&request_with(options)).err().map(|e| e.code);
        assert_eq!(code(&[(HOST, "generated")]), Some(CODE_BAD_REQUEST.to_string()));
        assert_eq!(code(&[(HOST, "wasm")]), Some(CODE_BAD_REQUEST.to_string()));
        assert!(backend(&request_with(&[(HOST, "kernel"), (FRAMEWORK, "hono")])).is_ok());
        assert!(backend(&request_with(&[])).is_ok());
    }

    #[test]
    fn an_incompatible_language_install_is_a_structured_failure() {
        let failure = language_ready(|| {
            Err(orbital_core_base::language_data::LanguageDataError::Invalid {
                path: std::path::PathBuf::from("std"),
                reason: "declares csv/parse".to_string(),
            })
        })
        .expect_err("an install that does not load is refused");
        assert_eq!(failure.code, "ORB_LANGUAGE_DATA_INVALID");
        assert!(failure.message.contains("csv/parse"), "{}", failure.message);
        assert!(language_ready(|| Ok(())).is_ok(), "control: a loading install generates");
    }

    #[test]
    fn dependencies_are_added_once_and_the_template_keeps_the_rest() {
        let template = "{\n  \"dependencies\": {\n    \"@almadar/core\": \"^10.0.0\",\n    \"zod\": \"^3.22.0\"\n  }\n}\n";
        let once = with_dependencies(template, &[("@almadar/kernel", "^18.0.0"), ("zod", "^4.0.0")]).unwrap();
        assert!(once.contains("\"@almadar/kernel\": \"^18.0.0\","));
        assert!(once.contains("\"zod\": \"^3.22.0\""), "a listed package keeps the template's pin:\n{once}");
        assert!(!once.contains("^4.0.0"));
        let twice = with_dependencies(&once, &[("@almadar/kernel", "^18.0.0")]).unwrap();
        assert_eq!(once, twice);
        assert!(with_dependencies("{}", &[("a", "1")]).is_none());
    }

    #[test]
    fn the_templates_depend_on_no_retired_package() {
        use orbital_core_base::shell::Shell;
        const RETIRED: &[&str] = &["@almadar/patterns", "@almadar/evaluator"];
        for shell in [express_shell(), hono_shell()] {
            for part in ["client", "server"] {
                let path = shell.template_path().join("packages").join(part).join("package.json");
                let manifest: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
                for kind in ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] {
                    for name in RETIRED {
                        assert!(manifest[kind].get(name).is_none(), "{} {kind} still names {name}", path.display());
                    }
                }
                assert!(manifest["dependencies"].get("@almadar/core").is_some(), "control: {} keeps @almadar/core", path.display());
            }
        }
    }

    #[test]
    fn edge_a_bad_framework_is_refused() {
        let request = GenerateRequest {
            ir_version: IR_VERSION,
            module: orbital_core_base::ir::OirModule::new("App", "1.0.0"),
            resolved: None,
            source_path: None,
            write: Default::default(),
            options: [(FRAMEWORK.to_string(), Value::String("koa".into()))].into_iter().collect(),
        };
        let err = TypeScriptProgram.generate(&request, Path::new("/tmp")).unwrap_err();
        assert_eq!(err.code, CODE_BAD_REQUEST);
    }
}
