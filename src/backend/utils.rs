use crate::backend::*;

// ============================================================================
// Utility Functions
// ============================================================================

// Canonical string helpers live in `orbital_core::str_utils`; re-exported
// here so the `backend::*` glob keeps resolving them.
pub(crate) use orbital_core_base::str_utils::{
    capitalize_first, escape_js_string, to_camel_case,
};

/// Derive a TS type from a default config value's *shape*, so a
/// `DEFAULT_CONFIG = {…} as {name}Config` cast (and `config.bodyContent.columns`
/// reads) typecheck. Used only for object / object-array config fields, whose
/// declared `config{}` type (`string` / `string[]`) doesn't match the authored
/// nested shape. `@`-binding strings derive to `string` (their runtime read
/// type at this boundary). Heterogeneous arrays produce a union element type.
pub(crate) fn oir_value_to_ts_type(v: &OirValue) -> String {
    if let Some(data) = orbital_core_base::schema::quote::quoted_oir_value(v) {
        return oir_value_to_ts_type(&data);
    }
    match v {
        OirValue::Null => "null".to_string(),
        OirValue::Bool(_) => "boolean".to_string(),
        OirValue::Number(_) => "number".to_string(),
        OirValue::String(_) => "string".to_string(),
        OirValue::Array(arr) => {
            if arr.is_empty() {
                // Empty default → element type is unknowable from the value.
                // `FieldValue[]` is the eslint-allowed permissive array type
                // (`almadar/no-unknown-type` bans bare `unknown`); `[]` and any
                // scalar/object array are both assignable to it.
                "FieldValue[]".to_string()
            } else {
                let mut elem: Vec<String> = arr.iter().map(oir_value_to_ts_type).collect();
                elem.sort();
                elem.dedup();
                if elem.len() > 1 {
                    format!("Array<{}>", elem.join(" | "))
                } else {
                    format!("{}[]", elem[0])
                }
            }
        }
        OirValue::Object(obj) => {
            let mut keys: Vec<&String> = obj.keys().collect();
            keys.sort();
            // Keys are quoted when not identifier-safe (render-tree props like
            // `data-theme` reach config defaults verbatim, and a bare
            // hyphenated key is a syntax error in a type literal).
            let entries: Vec<String> = keys
                .iter()
                .map(|k| {
                    format!(
                        "{}: {}",
                        crate::codegen::ts_ident::ts_member_name(k),
                        oir_value_to_ts_type(&obj[*k])
                    )
                })
                .collect();
            format!("{{ {} }}", entries.join("; "))
        }
    }
}

/// Walk an `OirType` and add every referenced entity name to `acc`. Used
/// while emitting event-payload interfaces so that `data : [CartItem]`
/// (`Array<Reference<CartItem>>`) brings CartItem into the import set
/// alongside a plain `Reference<CartItem>`. Arrays and Optional wrappers
/// recurse; primitives and Json don't contribute.
pub(crate) fn collect_reference_entities(
    ty: &OirType,
    acc: &mut std::collections::BTreeSet<String>,
) {
    match ty {
        OirType::Reference { entity } | OirType::Row { entity } => {
            acc.insert(entity.clone());
        }
        OirType::Array { inner } | OirType::Optional { inner } => {
            collect_reference_entities(inner, acc);
        }
        _ => {}
    }
}

/// Recursively rewrite every `OirType::Reference { entity }` that isn't in
/// `local` to `Reference { entity: "EntityRow" }`. Used by the events.ts
/// generator so molecules that inherit events from an imported orbital
/// (whose entities aren't in the local `entities.ts`) produce payloads
/// like `data: EntityRow[]` rather than `data: ModalRecord[]` with a
/// missing import. `EntityRow` is imported from `@almadar/core` at the
/// top of the generated events.ts, so referencing it is always safe.
pub(crate) fn rewrite_non_local_entity_refs(
    ty: &OirType,
    local: &std::collections::HashSet<String>,
) -> OirType {
    match ty {
        OirType::Reference { entity } if !local.contains(entity) => OirType::Reference {
            entity: "EntityRow".to_string(),
        },
        OirType::Row { entity } if !local.contains(entity) => OirType::Row {
            entity: "EntityRow".to_string(),
        },
        OirType::Array { inner } => OirType::Array {
            inner: Box::new(rewrite_non_local_entity_refs(inner, local)),
        },
        OirType::Optional { inner } => OirType::Optional {
            inner: Box::new(rewrite_non_local_entity_refs(inner, local)),
        },
        // A whole-entity payload (`row : Note`) expands to a Struct whose
        // members carry their declared type names, so a non-local reference
        // hides one level down — e.g. `blocksJson : [BlockSpec]`, a lolo
        // struct alias that `@app/shared` never exports, printed a bare
        // `BlockSpec[]` and tripped TS2304. Mirrors the Array/Map/Optional/
        // Struct recursion of `field_type_uses_{trait,node,sexpr}`.
        OirType::Struct { fields, additional } => OirType::Struct {
            additional: additional
                .as_ref()
                .map(|value| Box::new(rewrite_non_local_entity_refs(value, local))),
            fields: fields
                .iter()
                .map(|f| orbital_core_base::ir::OirField {
                    declared: None,
                    field_type: rewrite_non_local_entity_refs(&f.field_type, local),
                    ..f.clone()
                })
                .collect(),
        },
        OirType::Map { key, value } => OirType::Map {
            key: Box::new(rewrite_non_local_entity_refs(key, local)),
            value: Box::new(rewrite_non_local_entity_refs(value, local)),
        },
        other => other.clone(),
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use orbital_core_base::ir::OirValue;

    fn quoted(json: &str) -> OirValue {
        let sexpr: orbital_core_base::schema::SExpression = serde_json::from_str(json).unwrap();
        OirValue::Array(vec![
            OirValue::String("quote".into()),
            OirValue::String(orbital_core_base::schema::quote::encode_quote_body(&sexpr)),
        ])
    }

    /// G-CROSS-041: a quoted config default is emitted as the data it holds.
    #[test]
    fn a_quoted_default_emits_its_data_and_type() {
        let v = quoted(r#"{"event":"PAY","guard":[">","@payload.amount",0]}"#);
        assert_eq!(
            oir_value_to_ts_type(&v),
            "{ event: string; guard: Array<number | string> }"
        );
    }

    #[test]
    fn control_a_two_string_list_headed_otherwise_stays_a_list() {
        let v = OirValue::Array(vec![
            OirValue::String("quotes".into()),
            OirValue::String("{}".into()),
        ]);
        assert_eq!(oir_value_to_ts_type(&v), "string[]");
    }

    #[test]
    fn object_keys_quote_when_not_identifier_safe() {
        // render-tree props like data-theme reach config defaults verbatim;
        // a bare hyphenated key is a syntax error in type AND object literals
        let mut obj: orbital_core_base::ir::OirObject = orbital_core_base::ir::OirObject::new();
        obj.insert(
            "data-theme".to_string(),
            OirValue::String("@currentTheme".to_string()),
        );
        assert_eq!(
            oir_value_to_ts_type(&OirValue::Object(obj)),
            "{ \"data-theme\": string }"
        );
    }

    #[test]
    fn rewrite_reaches_references_nested_in_a_struct_member() {
        // `row : Note` expands to a Struct; a non-local reference on one of
        // its members (a lolo struct alias like BlockSpec) must still be
        // widened, or the handler prints an identifier nothing declares.
        let field = |name: &str, ty: OirType| orbital_core_base::ir::OirField {
            declared: None,
            merged_from: None,
            name: name.to_string(),
            field_type: ty,
            description: None,
            required: false,
            default: None,
            constraints: vec![],
            enum_values: None,
            relation: None,
            intrinsic: false,
        };
        let row = OirType::Struct {
            additional: None,
            fields: vec![
                field(
                    "authorId",
                    OirType::Reference {
                        entity: "Author".to_string(),
                    },
                ),
                field(
                    "blocksJson",
                    OirType::array(OirType::Reference {
                        entity: "BlockSpec".to_string(),
                    }),
                ),
                field(
                    "byKey",
                    OirType::map(
                        OirType::String,
                        OirType::Reference {
                            entity: "BlockSpec".to_string(),
                        },
                    ),
                ),
            ],
        };
        let local: std::collections::HashSet<String> =
            ["Note", "Author"].iter().map(|s| s.to_string()).collect();

        let OirType::Struct { fields, .. } = rewrite_non_local_entity_refs(&row, &local) else {
            panic!("expected a Struct back");
        };
        // Local entity reference survives — it IS importable from @app/shared.
        assert_eq!(
            fields[0].field_type,
            OirType::Reference {
                entity: "Author".to_string()
            }
        );
        assert_eq!(
            fields[1].field_type,
            OirType::array(OirType::Reference {
                entity: "EntityRow".to_string()
            })
        );
        assert_eq!(
            fields[2].field_type,
            OirType::map(
                OirType::String,
                OirType::Reference {
                    entity: "EntityRow".to_string()
                }
            )
        );
    }


}
