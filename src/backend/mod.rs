//! TypeScript Backend Implementation
//!
//! Generates the kernel-hosted TypeScript app from Orbital IR: client (React) and server (Express or Hono) host glue.
//!
//! Output structure matches KFlow shell convention:
//! - packages/shared/src/types/entities.ts - Entity interfaces
//! - packages/shared/src/schemas/entities.ts - Zod schemas
//! - packages/shared/src/program.json - the resolved program the embedded kernel runs
//! - packages/client, packages/server - host glue around `@almadar/kernel`

pub(crate) use orbital_core_base::generate::{Backend, GeneratedFile, GeneratedOutput};
pub(crate) use orbital_core_base::ir::{
    OirCardinality, OirConstraint, OirEntity, OirExpr, OirModule, OirPersistence, OirTrait,
    OirType, OirValue,
};
pub(crate) use std::collections::HashMap;

pub(crate) use crate::codegen::{
    generate_all_themes_config_ts, generate_env_manifest, generate_service_clients,
    generate_theme_css, theme_font_imports, ts_member_name,
};

/// A project-specific component mapping loaded from patterns.json
#[derive(Debug, Clone)]
pub struct ExtraComponentMapping {
    /// React component name (e.g., "SignatureCapture")
    pub component: String,
    /// Pattern category (e.g., "form", "display")
    pub category: String,
}

/// Server framework choice for backend code generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ServerFramework {
    /// Generate Express.js server code (default, backward-compatible)
    #[default]
    Express,
    /// Generate Hono server code
    Hono,
}

/// TypeScript code generation backend
pub struct TypeScriptBackend {
    /// Use strict TypeScript mode
    pub strict: bool,
    /// Generate JSDoc comments
    pub jsdoc: bool,
    /// Target: "client", "server", or "full"
    pub target: String,
    /// Extra component mappings from project patterns.json (pattern_type -> mapping)
    pub extra_mappings: Option<HashMap<String, ExtraComponentMapping>>,
    /// Schema language code (e.g. "en", "ar", "sl"): drives i18n locale/direction in generated App.tsx
    pub schema_language: String,
    /// When true, inject structured logging into generated host files
    pub dev_logs: bool,
    /// Server framework for backend code generation (Express or Hono)
    pub server_framework: ServerFramework,
    /// The resolved schema, bundled into the client for its browser-store legs.
    pub browser_schema: Option<orbital_core_base::schema::types::OrbitalSchema>,
}

impl Default for TypeScriptBackend {
    fn default() -> Self {
        Self {
            strict: true,
            jsdoc: true,
            target: "full".to_string(),
            extra_mappings: None,
            schema_language: "en".to_string(),
            dev_logs: false,
            server_framework: ServerFramework::default(),
            browser_schema: None,
        }
    }
}

/// File type for internal tracking
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) enum GeneratedFileType {
    Entity,
    Trait,
    Page,
    Route,
    Hook,
    Handler,
    Test,
    Barrel,
    Config,
}

/// Internal generated file with type info
pub(crate) struct InternalFile {
    pub(crate) path: String,
    pub(crate) content: String,
    #[allow(dead_code)]
    pub(crate) file_type: GeneratedFileType,
}

impl InternalFile {
    pub(crate) fn new(
        path: impl Into<String>,
        content: impl Into<String>,
        file_type: GeneratedFileType,
    ) -> Self {
        Self {
            path: path.into(),
            content: content.into(),
            file_type,
        }
    }

    pub(crate) fn into_generated_file(self) -> GeneratedFile {
        GeneratedFile::new(self.path, self.content)
    }
}

impl TypeScriptBackend {
        pub fn new() -> Self {
        Self::default()
    }

    /// Generate the kernel-hosted TypeScript app from an OIR module (internal): the host glue around
    /// `@almadar/kernel`, the shared types and the resolved program.
    fn generate_internal(&self, module: &OirModule) -> Vec<InternalFile> {
        let mut files = Vec::new();

        // Dedup entities by name: `[runtime]` entities may share a name across orbitals (they are
        // per-orbital singletons with no persistence collection), and codegen emits one declaration
        // per distinct name.
        let entities_dedup: Vec<OirEntity> = module.distinct_entities();
        let entities = &entities_dedup[..];

        files.push(self.generate_shared_entities(entities, &module.named_types));
        files.push(self.generate_shared_schemas(entities, &module.named_types));
        files.push(self.generate_shared_event_types(module));
        files.push(self.generate_shared_trait_configs(module));
        files.push(self.generate_shared_index_kernel());
        files.extend(self.generate_kernel_program());
        match self.server_framework {
            ServerFramework::Hono => files.push(self.generate_shared_package_json_hono()),
            ServerFramework::Express => files.push(self.generate_shared_package_json()),
        }

        if self.target == "client" || self.target == "full" {
            files.extend(self.generate_kernel_client(module));
        }

        if self.target == "server" || self.target == "full" {
            files.extend(self.generate_kernel_server());
            if let Some(f) = self.generate_access_policies(entities) {
                files.push(f);
            }
            match self.server_framework {
                ServerFramework::Express => files.push(self.generate_sse_module(entities, false)),
                ServerFramework::Hono => files.push(self.generate_sse_module_hono(entities, false)),
            }
            files.push(self.generate_viewer_module(entities, self.server_framework));
        }

        // Theme CSS and config (client-side)
        if (self.target == "client" || self.target == "full") && !module.themes.is_empty() {
            for theme in &module.themes {
                let css = generate_theme_css(theme);
                files.push(InternalFile::new(
                    format!("packages/client/src/themes/{}.css", theme.name),
                    css,
                    GeneratedFileType::Config,
                ));
            }
            let config =
                generate_all_themes_config_ts(&module.themes, module.default_theme.as_deref());
            files.push(InternalFile::new(
                "packages/client/src/generated/theme-config.ts",
                config,
                GeneratedFileType::Config,
            ));
            let mut imports_css = String::new();
            imports_css.push_str("/* Generated theme imports - add to index.css */\n\n");
            for url in theme_font_imports(&module.themes) {
                imports_css.push_str(&format!("@import url(\"{}\");\n", url));
            }
            for theme in &module.themes {
                imports_css.push_str(&format!("@import '../themes/{}.css';\n", theme.name));
            }
            files.push(InternalFile::new(
                "packages/client/src/generated/theme-imports.css",
                imports_css,
                GeneratedFileType::Config,
            ));
            let default_theme = &module.themes[0].name;
            files.push(InternalFile::new(
                "packages/client/src/main.tsx",
                self.generate_main_tsx_with_theme(default_theme),
                GeneratedFileType::Config,
            ));
            files.push(InternalFile::new(
                "packages/client/src/index.css",
                self.generate_index_css_with_themes(&module.themes),
                GeneratedFileType::Config,
            ));
        }

        if self.target == "server" || self.target == "full" {
            // Service clients: the template server imports `invokedServices` for its boot-time credential check.
            let invoked_services = crate::codegen::collect_invoked_services(module);
            files.push(InternalFile::new(
                "packages/server/src/services/clients.ts",
                generate_service_clients(&module.services, &invoked_services, &module.program_credentials),
                GeneratedFileType::Config,
            ));
            // Inbound deliveries (`/api/hooks/<name>`, EXEC-INBOUND-1) are answered by the kernel host.
            files.push(InternalFile::new(
                "packages/server/src/inbound.ts",
                "/**\n * Inbound deliveries: answered by the kernel host (EXEC-INBOUND-1).\n *\n * @generated by Orbital Compiler (kernel host)\n */\n\nexport { deliverInbound } from './kernel-host.js';\n",
                GeneratedFileType::Route,
            ));
            // Credential manifest for the services this schema invokes.
            if let Some((env_example, secrets_md)) = generate_env_manifest(module) {
                files.push(InternalFile::new(
                    "packages/server/.env.example",
                    env_example,
                    GeneratedFileType::Config,
                ));
                files.push(InternalFile::new(
                    "SECRETS.md",
                    secrets_md,
                    GeneratedFileType::Config,
                ));
            }
            // packages/server/package.json (Hono only: the Express template's static copy declares
            // every `@almadar/*` package the kernel host imports). Last, so the scan sees every
            // `packages/server/` file this compile emitted.
            if self.server_framework == ServerFramework::Hono {
                let server_package_json = self.generate_server_package_json_hono(&files);
                files.push(server_package_json);
            }
        }

        files
    }

    /// Generate main.tsx with unified ThemeProvider wired up to the orbital's theme
    fn generate_main_tsx_with_theme(&self, default_theme: &str) -> String {
        format!(
            r#"/**
 * Application Entry Point
 * Generated by Orbital Compiler
 *
 * Theme '{}' is configured from the orbital schema.
 * Uses unified ThemeProvider with data-theme="name-light/dark" attribute.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import {{ OrbitalProvider }} from '@almadar/ui/providers';
import {{ THEMES, DEFAULT_THEME, DEFAULT_MODE }} from './generated/theme-config';
import {{ App }} from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OrbitalProvider themes={{THEMES}} defaultTheme={{DEFAULT_THEME}} defaultMode={{DEFAULT_MODE}}>
      <App />
    </OrbitalProvider>
  </React.StrictMode>
);
"#,
            default_theme
        )
    }

    /// Generate index.css with theme imports included
    ///
    /// Uses the unified theme system where each theme defines complete variables
    /// for both light and dark modes via `[data-theme="name-light"]` and `[data-theme="name-dark"]`.
    /// No :root fallback needed - ThemeProvider always sets data-theme.
    fn generate_index_css_with_themes(&self, themes: &[orbital_core_base::schema::types::ThemeDefinition]) -> String {
        let mut css = String::new();

        css.push_str("/**\n");
        css.push_str(" * Application Styles\n");
        css.push_str(" * Generated by Orbital Compiler\n");
        css.push_str(" *\n");
        css.push_str(" * Themes use unified data-theme attribute:\n");
        css.push_str(" *   data-theme=\"themename-light\" or data-theme=\"themename-dark\"\n");
        css.push_str(" */\n\n");

        // Web fonts the themes declare — `@import` must lead the stylesheet.
        for url in theme_font_imports(themes) {
            css.push_str(&format!("@import url(\"{}\");\n", url));
        }

        // The runtime playground's theme entry: base, every built-in preset, and the foundation
        // rules. A sub-frame's `data-theme` (a tour's `demoTheme`) then resolves as it does there.
        css.push_str("@import '@almadar/ui/themes/index.css';\n\n");

        // Include orbital-generated themes
        if !themes.is_empty() {
            css.push_str("/* Custom themes from orbital schema */\n");
            for theme in themes {
                css.push_str(&format!("@import './themes/{}.css';\n", theme.name));
            }
            css.push('\n');
        }

        css.push_str("@tailwind base;\n");
        css.push_str("@tailwind components;\n");
        css.push_str("@tailwind utilities;\n");

        // Body styles: apply theme variables to the page
        css.push_str("\n/* Apply theme to body */\n");
        css.push_str("body {\n");
        css.push_str("  margin: 0;\n");
        css.push_str("  min-height: 100vh;\n");
        css.push_str("  background-color: var(--color-background);\n");
        css.push_str("  color: var(--color-foreground);\n");
        css.push_str("  font-family: var(--font-family, system-ui, -apple-system, sans-serif);\n");
        css.push_str("}\n\n");
        css.push_str("#root {\n");
        css.push_str("  min-height: 100vh;\n");
        css.push_str("}\n");

        css
    }
}

/// Implement the compiler's Backend trait
impl Backend for TypeScriptBackend {
    fn generate(&self, module: &OirModule) -> GeneratedOutput {
        let internal_files = self.generate_internal(module);
        GeneratedOutput {
            files: internal_files
                .into_iter()
                .map(|f| f.into_generated_file())
                .collect(),
            warnings: self.kernel_host_warnings(),
        }
    }

    fn generate_with_mode(
        &self,
        module: &OirModule,
        mode: orbital_core_base::generate::ShellMode,
    ) -> GeneratedOutput {
        use orbital_core_base::generate::ShellMode;

        // Create a new backend with the appropriate target based on mode
        let target = match mode {
            ShellMode::Full => "full",
            ShellMode::Client => "client",
            ShellMode::Server => "server",
        };

        let mode_backend = TypeScriptBackend {
            strict: self.strict,
            jsdoc: self.jsdoc,
            target: target.to_string(),
            extra_mappings: self.extra_mappings.clone(),
            schema_language: self.schema_language.clone(),
            dev_logs: self.dev_logs,
            server_framework: self.server_framework,
            browser_schema: self.browser_schema.clone(),
        };

        // Use the mode-aware backend to generate
        mode_backend.generate(module)
    }

    fn name(&self) -> &'static str {
        "typescript"
    }

    /// Browser legs run the resolved schema in-process, so the client needs it.
    fn supports_browser_stored_entities(&self) -> bool {
        self.browser_schema.is_some()
    }
}

// ============================================================================
// Submodules (module-split of the former monolithic backend.rs).
// Public API is preserved: TypeScriptBackend, ExtraComponentMapping,
// ServerFramework are re-exported below so `pub use backend::{...}` in lib.rs
// keeps resolving. Inherent methods live in these submodules' `impl
// TypeScriptBackend` blocks and resolve via the type regardless of module.
// ============================================================================
mod hono_manifests;
pub mod kernel_host;
pub(crate) mod server;
mod shared;
mod types;
pub(crate) use types::map_type_ts;
mod utils;

// Free helpers / case converters used across submodules.
pub(crate) use utils::*;
// Shared entity/schema helpers used by client codegen + the pattern registry.
pub use shared::EntityFieldInfo;
pub use types::classify_oir_type;

#[cfg(test)]
mod tests {
    use super::*;
    use orbital_core_base::ir::OirField;

    #[test]
    fn test_to_camel_case() {
        assert_eq!(to_camel_case("TaskLifecycle"), "taskLifecycle");
        assert_eq!(to_camel_case("Task"), "task");
    }

    #[test]
    fn test_type_mapping() {
        let backend = TypeScriptBackend::new();
        assert_eq!(backend.map_type(&OirType::String), "string");
        assert_eq!(backend.map_type(&OirType::Number), "number");
        assert_eq!(backend.map_type(&OirType::Boolean), "boolean");
    }

    // ---------------------------------------------------------------------
    // Characterization matrix for the `OirType → TS` walk (now the shared
    // `orbital_core::render_type` + `TsRenderer`). Pins the EXACT string for
    // every arm × every disturbable axis — the aliased
    // and payload wrappers, and the enum-sidecar union — so a future edit to
    // the walker or a backend leaf can't silently collapse a mode (the
    // CG-SWEEP-1 Inferred→Declared regression class). Every value below is the
    // pre-refactor output; the trait migration must keep it byte-identical.
    // ---------------------------------------------------------------------

    fn ev(vals: &[&str]) -> Vec<String> {
        vals.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn char_declared_leaves() {
        let b = TypeScriptBackend::new();
        let d = |t: &OirType| b.map_type_with_enum(t, None);
        assert_eq!(d(&OirType::String), "string");
        assert_eq!(d(&OirType::Number), "number");
        assert_eq!(d(&OirType::Integer), "number");
        assert_eq!(d(&OirType::Boolean), "boolean");
        // Honest at-rest domains (C-COMPILED-PATH-RED §25): dates are ISO
        // strings or epoch-ms numbers; a relation field stores the row's id.
        assert_eq!(d(&OirType::Date), "string | number");
        assert_eq!(d(&OirType::DateTime), "string | number");
        assert_eq!(d(&OirType::Bytes), "string");
        assert_eq!(d(&OirType::String), "string");
        assert_eq!(d(&OirType::Json), "Record<string, FieldValue | undefined>");
        assert_eq!(d(&OirType::Trait), "TraitFieldRef");
        assert_eq!(d(&OirType::SExpr), "SExpr");
        assert_eq!(d(&OirType::Node), "PatternValue");
        assert_eq!(d(&OirType::array(OirType::Node)), "PatternValue[]");
        assert_eq!(d(&OirType::enum_type("Status")), "string");
        assert_eq!(d(&OirType::reference("User")), "string");
    }

    #[test]
    fn char_declared_enum_sidecar_union() {
        let b = TypeScriptBackend::new();
        // A lolo `format:` union lowers to String + enum_values → literal union.
        assert_eq!(
            b.map_type_with_enum(&OirType::String, Some(&ev(&["active", "done"]))),
            "'active' | 'done'"
        );
        // Enum variant with the sidecar renders the same union.
        assert_eq!(
            b.map_type_with_enum(&OirType::enum_type("Status"), Some(&ev(&["a", "b"]))),
            "'a' | 'b'"
        );
    }

    #[test]
    fn char_declared_recursive() {
        let b = TypeScriptBackend::new();
        let d = |t: &OirType| b.map_type_with_enum(t, None);
        assert_eq!(d(&OirType::array(OirType::Number)), "number[]");
        assert_eq!(
            d(&OirType::map(OirType::String, OirType::Number)),
            "Record<string, number>"
        );
        assert_eq!(d(&OirType::optional(OirType::Number)), "number | null");
        assert_eq!(
            d(&OirType::optional(OirType::optional(OirType::Integer))),
            "number | null"
        );
    }

    #[test]
    fn char_declared_struct_honors_optional_and_enum() {
        let b = TypeScriptBackend::new();
        let st = OirType::Struct {
            fields: vec![
                OirField::new("title", OirType::String),
                OirField::optional("count", OirType::Number),
            ],
        };
        assert_eq!(
            b.map_type_with_enum(&st, None),
            "{ title: string; count?: number }"
        );
        let mut enum_field = OirField::new("kind", OirType::String);
        enum_field.enum_values = Some(ev(&["x", "y"]));
        let st2 = OirType::Struct {
            fields: vec![enum_field],
        };
        assert_eq!(b.map_type_with_enum(&st2, None), "{ kind: 'x' | 'y' }");
    }

    #[test]
    fn char_payload_wrapper_date_optional_and_unenumed_struct() {
        let b = TypeScriptBackend::new();
        // Payload dates accept the live `Date` too.
        assert_eq!(
            b.payload_struct_ts(&OirType::Date),
            "Date | string | number"
        );
        assert_eq!(b.payload_struct_ts(&OirType::Number), "number");
        // Payload unwraps optionality with no `| null` suffix.
        assert_eq!(
            b.payload_struct_ts(&OirType::optional(OirType::Number)),
            "number"
        );
        // A payload reference carries the ROW, not an id — so it must NOT
        // render as `string`. That is the entity relation-FIELD rule (a
        // relation stores an id at rest), and it leaked into payload positions
        // because both share the renderer: an event declaring
        // `{ row : BoardView }` emitted `row: string` in `events.ts` while a
        // row object arrived on the bus, and it typechecked — while
        // `handlers.ts` rendered the same OirType as the entity type, so the
        // two generated files disagreed. This assertion previously encoded the
        // bug (`== "string"`), which is why nothing caught the regression.
        assert_eq!(
            b.payload_struct_ts(&OirType::reference("User")),
            "EntityRow"
        );
        assert_eq!(b.payload_struct_ts(&OirType::Trait), "TraitFieldRef");
        assert_eq!(b.payload_struct_ts(&OirType::Node), "PatternValue");
        // Payload structs DROP the per-field enum sidecar (never emitted unions).
        let mut enum_field = OirField::new("kind", OirType::String);
        enum_field.enum_values = Some(ev(&["x", "y"]));
        let st = OirType::Struct {
            fields: vec![enum_field],
        };
        assert_eq!(b.payload_struct_ts(&st), "{ kind: string }");
    }

    #[test]
    fn test_generate_shared_entities_with_descriptions() {
        let backend = TypeScriptBackend::new();
        let entities = vec![OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "User".to_string(),
            description: Some("Represents a user account".to_string()),
            collection: "users".to_string(),
            persistence: OirPersistence::Persistent,
            fields: vec![OirField::new("id", OirType::String), {
                let mut f = OirField::new("email", OirType::String);
                f.description = Some("User's email address".to_string());
                f.constraints = vec![OirConstraint::Email];
                f
            }],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        }];
        let file = backend.generate_shared_entities(&entities, &Default::default());
        let content = file.into_generated_file().content;
        assert!(
            content.contains("Represents a user account"),
            "Entity description should appear in JSDoc"
        );
        assert!(
            content.contains("User's email address"),
            "Field description should appear in JSDoc"
        );
    }

    #[test]
    fn test_generate_shared_schemas_with_constraints() {
        let backend = TypeScriptBackend::new();
        let entities = vec![OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "User".to_string(),
            description: None,
            collection: "users".to_string(),
            persistence: OirPersistence::Persistent,
            fields: vec![
                OirField::new("id", OirType::String),
                {
                    let mut f = OirField::new("email", OirType::String);
                    f.constraints = vec![
                        OirConstraint::Email,
                        OirConstraint::MaxLength { value: 255 },
                    ];
                    f
                },
                {
                    let mut f = OirField::new("age", OirType::Number);
                    f.constraints = vec![
                        OirConstraint::Min { value: 0.0 },
                        OirConstraint::Max { value: 150.0 },
                    ];
                    f
                },
            ],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        }];
        let file = backend.generate_shared_schemas(&entities, &Default::default());
        let content = file.into_generated_file().content;
        assert!(
            content.contains(".email()"),
            "Should contain .email() constraint"
        );
        assert!(
            content.contains(".max(255)"),
            "Should contain .max(255) constraint"
        );
        assert!(
            content.contains(".min(0)"),
            "Should contain .min(0) constraint"
        );
        assert!(
            content.contains(".max(150)"),
            "Should contain .max(150) constraint"
        );
    }

    /// `field.required = false` (no `!` in the `.lolo`) wraps `field_type` in
    /// `OirType::Optional` (`OirField::optional`) — `map_type_to_zod` must
    /// unwrap that BEFORE `apply_constraints_to_zod` chains `.email()`/
    /// `.regex()`/etc. onto the base type, or the constraint lands on
    /// `ZodOptional<ZodString>` (`.optional()` already baked in), which zod
    /// doesn't expose those methods on — `z.string().optional().email()` is
    /// not valid zod chaining (TS2339). The single correct `.optional()` is
    /// the one this loop appends itself, after constraints.
    #[test]
    fn test_generate_shared_schemas_optional_field_with_constraint() {
        let backend = TypeScriptBackend::new();
        let entities = vec![OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "ServiceEmail".to_string(),
            description: None,
            collection: "service_emails".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String), {
                let mut f = OirField::optional("htmlBody", OirType::String);
                f.constraints = vec![OirConstraint::Email];
                f
            }],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        }];
        let file = backend.generate_shared_schemas(&entities, &Default::default());
        let content = file.into_generated_file().content;
        assert!(
            content.contains("htmlBody: z.string().email().optional()"),
            "constraint must chain before the single .optional(), got: {}",
            content
        );
        assert!(
            !content.contains(".optional().email()"),
            "must never chain a refinement method onto an already-optional zod type, got: {}",
            content
        );
    }

    #[test]
    fn test_generate_shared_schemas_update_schema() {
        let backend = TypeScriptBackend::new();
        let entities = vec![OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Task".to_string(),
            description: None,
            collection: "tasks".to_string(),
            persistence: OirPersistence::Persistent,
            fields: vec![
                OirField::new("id", OirType::String),
                OirField::new("title", OirType::String),
            ],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        }];
        let file = backend.generate_shared_schemas(&entities, &Default::default());
        let content = file.into_generated_file().content;
        assert!(
            content.contains("taskUpdateSchema = taskInputSchema.partial()"),
            "Should generate UpdateSchema"
        );
    }

    #[test]
    fn test_input_schema_omits_timestamps() {
        let backend = TypeScriptBackend::new();
        let entities = vec![OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Task".to_string(),
            description: None,
            collection: "tasks".to_string(),
            persistence: OirPersistence::Persistent,
            fields: vec![
                OirField::new("id", OirType::String),
                OirField::new("title", OirType::String),
                OirField::new("createdAt", OirType::DateTime),
                OirField::new("updatedAt", OirType::DateTime),
            ],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        }];
        let file = backend.generate_shared_schemas(&entities, &Default::default());
        let content = file.into_generated_file().content;
        assert!(
            content.contains("createdAt: true"),
            "InputSchema should omit createdAt"
        );
        assert!(
            content.contains("updatedAt: true"),
            "InputSchema should omit updatedAt"
        );
    }

    #[test]
    fn test_capitalize_first_for_field_alias() {
        assert_eq!(capitalize_first("type"), "Type");
        assert_eq!(capitalize_first("unitType"), "UnitType");
        assert_eq!(capitalize_first("status"), "Status");
    }

    // ========================================================================
    // @trait.X binding → compiled-path codegen
    //
    // Stage 4 of the `@trait.X` binding plan (docs/Almadar_Std_Gaps.md §3.8).
    // The compiled path emits a direct view-component reference
    // (`<{TraitName}View />`) at the embed position instead of routing
    // through the slot manager. Tests verify:
    //   1. `parse_trait_binding` accepts the canonical form and rejects
    //      the forms the validator turns away.
    //   2. `generate_pattern_from_registry` emits `<XView />` inline when
    //      a pattern's `children:` array contains `@trait.X`.
    //   3. `collect_nested_pattern_imports` picks up the matching
    //      `@/components/traits/XView` import so the generated file
    //      header includes it.
    // ========================================================================
}

/// The compiled client loads the same theme stylesheet entry as the runtime playground
/// (`@almadar/ui/themes/index.css`: base, every preset, foundation), so a sub-frame's
/// `data-theme` (a tour's `demoTheme`) resolves on both paths.
#[cfg(test)]
mod index_css_theme_parity_tests {
    use super::TypeScriptBackend;

    #[test]
    fn the_client_imports_every_built_in_theme() {
        let css = TypeScriptBackend::new().generate_index_css_with_themes(&[]);
        assert!(
            css.contains("@import '@almadar/ui/themes/index.css';"),
            "{css}"
        );
        assert!(
            !css.contains("_foundation.css"),
            "the entry already includes the foundation: {css}"
        );
    }

    #[test]
    fn control_the_program_s_own_themes_still_follow_the_built_ins() {
        let theme: orbital_core_base::schema::types::ThemeDefinition =
            serde_json::from_value(serde_json::json!({ "name": "sunset", "tokens": {} }))
                .expect("theme");
        let css = TypeScriptBackend::new().generate_index_css_with_themes(&[theme]);
        let built_ins = css
            .find("@import '@almadar/ui/themes/index.css';")
            .expect(&css);
        let own = css.find("@import './themes/sunset.css';").expect(&css);
        assert!(built_ins < own, "{css}");
    }
}
