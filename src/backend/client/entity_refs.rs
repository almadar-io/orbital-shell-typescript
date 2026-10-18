use crate::backend::*;
use crate::codegen::expr::BindingFlavor;

impl TypeScriptBackend {




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
                if let Ok(oir) = orbital_core_eval::lower::lower_sexpr(&sexpr) {
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
    use orbital_core_base::ir::OirValue;

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
