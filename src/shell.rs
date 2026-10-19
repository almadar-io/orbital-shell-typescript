//! The TypeScript shell: the Express web template as a `BaseShell`, and the prebuilt web client beside it.

use orbital_core_base::shell::BaseShell;
use std::path::PathBuf;

const EXTENSIONS: &[&str] = &["ts", "tsx", "js", "jsx"];

fn template(name: &str) -> PathBuf {
    orbital_core_base::renderer_packs::shell_template(name, std::path::Path::new(env!("CARGO_MANIFEST_DIR")))
}

/// The prebuilt program-independent web client (`scripts/build-web-client.mjs`), when it was built.
pub fn web_client() -> Option<PathBuf> {
    Some(template("almadar-web-client")).filter(|dir| dir.join("index.html").is_file())
}

/// The React client + Express server template (`almadar-shell`).
pub fn express_shell() -> BaseShell {
    BaseShell::new(
        "typescript",
        "TypeScript/React frontend with Express backend",
        EXTENSIONS,
        template("almadar-shell"),
        ".",
        "npm run build",
        "npm run dev",
        "npm test",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use orbital_core_base::shell::Shell;

    #[test]
    fn the_shell_uses_its_template_and_it_ships_in_this_crate() {
        assert!(express_shell().template_path().ends_with("almadar-shell"));
        assert!(express_shell().template_path().join("package.json").is_file());
    }

    #[test]
    fn generated_code_lands_at_the_project_root() {
        assert_eq!(express_shell().name(), "typescript");
        assert_eq!(express_shell().extensions(), EXTENSIONS);
        assert_eq!(express_shell().build_command(), "npm run build");
        assert_eq!(express_shell().generated_dir(), ".");
    }
}
