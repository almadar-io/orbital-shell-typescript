//! The TypeScript shells: the Express and Hono web templates as `BaseShell`s.

use orbital_core::shell::BaseShell;
use std::path::PathBuf;

const EXTENSIONS: &[&str] = &["ts", "tsx", "js", "jsx"];

fn template(name: &str) -> PathBuf {
    orbital_core::renderer_packs::shell_template(name, std::path::Path::new(env!("CARGO_MANIFEST_DIR")))
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

/// The React client + Hono server template (`almadar-shell-hono`).
pub fn hono_shell() -> BaseShell {
    BaseShell::new(
        "typescript",
        "TypeScript/React frontend with Hono backend",
        EXTENSIONS,
        template("almadar-shell-hono"),
        ".",
        "npm run build",
        "npm run dev",
        "npm test",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use orbital_core::shell::Shell;

    #[test]
    fn each_framework_uses_its_own_template() {
        assert!(express_shell().template_path().ends_with("almadar-shell"));
        assert!(hono_shell().template_path().ends_with("almadar-shell-hono"));
    }

    #[test]
    fn control_both_templates_ship_in_this_crate() {
        for shell in [express_shell(), hono_shell()] {
            assert!(shell.template_path().join("package.json").is_file(), "{}", shell.template_path().display());
        }
    }

    #[test]
    fn generated_code_lands_at_the_project_root() {
        assert_eq!(express_shell().name(), "typescript");
        assert_eq!(express_shell().extensions(), EXTENSIONS);
        assert_eq!(express_shell().build_command(), "npm run build");
        assert_eq!(express_shell().generated_dir(), ".");
        assert_eq!(hono_shell().generated_dir(), ".");
    }
}
