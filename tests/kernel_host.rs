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

/// The digest of the default (kernel-hosted) output for `module()` and `schema()`, recorded when the generated host was retired: the files the kernel host emitted before, unchanged.
const KERNEL_OUTPUT_DIGEST: u64 = 9_027_411_895_961_707_616;

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
    assert!(host.contains("engine: 'kernel'"), "{host}");
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
    assert!(loader.contains("@almadar/kernel"), "{loader}");
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
    let client =
        kernel_backend().generate_with_mode(&module, orbital_core_base::generate::ShellMode::Client);
    assert!(client
        .files
        .iter()
        .any(|f| f.path == "packages/client/src/App.tsx"));
    assert!(!client
        .files
        .iter()
        .any(|f| f.path.starts_with("packages/server/")));
    let server =
        kernel_backend().generate_with_mode(&module, orbital_core_base::generate::ShellMode::Server);
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
    assert!(app.contains("deriveCarriesCircuitState('stateless')"), "{app}");
}

#[test]
fn control_the_client_still_sends_events_over_the_http_transport() {
    let files = files_of(&kernel_backend());
    let app = file(&files, "packages/client/src/App.tsx");
    assert!(app.contains("createHttpTransport({ serverUrl: `${API_BASE}/api/orbitals`"), "{app}");
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
    assert!(host.contains("engine: 'kernel'"), "{host}");
    assert!(host.contains("loadKernelModule"), "{host}");
    assert!(host.contains("export async function kernelRuntime()"), "{host}");
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
    assert!(mount.contains("app.route('/api/orbitals', kernelRoutes)"), "{mount}");
    let sse = file(&files, "packages/server/src/sse.ts");
    assert!(sse.contains("hono/streaming"), "{sse}");
    assert!(sse.contains("mintStreamTicket"), "{sse}");
}

#[test]
fn control_the_express_kernel_server_has_no_hono_routes_and_the_hono_one_emits_no_handlers() {
    let express = files_of(&kernel_backend());
    assert!(express.iter().all(|(p, _)| p != "packages/server/src/kernel-routes.ts"));
    let hono = files_of(&hono_kernel_backend());
    assert!(
        hono.iter().all(|(p, _)| !p.contains("/routes/features/") && !p.ends_with("handlers.ts")),
        "{:?}",
        hono.iter().map(|(p, _)| p.as_str()).collect::<Vec<_>>()
    );
    let manifest: serde_json::Value =
        serde_json::from_str(file(&hono, "packages/shared/package.json")).unwrap();
    assert_eq!(manifest["type"], "module");
}
