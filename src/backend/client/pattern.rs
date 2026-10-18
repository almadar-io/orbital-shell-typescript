use crate::backend::*;

impl TypeScriptBackend {

    // ========================================================================
    // Phase 2: Structural Location — Logic Hook + Presentation Component
    // ========================================================================




    /// Parse an `@trait.X` binding from a bare string. Returns the trait
    /// name when the string matches exactly `@trait.<PascalName>`, else
    /// `None`. Multi-segment forms (`@trait.X.anything`) intentionally
    /// DO NOT match — the compiler's binding validator rejects them up
    /// front, so any leak-through here is treated as invalid and
    /// ignored for import collection / JSX emission.
    pub(crate) fn parse_trait_binding(&self, s: &str) -> Option<String> {
        let rest = orbital_core_base::ir::parse_trait_embed_token(s)?;
        // V4 leverage-ids: an embed token names a sibling trait by its DISPLAY
        // name; if that sibling was renamed, `current_trait_embed_names` maps
        // the (stale) token to the current declaration name via the stable id
        // (see `build_trait_embed_names`). Missing map / missing key → the raw
        // token, byte-identical to the pre-flip behavior.
        if let Some(current) = self
            .current_trait_embed_names
            .borrow()
            .as_ref()
            .and_then(|m| m.get(rest))
        {
            return Some(current.clone());
        }
        Some(rest.to_string())
    }

    /// V4 leverage-ids: resolve a trait's `trait_embed_ids` side-map (embed
    /// token NAME → trait id) into a token NAME → CURRENT display name map by
    /// following each id to its declaration via [`OirModule::resolve_trait_ref`]
    /// (id-first, name-fallback). Stored in `current_trait_embed_names` at trait
    /// entry so `parse_trait_binding` emits `<CurrentNameView />` for a renamed
    /// sibling without a name-rewrite pass. `None` when the trait carries no
    /// side-map → readers fall back to the raw token (today's behavior).
    pub(crate) fn build_trait_embed_names(
        trait_def: &OirTrait,
        module: &OirModule,
    ) -> Option<HashMap<String, String>> {
        trait_def.trait_embed_ids.as_ref().map(|embed| {
            embed
                .iter()
                .map(|(token, id)| {
                    let current = module
                        .resolve_trait_ref(Some(id), token)
                        .map(|t| t.name.clone())
                        .unwrap_or_else(|| token.clone());
                    (token.clone(), current)
                })
                .collect()
        })
    }



}

#[cfg(test)]
mod conditional_render_ui_import_tests {
    use super::*;
    use orbital_core_base::ir::{OirBinaryOp, OirBinding};

    /// The exact shipped crash: `PersonBrowseView` referenced `DataGrid` at
    /// runtime (`Uncaught ReferenceError: DataGrid is not defined`) because
    /// fixing the View's render collector to recurse into `(if …)` branches
    /// surfaced a `data-grid` pattern that only `collect_component_imports`'s
    /// OWN top-level-only scan still couldn't see — so the View rendered it,
    /// but nothing imported it.
    #[test]
    fn collect_component_imports_sees_a_render_ui_nested_inside_a_conditional() {
        let backend = TypeScriptBackend::new();
        let mut trait_def = OirTrait::new("PersonBrowse");
        trait_def.linked_entity = Some("Person".to_string());

        let mut trans = OirTransition::new("loading", "browsing", "BrowseItemLoaded");
        trans.effects.push(OirExpr::Conditional {
            condition: Box::new(OirExpr::BinaryOp {
                op: OirBinaryOp::Eq,
                left: Box::new(OirExpr::Binding {
                    binding: OirBinding::new(
                        OirBindingRoot::Config,
                        vec!["browseLook".to_string()],
                    ),
                }),
                right: Box::new(OirExpr::String {
                    value: "gallery".to_string(),
                }),
            }),
            then_branch: Box::new(OirExpr::Effect {
                effect: Box::new(OirEffect::RenderUi {
                    slot: "main".to_string(),
                    pattern: OirPattern::new("data-grid"),
                }),
            }),
            else_branch: Box::new(OirExpr::Effect {
                effect: Box::new(OirEffect::RenderUi {
                    slot: "main".to_string(),
                    pattern: OirPattern::new("data-list"),
                }),
            }),
        });
        trait_def.transitions.push(trans);

        let imports = backend.collect_component_imports(&trait_def);
        assert!(
            imports.iter().any(|(component, _)| component == "DataGrid"),
            "expected DataGrid among collected imports, got: {imports:?}"
        );
        assert!(
            imports.iter().any(|(component, _)| component == "DataList"),
            "expected DataList among collected imports, got: {imports:?}"
        );
    }
}

#[cfg(test)]
mod import_entry_point_tests {
    use super::*;

    /// AVL components ship from `@almadar/ui/avl`, not the core components barrel.
    #[test]
    fn avl_patterns_import_from_the_avl_entry_point() {
        let backend = TypeScriptBackend::new();
        for (pattern, component) in [
            ("avl-state-machine", "AvlStateMachine"),
            ("avl-glyph", "AvlGlyph"),
            ("behavior-view", "BehaviorView"),
            ("module-card", "ModuleCard"),
        ] {
            assert_eq!(
                backend.pattern_to_import(pattern),
                (component.to_string(), "@almadar/ui/avl".to_string()),
                "{pattern}"
            );
        }
    }

    #[test]
    fn control_core_patterns_still_import_from_the_components_barrel() {
        let backend = TypeScriptBackend::new();
        assert_eq!(
            backend.pattern_to_import("data-grid"),
            ("DataGrid".to_string(), "@almadar/ui/components".to_string())
        );
    }
}
