use crate::backend::*;

/// Extract `:param` names from a page path in declaration order (e.g.
/// `/users/:userId/posts/:postId` → `["userId", "postId"]`). Mirrors
/// `matchPath`/`extractRouteParams` in the JS runtime's navigation.tsx —
/// arbitrary param names are permitted, not just `:id`.
fn path_params(path: &str) -> Vec<String> {
    path.split('/')
        .filter(|seg| seg.starts_with(':') && seg.len() > 1)
        .map(|seg| seg[1..].to_string())
        .collect()
}

impl TypeScriptBackend {
    /// Generate packages/client/src/features/{pagename}/*.tsx
    pub(crate) fn generate_page_feature(
        &self,
        page: &OirPage,
        module: &OirModule,
        embedded_traits: &HashSet<String>,
    ) -> Vec<InternalFile> {
        let mut files = Vec::new();

        let page_name = &page.name;
        let folder_name = to_lowercase_nosep(page_name);

        files.push(self.generate_page_component(page, &folder_name, module, embedded_traits));
        files.push(self.generate_page_index(page, &folder_name));

        files
    }

    /// Recursively collects the names of every trait reachable from
    /// `trait_def` via `<trait.X/>` (or an anonymous inline embed) anywhere
    /// in ITS OWN render-ui patterns, then in the render-ui patterns of
    /// whatever it embeds, and so on — the transitive embed closure. Used
    /// by the page's Provider gate so a `[shared]`-entity trait embedded
    /// only through a sibling's render tree still gets the
    /// `SharedEntityStoreContext` its hook needs.
    ///
    /// Mirrors the per-source ambient-scope dance `find_racy_listens` uses:
    /// `parse_trait_binding` resolves a renamed embed token through the V4
    /// leverage-id side-map (`current_trait_embed_names`), which is keyed to
    /// the SOURCE trait currently being walked, not the page's top-level
    /// trait. `visited` guards against an embed cycle.
    pub(crate) fn collect_transitive_embedded_trait_refs<'m>(
        &self,
        trait_def: &'m OirTrait,
        module: &'m OirModule,
        visited: &mut HashSet<&'m str>,
        out: &mut HashSet<String>,
    ) {
        if !visited.insert(trait_def.name.as_str()) {
            return;
        }
        let prior_embed_names = self.current_trait_embed_names.snapshot();
        self.current_trait_embed_names
            .set(Self::build_trait_embed_names(trait_def, module));
        let mut directly_embedded: HashSet<String> = HashSet::new();
        for trans in &trait_def.transitions {
            for pattern in orbital_core::ir::render_ui_patterns(&trans.effects) {
                orbital_core::ir::collect_trait_refs_from_pattern(
                    pattern,
                    &|s| self.parse_trait_binding(s),
                    &mut directly_embedded,
                );
            }
        }
        self.current_trait_embed_names.set(prior_embed_names);

        for name in directly_embedded {
            if let Some(child) = module.traits.iter().find(|t| t.name == name) {
                out.insert(child.name.clone());
                self.collect_transitive_embedded_trait_refs(child, module, visited, out);
            }
        }
    }

    pub(crate) fn generate_page_component(
        &self,
        page: &OirPage,
        folder_name: &str,
        module: &OirModule,
        embedded_traits: &HashSet<String>,
    ) -> InternalFile {
        let traits = &module.traits;
        let page_name = &page.name;

        let mut code = String::new();

        // Collect all slots used by traits on this page (still needed for overlay slots),
        // and whether any trait on this page links a `[shared]` entity — if so, this
        // page owns the ONE `SharedEntityStore` instance every such trait's hook reads
        // via `SharedEntityStoreContext` (see `generate_shared_trait_logic_hook` /
        // `generate_shared_tick_driver`) instead of each creating its own disconnected
        // store. A page with no shared-entity trait emits no Provider — unchanged from
        // before this existed.
        let mut all_slots_used: HashSet<&str> = HashSet::new();
        let mut has_shared_entity = false;
        for trait_binding in &page.traits {
            if let Some(trait_def) = traits.iter().find(|t| {
                t.matches_ref(trait_binding.trait_id.as_deref(), &trait_binding.trait_name)
            }) {
                for slot in &trait_def.slots_used {
                    all_slots_used.insert(slot.as_str());
                }
                if self.shared_linked_entity(trait_def, module).is_some() {
                    has_shared_entity = true;
                }
                // A hybrid trait bound to a `[shared]` entity may reach this
                // page only through another trait's render tree
                // (`<trait.B/>` nested inside A's own `render-ui`, never
                // listed on the page directly) — walk the FULL transitive
                // embed closure, not just the page's own top-level trait
                // list, or the embedded trait mounts with no
                // `SharedEntityStoreContext` and throws.
                let mut visited: HashSet<&str> = HashSet::new();
                let mut transitively_embedded: HashSet<String> = HashSet::new();
                self.collect_transitive_embedded_trait_refs(
                    trait_def,
                    module,
                    &mut visited,
                    &mut transitively_embedded,
                );
                for name in &transitively_embedded {
                    if let Some(embedded_trait) = traits.iter().find(|t| &t.name == name) {
                        if self.shared_linked_entity(embedded_trait, module).is_some() {
                            has_shared_entity = true;
                        }
                    }
                }
            }
        }

        code.push_str(&format!("/**\n * {}\n *\n", page_name));
        code.push_str(&format!(" * Page component for {}\n", page_name));
        code.push_str(&format!(" * Path: {}\n *\n", page.path));
        code.push_str(" * @generated from schema\n */\n\n");

        code.push_str("import React from 'react';\n");

        // Route params (arbitrary `:name` segments, not just `:id`) plus the
        // navigate-state payload (`useLocation().state`, set by a caller's
        // `(navigate path payload)`) are both delivered into the mounted
        // view's `config` and merged into INIT — see
        // `generate_auto_init_effect` (codegen/effect/client.rs).
        let params = path_params(&page.path);
        let has_params = !params.is_empty();
        let has_id_param = params.iter().any(|p| p == "id");
        if has_params {
            code.push_str("import { useParams, useLocation } from 'react-router-dom';\n");
        } else {
            code.push_str("import { useLocation } from 'react-router-dom';\n");
        }
        code.push_str("import type { EventPayload } from '@almadar/core';\n");

        // Import View components (Phase 2 pattern). Skip imports for
        // embedded traits — those are referenced inline by a sibling
        // layout via `@trait.X`, and the layout's view file already
        // imports them. Importing here unused would trigger lint
        // errors in the generated app.
        for trait_binding in &page.traits {
            if embedded_traits.contains(&trait_binding.trait_name) {
                continue;
            }
            code.push_str(&format!(
                "import {{ {0}View as __{0}View }} from '@/components/traits/{0}View';\n",
                trait_binding.trait_name
            ));
        }
        code.push_str("import { VStack, UISlotComponent } from '@almadar/ui/components';\n");
        // A page declaring head modifiers keeps the document head on its
        // contract during client navigation (same hook as the runtime path).
        let page_head = page_head_literal(page, module);
        match (has_shared_entity, page_head.is_some()) {
            (true, true) => code.push_str(
                "import { SharedEntityStoreContext, useSharedEntityStore, usePageHead } from '@almadar/ui/hooks';\n",
            ),
            (true, false) => code.push_str(
                "import { SharedEntityStoreContext, useSharedEntityStore } from '@almadar/ui/hooks';\n",
            ),
            (false, true) => code.push_str("import { usePageHead } from '@almadar/ui/hooks';\n"),
            (false, false) => {}
        }

        // Only import slot components that are actually used (for overlay slots)
        let mut slot_imports = Vec::new();
        if all_slots_used.contains("modal") {
            slot_imports.push("ModalSlot");
        }
        if all_slots_used.contains("drawer") {
            slot_imports.push("DrawerSlot");
        }
        if all_slots_used.contains("toast") {
            slot_imports.push("ToastSlot");
        }
        if !slot_imports.is_empty() {
            code.push_str(&format!(
                "import {{ {} }} from '@almadar/ui/components';\n",
                slot_imports.join(", ")
            ));
        }
        code.push('\n');

        // Props interface
        code.push_str(&format!("interface {}Props {{\n", page_name));
        code.push_str("  // Add any page-level props here\n");
        code.push_str("}\n\n");

        // Component — renders View components directly
        code.push_str(&format!(
            "export function {}(_props: {}Props) {{\n",
            page_name, page_name
        ));

        // Extract URL route params (any `:name` segment) and the
        // navigate-state payload (delivered via router history state).
        if has_params {
            code.push_str("  const __routeParams = useParams();\n");
        }
        if let Some(head) = &page_head {
            code.push_str("  const __location = useLocation();\n");
            code.push_str("  const __navState = (__location.state ?? {}) as EventPayload;\n\n");
            code.push_str(&format!(
                "  usePageHead({{ {head}, path: __location.pathname }});\n\n"
            ));
        } else {
            code.push_str("  const __navState = (useLocation().state ?? {}) as EventPayload;\n\n");
        }
        if has_shared_entity {
            code.push_str("  const _sharedStore = useSharedEntityStore();\n\n");
        }

        // Render
        code.push_str("  return (\n");
        if has_shared_entity {
            code.push_str("    <SharedEntityStoreContext.Provider value={_sharedStore}>\n");
        } else {
            code.push_str("    <>\n");
        }
        code.push_str("      <UISlotComponent slot=\"main\">\n");
        code.push_str("        <VStack gap=\"lg\" className=\"w-full\">\n");

        // Render each trait as a View component. Skip embedded traits
        // (those referenced via `@trait.X` by some sibling layout) —
        // their View is inlined inside the embedding layout's view at
        // the `@trait.X` position. Iframe semantics: the embedded
        // trait's UI lives at the embedded position only; emitting
        // a standalone view here would double-render it.
        for trait_binding in &page.traits {
            if embedded_traits.contains(&trait_binding.trait_name) {
                continue;
            }
            if has_params {
                let entity_id_entry = if has_id_param {
                    "entityId: __routeParams.id, "
                } else {
                    ""
                };
                code.push_str(&format!(
                    "          <__{}View config={{{{ {}routeParams: __routeParams, initPayload: __navState }}}} />\n",
                    trait_binding.trait_name, entity_id_entry
                ));
            } else {
                code.push_str(&format!(
                    "          <__{}View config={{{{ initPayload: __navState }}}} />\n",
                    trait_binding.trait_name
                ));
            }
        }

        code.push_str("        </VStack>\n");
        code.push_str("      </UISlotComponent>\n");
        if has_shared_entity {
            code.push_str("    </SharedEntityStoreContext.Provider>\n");
        } else {
            code.push_str("    </>\n");
        }
        code.push_str("  );\n");
        code.push_str("}\n\n");
        code.push_str(&format!("export default {};\n", page_name));

        InternalFile::new(
            format!(
                "packages/client/src/features/{}/{}.tsx",
                folder_name, page_name
            ),
            code,
            GeneratedFileType::Page,
        )
    }

    pub(crate) fn generate_page_index(&self, page: &OirPage, folder_name: &str) -> InternalFile {
        let code = format!(
            "export {{ default as {} }} from './{}';\n",
            page.name, page.name
        );

        InternalFile::new(
            format!("packages/client/src/features/{}/index.ts", folder_name),
            code,
            GeneratedFileType::Barrel,
        )
    }

    /// Generate App.tsx with routes for all pages
    pub(crate) fn generate_app_tsx(&self, module: &OirModule) -> InternalFile {
        let _app_name = &module.name;
        let mut code = String::new();

        // Imports
        let gated = module
            .pages
            .iter()
            .any(|p| p.access == Some(orbital_core::schema::PageAccess::Authenticated));
        code.push_str("import React, { lazy, Suspense } from 'react';\n");
        code.push_str(if gated {
            "import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';\n"
        } else {
            "import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';\n"
        });
        code.push_str(
            "import { QueryClient, QueryClientProvider } from '@tanstack/react-query';\n",
        );
        code.push_str("import { ThemeProvider, UISlotProvider } from '@almadar/ui/context';\n");
        code.push_str(if gated {
            "import { EventBusProvider, VerificationProvider, NavStackRouterBridge, PageAccessHost } from '@almadar/ui/providers';\n"
        } else {
            "import { EventBusProvider, VerificationProvider, NavStackRouterBridge } from '@almadar/ui/providers';\n"
        });
        code.push_str(
            "import { UISlotComponent, PageTransition } from '@almadar/ui/components';\n",
        );
        let has_custom_themes = !module.themes.is_empty();
        if has_custom_themes {
            code.push_str(
                "import { THEMES, DEFAULT_THEME, DEFAULT_MODE } from './generated/theme-config';\n",
            );
        }
        let (locale_file, locale_code, direction) = match self.schema_language.as_str() {
            "ar" => ("ar.json", "ar", "rtl"),
            "sl" => ("sl.json", "sl", "ltr"),
            _ => ("en.json", "en", "ltr"),
        };
        code.push_str("import { I18nProvider, createTranslate } from '@almadar/ui/hooks';\n");
        if module.locales.is_empty() {
            code.push_str(&format!(
                "import localeMessages from '../../../locales/{}';\n",
                locale_file
            ));
        } else {
            for locale in &module.locales {
                code.push_str(&format!(
                    "import messages_{locale} from '../../../locales/{locale}.json';\n"
                ));
            }
        }
        code.push_str(if gated {
            "import { AuthProvider, useAuthContext } from './features/auth/AuthContext';\n"
        } else {
            "import { AuthProvider } from './features/auth/AuthContext';\n"
        });
        code.push_str("import Login from './features/auth/components/Login';\n");

        // Lazy-load page components for code splitting
        for page in &module.pages {
            let folder_name = to_lowercase_nosep(&page.name);
            code.push_str(&format!(
                "const {} = lazy(() => import('./features/{}/{}').then(m => ({{ default: m.{} }})));\n",
                page.name, folder_name, page.name, page.name
            ));
        }
        code.push('\n');

        // Navigation-stack page manifest: {path, name, orbital, label?} per
        // declared page. An entry's label is the declared `@label`, else the
        // page name as written; stacks are scoped per `orbital` (a page's orbital = the orbital of its
        // first bound trait — the page was declared inside it).
        code.push_str("const NAV_PAGES = [\n");
        for page in &module.pages {
            let orbital = page
                .traits
                .first()
                .and_then(|b| {
                    module
                        .traits
                        .iter()
                        .find(|t| t.name == b.trait_name)
                        .map(|t| t.orbital_name.clone())
                })
                .unwrap_or_else(|| module.name.clone());
            let label = page
                .label
                .as_ref()
                .map(|l| format!(", label: {}", serde_json::Value::String(l.clone())))
                .unwrap_or_default();
            code.push_str(&format!(
                "  {{ path: '{}', name: '{}', orbital: '{}'{} }},\n",
                page.path, page.name, orbital, label
            ));
        }
        code.push_str("] as const;\n\n");

        // QueryClient
        code.push_str("// Export queryClient for test access (to clear cache between tests)\n");
        code.push_str("export const queryClient = new QueryClient({\n");
        code.push_str("  defaultOptions: {\n");
        code.push_str("    queries: {\n");
        code.push_str("      staleTime: 1000 * 60 * 5, // 5 minutes\n");
        code.push_str("      retry: 1,\n");
        code.push_str("    },\n");
        code.push_str("  },\n");
        code.push_str("});\n\n");

        // i18n value
        if module.locales.is_empty() {
            code.push_str("const localeCatalog = Object.fromEntries(Object.entries(localeMessages).filter(([k]) => !k.startsWith('$'))) as Record<string, string>;\n");
            code.push_str(&format!(
                "const i18nValue = {{ locale: '{}', direction: '{}' as const, messages: localeCatalog, t: createTranslate(localeCatalog) }};\n\n",
                locale_code, direction
            ));
        } else {
            // One catalog per declared locale; a page renders under the
            // locale its path names (`OirModule::locale_of_path`).
            code.push_str("const I18N = {\n");
            for locale in &module.locales {
                code.push_str(&format!(
                    "  {locale}: {{ locale: '{locale}', direction: '{}' as const, messages: messages_{locale}, t: createTranslate(messages_{locale}) }},\n",
                    orbital_core::messages::locale_direction(locale)
                ));
            }
            code.push_str("};\n");
            code.push_str(&format!(
                "const i18nValue = I18N.{};\n\n",
                module.locales[0]
            ));
        }

        // `access: authenticated` pages mount through the shared page access
        // host — only those pages; public and undeclared routes stay direct.
        if gated {
            let sign_in = module
                .site
                .as_ref()
                .and_then(|s| s.sign_in.as_deref())
                .unwrap_or_default();
            code.push_str(
                "function AuthenticatedPage({ children }: { children: React.ReactNode }) {\n",
            );
            code.push_str("  const { authority, user } = useAuthContext();\n");
            code.push_str("  const { pathname } = useLocation();\n");
            code.push_str("  const navigate = useNavigate();\n");
            code.push_str("  const onDenied = React.useCallback(\n");
            code.push_str("    (to: string, returnTo: string) => navigate(to, { replace: true, state: { returnTo } }),\n");
            code.push_str("    [navigate],\n");
            code.push_str("  );\n");
            code.push_str(&format!(
                "  return <PageAccessHost access=\"authenticated\" authority={{authority}} viewerId={{user?.uid}} signIn={} path={{pathname}} onDenied={{onDenied}}>{{children}}</PageAccessHost>;\n",
                serde_json::to_string(sign_in).unwrap_or_default()
            ));
            code.push_str("}\n\n");
        }

        // Page transition host: routed page content animates in on every
        // navigation; a page's layout content region claims it (PageTransition).
        code.push_str(
            "function PageTransitionHost({ children }: { children: React.ReactNode }) {\n",
        );
        code.push_str("  const { pathname } = useLocation();\n");
        code.push_str(
            "  return <PageTransition locationKey={pathname}>{children}</PageTransition>;\n",
        );
        code.push_str("}\n\n");

        // App component
        code.push_str("export function App() {\n");
        code.push_str("  return (\n");
        code.push_str("    <I18nProvider value={i18nValue} documentRoot>\n");
        if has_custom_themes {
            code.push_str("    <ThemeProvider themes={THEMES} defaultTheme={DEFAULT_THEME} defaultMode={DEFAULT_MODE}>\n");
        } else {
            code.push_str(
                "    <ThemeProvider defaultTheme=\"minimalist\" defaultMode=\"light\">\n",
            );
        }
        code.push_str("      <QueryClientProvider client={queryClient}>\n");
        code.push_str("        <EventBusProvider>\n");
        code.push_str("          <VerificationProvider>\n");
        code.push_str("          <AuthProvider>\n");
        code.push_str("          <UISlotProvider>\n");
        code.push_str("            <BrowserRouter>\n");
        code.push_str("              <NavStackRouterBridge pages={NAV_PAGES}>\n");
        code.push_str("              <Suspense fallback={<div className=\"min-h-screen flex items-center justify-center\"><div className=\"animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600\" /></div>}>\n");
        code.push_str("              <PageTransitionHost>\n");
        code.push_str("              <Routes>\n");
        code.push_str("                <Route path=\"/login\" element={<Login />} />\n");

        // Generate route for each page
        let page_element = |page: &OirPage| -> String {
            let inner = if page.access == Some(orbital_core::schema::PageAccess::Authenticated) {
                format!("<AuthenticatedPage><{} /></AuthenticatedPage>", page.name)
            } else {
                format!("<{} />", page.name)
            };
            match module.locale_of_path(&page.path) {
                Some(locale) => format!(
                    "<I18nProvider value={{I18N.{locale}}} documentRoot>{inner}</I18nProvider>"
                ),
                None => inner,
            }
        };
        if !module.pages.is_empty() {
            // First page as index route
            let first_page = &module.pages[0];
            code.push_str(&format!(
                "                <Route index element={{{}}} />\n",
                page_element(first_page)
            ));
        } else {
            code.push_str(
                "                <Route index element={<Navigate to=\"/\" replace />} />\n",
            );
        }

        for page in &module.pages {
            // Remove leading slash for route path
            let route_path = page.path.trim_start_matches('/');
            if !route_path.is_empty() {
                code.push_str(&format!(
                    "                <Route path=\"{}\" element={{{}}} />\n",
                    route_path,
                    page_element(page)
                ));
            }
        }

        code.push_str("                {/* Fallback route - redirect to main page */}\n");
        code.push_str(
            "                <Route path=\"*\" element={<Navigate to=\"/\" replace />} />\n",
        );
        code.push_str("              </Routes>\n");
        code.push_str("              </PageTransitionHost>\n");
        code.push_str("              {/* Portal slots for modal, drawer, and toast overlays */}\n");
        code.push_str("              <UISlotComponent slot=\"modal\" portal />\n");
        code.push_str("              <UISlotComponent slot=\"drawer\" portal />\n");
        code.push_str("              <UISlotComponent slot=\"toast\" portal />\n");
        code.push_str("              </Suspense>\n");
        code.push_str("              </NavStackRouterBridge>\n");
        code.push_str("            </BrowserRouter>\n");
        code.push_str("          </UISlotProvider>\n");
        code.push_str("          </AuthProvider>\n");
        code.push_str("          </VerificationProvider>\n");
        code.push_str("        </EventBusProvider>\n");
        code.push_str("      </QueryClientProvider>\n");
        code.push_str("    </ThemeProvider>\n");
        code.push_str("    </I18nProvider>\n");
        code.push_str("  );\n");
        code.push_str("}\n\n");
        code.push_str("export default App;\n");

        InternalFile::new(
            "packages/client/src/App.tsx".to_string(),
            code,
            GeneratedFileType::Config,
        )
    }
}

/// A page's declared head modifiers plus the app's origin/site name, as the
/// object fields of its `usePageHead` call; `None` when the page declares none.
fn page_head_literal(page: &OirPage, module: &OirModule) -> Option<String> {
    if page.title.is_none()
        && page.description.is_none()
        && page.access.is_none()
        && page.indexing.is_none()
    {
        return None;
    }
    let mut head = serde_json::Map::new();
    let mut put = |key: &str, value: serde_json::Value| {
        head.insert(key.to_string(), value);
    };
    if let Some(v) = &page.title {
        put("title", serde_json::to_value(v).unwrap_or_default());
    }
    if let Some(v) = &page.description {
        put("description", serde_json::to_value(v).unwrap_or_default());
    }
    if let Some(v) = page.access {
        put("access", serde_json::to_value(v).unwrap_or_default());
    }
    if let Some(v) = page.indexing {
        put("indexing", serde_json::to_value(v).unwrap_or_default());
    }
    if let Some(site) = &module.site {
        if let Some(origin) = &site.origin {
            put("origin", origin.clone().into());
        }
        if let Some(name) = &site.name {
            put("siteName", name.clone().into());
        }
    }
    if let Some(alternates) = orbital_core::generate::locale_alternates(module, page) {
        put("alternates", alternates);
        if let Some(default_locale) = module.locales.first() {
            put("defaultLocale", default_locale.clone().into());
        }
    }
    // The fields only, spliced into the `usePageHead({ … })` call so the
    // parameter type contextually types the `i18n/t` tuple.
    serde_json::to_string(&serde_json::Value::Object(head))
        .ok()
        .map(|json| json[1..json.len() - 1].to_string())
}

#[cfg(test)]
mod page_access_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{OirModule, OirPage};

    fn app(pages: &[(&str, &str)]) -> String {
        let mut module = OirModule::new("App", "1.0.0");
        module.pages = pages.iter().map(|(n, p)| OirPage::new(*n, *p)).collect();
        TypeScriptBackend::default()
            .generate_app_tsx(&module)
            .content
    }

    /// Page access is written in `.lolo` (std-app-layout `allowedRoles`, std-role-gate,
    /// `@user` guards); the shell adds no gate of its own, like the runtime path. A
    /// blanket login gate turned every page of a public site into a sign-in screen
    /// once Firebase Hosting served a config (orb.almadar.io, 2026-10-07).
    #[test]
    fn pages_are_routed_without_an_implicit_login_gate() {
        let ts = app(&[("HomePage", "/"), ("DocsPage", "/docs")]);
        assert!(!ts.contains("ProtectedRoute"), "{ts}");
        assert!(
            ts.contains("<Route index element={<HomePage />} />"),
            "{ts}"
        );
        assert!(
            ts.contains("<Route path=\"docs\" element={<DocsPage />} />"),
            "{ts}"
        );
    }

    #[test]
    fn control_sign_in_stays_reachable() {
        let ts = app(&[("HomePage", "/")]);
        assert!(ts.contains("<AuthProvider>"), "{ts}");
        assert!(
            ts.contains("<Route path=\"/login\" element={<Login />} />"),
            "{ts}"
        );
    }

    fn gated_app() -> String {
        let mut module = OirModule::new("App", "1.0.0");
        let mut account = OirPage::new("AccountPage", "/account");
        account.access = Some(orbital_core::schema::PageAccess::Authenticated);
        let mut home = OirPage::new("HomePage", "/");
        home.access = Some(orbital_core::schema::PageAccess::Public);
        module.pages = vec![home, account, OirPage::new("DocsPage", "/docs")];
        module.site = Some(orbital_core::schema::SiteMeta {
            sign_in: Some("/login".into()),
            ..Default::default()
        });
        TypeScriptBackend::default()
            .generate_app_tsx(&module)
            .content
    }

    #[test]
    fn only_a_declared_authenticated_page_mounts_through_the_access_host() {
        let ts = gated_app();
        assert!(
            ts.contains("<Route path=\"account\" element={<AuthenticatedPage><AccountPage /></AuthenticatedPage>} />"),
            "{ts}"
        );
        assert!(
            ts.contains("<Route index element={<HomePage />} />"),
            "{ts}"
        );
        assert!(
            ts.contains("<Route path=\"docs\" element={<DocsPage />} />"),
            "{ts}"
        );
        assert!(ts.contains("signIn=\"/login\""), "{ts}");
        assert!(
            ts.contains("PageAccessHost } from '@almadar/ui/providers'"),
            "{ts}"
        );
        assert!(
            ts.contains(
                "import { AuthProvider, useAuthContext } from './features/auth/AuthContext';"
            ),
            "{ts}"
        );
        assert!(!ts.contains("ProtectedRoute"), "{ts}");
    }

    #[test]
    fn control_without_an_authenticated_page_no_access_host_is_emitted() {
        let ts = app(&[("HomePage", "/"), ("DocsPage", "/docs")]);
        assert!(!ts.contains("AuthenticatedPage"), "{ts}");
        assert!(!ts.contains("PageAccessHost"), "{ts}");
        assert!(!ts.contains("useNavigate"), "{ts}");
    }

    fn page_component(page: OirPage) -> String {
        let mut module = OirModule::new("App", "1.0.0");
        module.site = Some(orbital_core::schema::SiteMeta {
            origin: Some("https://example.org".into()),
            name: Some("Example".into()),
            ..Default::default()
        });
        TypeScriptBackend::default()
            .generate_page_component(&page, "home", &module, &std::collections::HashSet::new())
            .content
    }

    #[test]
    fn a_translated_page_carries_its_alternates_and_default_locale() {
        let mut module = OirModule::new("App", "1.0.0");
        module.locales = vec!["en".into(), "ar".into()];
        module.site = Some(orbital_core::schema::SiteMeta {
            origin: Some("https://example.org".into()),
            ..Default::default()
        });
        for (name, path) in [("HomeEN", "/"), ("HomeAR", "/ar")] {
            let mut p = OirPage::new(name, path);
            p.access = Some(orbital_core::schema::PageAccess::Public);
            p.source_page = Some("pag_home".into());
            module.pages.push(p);
        }
        let ts = TypeScriptBackend::default()
            .generate_page_component(
                &module.pages[1],
                "homear",
                &module,
                &std::collections::HashSet::new(),
            )
            .content;
        assert!(
            ts.contains(r#""alternates":[{"locale":"en","path":"/"},{"locale":"ar","path":"/ar"}],"defaultLocale":"en""#),
            "{ts}"
        );
    }

    #[test]
    fn control_a_page_without_translations_carries_no_alternates() {
        let mut page = OirPage::new("HomePage", "/");
        page.access = Some(orbital_core::schema::PageAccess::Public);
        assert!(!page_component(page).contains("alternates"));
    }

    #[test]
    fn a_page_declaring_head_modifiers_keeps_the_head_on_its_contract() {
        let mut page = OirPage::new("HomePage", "/");
        page.access = Some(orbital_core::schema::PageAccess::Public);
        page.title = Some(orbital_core::schema::PageMeta::message("site:meta.home"));
        let ts = page_component(page);
        assert!(
            ts.contains("import { usePageHead } from '@almadar/ui/hooks';"),
            "{ts}"
        );
        assert!(
            ts.contains(r#"usePageHead({ "title":["i18n/t","site:meta.home"],"access":"public","origin":"https://example.org","siteName":"Example", path: __location.pathname });"#),
            "{ts}"
        );
    }

    #[test]
    fn control_a_page_without_head_modifiers_writes_no_head() {
        let ts = page_component(OirPage::new("HomePage", "/"));
        assert!(!ts.contains("usePageHead"), "{ts}");
    }

    #[test]
    fn edge_a_program_without_pages_still_has_an_index_route() {
        let ts = app(&[]);
        assert!(
            ts.contains("<Route index element={<Navigate to=\"/\" replace />} />"),
            "{ts}"
        );
        assert!(!ts.contains("<Outlet"), "{ts}");
    }
}

#[cfg(test)]
mod page_transition_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::OirModule;

    #[test]
    fn app_tsx_wraps_routes_in_a_location_keyed_page_transition_host() {
        let backend = TypeScriptBackend::default();
        let ts = backend
            .generate_app_tsx(&OirModule::new("App", "1.0.0"))
            .content;
        assert!(ts
            .contains("import { UISlotComponent, PageTransition } from '@almadar/ui/components';"));
        assert!(ts.contains("useLocation } from 'react-router-dom';"));
        assert!(ts.contains("<PageTransition locationKey={pathname}>{children}</PageTransition>"));
        let host = ts.find("<PageTransitionHost>").expect("host opens");
        let routes = ts.find("<Routes>").expect("routes");
        let close = ts.find("</PageTransitionHost>").expect("host closes");
        let modal = ts
            .find("<UISlotComponent slot=\"modal\" portal />")
            .expect("modal slot");
        assert!(
            host < routes && routes < close,
            "Routes sit inside the host"
        );
        assert!(
            close < modal,
            "control: portal slots stay outside the page transition"
        );
    }
}

#[cfg(test)]
mod document_language_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::OirModule;

    #[test]
    fn the_app_root_i18n_provider_owns_the_document_lang_and_dir() {
        let backend = TypeScriptBackend {
            schema_language: "ar".to_string(),
            ..TypeScriptBackend::default()
        };
        let ts = backend
            .generate_app_tsx(&OirModule::new("App", "1.0.0"))
            .content;
        assert!(
            ts.contains("<I18nProvider value={i18nValue} documentRoot>"),
            "{ts}"
        );
        assert!(ts.contains("locale: 'ar', direction: 'rtl'"), "{ts}");
    }

    #[test]
    fn control_an_english_app_is_ltr() {
        let ts = TypeScriptBackend::default()
            .generate_app_tsx(&OirModule::new("App", "1.0.0"))
            .content;
        assert!(ts.contains("locale: 'en', direction: 'ltr'"), "{ts}");
    }
}

#[cfg(test)]
mod nav_pages_label_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{OirModule, OirPage};

    #[test]
    fn nav_pages_carry_the_declared_label_json_encoded() {
        let mut module = OirModule::new("App", "1.0.0");
        let mut labelled = OirPage::new("ContactsPage", "/contacts");
        labelled.label = Some("Today's \"Contacts\" — جهات".to_string());
        module.pages.push(labelled);
        module.pages.push(OirPage::new("NotesPage", "/notes"));
        let ts = TypeScriptBackend::default()
            .generate_app_tsx(&module)
            .content;
        assert!(ts.contains(
            "{ path: '/contacts', name: 'ContactsPage', orbital: 'App', label: \"Today's \\\"Contacts\\\" — جهات\" },"
        ), "{ts}");
        assert!(
            ts.contains("{ path: '/notes', name: 'NotesPage', orbital: 'App' },"),
            "control: an unlabelled page carries no label key"
        );
    }
}

#[cfg(test)]
mod shared_entity_provider_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{
        OirEntity, OirField, OirModule, OirPage, OirPersistence, OirTrait, OirTraitBinding, OirType,
    };
    use std::collections::HashSet;

    fn module_with(shared: bool) -> (OirModule, OirPage) {
        let mut tr = OirTrait::new("Board");
        tr.linked_entity = Some("Game".to_string());

        let mut module = OirModule::new("Orb", "1.0.0");
        module.entities.push(OirEntity {
            shared,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Game".to_string(),
            description: None,
            collection: "Game".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });
        module.traits.push(tr);

        let mut page = OirPage::new("BoardPage", "/board");
        page.traits.push(OirTraitBinding::new("Board"));
        module.pages.push(page.clone());

        (module, page)
    }

    /// A page named `<Trait>View` (page `AlmadarHomePageView` over trait
    /// `AlmadarHomePage`) must not shadow the trait view it mounts — the
    /// shadowed page rendered itself recursively and hung the browser.
    #[test]
    fn a_page_named_like_its_trait_view_mounts_the_view_not_itself() {
        let backend = TypeScriptBackend::new();
        let (mut module, _) = module_with(false);
        let mut page = OirPage::new("BoardView", "/board");
        page.traits.push(OirTraitBinding::new("Board"));
        module.pages = vec![page.clone()];
        let ts = backend
            .generate_page_component(&page, "boardview", &module, &HashSet::new())
            .content;

        assert!(
            ts.contains(
                "import { BoardView as __BoardView } from '@/components/traits/BoardView';"
            ),
            "{ts}"
        );
        assert!(
            ts.contains("<__BoardView config={{ initPayload: __navState }} />"),
            "{ts}"
        );
        assert!(ts.contains("export function BoardView("), "{ts}");
        assert!(
            !ts.contains("<BoardView "),
            "the page must never mount itself:\n{ts}"
        );
    }

    #[test]
    fn control_a_distinctly_named_page_mounts_the_aliased_view() {
        let backend = TypeScriptBackend::new();
        let (module, page) = module_with(false);
        let ts = backend
            .generate_page_component(&page, "boardpage", &module, &HashSet::new())
            .content;

        assert!(
            ts.contains(
                "import { BoardView as __BoardView } from '@/components/traits/BoardView';"
            ),
            "{ts}"
        );
        assert!(
            ts.contains("<__BoardView config={{ initPayload: __navState }} />"),
            "{ts}"
        );
        assert!(ts.contains("export function BoardPage("), "{ts}");
    }

    /// A page with a `[shared]`-entity trait must own ONE store instance and
    /// provide it to every trait view on the page — otherwise each trait's
    /// hook would create its own disconnected store (the cross-component
    /// sharing problem C-SHARED-TRAIT-NO-EVENT-DISPATCH's fix depends on).
    #[test]
    fn shared_entity_page_gets_the_provider() {
        let backend = TypeScriptBackend::new();
        let (module, page) = module_with(true);
        let file = backend.generate_page_component(&page, "boardpage", &module, &HashSet::new());
        let ts = &file.content;

        assert!(
            ts.contains("import { SharedEntityStoreContext, useSharedEntityStore } from '@almadar/ui/hooks';"),
            "missing the shared-store import:\n{ts}"
        );
        assert!(
            ts.contains("const _sharedStore = useSharedEntityStore();"),
            "page must own the one store instance:\n{ts}"
        );
        assert!(
            ts.contains("<SharedEntityStoreContext.Provider value={_sharedStore}>"),
            "page must wrap its trait views in the Provider:\n{ts}"
        );
    }

    /// A page with NO `[shared]`-entity trait must be byte-identical to
    /// before this fix — no Provider, no shared-store import, plain
    /// fragment. Proves the Provider wiring is additive, not a blanket
    /// change to every generated page.
    #[test]
    fn non_shared_page_stays_unchanged() {
        let backend = TypeScriptBackend::new();
        let (module, page) = module_with(false);
        let file = backend.generate_page_component(&page, "boardpage", &module, &HashSet::new());
        let ts = &file.content;

        assert!(
            !ts.contains("SharedEntityStoreContext"),
            "a page with no shared-entity trait must not import/reference the Provider:\n{ts}"
        );
        assert!(
            ts.contains("    <>\n"),
            "must keep the plain fragment root:\n{ts}"
        );
    }

    /// §88: the page lists ONLY trait A; A embeds B via `<trait.B/>` inside
    /// its own render-ui (never listed on the page directly); B is bound to
    /// a `[persistent, shared]` entity. The transitive embed closure must
    /// still earn the page its Provider — before this fix, B's hook mounted
    /// with no `SharedEntityStoreContext` and threw.
    #[test]
    fn page_gets_provider_for_a_shared_entity_trait_embedded_only_transitively() {
        use orbital_core::ir::{OirEffect, OirExpr, OirPattern, OirState, OirTransition, OirValue};

        let mut trait_a = OirTrait::new("HostView");
        trait_a.states.push(OirState::initial("ready"));
        let mut trans = OirTransition::new("ready", "ready", "INIT");
        trans.effects.push(OirExpr::Effect {
            effect: Box::new(OirEffect::RenderUi {
                slot: "main".to_string(),
                pattern: OirPattern::new("box").with_config(
                    "children",
                    OirValue::Array(vec![OirValue::String("@trait.ChatThread".to_string())]),
                ),
            }),
        });
        trait_a.transitions.push(trans);

        let mut trait_b = OirTrait::new("ChatThread");
        trait_b.linked_entity = Some("ChannelMember".to_string());

        let mut module = OirModule::new("Orb", "1.0.0");
        module.entities.push(OirEntity {
            shared: true,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "ChannelMember".to_string(),
            description: None,
            collection: "channelmembers".to_string(),
            persistence: OirPersistence::Persistent,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });
        module.traits.push(trait_a);
        module.traits.push(trait_b);

        let mut page = OirPage::new("HostPage", "/host");
        page.traits.push(OirTraitBinding::new("HostView"));
        module.pages.push(page.clone());

        let backend = TypeScriptBackend::new();
        let file = backend.generate_page_component(&page, "hostpage", &module, &HashSet::new());
        let ts = &file.content;

        assert!(
            ts.contains("<SharedEntityStoreContext.Provider value={_sharedStore}>"),
            "a shared-entity trait embedded only transitively must still earn the page its Provider:\n{ts}"
        );
    }
}

#[cfg(test)]
mod route_params_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{OirModule, OirPage, OirTrait, OirTraitBinding};
    use std::collections::HashSet;

    fn module_with_page(path: &str) -> (OirModule, OirPage) {
        let tr = OirTrait::new("Detail");
        let mut module = OirModule::new("Orb", "1.0.0");
        module.traits.push(tr);

        let mut page = OirPage::new("DetailPage", path);
        page.traits.push(OirTraitBinding::new("Detail"));
        module.pages.push(page.clone());

        (module, page)
    }

    /// A `:slug` page (not `:id`) must get `useParams` + `routeParams` on
    /// the view config, but NOT synthesize `entityId` — only `:id` earns
    /// that key (§48 payload-key contract point 2).
    #[test]
    fn slug_page_gets_route_params_no_entity_id() {
        let backend = TypeScriptBackend::new();
        let (module, page) = module_with_page("/articles/:slug");
        let file = backend.generate_page_component(&page, "detailpage", &module, &HashSet::new());
        let ts = &file.content;

        assert!(
            ts.contains("import { useParams, useLocation } from 'react-router-dom';"),
            "missing useParams+useLocation import:\n{ts}"
        );
        assert!(
            ts.contains("const __routeParams = useParams();"),
            "missing route params extraction:\n{ts}"
        );
        assert!(
            ts.contains(
                "<__DetailView config={{ routeParams: __routeParams, initPayload: __navState }} />"
            ),
            "slug page must pass routeParams without entityId:\n{ts}"
        );
        assert!(
            !ts.contains("entityId: __routeParams.id"),
            "a :slug page must not synthesize entityId:\n{ts}"
        );
    }

    /// An `:id` page must deliver BOTH `entityId` (backward-compat) AND
    /// `routeParams` — a strict superset of the pre-§48 `{ entityId }`
    /// shape.
    #[test]
    fn id_page_gets_entity_id_and_route_params() {
        let backend = TypeScriptBackend::new();
        let (module, page) = module_with_page("/tasks/:id");
        let file = backend.generate_page_component(&page, "detailpage", &module, &HashSet::new());
        let ts = &file.content;

        assert!(
            ts.contains("<__DetailView config={{ entityId: __routeParams.id, routeParams: __routeParams, initPayload: __navState }} />"),
            "an :id page must carry entityId AND routeParams:\n{ts}"
        );
    }

    /// A page with no `:param`s stays pinned to its pre-§48 emission except
    /// for the added `useLocation`/`initPayload` wiring — any page can be a
    /// navigate target, so the payload-carrying INIT path applies even
    /// without route params (full byte-identity is relaxed to this delta
    /// per the §48 design note).
    #[test]
    fn no_param_page_pinned_emission() {
        let backend = TypeScriptBackend::new();
        let (module, page) = module_with_page("/dashboard");
        let file = backend.generate_page_component(&page, "detailpage", &module, &HashSet::new());
        let ts = &file.content;

        assert!(
            !ts.contains("useParams"),
            "a param-less page must not import/call useParams:\n{ts}"
        );
        assert!(
            ts.contains("import { useLocation } from 'react-router-dom';"),
            "missing the useLocation-only import:\n{ts}"
        );
        assert!(
            ts.contains("const __navState = (useLocation().state ?? {}) as EventPayload;"),
            "missing the navigate-state extraction:\n{ts}"
        );
        assert!(
            ts.contains("<__DetailView config={{ initPayload: __navState }} />"),
            "a param-less page's view mount must gain ONLY initPayload:\n{ts}"
        );
    }
}

#[cfg(test)]
mod locale_route_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{OirModule, OirPage};

    fn module(locales: &[&str], paths: &[(&str, &str)]) -> OirModule {
        let mut module = OirModule::new("Site", "1.0.0");
        module.locales = locales.iter().map(|l| l.to_string()).collect();
        for (name, path) in paths {
            module.pages.push(OirPage::new(*name, *path));
        }
        module
    }

    #[test]
    fn each_page_renders_under_its_path_locales_catalog() {
        let ts = TypeScriptBackend::default()
            .generate_app_tsx(&module(
                &["en", "ar"],
                &[
                    ("HomePage", "/"),
                    ("HomeArPage", "/ar"),
                    ("PostArPage", "/ar/blog/why"),
                ],
            ))
            .content;
        assert!(
            ts.contains("import messages_en from '../../../locales/en.json';"),
            "{ts}"
        );
        assert!(
            ts.contains("import messages_ar from '../../../locales/ar.json';"),
            "{ts}"
        );
        assert!(
            ts.contains(
                "ar: { locale: 'ar', direction: 'rtl' as const, messages: messages_ar, t: createTranslate(messages_ar) }"
            ),
            "{ts}"
        );
        assert!(
            ts.contains("<I18nProvider value={I18N.ar} documentRoot><HomeArPage /></I18nProvider>"),
            "{ts}"
        );
        assert!(
            ts.contains("<I18nProvider value={I18N.ar} documentRoot><PostArPage /></I18nProvider>"),
            "{ts}"
        );
        assert!(
            ts.contains("<I18nProvider value={I18N.en} documentRoot><HomePage /></I18nProvider>"),
            "{ts}"
        );
    }

    #[test]
    fn control_a_program_without_locales_keeps_its_single_catalog() {
        let ts = TypeScriptBackend::default()
            .generate_app_tsx(&module(&[], &[("HomePage", "/")]))
            .content;
        assert!(
            ts.contains("import localeMessages from '../../../locales/en.json';"),
            "{ts}"
        );
        assert!(!ts.contains("I18N."), "{ts}");
        assert!(ts.contains("const localeCatalog = Object.fromEntries(Object.entries(localeMessages).filter(([k]) => !k.startsWith('$'))) as Record<string, string>;"), "{ts}");
        assert!(
            ts.contains("messages: localeCatalog, t: createTranslate(localeCatalog)"),
            "{ts}"
        );
    }
}
