use crate::backend::*;
use crate::codegen::expr::BindingFlavor;
use orbital_core::ir::OirField;

impl TypeScriptBackend {
    /// The relation TARGET entity name for one field, when the field names
    /// a relation — either a direct `Reference` type (`authorId : Author!`)
    /// or a declared `OirRelation` on an otherwise non-`Reference` type
    /// (an array-of-reference field like `tagIds : [NoteTagRef]`, whose
    /// OUTER `field_type` is `Array`, not `Reference`, but still carries
    /// `field.relation`). One owner, shared by the `EntityFieldInfo.
    /// relation_entity` builder (`trait_component.rs`) and the entity-import
    /// collector below — the two must agree, or a structural row-type cast
    /// that names the target type (`element_ts_type`, emitted for a
    /// filtered/mapped collection binding) has no import (TS2304).
    pub(crate) fn field_relation_entity(field: &OirField) -> Option<String> {
        if let OirType::Reference { entity } = &field.field_type {
            Some(entity.clone())
        } else {
            field.relation.as_ref().map(|r| r.target_entity.clone())
        }
    }

    /// The entity name a payload/emit field TYPE names, unwrapping
    /// `Array`/`Optional` to find a `Reference` OR a `TypeRef` underneath —
    /// the shape of an `emits { X { data : [Note] } }` declaration
    /// (including one the compiler synthesizes for a bare `fetch`/`ref`
    /// effect's success payload). A payload field naming an entity lowers
    /// as `Reference` when the entity is otherwise linked to this trait,
    /// but as a bare `TypeRef { name }` for an unrelated/`uses`-imported
    /// entity (`CategoryArticlesOverlay`'s `data : [HelpArticle]`, where
    /// the trait's own `linked_entity` is `HelpCategory`) — `TypeRef`
    /// renders as a bare name unconditionally (`type_ref()`,
    /// `backend/types.rs`), same as a bare `readonly HelpArticle[]` array
    /// cast (`infer_oirexpr_element_type_ts`'s `OirBindingRoot::Payload`
    /// arm, `codegen/infer.rs`), so it needs the same import. The caller
    /// MUST verify the name is actually a declared entity (`TypeRef` also
    /// names ordinary hoisted struct aliases, which live in THIS file, not
    /// `@app/shared`) before adding it to the import set.
    fn payload_field_entity(field_type: &OirType) -> Option<String> {
        match field_type {
            OirType::Reference { entity } | OirType::Row { entity } => Some(entity.clone()),
            OirType::TypeRef { name } => Some(name.clone()),
            OirType::Array { inner } | OirType::Optional { inner } => {
                Self::payload_field_entity(inner)
            }
            _ => None,
        }
    }

    /// Collect all entity type names referenced in render-ui effect patterns,
    /// plus every relation-target entity named by the linked entity's OWN
    /// fields. The render-ui `entity`-prop structural row cast for a
    /// filtered/mapped collection (`entity: (array/filter ?data …)`) embeds
    /// each relation field's target type by bare name via `element_ts_type`
    /// (`backend/client/trait_component.rs`) — those names need the same
    /// import as the linked entity itself, or the emitted file references an
    /// unimported type (TS2304).
    pub(crate) fn collect_referenced_entity_types(
        &self,
        trait_def: &OirTrait,
        module: &OirModule,
    ) -> HashSet<String> {
        let mut entity_types = HashSet::new();
        for trans in &trait_def.transitions {
            for pattern in orbital_core::ir::render_ui_patterns(&trans.effects) {
                self.collect_entity_types_from_config(
                    &pattern.config,
                    trait_def.linked_entity.as_deref(),
                    &mut entity_types,
                );
            }
        }
        if let Some(linked_entity) = &trait_def.linked_entity {
            if let Some(entity) =
                module.resolve_entity_ref(trait_def.linked_entity_id.as_deref(), linked_entity)
            {
                for field in &entity.fields {
                    if let Some(target) = Self::field_relation_entity(field) {
                        entity_types.insert(target);
                    }
                }
            }
        }
        // `OirEvent.payload_schema` (keyed by event, `HashMap<String,
        // OirType>`) — NOT `OirTrait.emits[].payload` (`Vec<OirPayloadField>`,
        // a SEPARATE, less-precise lowering of the same `.lolo` declaration
        // that degrades an entity-typed field to `Array { inner: String }`,
        // losing the entity name entirely). `payload_schema` is the one
        // `render-ui`/`infer_oirexpr_element_type_ts` (`codegen/infer.rs`,
        // `OirBindingRoot::Payload` arm) actually reads to resolve
        // `?data`/`@payload.data` — confirmed empirically:
        // `CategoryArticlesLoaded`'s `data : [HelpArticle]` payload lowers
        // to `Array { inner: Reference { entity: "HelpArticle" } }` here.
        for event in &trait_def.events {
            let Some(schema) = &event.payload_schema else {
                continue;
            };
            for field_type in schema.values() {
                if let Some(target) = Self::payload_field_entity(field_type) {
                    // `TypeRef` also names an ordinary hoisted struct alias
                    // (not every named type is an entity) — only entities
                    // live in `@app/shared`, so gate on the module's own
                    // entity catalog before adding an import.
                    if module.find_entity(&target).is_some() {
                        entity_types.insert(target);
                    }
                }
            }
        }
        entity_types
    }

    /// Recursively collect entity type names from pattern config.
    pub(crate) fn collect_entity_types_from_config(
        &self,
        config: &orbital_core::ir::OirObject,
        linked_entity: Option<&str>,
        entity_types: &mut HashSet<String>,
    ) {
        // Check "entity" key — this is where entity type names appear
        if let Some(entity_val) = config.get("entity") {
            let entity_name = match entity_val {
                OirValue::String(s) if s == "@entity" => linked_entity.map(|e| e.to_string()),
                OirValue::String(s) if !s.starts_with('@') => Some(s.clone()),
                _ => None,
            };
            if let Some(name) = entity_name {
                entity_types.insert(name);
            }
        }
        // Recurse into nested pattern objects
        for value in config.values() {
            match value {
                OirValue::Array(items) => {
                    for item in items {
                        if let OirValue::Object(child_obj) = item {
                            if child_obj.contains_key("type") {
                                let child_config: orbital_core::ir::OirObject = child_obj
                                    .iter()
                                    .filter(|(k, _)| *k != "type")
                                    .map(|(k, v)| (k.clone(), v.clone()))
                                    .collect();
                                self.collect_entity_types_from_config(
                                    &child_config,
                                    linked_entity,
                                    entity_types,
                                );
                            }
                        }
                    }
                }
                OirValue::Object(child_obj) => {
                    if child_obj.contains_key("type") {
                        let child_config: orbital_core::ir::OirObject = child_obj
                            .iter()
                            .filter(|(k, _)| *k != "type")
                            .map(|(k, v)| (k.clone(), v.clone()))
                            .collect();
                        self.collect_entity_types_from_config(
                            &child_config,
                            linked_entity,
                            entity_types,
                        );
                    }
                }
                _ => {}
            }
        }
    }

    /// Extract the entity field name from a binding string.
    /// Returns the last field component for entity/payload bindings.
    /// e.g., "@entity.positionX" → Some("positionX")
    ///       "@payload.row.health" → Some("health")
    ///       "@payload.positionY" → Some("positionY")
    ///       "@state" → None
    pub(crate) fn extract_entity_field_name(binding: &str) -> Option<&str> {
        if !binding.starts_with('@') {
            return None;
        }
        let s = &binding[1..]; // Remove @
        let parts: Vec<&str> = s.split('.').collect();
        if parts.len() < 2 {
            return None;
        }
        // For entity and payload roots, use the FIRST field segment for validation.
        // This allows dot-path access into populated relation objects:
        // @entity.assignee.name validates "assignee" (not "name") against entity fields.
        // The nested segments (name, email, etc.) are populated at runtime by
        // populateRelations() and can't be validated at compile time.
        match parts[0] {
            "entity" | "payload" | "_item" => Some(parts[1]),
            _ => None,
        }
    }

    /// Convert OirValue to string
    pub(crate) fn oirvalue_to_sexpr(value: &OirValue) -> SExpression {
        match value {
            OirValue::Null => SExpression::Null,
            OirValue::Bool(b) => SExpression::Bool(*b),
            OirValue::Number(n) => SExpression::Number(*n),
            OirValue::String(s) => SExpression::String(s.clone()),
            OirValue::Array(arr) => {
                SExpression::Array(arr.iter().map(Self::oirvalue_to_sexpr).collect())
            }
            OirValue::Object(obj) => SExpression::Object(
                obj.iter()
                    .map(|(k, v)| (k.clone(), Self::oirvalue_to_sexpr(v)))
                    .collect(),
            ),
        }
    }

    /// Check if an `OirValue::Array` is an operator-call prop value (first
    /// element is a known operator name) and, if so, compile it to TS.
    ///
    /// Lowers the operator-array through the ONE canonical lowering
    /// (`orbital_core::lower::lower_sexpr`) and emits
    /// via the ONE expression emitter (`expr_to_ts_flavored`) with the render
    /// binding flavor (`@entity.f`→`fields?.f`, `@payload.f`→`lastPayload?.f`,
    /// `@Entity`→`(data['Entity'] ?? [])` — `binding_string_to_ts`). Replaces
    /// the former Pipeline-1 (`compile_sexpr_to_ts`) detour and its bespoke
    /// `data['X']` collection (now handled by the render resolver). On a shape
    /// the lowering rejects, returns `None` (falls through to literal handling).
    pub(crate) fn try_compile_sexpr_prop(&self, arr: &[OirValue]) -> Option<String> {
        self.try_compile_sexpr_prop_flavored(arr, BindingFlavor::Render)
    }

    /// §A7 twin of `try_compile_sexpr_prop` for the compiled server's
    /// `clientEffects` tuple — same operator-array detection and sexpr
    /// lowering, `ServerRenderUi` binding flavor (single-record `@entity`,
    /// `@trait`/`@pages`/`@currentTheme` literal) instead of `Render`'s
    /// client `fields?.f`/`lastPayload?.f`.
    pub(crate) fn try_compile_sexpr_prop_server(&self, arr: &[OirValue]) -> Option<String> {
        self.try_compile_sexpr_prop_flavored(arr, BindingFlavor::ServerRenderUi)
    }

    fn try_compile_sexpr_prop_flavored(
        &self,
        arr: &[OirValue],
        flavor: BindingFlavor,
    ) -> Option<String> {
        self.try_compile_sexpr_prop_facts(arr, flavor)
            .map(|(ts, _)| ts)
    }

    /// `try_compile_sexpr_prop` plus whether the emitted value is never nullish
    /// (`infer::oir_expr_ts_never_nullish`), so a prop coercion drops its fallback.
    pub(crate) fn try_compile_sexpr_prop_facts(
        &self,
        arr: &[OirValue],
        flavor: BindingFlavor,
    ) -> Option<(String, bool)> {
        let first = arr.first()?;
        if let OirValue::String(op) = first {
            if !op.starts_with('@') && is_operator_name(op) {
                let sexpr = Self::oirvalue_to_sexpr(&OirValue::Array(arr.to_vec()));
                if let Ok(oir) = orbital_core::lower::lower_sexpr(&sexpr) {
                    let never_nullish = crate::codegen::infer::oir_expr_ts_never_nullish(&oir);
                    return Some((self.expr_to_ts_flavored(&oir, flavor), never_nullish));
                }
            }
        }
        None
    }

    /// Note: In render-ui context, @payload maps to lastPayload (stored from last event dispatch)
    /// since payload is only available in the dispatch function, not in the UI rendering context.
    /// The lastPayload stores the event payload from the most recent dispatch.
    /// Returns a string that can be used as a JSX value (binding expressions or literals)
    pub(crate) fn value_to_jsx_expr(&self, value: &OirValue) -> String {
        match value {
            OirValue::String(s) => {
                // Check if this is a binding (starts with @)
                if s.starts_with('@') {
                    self.binding_string_to_ts(s)
                } else if s == "now" {
                    // Special handling for 'now' - convert to current date/time
                    "Date.now()".to_string()
                } else {
                    format!("\"{}\"", s)
                }
            }
            OirValue::Number(n) => n.to_string(),
            OirValue::Bool(b) => b.to_string(),
            OirValue::Null => "null".to_string(),
            OirValue::Array(arr) => {
                let items: Vec<String> = arr.iter().map(|v| self.value_to_jsx_expr(v)).collect();
                format!("[{}]", items.join(", "))
            }
            OirValue::Object(obj) => {
                let pairs: Vec<String> = obj
                    .iter()
                    .map(|(k, v)| {
                        format!(
                            "{}: {}",
                            crate::codegen::ts_ident::ts_member_name(k),
                            self.value_to_jsx_expr(v)
                        )
                    })
                    .collect();
                format!("{{{}}}", pairs.join(", "))
            }
        }
    }
}

#[cfg(test)]
mod render_prop_pivot_tests {
    use super::*;
    use orbital_core::ir::OirValue;

    fn s(x: &str) -> OirValue {
        OirValue::String(x.to_string())
    }

    #[test]
    fn the_locale_binding_reads_the_views_locale_in_render_props() {
        let backend = TypeScriptBackend::new();
        assert_eq!(backend.value_to_jsx_expr(&s("@locale")), "__locale");
        let ts = backend
            .try_compile_sexpr_prop(&[s("="), s("@entry.code"), s("@locale")])
            .expect("compiles");
        assert!(
            ts.contains("__locale") && !ts.contains("=== locale"),
            "{ts}"
        );
    }

    // Operator-valued render-ui prop now lowers→OirExpr→expr_to_ts_flavored(Render):
    // @entity.f resolves to the render reducer mirror `fields?.f` (NOT the old
    // Pipeline-1 `entity?.f`), proving the consolidation to the render model.
    #[test]
    fn render_prop_entity_binding_uses_fields_mirror() {
        let backend = TypeScriptBackend::new();
        let arr = vec![
            s("str/concat"),
            s("@entity.title"),
            s(" — "),
            s("@entity.subtitle"),
        ];
        let ts = backend
            .try_compile_sexpr_prop(&arr)
            .expect("should compile");
        assert!(
            ts.contains("fields?.title"),
            "expected render fields mirror, got: {ts}"
        );
        assert!(ts.contains("fields?.subtitle"), "got: {ts}");
        assert!(
            !ts.contains("entity?.title"),
            "must not use handler-scope entity?.: {ts}"
        );
    }

    // @payload.X → lastPayload?.X (render View scope), not `payload`.
    #[test]
    fn render_prop_payload_uses_last_payload() {
        let backend = TypeScriptBackend::new();
        let arr = vec![s("str/upper"), s("@payload.name")];
        let ts = backend
            .try_compile_sexpr_prop(&arr)
            .expect("should compile");
        assert!(
            ts.contains("lastPayload?.name"),
            "expected lastPayload, got: {ts}"
        );
    }

    // @Entity (PascalCase) → the data collection `(data['Entity'] ?? [])`,
    // which the old path produced via collect_entity_bindings and the render
    // resolver now produces natively.
    #[test]
    fn render_prop_entity_collection_binding() {
        let backend = TypeScriptBackend::new();
        let arr = vec![s("array/first"), s("@Project")];
        let ts = backend
            .try_compile_sexpr_prop(&arr)
            .expect("should compile");
        assert!(
            ts.contains("data['Project']"),
            "expected data collection, got: {ts}"
        );
    }

    // Non-operator arrays return None (fall through to literal handling).
    #[test]
    fn render_prop_non_operator_is_none() {
        let backend = TypeScriptBackend::new();
        let arr = vec![s("@entity.a"), s("@entity.b")];
        assert!(backend.try_compile_sexpr_prop(&arr).is_none());
    }
}

#[cfg(test)]
mod relation_target_import_tests {
    use super::*;
    use orbital_core::ir::{OirCardinality, OirEntity, OirField, OirRelation};

    /// A scalar `Reference`-typed field (`authorId : Author!`) and an
    /// array-of-reference relation field (`tagIds : [NoteTagRef]`, whose
    /// OUTER `field_type` is `Array`, not `Reference` — the target lives on
    /// `field.relation` instead) both name a TARGET entity that a
    /// structural row-type cast may reference by bare name
    /// (`element_ts_type`, `trait_component.rs`). Both must come back from
    /// the collector, or the emitted file references an unimported type
    /// (TS2304) — the exact defect `field_relation_entity` fixes.
    #[test]
    fn collects_relation_targets_from_both_reference_and_array_relation_fields() {
        let backend = TypeScriptBackend::new();

        let mut note = OirEntity::new("Note");
        note.fields.push(OirField::new(
            "authorId",
            orbital_core::ir::OirType::Reference {
                entity: "Author".to_string(),
            },
        ));
        let mut tag_ids = OirField::new(
            "tagIds",
            orbital_core::ir::OirType::Array {
                inner: Box::new(orbital_core::ir::OirType::String),
            },
        );
        tag_ids.relation = Some(OirRelation {
            target_entity: "NoteTagRef".to_string(),
            target_entity_id: None,
            cardinality: OirCardinality::ManyToMany,
            foreign_key: None,
        });
        note.fields.push(tag_ids);
        // A plain scalar field (no relation) must NOT contribute a spurious
        // "target".
        note.fields
            .push(OirField::new("title", orbital_core::ir::OirType::String));

        let mut module = OirModule::new("TestApp", "0.1.0");
        module.entities.push(note);

        let mut trait_def = OirTrait::new("NoteTagNotesOverlay");
        trait_def.linked_entity = Some("Note".to_string());

        let entity_types = backend.collect_referenced_entity_types(&trait_def, &module);

        assert!(
            entity_types.contains("Author"),
            "must collect the scalar Reference field's target: {entity_types:?}"
        );
        assert!(
            entity_types.contains("NoteTagRef"),
            "must collect the array relation field's target: {entity_types:?}"
        );
        assert!(
            !entity_types.contains("title"),
            "a non-relation field must not contribute a target: {entity_types:?}"
        );
    }

    /// A trait can reference an entity that is NOT its own `linked_entity`
    /// at all — only named by a triggering event's payload
    /// (`CategoryArticlesOverlay -> HelpCategory` fetches `HelpArticle` and
    /// renders `entity: (array/filter ?data …)` over the `CategoryArticles
    /// Loaded { data : [HelpArticle] }` payload). The type lives on
    /// `OirTrait.events[].payload_schema` (`orbital_core::ir::OirTypeMap`) —
    /// NOT `OirTrait.emits[].payload` (`Vec<OirPayloadField>`, confirmed
    /// empirically to be a separate, less-precise lowering of the exact
    /// same `.lolo` declaration that degrades `[HelpArticle]` to `Array {
    /// inner: String }`, losing the entity name). `payload_field_entity`
    /// must unwrap the `Array` wrapper over `payload_schema`'s `Reference`,
    /// or the emitted structural cast references `HelpArticle` with no
    /// import (TS2304).
    #[test]
    fn collects_entity_names_from_event_payload_schema_not_just_linked_entity() {
        use orbital_core::ir::{OirEntity, OirEvent};

        let backend = TypeScriptBackend::new();
        let mut module = OirModule::new("TestApp", "0.1.0");
        module.entities.push(OirEntity::new("HelpArticle"));
        module.entities.push(OirEntity::new("Sponsor"));

        let mut trait_def = OirTrait::new("CategoryArticlesOverlay");
        trait_def.linked_entity = Some("HelpCategory".to_string());

        let mut loaded = OirEvent::new("CategoryArticlesLoaded");
        let mut schema = orbital_core::ir::OirTypeMap::new();
        schema.insert(
            "data".to_string(),
            orbital_core::ir::OirType::Array {
                inner: Box::new(orbital_core::ir::OirType::Reference {
                    entity: "HelpArticle".to_string(),
                }),
            },
        );
        // The real defect's shape ALSO includes an unrelated/`uses`-imported
        // entity lowering as a bare `TypeRef` in some other paths — must be
        // collected too, but ONLY when it names a real module entity (a
        // `TypeRef` also names an ordinary hoisted struct alias that lives
        // in this file, not `@app/shared` — "NotAnEntity" must be rejected).
        schema.insert(
            "sponsor".to_string(),
            orbital_core::ir::OirType::TypeRef {
                name: "Sponsor".to_string(),
            },
        );
        schema.insert(
            "shape".to_string(),
            orbital_core::ir::OirType::TypeRef {
                name: "NotAnEntity".to_string(),
            },
        );
        loaded.payload_schema = Some(schema);
        trait_def.events.push(loaded);

        let entity_types = backend.collect_referenced_entity_types(&trait_def, &module);

        assert!(
            entity_types.contains("HelpArticle"),
            "must collect the event payload's array-of-Reference element target: {entity_types:?}"
        );
        assert!(
            entity_types.contains("Sponsor"),
            "must collect a TypeRef payload field that names a real entity: {entity_types:?}"
        );
        assert!(
            !entity_types.contains("NotAnEntity"),
            "must NOT collect a TypeRef that names a non-entity struct alias: {entity_types:?}"
        );
    }
}
