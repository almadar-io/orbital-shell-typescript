use crate::backend::*;
use orbital_core_base::ir::{
    classify_type, render_type, OirEntity, OirField, OirType, TargetTypeRenderer, TypeMappingClass,
};
use std::collections::HashMap;

/// A `'a' | 'b' | 'c'` string-literal union from a non-empty enum value list,
/// or `None` when there are no values. The one place enum values become a TS
/// union, shared by the `String`/`Enum`/struct-field arms of `map_type_ts`.

/// Whether an `OirType` reaches the `SExpr` brand anywhere (its emitted TS needs the `SExpr` type).
pub(crate) fn oir_type_uses_sexpr(oir_type: &OirType) -> bool {
    match oir_type {
        OirType::SExpr => true,
        OirType::Array { inner } | OirType::Optional { inner } => oir_type_uses_sexpr(inner),
        OirType::Map { key, value } => oir_type_uses_sexpr(key) || oir_type_uses_sexpr(value),
        OirType::Struct { fields, additional } => fields.iter().any(|f| oir_type_uses_sexpr(&f.field_type)) || additional.as_deref().is_some_and(oir_type_uses_sexpr),
        OirType::Union { variants } => variants.iter().any(|v| oir_type_uses_sexpr(&v.field_type)),
        _ => false,
    }
}

pub(crate) fn nonempty_enum_union(values: Option<&[String]>) -> Option<String> {
    let values = values?;
    if values.is_empty() {
        return None;
    }
    Some(
        values
            .iter()
            .map(|v| format!("'{}'", escape_js_string(v)))
            .collect::<Vec<_>>()
            .join(" | "),
    )
}

/// One inline-struct-literal walker shared by every `OirType::Struct` emitter
/// (`map_type_ts`, `payload_struct_ts`). Owns the
/// common skeleton: presence comes from `required`, nullability from the value type.
pub(crate) fn struct_fields_ts(
    fields: &[OirField],
    additional: Option<String>,
    inner_ts: impl Fn(&OirField, &OirType) -> String,
) -> String {
    let mut parts: Vec<String> = fields
        .iter()
        .map(|f| {
            let optional = if f.required { "" } else { "?" };
            format!("{}{}: {}", f.name, optional, inner_ts(f, &f.field_type))
        })
        .collect();
    if let Some(additional) = additional {
        parts.push(format!("[key: string]: {additional} | undefined"));
    }
    format!("{{ {} }}", parts.join("; "))
}

/// The TypeScript leaf-renderer behind the shared `orbital_core` walker
/// ([`render_type`]). Every former `OirType → TS` entry point is a config of
/// this one struct — the recursion now lives once in `orbital-core`, so a new
/// `OirType` variant forces an explicit decision here (and in every other
/// backend) at compile time. The two axes: `catalog` (a `Row` of an entity the
/// catalog lacks widens to `EntityRow`) and `payload` (bus-payload dates as `Date | string`). Enum values ride the `enum_values`
/// sidecar (a lolo `format:` union lowers to `String` + `enum_values`, so they
/// can't live on `OirType::Enum`).
pub(crate) struct TsRenderer<'a> {
    catalog: Option<&'a HashMap<String, OirEntity>>,
    payload: bool,
    host_input: bool,
    named_type_module: Option<&'a str>,
}

impl TargetTypeRenderer for TsRenderer<'_> {
    type Out = String;

    fn string(&self, enum_values: Option<&[String]>) -> String {
        nonempty_enum_union(enum_values).unwrap_or_else(|| "string".to_string())
    }
    fn number(&self) -> String {
        "number".to_string()
    }
    fn integer(&self) -> String {
        "number".to_string()
    }
    fn boolean(&self) -> String {
        "boolean".to_string()
    }
    fn date(&self) -> String {
        // A bus payload date legitimately arrives as the serialized string OR an
        // in-memory `Date`.
        // `number` is in every union because BOTH paths store `time/now` as
        // epoch milliseconds (`Date.now()`) — a date-typed field's at-rest
        // value domain is honestly `string | number` (ISO seed or ms write),
        // and typing it `string` alone made every `time/now` write a TS2352
        // non-overlap cast (C-COMPILED-PATH-RED §25, date-as-number cluster).
        if self.payload {
            return "Date | string | number".to_string();
        }
        "string | number".to_string()
    }
    fn json(&self) -> String {
        // A Json entity field must stay assignable to the surrounding `EntityRow` index
        // signature (`Record<string, FieldValue | undefined>`); `Record<string, unknown>` breaks TS2411.
        "Record<string, FieldValue | undefined>".to_string()
    }
    fn union_ty(&self, variants: &[OirField]) -> String {
        // A real TS discriminated union. Each variant already renders as an
        // inline struct literal carrying its own literal-typed tag field, so
        // `A | B` narrows on that tag at the use site — the whole point of
        // making this a union instead of one merged struct with every
        // variant's fields marked optional.
        let parts: Vec<String> = variants
            .iter()
            .map(|v| render_type(self, &v.field_type, v.enum_values.as_deref()))
            .collect();
        match parts.len() {
            0 => self.json(),
            1 => parts.into_iter().next().unwrap_or_default(),
            _ => parts.join(" | "),
        }
    }
    fn reference(&self, entity: &str) -> String {
        // A PAYLOAD field referencing an entity carries the ROW, not an id.
        // The `"string"` rule below is right for entity relation
        // fields (which really do store an id at rest) but wrong here, and the
        // two share this renderer: an event declaring `{ row : BoardView }`
        // rendered `row: string` in `events.ts` while a row object arrived on
        // the bus — and it typechecked, so nothing caught it. Payload positions
        // get the row interface.
        if self.payload {
            return match self.catalog {
                Some(c) if c.contains_key(entity) => entity.to_string(),
                _ => "EntityRow".to_string(),
            };
        }
        // A relation FIELD stores the referenced row's id, a string, on both paths; typing the
        // member as the referenced entity's interface made every `@user.id` write a TS2352 cast.
        "string".to_string()
    }
    fn row(&self, entity: &str) -> String {
        match self.catalog {
            Some(c) if !c.contains_key(entity) => "EntityRow".to_string(),
            _ => entity.to_string(),
        }
    }
    fn enum_ty(&self, _name: &str, enum_values: Option<&[String]>) -> String {
        nonempty_enum_union(enum_values).unwrap_or_else(|| "string".to_string())
    }
    fn orbital_value(&self) -> String {
        // The inlined storage shape where it is declared; an expression result reads as a stored field value.
        "OrbitalFieldRef".to_string()
    }
    fn behavior_value(&self) -> String {
        "BehaviorFieldRef".to_string()
    }
    fn trait_ref(&self) -> String {
        // A `trait`-typed config field is the branded `TraitFieldRef`.
        "TraitFieldRef".to_string()
    }
    fn sexpr(&self) -> String {
        "SExpr".to_string()
    }
    fn type_ref(&self, name: &str) -> String {
        match self.named_type_module {
            Some(module) => format!("import('{module}').{name}"),
            None => name.to_string(),
        }
    }
    fn node(&self) -> String {
        // Renderable content: string leaf, pattern node, or arrays of either.
        // `PatternValue` is assignable under `EntityRow`'s index signature
        // (`FieldValue` carries a `readonly FieldValue[]` member for exactly
        // this).
        "PatternValue".to_string()
    }
    fn array(&self, inner_ty: &OirType, inner: String) -> String {
        // `[A | B]` is an array of the union; bare `A | B[]` binds `[]` to B.
        let element = match inner_ty {
            OirType::Union { variants } if variants.len() > 1 => format!("({})", inner),
            OirType::Optional { .. } | OirType::Date | OirType::DateTime => format!("({})", inner),
            _ => inner,
        };
        format!("{}[]", element)
    }
    fn tuple(&self, _items_ty: &[OirType], items: Vec<String>) -> String {
        format!("[{}]", items.join(", "))
    }
    fn map(&self, _key_ty: &OirType, key: String, _value_ty: &OirType, value: String) -> String {
        if self.host_input {
            format!("Record<{}, {} | undefined>", key, value)
        } else {
            format!("Record<{}, {}>", key, value)
        }
    }
    fn optional(&self, _inner_ty: &OirType, inner: String) -> String {
        format!("{} | null", inner)
    }
    fn struct_ty(&self, fields: &[OirField], additional: Option<&OirType>) -> String {
        struct_fields_ts(fields, additional.map(|value| render_type(self, value, None)), |f, effective| {
            render_type(self, effective, f.enum_values.as_deref())
        })
    }

    // Classifications per `docs/Orbital_Type_Chain_Table.md` (TS column,
    // Declared mode — the mode the table cites): `number` is faithful so
    // Number is; Integer→number, the erased semantic domains, Money (via the
    // trait-default classify_money), and Date (`string | number`) are
    // Widening; Declared Json is the shapeless-record Lossy arm. The faithful
    // arms TS spells natively — scalar's closed union, PatternValue, the
    // hoisted TypeRef name, the discriminated union — override their
    // json-default classification exactly as the rendering overrides the
    // json-default rendering. Payload positions carry the row, not the
    // id (Faithful).
    fn classify_string(&self, _enum_values: Option<&[String]>) -> TypeMappingClass {
        TypeMappingClass::Faithful
    }
    fn classify_number(&self) -> TypeMappingClass {
        TypeMappingClass::Faithful
    }
    fn classify_integer(&self) -> TypeMappingClass {
        TypeMappingClass::Widening
    }
    fn classify_boolean(&self) -> TypeMappingClass {
        TypeMappingClass::Faithful
    }
    fn classify_date(&self) -> TypeMappingClass {
        TypeMappingClass::Widening
    }
    fn classify_json(&self) -> TypeMappingClass {
        TypeMappingClass::Lossy
    }
    fn classify_node(&self) -> TypeMappingClass {
        TypeMappingClass::Faithful
    }
    fn classify_reference(&self, _entity: &str) -> TypeMappingClass {
        if self.payload {
            return TypeMappingClass::Faithful;
        }
        TypeMappingClass::Widening
    }
    fn classify_row(&self, entity: &str) -> TypeMappingClass {
        if self.catalog.is_none_or(|c| c.contains_key(entity)) {
            TypeMappingClass::Faithful
        } else {
            TypeMappingClass::Widening
        }
    }
    fn classify_enum_ty(&self, _name: &str, _enum_values: Option<&[String]>) -> TypeMappingClass {
        TypeMappingClass::Faithful
    }
    fn classify_trait_ref(&self) -> TypeMappingClass {
        TypeMappingClass::Faithful
    }
    fn classify_sexpr(&self) -> TypeMappingClass {
        TypeMappingClass::Faithful
    }
    fn classify_type_ref(&self, _name: &str) -> TypeMappingClass {
        TypeMappingClass::Faithful
    }
    fn classify_union_ty(&self, _variants: &[OirField]) -> TypeMappingClass {
        TypeMappingClass::Faithful
    }
    fn classify_array(&self, _inner_ty: &OirType, inner: TypeMappingClass) -> TypeMappingClass {
        inner
    }
    fn classify_map(
        &self,
        _key_ty: &OirType,
        key: TypeMappingClass,
        _value_ty: &OirType,
        value: TypeMappingClass,
    ) -> TypeMappingClass {
        key.meet(value)
    }
    fn classify_optional(&self, _inner_ty: &OirType, inner: TypeMappingClass) -> TypeMappingClass {
        inner
    }
    fn classify_struct_ty(&self, _fields: &[OirField], additional: Option<&OirType>) -> TypeMappingClass {
        additional.map_or(TypeMappingClass::Faithful, |value| classify_type(self, value, None))
    }
}

/// Classify an `OirType` under the TS renderer's faithfulness table
/// (Phase-1 metadata; the classification never alters rendered output).
/// This is the Declared-mode classification the enumeration table cites;
/// `enum_values` is the immediate field's sidecar.
pub fn classify_oir_type(ty: &OirType, enum_values: Option<&[String]>) -> TypeMappingClass {
    classify_type(
        &TsRenderer {
            catalog: None,
            payload: false,
            host_input: false,
            named_type_module: None,
        },
        ty,
        enum_values,
    )
}

/// The single canonical `OirType → TypeScript type string` mapper, over the shared
/// `orbital_core` walker via [`TsRenderer`]; `entity_catalog` decides whether a `Row`
/// names a known entity or widens to `EntityRow`.
pub(crate) fn map_type_ts(
    ty: &OirType,
    enum_values: Option<&Vec<String>>,
    entity_catalog: Option<&HashMap<String, OirEntity>>,
) -> String {
    map_type_ts_with_projection(ty, enum_values, entity_catalog, TypeProjection::Wire, None)
}

pub(crate) fn map_type_ts_with_projection(
    ty: &OirType,
    enum_values: Option<&Vec<String>>,
    entity_catalog: Option<&HashMap<String, OirEntity>>,
    projection: TypeProjection,
    named_type_module: Option<&str>,
) -> String {
    let host_input = projection == TypeProjection::HostInput;
    render_type(
        &TsRenderer { catalog: entity_catalog, payload: host_input, host_input, named_type_module },
        ty,
        enum_values.map(Vec::as_slice),
    )
}

impl TypeScriptBackend {


    /// Map OIR type to TypeScript type
    pub fn map_type(&self, oir_type: &OirType) -> String {
        self.map_type_with_enum(oir_type, None)
    }

    /// Render an `OirType` as an inline TypeScript type for the BUS payload
    /// context. Identical to `map_type` except a date is `Date | string` — a
    /// payload date legitimately arrives as the serialized string OR an
    /// in-memory `Date` (both are in `EventPayloadValue`), so this matches what
    /// a component callback hands back (e.g. `CalendarEvent.startTime:
    /// string | Date`). Recurses through structs/arrays/optionals; used only
    /// for anonymous struct payload fields.
    pub(crate) fn payload_struct_ts(&self, oir_type: &OirType) -> String {
        render_type(
            &TsRenderer {
                    catalog: None,
                payload: true,
                host_input: false,
            named_type_module: None,
            },
            oir_type,
            None,
        )
    }

    /// Recursively check whether an `OirType` contains a `Trait` reference
    /// anywhere — used by the entities.ts emitter to decide whether the
    /// inlined `TraitFieldRef` type alias is needed.
    pub(crate) fn field_type_uses_trait(&self, oir_type: &OirType) -> bool {
        match oir_type {
            OirType::Trait => true,
            OirType::Array { inner } => self.field_type_uses_trait(inner),
            OirType::Map { key, value } => {
                self.field_type_uses_trait(key) || self.field_type_uses_trait(value)
            }
            OirType::Optional { inner } => self.field_type_uses_trait(inner),
            OirType::Struct { fields, additional } => fields
                .iter()
                .any(|f| self.field_type_uses_trait(&f.field_type))
                || additional.as_deref().is_some_and(|value| self.field_type_uses_trait(value)),
            _ => false,
        }
    }

    /// Recursively check whether an `OirType` contains an `Orbital` value —
    /// gates the inlined `OrbitalFieldRef` storage shape.
    pub(crate) fn field_type_uses_orbital(&self, oir_type: &OirType) -> bool {
        match oir_type {
            OirType::Orbital => true,
            OirType::Array { inner } | OirType::Optional { inner } => {
                self.field_type_uses_orbital(inner)
            }
            OirType::Map { key, value } => {
                self.field_type_uses_orbital(key) || self.field_type_uses_orbital(value)
            }
            OirType::Struct { fields, additional } => fields
                .iter()
                .any(|f| self.field_type_uses_orbital(&f.field_type))
                || additional.as_deref().is_some_and(|value| self.field_type_uses_orbital(value)),
            _ => false,
        }
    }

    /// Recursively check whether an `OirType` contains a `Behavior` value —
    /// gates the inlined `BehaviorFieldRef` storage shape.
    pub(crate) fn field_type_uses_behavior(&self, oir_type: &OirType) -> bool {
        match oir_type {
            OirType::Behavior => true,
            OirType::Array { inner } | OirType::Optional { inner } => {
                self.field_type_uses_behavior(inner)
            }
            OirType::Map { key, value } => {
                self.field_type_uses_behavior(key) || self.field_type_uses_behavior(value)
            }
            OirType::Struct { fields, additional } => fields
                .iter()
                .any(|f| self.field_type_uses_behavior(&f.field_type))
                || additional.as_deref().is_some_and(|value| self.field_type_uses_behavior(value)),
            _ => false,
        }
    }

    /// Recursively check whether an `OirType` contains renderable `Node`
    /// content anywhere — gates the inlined `PatternValue`/`PatternNode`
    /// declaration in the generated file (mirrors `field_type_uses_trait`).
    pub(crate) fn field_type_uses_node(&self, oir_type: &OirType) -> bool {
        match oir_type {
            OirType::Node => true,
            OirType::Array { inner } => self.field_type_uses_node(inner),
            OirType::Map { key, value } => {
                self.field_type_uses_node(key) || self.field_type_uses_node(value)
            }
            OirType::Optional { inner } => self.field_type_uses_node(inner),
            OirType::Struct { fields, additional } => fields
                .iter()
                .any(|f| self.field_type_uses_node(&f.field_type))
                || additional.as_deref().is_some_and(|value| self.field_type_uses_node(value)),
            _ => false,
        }
    }

    /// Recursively check whether an `OirType` contains an `SExpr` brand
    /// anywhere — used by the emitters to decide whether the inlined recursive
    /// `SExpr` type alias is needed (mirrors `field_type_uses_trait`).
    pub(crate) fn field_type_uses_sexpr(&self, oir_type: &OirType) -> bool {
        oir_type_uses_sexpr(oir_type)
    }

    /// Recursively collect every named struct type this `OirType` reaches
    /// via `OirType::TypeRef` — the interface `generate_shared_entities`
    /// hoists into `types/entities.ts`. Any file that renders a `TypeRef` as
    /// a bare name (via `map_type_ts` / `TsRenderer::type_ref`) without
    /// importing it hits TS2304; this is the one walker both
    /// `generate_shared_schemas` (imports every declared struct's own
    /// interface) and `generate_shared_trait_configs` (imports only the
    /// struct names a `config {}` block actually reads through) build their
    /// import line from — mirrors `field_type_uses_node`/`_sexpr` above.
    pub(crate) fn collect_named_type_refs(
        oir_type: &OirType,
        out: &mut std::collections::BTreeSet<String>,
    ) {
        match oir_type {
            OirType::TypeRef { name } => {
                out.insert(name.clone());
            }
            OirType::Array { inner } | OirType::Optional { inner } => {
                Self::collect_named_type_refs(inner, out);
            }
            OirType::Map { key, value } => {
                Self::collect_named_type_refs(key, out);
                Self::collect_named_type_refs(value, out);
            }
            OirType::Struct { fields, additional } => {
                for f in fields {
                    Self::collect_named_type_refs(&f.field_type, out);
                }
                if let Some(value) = additional { Self::collect_named_type_refs(value, out); }
            }
            OirType::Union { variants } => {
                for v in variants {
                    Self::collect_named_type_refs(&v.field_type, out);
                }
            }
            _ => {}
        }
    }

    /// Map OIR type to TypeScript type with enum values (DECLARED position).
    /// Thin wrapper over the canonical `map_type_ts`.
    pub(crate) fn map_type_with_enum(
        &self,
        oir_type: &OirType,
        enum_values: Option<&Vec<String>>,
    ) -> String {
        map_type_ts_with_projection(oir_type, enum_values, None, self.type_projection, None)
    }
}

#[cfg(test)]
mod array_of_union_tests {
    use super::*;

    fn tagged(tag: &str) -> OirField {
        OirField::new(
            tag,
            OirType::Struct {
                additional: None,
                fields: vec![OirField::new("type", OirType::String)],
            },
        )
    }

    /// `[A | B]` is an array of the union; `A | B[]` would be A or an array of B.
    #[test]
    fn an_array_of_a_union_parenthesizes_the_union() {
        let ty = OirType::Array {
            inner: Box::new(OirType::Union {
                variants: vec![tagged("A"), tagged("B")],
            }),
        };
        let declared = map_type_ts(&ty, None, None);
        assert!(
            declared.starts_with('(') && declared.ends_with(")[]"),
            "{declared}"
        );
    }

    /// Control: a plain element type keeps its bare `T[]`.
    #[test]
    fn an_array_of_a_plain_type_stays_bare() {
        let ty = OirType::Array {
            inner: Box::new(OirType::String),
        };
        assert_eq!(
            map_type_ts(&ty, None, None),
            "string[]"
        );
    }
}

#[cfg(test)]
mod tuple_type_tests {
    use super::*;

    /// `.lolo` `[number, number, number]` (Canvas lighting `position`) is a TS tuple,
    /// not `number[]` (TS2322 against the component's `[number, number, number]`).
    #[test]
    fn a_tuple_renders_as_a_ts_tuple() {
        let ty = OirType::Tuple {
            items: vec![OirType::Number, OirType::Number, OirType::Number],
        };
        assert_eq!(
            map_type_ts(&ty, None, None),
            "[number, number, number]"
        );
    }
}

#[cfg(test)]
mod row_type_tests {
    use super::*;

    fn catalog(names: &[&str]) -> HashMap<String, OirEntity> {
        names
            .iter()
            .map(|n| (n.to_string(), OirEntity::new(*n)))
            .collect()
    }

    #[test]
    fn a_row_renders_the_entity_interface_where_a_reference_renders_an_id() {
        assert_eq!(
            map_type_ts(&OirType::row("NoteRevision"), None, None),
            "NoteRevision"
        );
        assert_eq!(
            map_type_ts(
                &OirType::array(OirType::reference("NoteRevision")),
                None,
                None),
            "string[]"
        );
        assert_eq!(
            map_type_ts(
                &OirType::array(OirType::row("NoteRevision")),
                None,
                None),
            "NoteRevision[]"
        );
    }

    #[test]
    fn a_row_of_an_entity_outside_the_catalog_widens_to_entity_row() {
        let cat = catalog(&["Note"]);
        assert_eq!(
            map_type_ts(
                &OirType::row("Note"),
                None,
                Some(&cat)),
            "Note"
        );
        assert_eq!(
            map_type_ts(
                &OirType::row("Elsewhere"),
                None,
                Some(&cat)),
            "EntityRow"
        );
    }

    #[test]
    fn row_classification_follows_the_rendering() {
        use orbital_core_base::ir::classify_type;
        let cat = catalog(&["Note"]);
        let r = TsRenderer {
            catalog: Some(&cat),
            payload: false,
            host_input: false,
            named_type_module: None,
        };
        assert_eq!(
            classify_type(&r, &OirType::row("Note"), None),
            TypeMappingClass::Faithful
        );
        assert_eq!(
            classify_type(&r, &OirType::row("Elsewhere"), None),
            TypeMappingClass::Widening
        );
    }
}
