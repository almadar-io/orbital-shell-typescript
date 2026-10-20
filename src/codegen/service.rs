//! The credential manifest of the services a program invokes (`.env.example`, `SECRETS.md`). `call-service` itself is a
//! kernel ask the native kernel answers, so no client is emitted.

use orbital_core_base::ir::OirModule;
use std::collections::BTreeSet;

/// Collect the service names this module invokes via `call-service` effects
/// (transitions + ticks), at ANY depth — nested forms inside expression args
/// (the `llm embed` class, I-8) count, same coverage as effect validation.
pub fn collect_invoked_services(module: &OirModule) -> BTreeSet<String> {
    module.invoked_services()
}

/// Generate the per-app credential manifest for the services the schema
/// invokes: a `packages/server/.env.example` block and a `SECRETS.md` deploy
/// manifest (env var table + `firebase apphosting:secrets:set` commands).
/// Returns `None` when the schema invokes no services, or none of the invoked
/// services declare credentials.
pub fn generate_env_manifest(module: &OirModule) -> Option<(String, String)> {
    let invoked = collect_invoked_services(module);
    if invoked.is_empty() {
        return None;
    }

    let registry = orbital_core_base::language::registry::baked_service_credentials();
    let with_creds: Vec<(&String, &Vec<orbital_core_base::language::registry::EmbeddedServiceCredential>)> =
        invoked
            .iter()
            .filter_map(|name| registry.get(name).filter(|c| !c.is_empty()).map(|c| (name, c)))
            .collect();
    if with_creds.is_empty() {
        return None;
    }

    let mut env = String::new();
    env.push_str("# Integration credentials — generated from the services this app invokes.\n");
    env.push_str("# Copy to packages/server/.env for local development; production values\n");
    env.push_str("# come from the platform secret store (see SECRETS.md).\n");
    for (service, creds) in &with_creds {
        env.push_str(&format!("\n# {service}\n"));
        for c in creds.iter() {
            let requirement = if c.required { "required" } else { "optional" };
            env.push_str(&format!("# {} ({})\n{}=\n", c.description, requirement, c.env_var));
        }
    }

    let mut md = String::new();
    md.push_str("# Secrets\n\n");
    md.push_str("Generated from the services this app invokes. Each variable below must be\n");
    md.push_str("present in the server environment; required ones fail the boot check when\n");
    md.push_str("missing in production.\n\n");
    md.push_str("| Service | Env var | Required | Description |\n");
    md.push_str("|---|---|---|---|\n");
    for (service, creds) in &with_creds {
        for c in creds.iter() {
            md.push_str(&format!(
                "| {} | `{}` | {} | {} |\n",
                service,
                c.env_var,
                if c.required { "yes" } else { "no" },
                c.description,
            ));
        }
    }
    md.push_str("\n## Firebase App Hosting\n\n");
    md.push_str("```bash\n");
    for (_, creds) in &with_creds {
        for c in creds.iter() {
            md.push_str(&format!("firebase apphosting:secrets:set {}\n", c.env_var));
        }
    }
    md.push_str("```\n\n");
    md.push_str("Then reference each secret from `apphosting.yaml`:\n\n");
    md.push_str("```yaml\n");
    md.push_str("env:\n");
    for (_, creds) in &with_creds {
        for c in creds.iter() {
            md.push_str(&format!(
                "  - variable: {}\n    secret: {}\n",
                c.env_var, c.env_var
            ));
        }
    }
    md.push_str("```\n");

    Some((env, md))
}
