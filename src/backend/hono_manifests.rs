//! Hono manifests for the kernel host: the server and shared `package.json` files.

use crate::backend::{GeneratedFileType, InternalFile, TypeScriptBackend};

impl TypeScriptBackend {
    /// Every `@almadar/*` package the Hono server codegen can literally
    /// import, paired with the pin `templates/almadar-shell/packages/server/
    /// package.json` (the Express template) already declares for the same
    /// package — one owner so the two backends never drift on a shared
    /// pin. Exhaustive over this crate's `packages/server/**` emitters
    /// (`backend_hono.rs`, `backend/server/*.rs`, `codegen/service.rs`,
    /// `codegen/handler_header.rs`): `@almadar/server` (Express-only) and
    /// client-side packages are deliberately absent — they can never appear
    /// in a `packages/server/` file's import text.
    const ALMADAR_SERVER_PACKAGE_VERSIONS: &[(&str, &str)] = &[
        ("@almadar/auth", "^0.1.0"),
        ("@almadar/core", "^10.97.0"),
        ("@almadar/db", "^0.1.0"),
        ("@almadar/evaluator", "^2.61.0"),
        ("@almadar/integrations", "^2.36.0"),
        ("@almadar/logger", "^1.12.0"),
        ("@almadar/runtime", "^6.83.0"),
        ("@almadar/server-hono", "^0.4.13"),
    ];

    /// Generate `packages/server/package.json` for Hono builds.
    ///
    /// The template's static copy declares a FIXED `@almadar/*` dependency
    /// set that drifts from what the generated handlers/routes/services/SSE
    /// module actually import — `@almadar/evaluator/entityAccess`
    /// (`handlers.rs`/`sse.rs`'s `entityAccess` imports), e.g., was missing
    /// entirely, and under bun's isolated linker a missing `dependencies`
    /// entry is a BOOT failure (the package is never linked into
    /// `packages/server/node_modules/@almadar/`), not just an unused-dep
    /// nit. Derive the `@almadar/*` set from the emitted imports instead of
    /// a hand list: scan every already-generated `packages/server/**` file
    /// for `from '@almadar/<name>'` / `from '@almadar/<name>/<subpath>'`.
    /// Call this LAST, once every other `packages/server/` file this
    /// compile emits is already in `files`.
    pub(crate) fn generate_server_package_json_hono(&self, files: &[InternalFile]) -> InternalFile {
        let mut almadar_deps: std::collections::BTreeSet<&'static str> =
            std::collections::BTreeSet::new();
        // The template's `scripts/emulators.mjs` (run by `orb serve`) imports `@almadar/db/emulator`.
        almadar_deps.insert("@almadar/db");
        for file in files {
            if !file.path.starts_with("packages/server/") {
                continue;
            }
            for line in file.content.lines() {
                let trimmed = line.trim_start();
                if !trimmed.starts_with("import") {
                    continue;
                }
                let Some(from_idx) = trimmed.find("from '@almadar/") else {
                    continue;
                };
                let spec_start = from_idx + "from '".len();
                let Some(rel_end) = trimmed[spec_start..].find('\'') else {
                    continue;
                };
                let spec = &trimmed[spec_start..spec_start + rel_end];
                // `@almadar/<name>` or `@almadar/<name>/<subpath>` — the
                // package name is the first two `/`-separated segments.
                let mut segs = spec.splitn(3, '/');
                let (Some(scope), Some(name)) = (segs.next(), segs.next()) else {
                    continue;
                };
                let pkg = format!("{}/{}", scope, name);
                if let Some((canonical, _)) = Self::ALMADAR_SERVER_PACKAGE_VERSIONS
                    .iter()
                    .find(|(n, _)| **n == pkg)
                {
                    almadar_deps.insert(canonical);
                }
            }
        }

        let mut dep_lines: Vec<String> = almadar_deps
            .iter()
            .map(|name| {
                let version = Self::ALMADAR_SERVER_PACKAGE_VERSIONS
                    .iter()
                    .find(|(n, _)| n == name)
                    .map(|(_, v)| *v)
                    .unwrap_or("*");
                format!("    \"{}\": \"{}\",", name, version)
            })
            .collect();
        dep_lines.extend([
            "    \"hono\": \"^4.7.0\",".to_string(),
            "    \"@hono/node-server\": \"^1.14.0\",".to_string(),
            "    \"@hono/zod-validator\": \"^0.4.0\",".to_string(),
            "    \"dotenv\": \"^16.4.7\",".to_string(),
            "    \"zod\": \"^3.22.0\"".to_string(),
        ]);

        let code = format!(
            r#"{{
  "name": "@almadar/shell-hono-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {{
    "dev": "tsx watch src/index.ts",
    "build": "esbuild src/index.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/index.js",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest"
  }},
  "dependencies": {{
{}
  }},
  "devDependencies": {{
    "@almadar/eslint-plugin": "^2.18.0",
    "@typescript-eslint/parser": "8.56.0",
    "@types/bun": "^1.1.0",
    "@types/node": "^20.17.19",
    "eslint": "10.0.0",
    "esbuild": "^0.25.0",
    "tsx": "^4.19.3",
    "typescript": "^5.7.3",
    "vitest": "^2.1.9"
  }}
}}
"#,
            dep_lines.join("\n")
        );

        InternalFile::new(
            "packages/server/package.json",
            code,
            GeneratedFileType::Config,
        )
    }

    /// Generate packages/shared/package.json for Hono builds.
    ///
    /// Unlike the Express version (raw .ts, no build), the Hono shared package
    /// includes a tsup build step so that entity Zod schemas can be imported
    /// as runtime values by server handlers.
    pub(crate) fn generate_shared_package_json_hono(&self) -> InternalFile {
        let code = r#"{
  "name": "@app/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch"
  },
  "dependencies": {
    "@almadar/core": ">=5.3.2",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.7.0"
  }
}
"#;

        InternalFile::new(
            "packages/shared/package.json",
            code,
            GeneratedFileType::Config,
        )
    }
}
