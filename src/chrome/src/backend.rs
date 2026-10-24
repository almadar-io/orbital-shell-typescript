//! The chrome-extension backend: bundles the resolved program for the worker's runtime host and
//! writes the Manifest V3 manifest from declared facts — the app's identity, the sites its `browser/tab-*`
//! calls read, and the permissions its services need.

use orbital_core_base::generate::{Backend, GeneratedFile, GeneratedOutput};
use orbital_core_base::ir::OirModule;
use orbital_core_base::schema::{OrbitalSchema, ThemeDefinition};
use orbital_shell_typescript::{generate_theme_css, theme_font_imports};
use serde_json::{json, Value};

use crate::program::ChromeProgram;

pub struct ChromeBackend {
    resolved_schema: Option<OrbitalSchema>,
    program: ChromeProgram,
}

impl ChromeBackend {
    pub fn new(resolved_schema: OrbitalSchema, program: ChromeProgram) -> Self {
        Self {
            resolved_schema: Some(resolved_schema),
            program,
        }
    }
}

/// Chrome extension versions are one to four dot-separated integers; anything after a `-`/`+` is dropped.
fn extension_version(version: &str) -> String {
    let core = version.split(['-', '+']).next().unwrap_or_default();
    let parts: Vec<&str> = core
        .split('.')
        .filter(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
        .collect();
    if parts.is_empty() {
        "0.0.0".to_string()
    } else {
        parts.into_iter().take(4).collect::<Vec<_>>().join(".")
    }
}

/// The permissions the program's services need, plus the two the host itself uses.
fn permissions(program: &ChromeProgram) -> Vec<&'static str> {
    let mut out = vec!["sidePanel", "storage"];
    if program.uses_tabs {
        out.push("tabs");
    }
    if program.uses_tab_capture {
        out.push("activeTab");
    }
    if program.uses_identity {
        out.push("identity");
    }
    out
}

/// The program's own themes as stylesheets, plus `themes.css` importing them, which the panel's
/// stylesheet imports. Built-in themes ship with `@almadar/ui`.
pub fn theme_files(themes: &[ThemeDefinition]) -> Vec<GeneratedFile> {
    let mut index = String::new();
    for url in theme_font_imports(themes) {
        index.push_str(&format!("@import url(\"{url}\");\n"));
    }
    let mut files = Vec::new();
    for theme in themes {
        index.push_str(&format!("@import './themes/{}.css';\n", theme.name));
        files.push(GeneratedFile::new(
            format!("themes/{}.css", theme.name),
            generate_theme_css(theme),
        ));
    }
    files.push(GeneratedFile::new("themes.css", index));
    files
}

const MODEL_HOSTS: [&str; 2] = ["https://huggingface.co/*", "https://*.hf.co/*"];
const WASM_CSP: &str = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'";

const EMBEDDER_REAL: &str = r#"import { env, pipeline } from '@huggingface/transformers';
import { transformersEmbedder, type OnDeviceEmbedderPort } from '@almadar/shell-chrome';

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;

export const embedder: OnDeviceEmbedderPort | undefined = transformersEmbedder(
  () => pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8', device: 'wasm' }),
  { prefix: 'query: ' },
);
"#;

const EMBEDDER_STUB: &str = "import type { OnDeviceEmbedderPort } from '@almadar/shell-chrome';\n\nexport const embedder: OnDeviceEmbedderPort | undefined = undefined;\n";

const KERNEL_WASM_ASSET: (&str, &str) = (
    "node_modules/@almadar/kernel/pkg-client/orbital_wasm_bg.wasm",
    "orbital_wasm_bg.wasm",
);

/// The language-data bundle `finalize.mjs` writes into `dist/` and the worker hands the kernel.
const LANGUAGE_BUNDLE_FILE: &str = "language.json";

const HTTP_STUB: &str = "import type { HttpPorts } from '@almadar/shell-web';\n\nexport const http: HttpPorts | undefined = undefined;\n";

/// The wasm kernel the worker hosts the program on (the client build: no verifier, no raw-socket drivers), loaded from the
/// `.wasm` the build copies into `dist/`: an MV3 worker
/// cannot `eval`, so the module is fetched from its own `chrome.runtime.getURL` and compiled under the manifest's
/// `wasm-unsafe-eval` CSP. The kernel then installs the language data (`language.json`, written by `finalize.mjs` from the
/// installed packages) its operators are routed by; without it a program using `fn` or a host effect traps.
fn kernel_loader() -> String {
    format!(
        "import initKernel, * as kernel from '@almadar/kernel/client';\n\nexport const kernelReady: Promise<typeof kernel> = initKernel({{ module_or_path: chrome.runtime.getURL('{wasm}') }})\n  .then(() => fetch(chrome.runtime.getURL('{language}')))\n  .then((response) => response.text())\n  .then((bundle) => {{\n    kernel.installLanguage(bundle);\n    return kernel;\n  }});\n",
        wasm = KERNEL_WASM_ASSET.1,
        language = LANGUAGE_BUNDLE_FILE
    )
}

/// The worker's `http` ports: the kernel's request driver and the browser's own `fetch` — a browser cannot resolve a
/// name, so only the program's `egress` (and the extension's `host_permissions`, derived from it) bound what the call reaches.
/// A program that names a credential (an `http` with `auth`, `credential-*`, an OAuth effect) also gets the profile's credential
/// store, so the kernel's secret asks are answered here and the program never receives a value; `oauth-authorize` further gets
/// the host's own Google sign-in (`chrome.identity`, no client secret).
fn http_ports(program: &ChromeProgram) -> String {
    let egress: Vec<String> = program.egress_origins.iter().map(|o| format!("'{o}'")).collect();
    let egress = egress.join(", ");
    if !program.uses_credentials {
        return format!(
            "import {{ createBrowserHttpPorts, type HttpPorts }} from '@almadar/shell-web';\nimport {{ kernelReady }} from './kernel';\n\nexport const http: HttpPorts | undefined = createBrowserHttpPorts({{\n  kernel: () => kernelReady,\n  egress: [{egress}],\n}});\n"
        );
    }
    let sign_in = if program.uses_identity { "  signIn: extensionHost.signIn,\n" } else { "" };
    format!(
        "import {{ createChromeCredentialStore, createExtensionHttpPorts }} from '@almadar/shell-chrome';\nimport type {{ HttpPorts }} from '@almadar/shell-web';\nimport {{ extensionHost }} from '../config';\nimport {{ kernelReady }} from './kernel';\n\nexport const http: HttpPorts | undefined = createExtensionHttpPorts({{\n  kernel: () => kernelReady,\n  egress: [{egress}],\n  credentials: createChromeCredentialStore(chrome.storage.local),\n  provisioned: extensionHost.provisioned,\n  fetch: extensionHost.fetch,\n{sign_in}}});\n"
    )
}

/// The worker's embedder, `http` and kernel wiring and the files `finalize.mjs` copies into `dist/`. The kernel decides
/// every step of the program, so its `.wasm` always ships; the embedder and the `http` ports are each declared by whether
/// the program runs `browser/embed` / a keyless `http`.
pub fn embedder_files(program: &ChromeProgram) -> Vec<GeneratedFile> {
    let (embedder, mut assets) = if program.embeds_on_device {
        (
            EMBEDDER_REAL,
            vec![json!({
                "from": "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm",
                "to": "ort-wasm-simd-threaded.jsep.wasm"
            })],
        )
    } else {
        (EMBEDDER_STUB, Vec::new())
    };
    assets.push(json!({ "from": KERNEL_WASM_ASSET.0, "to": KERNEL_WASM_ASSET.1 }));
    vec![
        GeneratedFile::new("embedder.ts", embedder.to_string()),
        GeneratedFile::new(
            "assets.json",
            serde_json::to_string_pretty(&assets).unwrap_or_default(),
        ),
        GeneratedFile::new(
            "http.ts",
            if program.uses_http || program.uses_credentials { http_ports(program) } else { HTTP_STUB.to_string() },
        ),
        GeneratedFile::new("kernel.ts", kernel_loader()),
    ]
}

pub fn manifest(
    name: &str,
    version: &str,
    description: Option<&str>,
    program: &ChromeProgram,
) -> Value {
    let mut m = json!({
        "manifest_version": 3,
        "name": name,
        "version": extension_version(version),
        "background": { "service_worker": "worker.js", "type": "module" },
        "action": { "default_title": name },
        "side_panel": { "default_path": "panel.html" },
        "permissions": permissions(program),
    });
    if let Some(d) = description {
        m["description"] = json!(d);
    }
    let mut host_permissions = program.host_patterns.clone();
    for pattern in &program.egress_patterns {
        if !host_permissions.contains(pattern) {
            host_permissions.push(pattern.clone());
        }
    }
    if program.embeds_on_device {
        host_permissions.extend(MODEL_HOSTS.iter().map(|h| h.to_string()));
    }
    m["content_security_policy"] = json!({ "extension_pages": WASM_CSP });
    if !host_permissions.is_empty() {
        m["host_permissions"] = json!(host_permissions);
    }
    if !program.host_patterns.is_empty() {
        m["content_scripts"] = json!([{ "matches": program.host_patterns, "js": ["content.js"], "run_at": "document_idle" }]);
    }
    m
}

impl Backend for ChromeBackend {
    fn generate(&self, module: &OirModule) -> GeneratedOutput {
        let mut output = GeneratedOutput::default();
        match &self.resolved_schema {
            Some(schema) => match orbital_core_eval::util::canonical_json::to_canonical_string_pretty(schema) {
                Ok(json) => output.files.push(GeneratedFile::new("program.orb", json)),
                Err(e) => output
                    .warnings
                    .push(format!("could not serialize the resolved program: {e}")),
            },
            None => output
                .warnings
                .push("no resolved program to bundle".to_string()),
        }
        output.files.extend(theme_files(&module.themes));
        let manifest = manifest(
            &module.name,
            &module.version,
            module.description.as_deref(),
            &self.program,
        );
        output.files.extend(embedder_files(&self.program));
        output.files.push(GeneratedFile::new(
            "manifest.json",
            serde_json::to_string_pretty(&manifest).unwrap_or_default(),
        ));
        output
    }

    fn name(&self) -> &'static str {
        "chrome-extension"
    }

    fn supports_browser_stored_entities(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn program(patterns: &[&str], services: &[&str]) -> ChromeProgram {
        ChromeProgram {
            host_patterns: patterns.iter().map(|s| s.to_string()).collect(),
            uses_tabs: false,
            uses_tab_capture: false,
            services: services.iter().map(|s| s.to_string()).collect(),
            embeds_on_device: false,
            egress_patterns: Vec::new(),
            egress_origins: Vec::new(),
            uses_http: false,
            uses_credentials: false,
            uses_identity: false,
        }
    }

    fn embedding_program(patterns: &[&str]) -> ChromeProgram {
        ChromeProgram {
            embeds_on_device: true,
            ..program(patterns, &[])
        }
    }

    #[test]
    fn manifest_carries_the_program_sites_and_the_permissions_its_services_need() {
        let m = manifest(
            "Feed",
            "1.2.3",
            Some("d"),
            &ChromeProgram { uses_tabs: true, uses_identity: true, ..program(&["https://example.com/*"], &[]) },
        );
        assert_eq!(m["manifest_version"], 3);
        assert_eq!(m["host_permissions"], json!(["https://example.com/*"]));
        assert_eq!(
            m["content_scripts"][0]["matches"],
            json!(["https://example.com/*"])
        );
        assert_eq!(
            m["permissions"],
            json!(["sidePanel", "storage", "tabs", "identity"])
        );
        assert_eq!(m["background"]["service_worker"], "worker.js");
        let capturing = manifest("Feed", "1.2.3", None, &ChromeProgram { uses_tabs: true, uses_tab_capture: true, ..program(&[], &[]) });
        assert_eq!(capturing["permissions"], json!(["sidePanel", "storage", "tabs", "activeTab"]));
    }

    fn http_program(egress: &[(&str, &str)]) -> ChromeProgram {
        ChromeProgram {
            egress_patterns: egress.iter().map(|(_, pattern)| pattern.to_string()).collect(),
            egress_origins: egress.iter().map(|(origin, _)| origin.to_string()).collect(),
            uses_http: true,
            ..program(&["https://example.com/*"], &[])
        }
    }

    #[test]
    fn a_program_running_http_gets_every_egress_origin_as_a_host_permission_and_the_driver_over_the_kernel() {
        let p = http_program(&[("https://api.example.com", "https://api.example.com/*")]);
        let m = manifest("App", "1.0.0", None, &p);
        assert_eq!(
            m["host_permissions"],
            json!(["https://example.com/*", "https://api.example.com/*"])
        );
        assert_eq!(
            m["content_scripts"][0]["matches"],
            json!(["https://example.com/*"]),
            "egress origins grant fetch access only, never a content script"
        );
        assert_eq!(
            m["content_security_policy"]["extension_pages"],
            "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
        );
        let files = embedder_files(&p);
        assert_eq!(kernel_assets(&files[1]), json!([kernel_asset()]));
        assert_eq!(files[2].path, "http.ts");
        assert!(files[2].content.contains("createBrowserHttpPorts"), "{}", files[2].content);
        assert!(files[2].content.contains("type HttpPorts } from '@almadar/shell-web'"), "{}", files[2].content);
        assert!(files[2].content.contains("egress: ['https://api.example.com']"), "{}", files[2].content);
        assert!(!files[2].content.contains("initKernel"), "the http ports share the one kernel loader: {}", files[2].content);
        assert!(files[2].content.contains("kernel: () => kernelReady"), "{}", files[2].content);
    }

    #[test]
    fn a_program_that_names_a_credential_gets_the_profile_credential_store_and_only_authorize_gets_the_native_sign_in() {
        let credential_program = ChromeProgram { uses_credentials: true, ..http_program(&[("https://api.example.com", "https://api.example.com/*")]) };
        let files = embedder_files(&credential_program);
        let http = &files[2].content;
        assert!(http.contains("createExtensionHttpPorts"), "{http}");
        assert!(http.contains("import type { HttpPorts } from '@almadar/shell-web'"), "{http}");
        assert!(http.contains("createChromeCredentialStore(chrome.storage.local)"), "{http}");
        assert!(http.contains("fetch: extensionHost.fetch"), "Firebase requests carry the project key through the host fetch: {http}");
        assert!(http.contains("from '../config'"), "http.ts lives in generated/, config.ts one level up: {http}");
        assert!(http.contains("egress: ['https://api.example.com']"), "{http}");
        assert!(!http.contains("signIn"), "no sign-in without oauth-authorize: {http}");
        assert!(!manifest("App", "1.0.0", None, &credential_program)["permissions"].as_array().unwrap().contains(&json!("identity")));

        let oauth_program = ChromeProgram { uses_identity: true, ..credential_program.clone() };
        let http = &embedder_files(&oauth_program)[2].content;
        assert!(http.contains("signIn: extensionHost.signIn"), "{http}");
        assert!(manifest("App", "1.0.0", None, &oauth_program)["permissions"].as_array().unwrap().contains(&json!("identity")));

        let only_credentials = ChromeProgram { uses_http: false, uses_credentials: true, ..program(&["https://example.com/*"], &[]) };
        assert!(embedder_files(&only_credentials)[2].content.contains("createExtensionHttpPorts"), "credential-status alone still needs the store");
    }

    #[test]
    fn control_the_worker_template_and_the_generated_ports_carry_no_oauth_client_secret() {
        for (name, text) in [
            ("config.ts", include_str!("../../../templates/chrome-shell/src/config.ts")),
            ("worker.ts", include_str!("../../../templates/chrome-shell/src/worker.ts")),
        ] {
            for needle in ["CLIENT_SECRET", "clientSecret", "client_secret"] {
                assert!(!text.contains(needle), "{name} names {needle}: an extension bundle is extractable, so no client secret may ship in it");
            }
        }
        let oauth_program = ChromeProgram { uses_credentials: true, uses_identity: true, ..http_program(&[("https://accounts.google.com", "https://accounts.google.com/*")]) };
        let http = &embedder_files(&oauth_program)[2].content;
        assert!(!http.contains("ecret"), "{http}");
    }

    #[test]
    fn an_egress_origin_already_read_as_a_site_is_listed_once() {
        let p = http_program(&[("https://example.com", "https://example.com/*")]);
        assert_eq!(manifest("App", "1.0.0", None, &p)["host_permissions"], json!(["https://example.com/*"]));
    }

    #[test]
    fn control_a_program_without_http_gets_the_http_stub_but_still_the_kernel() {
        let p = program(&["https://example.com/*"], &[]);
        let files = embedder_files(&p);
        assert!(files[2].content.contains("= undefined;"), "{}", files[2].content);
        assert_eq!(kernel_assets(&files[1]), json!([kernel_asset()]));
    }

    fn kernel_assets(assets: &GeneratedFile) -> Value {
        assert_eq!(assets.path, "assets.json");
        serde_json::from_str(&assets.content).expect("assets json")
    }

    fn kernel_asset() -> Value {
        json!({ "from": "node_modules/@almadar/kernel/pkg-client/orbital_wasm_bg.wasm", "to": "orbital_wasm_bg.wasm" })
    }

    #[test]
    fn control_a_program_that_reads_no_site_gets_no_host_access_and_no_content_script() {
        let m = manifest("App", "1.0.0", None, &program(&[], &[]));
        assert!(m.get("host_permissions").is_none());
        assert!(m.get("content_scripts").is_none());
        assert_eq!(m["permissions"], json!(["sidePanel", "storage"]));
    }

    #[test]
    fn a_program_running_browser_embed_gets_the_csp_model_hosts_embedder_and_wasm_asset() {
        let m = manifest(
            "App",
            "1.0.0",
            None,
            &embedding_program(&["https://example.com/*"]),
        );
        assert_eq!(
            m["content_security_policy"]["extension_pages"],
            "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
        );
        assert_eq!(
            m["host_permissions"],
            json!([
                "https://example.com/*",
                "https://huggingface.co/*",
                "https://*.hf.co/*"
            ])
        );
        assert_eq!(
            m["content_scripts"][0]["matches"],
            json!(["https://example.com/*"])
        );
        let files = embedder_files(&embedding_program(&[]));
        assert_eq!(files[0].path, "embedder.ts");
        assert!(files[0].content.contains("@huggingface/transformers"));
        assert!(files[0].content.contains("transformersEmbedder"));
        let assets: Value = serde_json::from_str(&files[1].content).expect("assets json");
        assert_eq!(files[1].path, "assets.json");
        assert_eq!(
            assets,
            json!([{ "from": "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm", "to": "ort-wasm-simd-threaded.jsep.wasm" }, kernel_asset()])
        );
    }

    #[test]
    fn control_a_program_without_browser_embed_gets_no_model_hosts_and_the_stub() {
        let p = program(&["https://example.com/*"], &[]);
        let m = manifest("App", "1.0.0", None, &p);
        assert_eq!(m["host_permissions"], json!(["https://example.com/*"]));
        let files = embedder_files(&p);
        assert!(!files[0].content.contains("@huggingface"));
        assert!(files[0].content.contains("= undefined;"));
        assert_eq!(kernel_assets(&files[1]), json!([kernel_asset()]));
    }

    const WORKER: &str = include_str!("../../../templates/chrome-shell/src/worker.ts");

    #[test]
    fn every_program_gets_the_wasm_csp_the_kernel_asset_and_the_loader_that_fetches_it_from_the_extension() {
        let p = program(&["https://example.com/*"], &[]);
        let m = manifest("App", "1.0.0", None, &p);
        assert_eq!(
            m["content_security_policy"]["extension_pages"],
            "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
            "WebAssembly needs wasm-unsafe-eval in an MV3 extension page, and nothing broader"
        );
        let files = embedder_files(&p);
        assert_eq!(files[3].path, "kernel.ts");
        assert!(files[3].content.contains("initKernel({ module_or_path: chrome.runtime.getURL('orbital_wasm_bg.wasm') })"), "{}", files[3].content);
        assert!(files[3].content.contains("export const kernelReady"), "{}", files[3].content);
        assert!(
            files[3].content.contains("from '@almadar/kernel/client'"),
            "a browser loads the client build: {}",
            files[3].content
        );
        assert!(!files[3].content.contains("eval("), "{}", files[3].content);
    }

    const FINALIZE: &str = include_str!("../../../templates/chrome-shell/scripts/finalize.mjs");
    const TEMPLATE_PACKAGE: &str = include_str!("../../../templates/chrome-shell/package.json");

    #[test]
    fn the_kernel_is_handed_the_language_data_the_build_writes_from_the_installed_packages() {
        let loader = &embedder_files(&program(&[], &[]))[3].content;
        assert!(loader.contains("chrome.runtime.getURL('language.json')"), "{loader}");
        assert!(loader.contains("kernel.installLanguage(bundle)"), "{loader}");
        assert!(FINALIZE.contains("readLanguageBundle(process.cwd())") && FINALIZE.contains("dist/language.json"), "the build writes no language bundle");
        let package: Value = serde_json::from_str(TEMPLATE_PACKAGE).expect("template package.json");
        for dependency in ["@almadar/core", "@almadar/std", "@almadar/kernel"] {
            assert!(package["dependencies"][dependency].is_string(), "the bundle is read from the installed {dependency}");
        }
    }

    #[test]
    fn control_no_generated_file_imports_the_integrations_package() {
        let credentials = ChromeProgram { uses_credentials: true, uses_identity: true, ..http_program(&[("https://accounts.google.com", "https://accounts.google.com/*")]) };
        for p in [embedding_program(&[]), program(&[], &[]), credentials] {
            for file in embedder_files(&p) {
                assert!(!file.content.contains("@almadar/integrations"), "{}", file.path);
            }
        }
    }

    #[test]
    fn control_a_program_with_no_site_and_no_services_still_ships_the_kernel() {
        let p = program(&[], &[]);
        assert!(manifest("App", "1.0.0", None, &p).get("content_security_policy").is_some());
        assert_eq!(kernel_assets(&embedder_files(&p)[1]), json!([kernel_asset()]));
    }

    #[test]
    fn the_worker_hosts_the_program_on_the_kernel_with_the_chrome_tab_port_and_the_generated_loader() {
        assert!(!WORKER.contains("engine:"), "the worker names an engine; the kernel is the only one");
        assert!(WORKER.contains("chromeTabPort(chrome.tabs, chrome.runtime,"), "the worker passes no tab port");
        assert!(WORKER.contains("\n    tabs,\n"), "the tab port never reaches the host");
        assert!(WORKER.contains("kernel,\n"), "the kernel module never reaches the host");
        assert!(WORKER.contains("from './generated/kernel'"));
        assert!(WORKER.contains("loadedKernel.tabUrlMatches(pattern, url)"), "the kernel owns the match-pattern rule");
        let generated: Vec<String> = embedder_files(&program(&[], &[])).into_iter().map(|f| f.path).collect();
        assert!(generated.contains(&"kernel.ts".to_string()), "the worker imports a file the shell does not generate");
    }

    #[test]
    fn control_the_worker_registers_its_tab_listener_in_its_first_turn_not_after_the_kernel_loads() {
        let port = WORKER.find("chromeTabPort(").expect("tab port");
        let host = WORKER.find("kernelReady.then(").expect("host open");
        assert!(port < host, "a stopped worker wakes only for listeners added in its first turn");
    }

    #[test]
    fn edge_embed_without_host_patterns_holds_only_the_model_hosts_and_no_content_script() {
        let m = manifest("App", "1.0.0", None, &embedding_program(&[]));
        assert_eq!(
            m["host_permissions"],
            json!(["https://huggingface.co/*", "https://*.hf.co/*"])
        );
        assert!(m.get("content_scripts").is_none());
    }

    #[test]
    fn the_generated_output_carries_the_embedder_and_assets_files() {
        let schema: OrbitalSchema =
            serde_json::from_value(json!({ "name": "app", "orbitals": [] })).expect("schema");
        let module: OirModule = serde_json::from_value(json!({
            "name": "app", "version": "1.0.0", "entities": [], "traits": [], "pages": [], "metadata": {}
        }))
        .expect("module");
        let out = ChromeBackend::new(schema, embedding_program(&[])).generate(&module);
        let paths: Vec<&str> = out.files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"embedder.ts") && paths.contains(&"assets.json"));
    }

    fn theme(name: &str) -> ThemeDefinition {
        serde_json::from_value(json!({ "name": name, "tokens": {} })).expect("theme fixture")
    }

    #[test]
    fn a_programs_own_themes_become_stylesheets_the_panel_imports() {
        let files = theme_files(&[theme("sunset")]);
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["themes/sunset.css", "themes.css"]);
        assert!(files[1].content.contains("@import './themes/sunset.css';"));
    }

    #[test]
    fn control_a_program_without_themes_still_gets_the_index_the_panel_imports() {
        let files = theme_files(&[]);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "themes.css");
        assert!(!files[0].content.contains("@import"));
    }

    #[test]
    fn edge_versions_become_chrome_versions() {
        assert_eq!(extension_version("2.0.0-beta.1"), "2.0.0");
        assert_eq!(extension_version("1.2.3.4.5"), "1.2.3.4");
        assert_eq!(extension_version("dev"), "0.0.0");
    }
}
