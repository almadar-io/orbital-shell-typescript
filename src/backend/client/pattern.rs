use crate::backend::*;

impl TypeScriptBackend {
    /// Convert OirPattern to JSX with data injection from server response
    /// All patterns are rendered using the registry-based generator
    pub(crate) fn pattern_to_jsx_with_data(
        &self,
        pattern: &OirPattern,
        linked_entity: Option<&str>,
        entity_field_types: Option<&HashMap<String, EntityFieldInfo>>,
    ) -> String {
        self.generate_pattern_from_registry(
            &pattern.pattern_type,
            &pattern.config,
            linked_entity,
            entity_field_types,
        )
    }

    // ========================================================================
    // Phase 2: Structural Location — Logic Hook + Presentation Component
    // ========================================================================

    /// Collect all component imports needed from render_ui effects
    pub(crate) fn collect_component_imports(&self, trait_def: &OirTrait) -> Vec<(String, String)> {
        let mut imports = std::collections::BTreeSet::new();

        for trans in &trait_def.transitions {
            for pattern in orbital_core::ir::render_ui_patterns(&trans.effects) {
                // Collect import for the top-level pattern
                let (component, path) = self.pattern_to_import(&pattern.pattern_type);
                if !component.is_empty() {
                    imports.insert((component, path));
                }
                // Recursively collect imports from nested children
                self.collect_nested_pattern_imports(&pattern.config, &mut imports);
            }
        }
        // A toast-slot write renders as `Toast` (the `notification` pattern).
        if self.writes_toast_slot(trait_def) {
            let (component, path) = self.pattern_to_import("notification");
            if !component.is_empty() {
                imports.insert((component, path));
            }
        }

        imports.into_iter().collect()
    }

    /// Whether any render-ui tree in this trait binds the signed-in user —
    /// an `@user` / `@user.<field>` string anywhere in a pattern config value
    /// (a direct prop binding, or inside an s-expression array like the
    /// role-branched `navItems` conditional). The View emits those bindings
    /// as bare `user?.<field>` reads, so the component must bring `user` into
    /// scope (`useUser`) exactly when this returns true — the identity
    /// campaign's `viewerName: @user.name` layouts compiled to TS2304
    /// without it.
    /// Whether a render-ui tree calls `i18n/t` or reads `@locale` — the view
    /// then takes `t` / `locale` from `useTranslate()`.
    pub(crate) fn trait_render_ui_uses_messages(&self, trait_def: &OirTrait) -> bool {
        fn value_uses_messages(v: &OirValue) -> bool {
            match v {
                OirValue::String(s) => s == "@locale",
                OirValue::Array(items) => {
                    matches!(items.first(), Some(OirValue::String(op)) if op == orbital_core::messages::TRANSLATE_OP)
                        || items.iter().any(value_uses_messages)
                }
                OirValue::Object(obj) => obj.values().any(value_uses_messages),
                _ => false,
            }
        }
        let effects_use = |effects: &[OirExpr]| -> bool {
            orbital_core::ir::render_ui_patterns(effects)
                .iter()
                .any(|pattern| pattern.config.values().any(value_uses_messages))
        };
        trait_def
            .transitions
            .iter()
            .any(|t| effects_use(&t.effects))
            || trait_def.ticks.iter().any(|t| effects_use(&t.effects))
    }

    pub(crate) fn trait_render_ui_uses_user(&self, trait_def: &OirTrait) -> bool {
        fn value_has_user_binding(v: &OirValue) -> bool {
            match v {
                OirValue::String(s) => s == "@user" || s.starts_with("@user."),
                OirValue::Array(items) => items.iter().any(value_has_user_binding),
                OirValue::Object(obj) => obj.values().any(value_has_user_binding),
                _ => false,
            }
        }
        let effects_use_user = |effects: &[OirExpr]| -> bool {
            orbital_core::ir::render_ui_patterns(effects)
                .iter()
                .any(|pattern| pattern.config.values().any(value_has_user_binding))
        };
        trait_def
            .transitions
            .iter()
            .any(|t| effects_use_user(&t.effects))
            || trait_def.ticks.iter().any(|t| effects_use_user(&t.effects))
    }

    /// Parse an `@trait.X` binding from a bare string. Returns the trait
    /// name when the string matches exactly `@trait.<PascalName>`, else
    /// `None`. Multi-segment forms (`@trait.X.anything`) intentionally
    /// DO NOT match — the compiler's binding validator rejects them up
    /// front, so any leak-through here is treated as invalid and
    /// ignored for import collection / JSX emission.
    pub(crate) fn parse_trait_binding(&self, s: &str) -> Option<String> {
        let rest = orbital_core::ir::parse_trait_embed_token(s)?;
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

    /// Recursively collect component imports from nested pattern configs.
    /// Checks all config keys for nested pattern objects (not just `children`),
    /// handling both array and single-object values.
    pub(crate) fn collect_nested_pattern_imports(
        &self,
        config: &orbital_core::ir::OirObject,
        imports: &mut std::collections::BTreeSet<(String, String)>,
    ) {
        for value in config.values() {
            match value {
                // Array value: children lists, but also s-expression arrays
                // (`["if", cond, {…}, {…}]`) and lambda bodies whose elements
                // can nest pattern objects arbitrarily deep — recurse into
                // EVERY element (a shallow object-or-string scan left nested
                // patterns unimported: TS2304 `Cannot find name 'Badge'` on
                // every notifications overlay).
                OirValue::Array(items) => {
                    for item in items {
                        match item {
                            OirValue::Object(child_obj) => {
                                self.collect_pattern_from_object(child_obj, imports);
                            }
                            OirValue::Array(_) => {
                                let nested: orbital_core::ir::OirObject =
                                    [("_".to_string(), item.clone())].into_iter().collect();
                                self.collect_nested_pattern_imports(&nested, imports);
                            }
                            // `@trait.X` binding in a `children:` array → the
                            // compiled path emits `<XView />` at this position
                            // and imports the view component. Orbital-scoped:
                            // all trait views live under
                            // `@/components/traits/{Name}View`.
                            OirValue::String(s) => {
                                if let Some(trait_name) = self.parse_trait_binding(s) {
                                    imports.insert((
                                        format!("{}View", trait_name),
                                        format!("@/components/traits/{}View", trait_name),
                                    ));
                                }
                            }
                            _ => {}
                        }
                    }
                }
                // Single object child (e.g. children: {type: "pattern-a", ...})
                OirValue::Object(child_obj) => {
                    self.collect_pattern_from_object(child_obj, imports);
                }
                // `@trait.X` in a `node`-typed prop (not a `children:` array
                // element). Codegen emits a direct view-component reference
                // at that prop position too; same import line applies.
                OirValue::String(s) => {
                    if let Some(trait_name) = self.parse_trait_binding(s) {
                        imports.insert((
                            format!("{}View", trait_name),
                            format!("@/components/traits/{}View", trait_name),
                        ));
                    }
                }
                _ => {}
            }
        }
    }

    /// Extract a pattern import from an object that has a "type" key,
    /// then recurse into its remaining config keys.
    pub(crate) fn collect_pattern_from_object(
        &self,
        obj: &orbital_core::ir::OirObject,
        imports: &mut std::collections::BTreeSet<(String, String)>,
    ) {
        if let Some(OirValue::String(child_type)) = obj.get("type") {
            let (component, path) = self.pattern_to_import(child_type);
            if !component.is_empty() {
                imports.insert((component, path));
            }
        }
        // Recursively check this object's values for more nested patterns —
        // even when the object itself carries no `type` key (a plain wrapper
        // knob like `notificationTemplate: {…}` still nests renderable
        // pattern objects that the view will emit as components).
        let child_config: orbital_core::ir::OirObject = obj
            .iter()
            .filter(|(k, _)| *k != "type")
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        self.collect_nested_pattern_imports(&child_config, imports);
    }

    /// Map pattern type to component import
    pub(crate) fn pattern_to_import(&self, pattern_type: &str) -> (String, String) {
        // Use registry to get component name and import path
        if let Some(mapping) = get_component_mapping(pattern_type) {
            // Rewrite @/ builder-internal paths to @almadar/ui package paths
            let import_path = if mapping.import_path.starts_with("@almadar/ui/") {
                // Already a fully-qualified @almadar/ui subpath — pass through as-is
                // e.g. "@almadar/ui/components/organisms/game/three" for GameCanvas3D
                mapping.import_path.clone()
            } else if mapping.import_path.starts_with("@/clients/") {
                // Client-specific components live in the project's own design-system.
                // The @design-system alias is configured per-project in tsconfig + vite.
                // e.g. "@/clients/trait-wars/atoms/CanvasEffect" → "@design-system"
                "@design-system".to_string()
            } else if mapping.import_path.starts_with("@/") {
                // Core components: use package entry points instead of deep paths
                // The @almadar/ui package uses tsup with barrel exports
                if mapping.import_path.starts_with("@/components/avl/") {
                    // AVL ships from its own entry point, outside the components barrel
                    "@almadar/ui/avl".to_string()
                } else if mapping.import_path.starts_with("@/components/") {
                    // e.g. "@/components/organisms/StatCard" → "@almadar/ui/components"
                    "@almadar/ui/components".to_string()
                } else if mapping.import_path.starts_with("@/hooks/") {
                    // e.g. "@/hooks/useEventBus" → "@almadar/ui/hooks"
                    "@almadar/ui/hooks".to_string()
                } else if mapping.import_path.starts_with("@/providers/") {
                    // e.g. "@/providers/ThemeProvider" → "@almadar/ui/providers"
                    "@almadar/ui/providers".to_string()
                } else if mapping.import_path.starts_with("@/context/") {
                    // e.g. "@/context/EventBusContext" → "@almadar/ui/context"
                    "@almadar/ui/context".to_string()
                } else if mapping.import_path.starts_with("@/stores/") {
                    // e.g. "@/stores/useStore" → "@almadar/ui/stores"
                    "@almadar/ui/stores".to_string()
                } else if mapping.import_path.starts_with("@/lib/") {
                    // e.g. "@/lib/utils" → "@almadar/ui/lib"
                    "@almadar/ui/lib".to_string()
                } else if mapping.import_path.starts_with("@/renderer/") {
                    // e.g. "@/renderer/PatternRenderer" → "@almadar/ui/renderer"
                    "@almadar/ui/renderer".to_string()
                } else {
                    // Fallback: keep the deep path for unknown patterns
                    format!("@almadar/ui/{}", &mapping.import_path[2..])
                }
            } else {
                mapping.import_path.clone()
            };
            (mapping.component.clone(), import_path)
        } else if let Some(extra) = &self.extra_mappings {
            // Check project-specific patterns from patterns.json
            if let Some(m) = extra.get(pattern_type) {
                (m.component.clone(), "@design-system".to_string())
            } else {
                (String::new(), String::new())
            }
        } else {
            (String::new(), String::new())
        }
    }
}

#[cfg(test)]
mod conditional_render_ui_import_tests {
    use super::*;
    use orbital_core::ir::{OirBinaryOp, OirBinding};

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
