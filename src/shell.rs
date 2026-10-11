//! TypeScript Shell Implementation
//!
//! Implements the Shell trait for TypeScript/React projects.

use orbital_core::shell::{Shell, ShellError};
use std::path::{Path, PathBuf};

/// TypeScript shell for React frontend + Express backend
pub struct TypeScriptShell {
    template_path: PathBuf,
}

impl TypeScriptShell {
    /// Create a new TypeScript shell
    pub fn new() -> Self {
        let template_path = Self::find_template_path();
        Self { template_path }
    }

    /// The Express template: an installed/shipped `almadar-shell`
    /// (`ORBITAL_SHELLS_DIR`, beside the binary), else this crate's own `templates/`.
    fn find_template_path() -> PathBuf {
        orbital_core::renderer_packs::find_template_dir("almadar-shell").unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("templates/almadar-shell")
        })
    }

    /// Create with explicit template path
    pub fn with_template_path(template_path: impl Into<PathBuf>) -> Self {
        Self {
            template_path: template_path.into(),
        }
    }
}

impl Default for TypeScriptShell {
    fn default() -> Self {
        Self::new()
    }
}

impl Shell for TypeScriptShell {
    fn name(&self) -> &'static str {
        "typescript"
    }

    fn description(&self) -> &'static str {
        "TypeScript/React frontend with Express backend"
    }

    fn extensions(&self) -> &[&'static str] {
        &["ts", "tsx", "js", "jsx"]
    }

    fn template_path(&self) -> &Path {
        &self.template_path
    }

    fn generated_dir(&self) -> &str {
        "src/generated"
    }

    fn build_command(&self) -> &str {
        "npm run build"
    }

    fn dev_command(&self) -> &str {
        "npm run dev"
    }

    fn test_command(&self) -> &str {
        "npm test"
    }

    fn init_project(&self, target_dir: &Path, project_name: &str) -> Result<(), ShellError> {
        // Copy template to target directory
        self.copy_template(target_dir)?;

        // Update package.json with project name
        let package_json_path = target_dir.join("package.json");
        if package_json_path.exists() {
            let content = std::fs::read_to_string(&package_json_path)?;

            let updated = content.replace(
                "\"name\": \"orbital-app\"",
                &format!("\"name\": \"{}\"", project_name),
            );

            std::fs::write(&package_json_path, updated)?;
        }

        Ok(())
    }

    fn copy_template(&self, output_dir: &Path) -> Result<(), ShellError> {
        if !self.template_path.exists() {
            return Err(ShellError::NotFound(
                self.template_path.display().to_string(),
            ));
        }

        copy_dir_recursive(&self.template_path, output_dir)?;
        Ok(())
    }

    fn validate_structure(&self, output_dir: &Path) -> Result<(), ShellError> {
        let required_files = ["package.json", "tsconfig.json"];

        for file in &required_files {
            let path = output_dir.join(file);
            if !path.exists() {
                return Err(ShellError::InvalidStructure {
                    path: path.clone(),
                    message: format!("Missing required file: {}", file),
                });
            }
        }

        Ok(())
    }
}

/// Recursively copy a directory
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), ShellError> {
    if !dst.exists() {
        std::fs::create_dir_all(dst)?;
    }

    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        // Skip generated directory and node_modules
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();
        if file_name_str == "generated"
            || file_name_str == "node_modules"
            || file_name_str == ".git"
        {
            continue;
        }

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_properties() {
        let shell = TypeScriptShell::new();
        assert_eq!(shell.name(), "typescript");
        assert_eq!(shell.extensions(), &["ts", "tsx", "js", "jsx"]);
        assert_eq!(shell.generated_dir(), "src/generated");
    }
}
