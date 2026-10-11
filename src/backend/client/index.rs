use crate::backend::*;

impl TypeScriptBackend {
    /// Generate packages/client/src/components/traits/index.ts
    pub(crate) fn generate_components_index(&self, traits: &[OirTrait]) -> InternalFile {
        let mut code = String::new();
        code.push_str("// Auto-generated barrel file for trait components\n\n");

        for trait_def in traits {
            code.push_str(&format!("export * from './{}View';\n", trait_def.name));
        }

        InternalFile::new(
            "packages/client/src/components/traits/index.ts",
            code,
            GeneratedFileType::Barrel,
        )
    }

    /// Generate packages/client/src/hooks/traits/index.ts
    pub(crate) fn generate_traits_index(&self, traits: &[OirTrait]) -> InternalFile {
        let mut code = String::new();
        code.push_str("// Auto-generated barrel file for trait hooks\n\n");

        for trait_def in traits {
            code.push_str(&format!("export * from './use{}Logic';\n", trait_def.name));
        }

        InternalFile::new(
            "packages/client/src/hooks/traits/index.ts",
            code,
            GeneratedFileType::Barrel,
        )
    }
}
