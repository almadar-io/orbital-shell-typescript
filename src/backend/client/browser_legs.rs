//! Browser legs: a transition whose data effects target a browser-stored entity
//! (`[persistent: x, local]`) sends its leg to the in-process browser store
//! (`@almadar/runtime` `openBundledBrowserStore`) instead of the server. The
//! store runs the resolved schema, bundled as `browserSchema.json` and loaded
//! on the first such leg.

use crate::backend::*;

/// Path of the bundled schema, relative to `packages/client/src`.
pub(crate) const BROWSER_SCHEMA_FILE: &str = "browserSchema.json";

/// The `Trait\u{0}EVENT` key the bridge routes on.
pub(crate) fn browser_leg_key(trait_name: &str, event: &str) -> String {
    format!("{trait_name}\u{0}{event}")
}

/// Whether `expr` holds a `browser/beacon` at any depth: the compiled client has no executor of its own, so a
/// beacon is delivered by the browser store's one http driver, reached as a browser leg like a keyless `http`.
fn runs_beacon(expr: &OirExpr) -> bool {
    match expr {
        OirExpr::Effect { effect } if matches!(effect.as_ref(), OirEffect::BrowserBeacon { .. }) => true,
        OirExpr::Conditional { condition, then_branch, else_branch } => {
            (!condition.is_statically_false() && runs_beacon(then_branch)) || runs_beacon(else_branch)
        }
        _ => expr.child_exprs().into_iter().any(runs_beacon),
    }
}

impl TypeScriptBackend {
    /// The events whose leg goes to the browser store: the core set (`OirTrait::browser_leg_events`) plus every live
    /// transition or client tick that sends a `browser/beacon`.
    pub(crate) fn trait_browser_leg_events(trait_def: &OirTrait, module: &OirModule) -> BTreeSet<String> {
        let residence = orbital_core_base::runs_on::Residence::of_module(module);
        let mut events = trait_def.browser_leg_events(&residence);
        events.extend(
            trait_def
                .transitions
                .iter()
                .filter(|t| !t.guard.as_ref().is_some_and(|g| g.is_statically_false()))
                .filter(|t| t.effects.iter().any(runs_beacon))
                .map(|t| t.event.clone()),
        );
        events.extend(
            trait_def
                .ticks
                .iter()
                .filter(|t| !t.background && t.effects.iter().any(runs_beacon))
                .map(|t| orbital_core_base::bus_event::tick_event_key(&t.name)),
        );
        events
    }

    pub(crate) fn compute_browser_legs(module: &OirModule) -> BTreeSet<String> {
        module
            .traits
            .iter()
            .flat_map(|t| {
                Self::trait_browser_leg_events(t, module)
                    .into_iter()
                    .map(|event| browser_leg_key(&t.name, &event))
            })
            .collect()
    }

    /// The browser store's `callService`: the web-hosted implementations of the
    /// browser-only services the program calls.
    pub(crate) fn generate_browser_services_file(module: &OirModule) -> Option<InternalFile> {
        if module.browser_services.is_empty() {
            return None;
        }
        let names: Vec<String> = module
            .browser_services
            .iter()
            .map(|s| format!("'{s}'"))
            .collect();
        Some(InternalFile::new(
            "packages/client/src/browserServices.ts".to_string(),
            format!(
                "import {{ createBrowserCallService, webBrowserServices }} from '@almadar/integrations/browser';\n\nexport const browserCallService = createBrowserCallService(webBrowserServices([{}]));\n",
                names.join(", ")
            ),
            GeneratedFileType::Config,
        ))
    }

    /// Whether the program runs a keyless `http` (no `auth` key) or a `browser/beacon`: it runs where its trait
    /// does, so in a browser leg it needs the browser store's request driver.
    pub(crate) fn module_runs_client_http(module: &OirModule) -> bool {
        fn client_http(expr: &OirExpr) -> bool {
            if runs_beacon(expr) {
                return true;
            }
            if let OirExpr::Effect { effect } = expr {
                if matches!(effect.as_ref(), OirEffect::Http { .. })
                    && orbital_core_base::runs_on::ir_effect_site(effect, &orbital_core_base::runs_on::Residence::none())
                        == orbital_core_base::runs_on::RunsOn::Client
                {
                    return true;
                }
            }
            expr.child_exprs().into_iter().any(client_http)
        }
        module.traits.iter().any(|t| {
            t.transitions.iter().any(|tr| tr.effects.iter().any(client_http))
                || t.ticks.iter().any(|tick| tick.effects.iter().any(client_http))
        })
    }

    /// The browser store's `http` ports: the kernel's request driver over the browser's `fetch`, bounded by the
    /// program's `egress` and the browser's own CORS (a browser cannot resolve a name, so there is no address check).
    pub(crate) fn generate_browser_http_file(module: &OirModule) -> Option<InternalFile> {
        if !Self::module_runs_client_http(module) {
            return None;
        }
        let egress: Vec<String> = module.egress.iter().map(|o| format!("'{o}'")).collect();
        Some(InternalFile::new(
            "packages/client/src/browserHttp.ts".to_string(),
            format!(
                "import initKernel, * as kernel from '@almadar/kernel';\nimport wasmUrl from '@almadar/kernel/kernel.wasm?url';\nimport {{ createBrowserHttpPorts }} from '@almadar/runtime/kernel';\n\nexport const browserHttp = createBrowserHttpPorts({{\n  kernel: async () => {{\n    await initKernel({{ module_or_path: wasmUrl }});\n    return kernel;\n  }},\n  egress: [{}],\n}});\n",
                egress.join(", ")
            ),
            GeneratedFileType::Config,
        ))
    }

    /// The resolved schema restricted to the orbitals that own a browser leg.
    pub(crate) fn generate_browser_schema_file(&self, module: &OirModule) -> Option<InternalFile> {
        let legged: Vec<&OirTrait> = module
            .traits
            .iter()
            .filter(|t| !Self::trait_browser_leg_events(t, module).is_empty())
            .collect();
        if legged.is_empty() {
            return None;
        }
        let owners: BTreeSet<&str> = legged.iter().map(|t| t.orbital_name.as_str()).collect();
        let traits: BTreeSet<&str> = legged.iter().map(|t| t.name.as_str()).collect();
        let mut schema = self.browser_schema.clone()?;
        schema.orbitals.retain(|o| owners.contains(o.name.as_str()));
        // A compiled client relays its own cascade, so the store runs only the requested leg's trait;
        // resolve-time imports, metadata and the identity ledger are never read there.
        schema.metadata = None;
        schema.ledger = None;
        for orbital in &mut schema.orbitals {
            orbital
                .traits
                .retain(|t| t.trait_name().is_some_and(|n| traits.contains(n)));
            orbital.uses = None;
        }
        let json = serde_json::to_string(&schema).ok()?;
        Some(InternalFile::new(
            format!("packages/client/src/{BROWSER_SCHEMA_FILE}"),
            json,
            GeneratedFileType::Config,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use orbital_core_base::ir::{
        OirEffect, OirEntity, OirExpr, OirField, OirModule, OirPersistence, OirState, OirTrait,
        OirTransition, OirType,
    };

    fn module(local: bool) -> OirModule {
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
        module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local,
            seed_mock: false,
            id: None,
            name: "Invoice".to_string(),
            description: None,
            collection: "invoices".to_string(),
            persistence: OirPersistence::Persistent,
            fields: vec![
                OirField::new("id", OirType::String),
                OirField::new("amount", OirType::Number),
            ],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });
        module.traits.push(list);
        module
    }

    fn backend_with_schema() -> TypeScriptBackend {
        let schema: orbital_core_base::schema::types::OrbitalSchema = serde_json::from_value(serde_json::json!({
            "name": "Books",
            "orbitals": [
                { "name": "Books", "entity": { "name": "Invoice", "persistence": "persistent", "collection": "invoices", "local": true, "fields": [{ "name": "id", "type": "string" }] }, "traits": [], "pages": [] },
                { "name": "Other", "entity": { "name": "Note", "persistence": "runtime", "fields": [{ "name": "id", "type": "string" }] }, "traits": [], "pages": [] }
            ]
        }))
        .expect("schema fixture");
        TypeScriptBackend {
            browser_schema: Some(schema),
            ..TypeScriptBackend::default()
        }
    }

    #[test]
    fn a_fetch_of_a_browser_stored_entity_is_a_browser_leg() {
        let legs = TypeScriptBackend::compute_browser_legs(&module(true));
        assert_eq!(
            legs.into_iter().collect::<Vec<_>>(),
            vec![browser_leg_key("InvoiceList", "INIT")]
        );
    }

    #[test]
    fn control_a_fetch_of_a_server_entity_is_no_browser_leg() {
        assert!(TypeScriptBackend::compute_browser_legs(&module(false)).is_empty());
    }

    #[test]
    fn the_bundled_schema_keeps_only_the_orbitals_that_own_a_browser_leg() {
        let file = backend_with_schema()
            .generate_browser_schema_file(&module(true))
            .expect("schema file");
        assert_eq!(file.path, "packages/client/src/browserSchema.json");
        let value: serde_json::Value = serde_json::from_str(&file.content).unwrap();
        let names: Vec<&str> = value["orbitals"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, vec!["Books"]);
    }

    #[test]
    fn the_bundled_schema_keeps_only_the_traits_that_own_a_browser_leg() {
        let schema: orbital_core_base::schema::types::OrbitalSchema = serde_json::from_value(serde_json::json!({
            "name": "Books",
            "orbitals": [{
                "name": "Books",
                "entity": { "name": "Invoice", "persistence": "persistent", "collection": "invoices", "local": true, "fields": [{ "name": "id", "type": "string" }] },
                "traits": [
                    { "name": "InvoiceList", "stateMachine": { "states": [{ "name": "idle", "isInitial": true }], "transitions": [] } },
                    { "name": "InvoiceChart", "stateMachine": { "states": [{ "name": "idle", "isInitial": true }], "transitions": [] } }
                ],
                "pages": [],
                "uses": [{ "from": "almadar-behaviors/std-orb-home", "as": "Home" }]
            }]
        }))
        .expect("schema fixture");
        let backend = TypeScriptBackend {
            browser_schema: Some(schema),
            ..TypeScriptBackend::default()
        };
        let file = backend
            .generate_browser_schema_file(&module(true))
            .expect("schema file");
        let value: serde_json::Value = serde_json::from_str(&file.content).unwrap();
        let traits: Vec<&str> = value["orbitals"][0]["traits"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            traits,
            vec!["InvoiceList"],
            "a compiled client relays its cascade; the store runs only leg traits"
        );
        assert_eq!(
            value["orbitals"][0]["entity"]["name"], "Invoice",
            "the orbital's entities stay"
        );
        assert!(
            value["orbitals"][0].get("uses").is_none(),
            "resolve-time imports are not shipped to the store"
        );
    }

    #[test]
    fn control_no_browser_leg_bundles_no_schema() {
        assert!(backend_with_schema()
            .generate_browser_schema_file(&module(false))
            .is_none());
    }

    #[test]
    fn a_backend_without_the_resolved_schema_cannot_store_rows_in_the_browser() {
        use orbital_core_base::generate::Backend;
        assert!(!TypeScriptBackend::default().supports_browser_stored_entities());
        assert!(backend_with_schema().supports_browser_stored_entities());
    }

    #[test]
    fn the_bridge_routes_browser_legs_to_the_browser_store() {
        let backend = backend_with_schema();
        backend
            .browser_legs
            .set(TypeScriptBackend::compute_browser_legs(&module(true)));
        let bridge = backend.generate_orbital_bridge_hook().content;
        for marker in [
            "import { openBundledBrowserStore } from '@almadar/runtime';",
            "const __BROWSER_LEGS: ReadonlySet<string> = new Set(['InvoiceList\\u0000INIT']);",
            "const __browserLeg = __BROWSER_LEGS.has(`${traitName}\\u0000${event}`);",
            "const __browserTransports = new Map<string, ReturnType<typeof openBundledBrowserStore>>();",
            "import('@/browserSchema.json').then((m) => openBundledBrowserStore(m.default, locale, undefined, __BROWSER_MESSAGES))",
            "return transport.then((t) => t.send(orbitalName, { ...request, locale }));",
            "const { locale: __locale } = useTranslate();",
            "await __browserSend(orbitalName, { event, payload",
        ] {
            assert!(bridge.contains(marker), "missing {marker:?}:\n{bridge}");
        }
    }

    /// A browser leg evaluates `i18n/t` in the browser store: it needs the app's catalogs.
    #[test]
    fn the_browser_store_gets_every_locale_catalog() {
        let backend = backend_with_schema();
        backend
            .browser_legs
            .set(TypeScriptBackend::compute_browser_legs(&module(true)));
        backend
            .browser_locales
            .set(vec!["en".to_string(), "ar".to_string()]);
        let bridge = backend.generate_orbital_bridge_hook().content;
        for marker in [
            "import __messages_en from '../../../../locales/en.json';",
            "import __messages_ar from '../../../../locales/ar.json';",
            "const __BROWSER_MESSAGES: Record<string, Record<string, string>> = { en: __messages_en, ar: __messages_ar };",
        ] {
            assert!(bridge.contains(marker), "missing {marker:?}:\n{bridge}");
        }
    }

    fn analytics_module() -> OirModule {
        let mut visit = OirTrait::new("Pageview");
        visit.orbital_name = "Site".to_string();
        visit.states.push(OirState::initial("active"));
        visit.transitions.push(
            OirTransition::new("active", "active", "INIT").with_effects(vec![OirExpr::effect(
                OirEffect::call_service("analytics", "pageview", OirExpr::null()),
            )]),
        );
        let mut module = OirModule::new("Site", "1.0.0");
        module.traits.push(visit);
        module.browser_services = vec!["analytics".to_string()];
        module
    }

    #[test]
    fn a_call_to_a_browser_only_service_is_a_browser_leg() {
        assert_eq!(
            TypeScriptBackend::compute_browser_legs(&analytics_module())
                .into_iter()
                .collect::<Vec<_>>(),
            vec![browser_leg_key("Pageview", "INIT")]
        );
        let mut control = analytics_module();
        control.browser_services.clear();
        assert!(
            TypeScriptBackend::compute_browser_legs(&control).is_empty(),
            "undeclared, it stays a server leg"
        );
    }

    #[test]
    fn the_client_wires_the_web_hosted_browser_services_it_calls() {
        let file = TypeScriptBackend::generate_browser_services_file(&analytics_module())
            .expect("browserServices.ts");
        assert_eq!(file.path, "packages/client/src/browserServices.ts");
        assert!(file.content.contains("import { createBrowserCallService, webBrowserServices } from '@almadar/integrations/browser';"), "{}", file.content);
        assert!(file.content.contains("export const browserCallService = createBrowserCallService(webBrowserServices(['analytics']));"), "{}", file.content);
        assert!(
            TypeScriptBackend::generate_browser_services_file(&module(true)).is_none(),
            "control: no browser-only service, no file"
        );
    }

    #[test]
    fn the_browser_store_answers_its_service_calls() {
        let backend = backend_with_schema();
        backend
            .browser_legs
            .set(TypeScriptBackend::compute_browser_legs(&analytics_module()));
        backend.browser_services.set(true);
        let bridge = backend.generate_orbital_bridge_hook().content;
        for marker in [
            "import { browserCallService } from '@/browserServices';",
            "import('@/browserSchema.json').then((m) => openBundledBrowserStore(m.default, locale, browserCallService, __BROWSER_MESSAGES))",
        ] {
            assert!(bridge.contains(marker), "missing {marker:?}:\n{bridge}");
        }
    }

    fn http_module(auth: bool) -> OirModule {
        let mut fields = orbital_core_base::ir::OirFields::new();
        if auth {
            fields.insert("auth".to_string(), OirExpr::object(orbital_core_base::ir::OirFields::new()));
        }
        let mut effect = OirEffect::http(
            orbital_core_base::http_wire::HttpMethod::Get,
            OirExpr::string("https://api.example.com"),
            OirExpr::string("/x"),
        );
        if let OirEffect::Http { request, .. } = &mut effect {
            *request = Some(OirExpr::object(fields));
        }
        let mut load = OirTrait::new("Loader");
        load.orbital_name = "Feed".to_string();
        load.states.push(OirState::initial("idle"));
        load.transitions.push(
            OirTransition::new("idle", "idle", "LOAD").with_effects(vec![OirExpr::effect(effect)]),
        );
        let mut module = OirModule::new("Feed", "1.0.0");
        module.traits.push(load);
        module.egress = vec!["https://api.example.com".to_string()];
        module
    }

    #[test]
    fn a_beacon_is_a_browser_leg_and_the_client_wires_its_request_driver() {
        let mut module = http_module(false);
        module.traits[0].transitions[0].effects = vec![OirExpr::effect(OirEffect::BrowserBeacon {
            url: OirExpr::string("https://api.example.com/e"),
            request: OirExpr::object(orbital_core_base::ir::OirFields::new()),
            key: None,
            emit: None,
        })];
        assert_eq!(
            TypeScriptBackend::compute_browser_legs(&module).into_iter().collect::<Vec<_>>(),
            vec![browser_leg_key("Loader", "LOAD")]
        );
        assert!(TypeScriptBackend::generate_browser_http_file(&module).is_some());
    }

    #[test]
    fn a_keyless_http_is_a_browser_leg_and_the_client_wires_its_request_driver() {
        let module = http_module(false);
        assert_eq!(
            TypeScriptBackend::compute_browser_legs(&module).into_iter().collect::<Vec<_>>(),
            vec![browser_leg_key("Loader", "LOAD")]
        );
        assert!(TypeScriptBackend::module_runs_client_http(&module));
        let file = TypeScriptBackend::generate_browser_http_file(&module).expect("browserHttp.ts");
        assert_eq!(file.path, "packages/client/src/browserHttp.ts");
        for marker in [
            "import { createBrowserHttpPorts } from '@almadar/runtime/kernel';",
            "import wasmUrl from '@almadar/kernel/kernel.wasm?url';",
            "await initKernel({ module_or_path: wasmUrl });",
            "egress: ['https://api.example.com'],",
        ] {
            assert!(file.content.contains(marker), "missing {marker:?}:\n{}", file.content);
        }
    }

    #[test]
    fn control_an_http_with_auth_stays_a_server_leg_and_the_client_wires_no_driver() {
        let module = http_module(true);
        assert!(TypeScriptBackend::compute_browser_legs(&module).is_empty());
        assert!(!TypeScriptBackend::module_runs_client_http(&module));
        assert!(TypeScriptBackend::generate_browser_http_file(&module).is_none());
    }

    #[test]
    fn the_browser_store_is_opened_with_the_request_driver() {
        let backend = backend_with_schema();
        backend
            .browser_legs
            .set(TypeScriptBackend::compute_browser_legs(&http_module(false)));
        backend.browser_http.set(true);
        let bridge = backend.generate_orbital_bridge_hook().content;
        for marker in [
            "import { browserHttp } from '@/browserHttp';",
            "import('@/browserSchema.json').then((m) => openBundledBrowserStore(m.default, locale, undefined, __BROWSER_MESSAGES, browserHttp))",
        ] {
            assert!(bridge.contains(marker), "missing {marker:?}:\n{bridge}");
        }
    }

    #[test]
    fn control_a_program_without_a_client_http_opens_the_store_without_a_driver() {
        let backend = backend_with_schema();
        backend
            .browser_legs
            .set(TypeScriptBackend::compute_browser_legs(&module(true)));
        let bridge = backend.generate_orbital_bridge_hook().content;
        assert!(!bridge.contains("browserHttp"), "{bridge}");
    }

    #[test]
    fn control_browser_legs_over_entities_only_lend_no_services() {
        let backend = backend_with_schema();
        backend
            .browser_legs
            .set(TypeScriptBackend::compute_browser_legs(&module(true)));
        let bridge = backend.generate_orbital_bridge_hook().content;
        assert!(!bridge.contains("browserServices"), "{bridge}");
        assert!(
            bridge.contains(
                "openBundledBrowserStore(m.default, locale, undefined, __BROWSER_MESSAGES))"
            ),
            "{bridge}"
        );
    }

    #[test]
    fn control_an_app_without_browser_legs_has_no_browser_routing() {
        let backend = backend_with_schema();
        backend
            .browser_legs
            .set(TypeScriptBackend::compute_browser_legs(&module(false)));
        let bridge = backend.generate_orbital_bridge_hook().content;
        for absent in ["@almadar/runtime", "__BROWSER_LEGS", "browserSchema"] {
            assert!(!bridge.contains(absent), "unexpected {absent:?}:\n{bridge}");
        }
    }

    #[test]
    fn a_client_only_trait_sends_a_leg_for_its_browser_events_only() {
        let backend = backend_with_schema();
        let module = module(true);
        let list = module.find_trait("InvoiceList").unwrap();
        let hook = backend.generate_trait_logic_hook(list, &module).content;
        assert!(
            hook.contains("const __LEG_EVENTS: ReadonlySet<string> = new Set(['INIT']);"),
            "{hook}"
        );
        assert!(hook.contains("if (__LEG_EVENTS.has(event)) {"), "{hook}");
        assert!(hook.contains("commandPump.enqueue(async () => {"), "{hook}");
        assert!(hook.contains("        if (response.success) {\n"), "{hook}");
        assert!(!hook.contains("=== _optimistic.newState"), "{hook}");
    }

    /// The browser store runs one leg statelessly: it replays the transition from the pre-dispatch
    /// state, so it needs the pre-dispatch row (std-checkout's `COMPLETE` guard reads the name,
    /// email and address the earlier steps set on the client).
    #[test]
    fn a_browser_leg_carries_the_rows_state_before_the_dispatch() {
        let backend = backend_with_schema();
        let module = module(true);
        let list = module.find_trait("InvoiceList").unwrap();
        let hook = backend.generate_trait_logic_hook(list, &module).content;
        let pre = hook.find("const _preRow = { ...fieldsRef.current } as EntityRow;").expect(&hook);
        let commit = hook.find("fieldsRef.current = { ...fieldsRef.current, ..._optimistic.fields }").expect(&hook);
        assert!(pre < commit, "the row is taken before the local commit:\n{hook}");
        assert!(hook.contains("const response = await sendEvent(event, payload, prevState, _preRow);"), "{hook}");
    }

    #[test]
    fn control_a_trait_on_a_server_entity_has_no_leg_gate() {
        let backend = backend_with_schema();
        let module = module(false);
        let list = module.find_trait("InvoiceList").unwrap();
        let hook = backend.generate_trait_logic_hook(list, &module).content;
        assert!(!hook.contains("__LEG_EVENTS"), "{hook}");
        assert!(hook.contains("await sendEvent("), "{hook}");
    }
}
