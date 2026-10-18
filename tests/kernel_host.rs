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

/// The digest of the default (kernel-hosted) output for `module()` and `schema()`, recorded when the embedded program began serializing with sorted keys: the kernel output of the generated-host removal plus the client program files, now a fetched static asset (`public/program.client.json`).
const KERNEL_OUTPUT_DIGEST: u64 = 15_863_638_751_871_176_900;

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

fn file<'a>(files: &'a [(String, String)], path: &str) -> &'a str {
    files
        .iter()
        .find(|(p, _)| p == path)
        .map(|(_, c)| c.as_str())
        .unwrap_or_else(|| panic!("{path} was not emitted"))
}

#[test]
fn the_server_hosts_the_kernel_through_the_runtime() {
    let files = files_of(&kernel_backend());
    let host = file(&files, "packages/server/src/kernel-host.ts");
    assert!(!host.contains("engine:"), "the runtime has only the kernel, so the host names no engine: {host}");
    assert!(host.contains("loadKernelModule"), "{host}");
    assert!(
        host.contains("@almadar/runtime/OrbitalServerRuntime"),
        "{host}"
    );
    let routes = file(&files, "packages/server/src/routes.ts");
    assert!(routes.contains("/api/orbitals"), "{routes}");
}

#[test]
fn the_client_hosts_the_kernel_through_the_ui_engine_provider() {
    let files = files_of(&kernel_backend());
    let app = file(&files, "packages/client/src/App.tsx");
    assert!(
        app.contains("<KernelEngineProvider engine=\"kernel\""),
        "{app}"
    );
    assert!(app.contains("OrbPreview"), "{app}");
    let loader = file(&files, "packages/client/src/kernel-host.ts");
    assert!(loader.contains("@almadar/kernel/client"), "{loader}");
}

#[test]
fn the_client_loader_hands_the_renderer_the_whole_kernel_module_its_evaluator_reads() {
    let files = files_of(&kernel_backend());
    let loader = file(&files, "packages/client/src/kernel-host.ts");
    assert!(loader.contains("import init, * as kernel from '@almadar/kernel/client';"), "{loader}");
    assert!(loader.contains("return kernel;"), "the renderer's evaluator calls evaluateMany and its siblings on the module: {loader}");
    assert!(!loader.contains("return { Kernel };"), "only the Kernel class leaves the evaluator exports out: {loader}");
}

#[test]
fn the_resolved_schema_ships_as_the_apps_data() {
    let files = files_of(&kernel_backend());
    let embedded: serde_json::Value =
        serde_json::from_str(file(&files, "packages/shared/src/program.json")).unwrap();
    assert_eq!(embedded, serde_json::to_value(schema()).unwrap());
    let barrel = file(&files, "packages/shared/src/index.ts");
    assert!(barrel.contains("./program.js"), "{barrel}");
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
        .any(|f| f.path == "packages/client/src/App.tsx"));
    assert!(!client
        .files
        .iter()
        .any(|f| f.path.starts_with("packages/server/")));
    let server = kernel_backend()
        .generate_with_mode(&module, orbital_core_base::generate::ShellMode::Server);
    assert!(server
        .files
        .iter()
        .any(|f| f.path == "packages/server/src/kernel-host.ts"));
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
        .any(|f| f.path.ends_with("program.json")));
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
fn the_server_host_wires_http_os_clock_and_the_dispatch_sink() {
    let files = files_of(&kernel_backend());
    let host = file(&files, "packages/server/src/kernel-host.ts");
    for needle in [
        "import { createCredentialAdminPort, createHttpSecrets, createOAuthPort } from '@almadar/runtime/kernel';",
        "import { createNodeOsHost } from '@almadar/runtime/kernelOsNode';",
        "import { loadHttpKernel, loadKernelModule } from '@almadar/runtime/kernelNode';",
        "http: { kernel: async () => httpKernel, secrets, credentials: createCredentialAdminPort(), oauth: createOAuthPort({ secrets, now: clock }) },",
        "osHost: createNodeOsHost,",
        "clock,",
        "runtime.setHostDispatchSink((item: HostDispatchItem) => {",
        "pushToOrigin(item.originClientId, { type: 'dispatch'",
    ] {
        assert!(host.contains(needle), "missing {needle}\n{host}");
    }
    let sse = file(&files, "packages/server/src/sse.ts");
    assert!(
        sse.contains("item: BusBroadcastItem | DispatchPushItem"),
        "{sse}"
    );
    assert!(
        file(&files, "packages/shared/src/dispatch.ts").contains("type: 'dispatch'"),
        "dispatch frame type"
    );
    assert!(
        file(&files, "packages/shared/src/index.ts").contains("./dispatch.js"),
        "barrel"
    );
}

#[test]
fn the_client_never_registers_the_program_the_server_booted_with() {
    let files = files_of(&kernel_backend());
    let app = file(&files, "packages/client/src/App.tsx");
    assert!(app.contains("register: async () =>"), "{app}");
    assert!(app.contains("unregister: async () =>"), "{app}");
    assert!(
        app.contains("deriveCarriesCircuitState('stateless')"),
        "{app}"
    );
}

#[test]
fn control_the_client_still_sends_events_over_the_http_transport() {
    let files = files_of(&kernel_backend());
    let app = file(&files, "packages/client/src/App.tsx");
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

fn hono_kernel_backend() -> TypeScriptBackend {
    TypeScriptBackend {
        server_framework: orbital_shell_typescript::ServerFramework::Hono,
        ..kernel_backend()
    }
}

#[test]
fn the_hono_server_opens_the_same_kernel_without_the_express_router() {
    let files = files_of(&hono_kernel_backend());
    let host = file(&files, "packages/server/src/kernel-host.ts");
    assert!(!host.contains("engine:"), "the runtime has only the kernel, so the host names no engine: {host}");
    assert!(host.contains("loadKernelModule"), "{host}");
    assert!(
        host.contains("export async function kernelRuntime()"),
        "{host}"
    );
    assert!(host.contains("@almadar/server-hono"), "{host}");
    assert!(!host.contains("express"), "{host}");
    assert!(!host.contains("runtime.router()"), "{host}");
    let express = files_of(&kernel_backend());
    let express_host = file(&express, "packages/server/src/kernel-host.ts");
    assert!(express_host.contains("runtime.router()"), "{express_host}");
}

#[test]
fn the_hono_routes_answer_every_route_the_express_router_serves_from_the_same_runtime_methods() {
    let files = files_of(&hono_kernel_backend());
    let routes = file(&files, "packages/server/src/kernel-routes.ts");
    for call in [
        "kernelRoutes.get('/', ",
        "kernelRoutes.get('/inputs', ",
        "kernelRoutes.post('/resolve-rows', ",
        "kernelRoutes.post('/:orbital/inputs', ",
        "kernelRoutes.get('/:orbital/entities/:entityType', ",
        "kernelRoutes.get('/:orbital', ",
        "kernelRoutes.post('/:orbital/events', ",
        "listOrbitalSummaries()",
        "describeOrbital(",
        "entityRows(",
        "refuseInboundOnly(",
        "processOrbitalEvent(",
        "dispatchExternalInput(",
        "streamSSE(",
    ] {
        assert!(routes.contains(call), "{call} missing from {routes}");
    }
    let mount = file(&files, "packages/server/src/routes.ts");
    assert!(mount.contains("identifyBearer"), "{mount}");
    assert!(
        mount.contains("app.route('/api/orbitals', kernelRoutes)"),
        "{mount}"
    );
    let sse = file(&files, "packages/server/src/sse.ts");
    assert!(sse.contains("hono/streaming"), "{sse}");
    assert!(sse.contains("mintStreamTicket"), "{sse}");
}

#[test]
fn control_the_express_kernel_server_has_no_hono_routes_and_the_hono_one_emits_no_handlers() {
    let express = files_of(&kernel_backend());
    assert!(express
        .iter()
        .all(|(p, _)| p != "packages/server/src/kernel-routes.ts"));
    let hono = files_of(&hono_kernel_backend());
    assert!(
        hono.iter()
            .all(|(p, _)| !p.contains("/routes/features/") && !p.ends_with("handlers.ts")),
        "{:?}",
        hono.iter().map(|(p, _)| p.as_str()).collect::<Vec<_>>()
    );
    let manifest: serde_json::Value =
        serde_json::from_str(file(&hono, "packages/shared/package.json")).unwrap();
    assert_eq!(manifest["type"], "module");
}

#[test]
fn the_production_client_build_ships_no_source_maps_and_splits_the_kernel_and_react_into_chunks() {
    for (name, config) in [
        (
            "almadar-shell",
            include_str!("../templates/almadar-shell/packages/client/vite.config.ts"),
        ),
        (
            "almadar-shell-hono",
            include_str!("../templates/almadar-shell-hono/packages/client/vite.config.ts"),
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
    let full: serde_json::Value =
        serde_json::from_str(file(&files, "packages/shared/src/program.json")).unwrap();
    let client: serde_json::Value =
        serde_json::from_str(file(&files, "packages/client/public/program.client.json")).unwrap();
    for key in ["_metadata", "ledger"] {
        assert!(client.get(key).is_none(), "{key}");
    }
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
    let app = file(&files, "packages/client/src/App.tsx");
    assert!(app.contains("from './client-program'"), "{app}");
    assert!(!app.contains("program.client.json") && !app.contains("program.json"), "{app}");
    assert!(!app.contains("from '@app/shared'"), "{app}");
    let module = file(&files, "packages/client/src/client-program.ts");
    assert!(module.contains("fetch(`${import.meta.env.BASE_URL}program.client.json`)"), "{module}");
    assert!(!module.contains("import programJson"), "{module}");
}

#[test]
fn the_client_asset_omits_what_the_client_never_reads_while_the_server_copy_keeps_it() {
    let files = files_of(&kernel_backend());
    let asset: serde_json::Value =
        serde_json::from_str(file(&files, "packages/client/public/program.client.json")).unwrap();
    let server: serde_json::Value =
        serde_json::from_str(file(&files, "packages/shared/src/program.json")).unwrap();
    assert!(asset.get("_metadata").is_none() && asset.get("ledger").is_none());
    assert_eq!(server["_metadata"]["version"], 1, "control: {server}");
}

#[test]
fn control_the_client_entry_fetches_the_program_and_no_client_source_imports_it() {
    let files = files_of(&kernel_backend());
    for (path, content) in &files {
        if path.starts_with("packages/client/src/") && (path.ends_with(".ts") || path.ends_with(".tsx")) {
            assert!(!content.contains("program.client.json'"), "{path} imports the program");
            assert!(!content.contains("program.json'"), "{path} imports the program");
        }
    }
    let module = file(&files, "packages/client/src/client-program.ts");
    assert!(module.contains("export function loadProgram"), "{module}");
}

#[test]
fn control_a_server_only_compile_ships_no_client_projection() {
    let server = kernel_backend()
        .generate_with_mode(&module(), orbital_core_base::generate::ShellMode::Server);
    assert!(!server
        .files
        .iter()
        .any(|f| f.path.contains("program.client.json")));
}
