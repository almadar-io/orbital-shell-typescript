//! The kernel-hosted output: the generated app hands every execution step to
//! `@almadar/kernel` and emits no per-event logic; the default output is unchanged.

use orbital_core_base::generate::Backend;
use orbital_core_base::ir::{
    OirEffect, OirEntity, OirExpr, OirField, OirModule, OirPersistence, OirState, OirTrait,
    OirTransition, OirType,
};
use orbital_shell_typescript::TypeScriptBackend;

fn module() -> OirModule {
    let mut list = OirTrait::new("InvoiceList");
    list.orbital_name = "Books".to_string();
    list.linked_entity = Some("Invoice".to_string());
    list.states.push(OirState::initial("idle"));
    list.transitions.push(
        OirTransition::new("idle", "idle", "INIT")
            .with_effects(vec![OirExpr::effect(OirEffect::fetch("Invoice"))]),
    );
    list.transitions
        .push(OirTransition::new("idle", "idle", "OPEN"));
    let mut module = OirModule::new("Books", "1.0.0");
    let mut invoice = OirEntity::new("Invoice");
    invoice.collection = "invoices".to_string();
    invoice.persistence = OirPersistence::Persistent;
    invoice.fields = vec![
        OirField::new("id", OirType::String),
        OirField::new("amount", OirType::Number),
    ];
    module.entities.push(invoice);
    module.traits.push(list);
    module
}

fn schema() -> orbital_core_base::schema::types::OrbitalSchema {
    serde_json::from_value(serde_json::json!({
        "name": "Books",
        "_metadata": { "version": 1, "source": "kernel-host-test" },
        "orbitals": [
            { "name": "Books", "entity": { "name": "Invoice", "persistence": "persistent", "collection": "invoices", "fields": [{ "name": "id", "type": "string" }] }, "traits": [], "pages": [] }
        ]
    }))
    .expect("schema fixture")
}

fn fnv1a(bytes: &[u8], mut hash: u64) -> u64 {
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn digest(backend: &TypeScriptBackend) -> u64 {
    let mut files: Vec<_> = backend
        .generate(&module())
        .files
        .into_iter()
        .map(|f| (f.path, f.content))
        .collect();
    files.sort();
    files
        .iter()
        .fold(0xcbf2_9ce4_8422_2325, |h, (path, content)| {
            fnv1a(content.as_bytes(), fnv1a(path.as_bytes(), h))
        })
}

/// The digest of the default (kernel-hosted) output for `module()` and `schema()`, recorded when the server became the
/// template's native host (2026-10-20: no server TypeScript is generated), re-recorded 2026-10-24 when the programs became
/// `.orb` files and the unread shared copy was retired. The client source is the template's, and the compile emits only
/// the program's runtime files (`public/client.json`, `public/themes.css`, `public/program.client.orb`).
const KERNEL_OUTPUT_DIGEST: u64 = 8_716_758_803_243_522_726;

#[test]
fn control_the_default_output_is_the_recorded_kernel_output() {
    let backend = TypeScriptBackend {
        browser_schema: Some(schema()),
        ..TypeScriptBackend::default()
    };
    assert_eq!(digest(&backend), KERNEL_OUTPUT_DIGEST);
}

fn kernel_backend() -> TypeScriptBackend {
    TypeScriptBackend {
        browser_schema: Some(schema()),
        ..TypeScriptBackend::default()
    }
}

fn files_of(backend: &TypeScriptBackend) -> Vec<(String, String)> {
    backend
        .generate(&module())
        .files
        .into_iter()
        .map(|f| (f.path, f.content))
        .collect()
}

/// A file of the TypeScript template (the program-independent client source lives there, not in the compile's output).
fn template(path: &str) -> String {
    let full = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("templates/almadar-shell").join(path);
    std::fs::read_to_string(&full).unwrap_or_else(|e| panic!("{}: {e}", full.display()))
}

fn file<'a>(files: &'a [(String, String)], path: &str) -> &'a str {
    files
        .iter()
        .find(|(p, _)| p == path)
        .map(|(_, c)| c.as_str())
        .unwrap_or_else(|| panic!("{path} was not emitted"))
}

#[test]
fn the_server_is_the_templates_node_host_and_the_compile_ships_only_its_served_program() {
    let files = files_of(&TypeScriptBackend { served_schema: Some(served()), ..kernel_backend() });
    let server: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).filter(|p| p.starts_with("packages/server/")).collect();
    assert_eq!(server, [SERVED_PROGRAM], "no TypeScript server logic is generated");
    let index = template("packages/server/src/index.ts");
    assert!(index.contains("new OrbitalServerRuntime(") && index.contains("runtime.register(program"), "{index}");
}

#[test]
fn the_client_hosts_the_kernel_through_the_ui_engine_provider() {
    let app = &template("packages/client/src/App.tsx");
    assert!(
        app.contains("<KernelEngineProvider loader={loadKernel} {...(manifest.language ? { languageLoader: loadLanguage } : {})}>"),
        "{app}"
    );
    assert!(!app.contains("engine="), "the kernel is the only engine: {app}");
    assert!(app.contains("OrbPreview"), "{app}");
    let loader = &template("packages/client/src/kernel-host.ts");
    assert!(loader.contains("@almadar/kernel/client"), "{loader}");
}

fn browser_stored_module() -> OirModule {
    let mut module = module();
    module.entities[0].browser = true;
    module
}

#[test]
fn a_program_storing_rows_in_the_browser_ships_the_language_its_browser_kernel_installs() {
    let files: Vec<(String, String)> = kernel_backend()
        .generate(&browser_stored_module())
        .files
        .into_iter()
        .map(|f| (f.path, f.content))
        .collect();
    let bundle: serde_json::Value =
        serde_json::from_str(file(&files, "packages/client/public/language.json")).expect("the bundle is JSON");
    assert_eq!(
        serde_json::from_value::<serde_json::Value>(bundle.clone()).ok(),
        serde_json::from_str::<serde_json::Value>(&orbital_core_base::language_data::language_bundle_json().unwrap()).ok(),
        "the installed language, as the kernel's install takes it"
    );
    let manifest: serde_json::Value = serde_json::from_str(file(&files, "packages/client/public/client.json")).expect("client.json");
    assert_eq!(manifest["language"], true, "{manifest}");
    let loader = &template("packages/client/src/kernel-host.ts");
    assert!(loader.contains("export async function loadLanguage(): Promise<string>"), "{loader}");
    assert!(loader.contains("fetch(`${import.meta.env.BASE_URL}language.json`)"), "{loader}");
}

/// A lazy page's behavior is loaded after compile and may bring its own browser-stored entity, so a program with
/// lazy pages ships the language its local kernel would need (G-ORBITAL-SHELL-TYPESCRIPT-028, owner 2026-10-19).
#[test]
fn a_program_with_lazy_pages_ships_the_language() {
    let mut schema = schema();
    schema.lazy_pages = Some(vec![serde_json::from_value(serde_json::json!({
        "path": "/notes", "orbital": "Notes", "orbRef": "./notes.orb"
    }))
    .expect("lazy page")]);
    let backend = TypeScriptBackend { browser_schema: Some(schema), ..kernel_backend() };
    let files = files_of(&backend);
    assert!(files.iter().any(|(p, _)| p == "packages/client/public/language.json"));
    let manifest: serde_json::Value = serde_json::from_str(file(&files, "packages/client/public/client.json")).expect("client.json");
    assert_eq!(manifest["language"], true, "{manifest}");
}

#[test]
fn edge_an_empty_lazy_page_list_ships_no_language() {
    let mut schema = schema();
    schema.lazy_pages = Some(Vec::new());
    let backend = TypeScriptBackend { browser_schema: Some(schema), ..kernel_backend() };
    assert!(files_of(&backend).iter().all(|(p, _)| p != "packages/client/public/language.json"));
}

#[test]
fn control_a_program_with_no_browser_stored_rows_ships_no_language() {
    let files = files_of(&kernel_backend());
    assert!(files.iter().all(|(p, _)| p != "packages/client/public/language.json"));
    let manifest: serde_json::Value = serde_json::from_str(file(&files, "packages/client/public/client.json")).expect("client.json");
    assert_eq!(manifest["language"], false, "{manifest}");
}

/// The web client is program-independent: two different programs compile to byte-identical client source, and
/// differ only in the runtime files the client reads at startup.
#[test]
fn two_programs_compile_to_the_same_client_source_and_differ_only_in_their_runtime_files() {
    let books = files_of(&kernel_backend());
    let mut other_module = browser_stored_module();
    other_module.name = "Other".to_string();
    other_module.themes = vec![serde_json::from_value(serde_json::json!({ "name": "clay", "displayName": "Clay", "tokens": { "colors": { "primary": "#c96" } }, "variants": { "dark": { "colors": { "primary": "#963" } } } })).unwrap()];
    other_module.default_theme = Some("clay-dark".to_string());
    let backend = TypeScriptBackend { schema_language: "ar".to_string(), ..kernel_backend() };
    let other: Vec<(String, String)> = backend.generate(&other_module).files.into_iter().map(|f| (f.path, f.content)).collect();
    for files in [&books, &other] {
        for (path, _) in files.iter() {
            assert!(!(path.starts_with("packages/client/src/") && (path.ends_with(".ts") || path.ends_with(".tsx"))), "{path}: the client source is the template's, never per program");
        }
    }
    let manifest: serde_json::Value = serde_json::from_str(file(&other, "packages/client/public/client.json")).unwrap();
    assert_eq!(
        manifest,
        serde_json::json!({ "locale": "ar", "direction": "rtl", "themes": [{ "name": "clay", "displayName": "Clay", "hasLightMode": true, "hasDarkMode": true }], "defaultTheme": "clay", "defaultMode": "dark", "language": true })
    );
    let css = file(&other, "packages/client/public/themes.css");
    assert!(css.contains("[data-theme=\"clay-light\"]") && css.contains("[data-theme=\"clay-dark\"]"), "{css}");
    assert!(!css.contains("minimalist"), "only the declared theme ships: {css}");
}

#[test]
fn control_a_program_declaring_no_theme_ships_the_runtime_default_preset_and_no_default_theme() {
    let files = files_of(&kernel_backend());
    let manifest: serde_json::Value = serde_json::from_str(file(&files, "packages/client/public/client.json")).unwrap();
    assert_eq!((manifest["themes"].clone(), manifest["defaultTheme"].clone()), (serde_json::json!([]), serde_json::Value::Null));
    let css = file(&files, "packages/client/public/themes.css");
    let default = format!("[data-theme=\"{}-light\"]", orbital_core_base::theme::DEFAULT_THEME_BASE);
    assert!(css.contains(&default), "{css}");
}

#[test]
fn the_client_loader_hands_the_renderer_the_whole_kernel_module_its_evaluator_reads() {
    let loader = &template("packages/client/src/kernel-host.ts");
    assert!(loader.contains("import init, * as kernel from '@almadar/kernel/client';"), "{loader}");
    assert!(loader.contains("return kernel;"), "the renderer's evaluator calls evaluateMany and its siblings on the module: {loader}");
    assert!(!loader.contains("return { Kernel };"), "only the Kernel class leaves the evaluator exports out: {loader}");
}

#[test]
fn every_program_a_compile_ships_is_an_orb_file() {
    let backend = TypeScriptBackend { served_schema: Some(served()), ..kernel_backend() };
    let programs: Vec<String> = files_of(&backend)
        .into_iter()
        .map(|(path, _)| path)
        .filter(|path| path.rsplit('/').next().is_some_and(|name| name.starts_with("program.") && !name.ends_with(".ts")))
        .collect();
    assert_eq!(programs.len(), 2, "{programs:?}");
    for path in &programs {
        assert!(path.ends_with(".orb"), "{path}");
    }
}

#[test]
fn the_shared_package_embeds_no_copy_of_the_program() {
    let files = files_of(&kernel_backend());
    assert!(!files.iter().any(|(path, _)| path.starts_with("packages/shared/src/program.")), "no client or server source reads it");
    let barrel = file(&files, "packages/shared/src/index.ts");
    assert!(!barrel.contains("./program.js"), "{barrel}");
    assert!(barrel.contains("./dispatch.js"), "control: {barrel}");
}

#[test]
fn no_per_event_logic_is_emitted() {
    for (path, content) in files_of(&kernel_backend()) {
        for forbidden in [
            "routes/features/",
            "hooks/traits/",
            "components/traits/",
            "eventListeners",
            "orbital-events",
            "useOrbitalBridge",
            "/features/",
            "seedMockData",
        ] {
            assert!(!path.contains(forbidden), "{path} is per-event glue");
        }
        assert!(
            !content.contains("handleEvent"),
            "{path} carries a per-event handler"
        );
    }
}

#[test]
fn a_client_only_compile_emits_no_server_files_and_a_server_only_one_no_client_files() {
    let module = module();
    let client = kernel_backend()
        .generate_with_mode(&module, orbital_core_base::generate::ShellMode::Client);
    assert!(client
        .files
        .iter()
        .any(|f| f.path == "packages/client/public/client.json"));
    assert!(!client
        .files
        .iter()
        .any(|f| f.path.starts_with("packages/server/")));
    let server = TypeScriptBackend { served_schema: Some(served()), ..kernel_backend() }
        .generate_with_mode(&module, orbital_core_base::generate::ShellMode::Server);
    assert!(server
        .files
        .iter()
        .any(|f| f.path == SERVED_PROGRAM));
    assert!(!server
        .files
        .iter()
        .any(|f| f.path.starts_with("packages/client/")));
}

#[test]
fn edge_without_a_resolved_schema_nothing_is_embedded_and_the_output_says_so() {
    let output = TypeScriptBackend {
        ..TypeScriptBackend::default()
    }
    .generate(&module());
    assert!(!output
        .files
        .iter()
        .any(|f| f.path.ends_with(".orb")));
    assert!(
        output
            .warnings
            .iter()
            .any(|w| w.contains("resolved schema")),
        "{:?}",
        output.warnings
    );
}

#[test]
fn the_shared_package_carries_the_dispatch_frame_type_the_client_reads() {
    let files = files_of(&kernel_backend());
    assert!(file(&files, "packages/shared/src/dispatch.ts").contains("type: 'dispatch'"), "dispatch frame type");
    assert!(file(&files, "packages/shared/src/index.ts").contains("./dispatch.js"), "barrel");
}

#[test]
fn the_client_never_registers_the_program_the_server_booted_with() {
    let app = &template("packages/client/src/App.tsx");
    assert!(app.contains("register: async () =>"), "{app}");
    assert!(app.contains("unregister: async () =>"), "{app}");
    assert!(
        app.contains("deriveCarriesCircuitState('stateless')"),
        "{app}"
    );
}

#[test]
fn control_the_client_still_sends_events_over_the_http_transport() {
    let app = &template("packages/client/src/App.tsx");
    assert!(
        app.contains("createHttpTransport({ serverUrl: `${API_BASE}/api/orbitals`"),
        "{app}"
    );
    assert!(app.contains("...http"), "{app}");
}

#[test]
fn the_shared_package_is_a_module_so_the_server_can_import_the_program_under_tsx() {
    let files = files_of(&kernel_backend());
    let manifest: serde_json::Value =
        serde_json::from_str(file(&files, "packages/shared/package.json")).unwrap();
    assert_eq!(manifest["type"], "module");
}

#[test]
fn the_production_client_build_ships_no_source_maps_and_splits_the_kernel_and_react_into_chunks() {
    for (name, config) in [
        (
            "almadar-shell",
            include_str!("../templates/almadar-shell/packages/client/vite.config.ts"),
        ),
    ] {
        assert!(config.contains("sourcemap: mode === 'development',"), "{name}: {config}");
        assert!(!config.contains("sourcemap: true"), "{name}: production ships no source maps: {config}");
        assert!(
            config.contains("manualChunks: manualChunk"),
            "{name}: {config}"
        );
        for chunk in ["'kernel'", "'react'"] {
            assert!(config.contains(chunk), "{name} has no {chunk} chunk: {config}");
        }
        for pinned in ["'three'", "'ui'"] {
            assert!(
                !config.contains(pinned),
                "{name}: pinning {pinned} makes a circular chunk (TDZ at boot) and drags ui's lazy chunks into the first load: {config}"
            );
        }
    }
}

#[test]
fn the_client_runs_a_projection_of_the_program_and_the_server_keeps_the_whole_one() {
    let files = files_of(&kernel_backend());
    let full = serde_json::to_value(schema()).unwrap();
    let client: serde_json::Value =
        serde_json::from_str(file(&files, "packages/client/public/program.client.orb")).unwrap();
    assert!(client.get("ledger").is_none(), "ledger");
    assert_client_metadata_only(&client);
    assert_eq!(
        client["orbitals"].as_array().map(Vec::len),
        full["orbitals"].as_array().map(Vec::len)
    );
    assert_eq!(client["name"], full["name"]);
    for orbital in client["orbitals"].as_array().unwrap() {
        for trait_def in orbital["traits"].as_array().into_iter().flatten() {
            for key in ["effectRow", "sourceEntityDefinition"] {
                assert!(trait_def.get(key).is_none(), "{key}");
            }
        }
    }
    let app = &template("packages/client/src/App.tsx");
    assert!(app.contains("from './client-program'"), "{app}");
    assert!(!app.contains("program.client.orb") && !app.contains("program.orb"), "{app}");
    assert!(!app.contains("from '@app/shared'"), "{app}");
    let module = &template("packages/client/src/client-program.ts");
    assert!(module.contains("fetch(`${import.meta.env.BASE_URL}program.client.orb`)"), "{module}");
    assert!(!module.contains("import programJson"), "{module}");
}

#[test]
fn the_client_asset_omits_what_the_client_never_reads_while_the_server_copy_keeps_it() {
    let files = files_of(&kernel_backend());
    let asset: serde_json::Value =
        serde_json::from_str(file(&files, "packages/client/public/program.client.orb")).unwrap();
    let server = serde_json::to_value(schema()).unwrap();
    assert!(asset.get("ledger").is_none());
    assert_client_metadata_only(&asset);
    assert_eq!(server["_metadata"]["version"], 1, "control: {server}");
}

/// A client program's `_metadata` is only what a browser kernel registers it with, never the server copy's provenance.
fn assert_client_metadata_only(client: &serde_json::Value) {
    let keys: Vec<&str> = client["_metadata"].as_object().map(|m| m.keys().map(String::as_str).collect()).unwrap_or_default();
    assert!(keys.iter().all(|k| ["operatorSites", "dispatchFacts", "protocols"].contains(k)), "{keys:?}");
    assert!(client["_metadata"].get("version").is_none(), "the provenance stays on the server copy");
}

#[test]
fn control_the_client_entry_fetches_the_program_and_no_client_source_imports_it() {
    let files = files_of(&kernel_backend());
    for (path, content) in &files {
        if path.starts_with("packages/client/src/") && (path.ends_with(".ts") || path.ends_with(".tsx")) {
            assert!(!content.contains("program.client.orb'"), "{path} imports the program");
            assert!(!content.contains("program.orb'"), "{path} imports the program");
        }
    }
    let module = &template("packages/client/src/client-program.ts");
    assert!(module.contains("export function loadProgram"), "{module}");
}

#[test]
fn control_a_server_only_compile_ships_no_client_projection() {
    let server = kernel_backend()
        .generate_with_mode(&module(), orbital_core_base::generate::ShellMode::Server);
    assert!(!server
        .files
        .iter()
        .any(|f| f.path.contains("program.client.orb")));
}

const SERVED_PROGRAM: &str = "packages/server/generated/program.orb";

fn served() -> orbital_core_base::schema::types::OrbitalSchema {
    orbital_core_base::schema::types::OrbitalSchema { name: "BooksServed".to_string(), ..schema() }
}

#[test]
fn the_served_program_is_what_a_full_or_server_compile_ships_its_server() {
    let backend = TypeScriptBackend { served_schema: Some(served()), ..kernel_backend() };
    for mode in [orbital_core_base::generate::ShellMode::Full, orbital_core_base::generate::ShellMode::Server] {
        let output = backend.generate_with_mode(&module(), mode);
        let file = output.files.iter().find(|f| f.path == SERVED_PROGRAM).expect("the served program is written");
        let written: serde_json::Value = serde_json::from_str(&file.content).expect("the served program is JSON");
        assert_eq!(written["name"], "BooksServed");
    }
}

#[test]
fn control_a_client_only_compile_ships_no_served_program() {
    let backend = TypeScriptBackend { served_schema: Some(served()), ..kernel_backend() };
    let client = backend.generate_with_mode(&module(), orbital_core_base::generate::ShellMode::Client);
    assert!(!client.files.iter().any(|f| f.path == SERVED_PROGRAM));
}

#[test]
fn edge_a_server_compile_given_no_served_program_ships_none_and_says_so() {
    let output = kernel_backend().generate_with_mode(&module(), orbital_core_base::generate::ShellMode::Server);
    assert!(!output.files.iter().any(|f| f.path == SERVED_PROGRAM));
    assert!(output.warnings.iter().any(|w| w.contains("no served program")), "{:?}", output.warnings);
}

fn schema_with_pages(pages: serde_json::Value) -> orbital_core_base::schema::types::OrbitalSchema {
    serde_json::from_value(serde_json::json!({
        "name": "Books",
        "orbitals": [
            { "name": "Books", "entity": { "name": "Invoice", "persistence": "persistent", "collection": "invoices", "fields": [{ "name": "id", "type": "string" }] }, "traits": [], "pages": pages }
        ]
    }))
    .expect("schema fixture")
}

fn client_page_names(schema: &orbital_core_base::schema::types::OrbitalSchema) -> Vec<String> {
    let projected: serde_json::Value =
        serde_json::from_str(&orbital_shell_typescript::client_program_orb(schema).expect("projects")).expect("JSON");
    projected["orbitals"][0]["pages"]
        .as_array()
        .expect("pages")
        .iter()
        .map(|p| p["name"].as_str().expect("name").to_string())
        .collect()
}

#[test]
fn the_client_projection_keeps_route_pages_and_drops_protocol_pages() {
    let schema = schema_with_pages(serde_json::json!([
        { "name": "Home", "path": "/", "traits": [] },
        { "name": "Api", "path": "", "protocol": "http", "address": ["host", "0.0.0.0"], "traits": [] },
        { "name": "Mcp", "path": "", "protocol": "stdio", "traits": [] },
        { "name": "Background", "path": "", "protocol": "boot", "traits": [] },
        { "name": "Detail", "path": "/detail", "traits": [] }
    ]));
    assert_eq!(client_page_names(&schema), vec!["Home", "Detail"]);
}

#[test]
fn control_a_program_of_routes_only_projects_every_page() {
    let schema = schema_with_pages(serde_json::json!([
        { "name": "Home", "path": "/", "traits": [] },
        { "name": "Detail", "path": "/detail", "traits": [] }
    ]));
    assert_eq!(client_page_names(&schema), vec!["Home", "Detail"]);
}

#[test]
fn edge_a_program_of_protocol_pages_only_projects_an_empty_page_list() {
    let schema = schema_with_pages(serde_json::json!([
        { "name": "Api", "path": "", "protocol": "http", "address": ["host", "0.0.0.0"], "traits": [] }
    ]));
    assert!(client_page_names(&schema).is_empty());
}
