use crate::backend::*;
use orbital_core_base::ir::{
    classify_type, render_type, OirEntity, OirField, OirType, TargetTypeRenderer, TypeMappingClass,
};
use std::collections::HashMap;

/// Whether an `OirType` is rendered for a DECLARED position (entity/schema
/// interfaces, trait config) or an INFERRED one (lambda-param / array-element
/// types in expression codegen). The only axis on which the otherwise-shared
/// `OirType → TS` walk varies — mirrors the crate's `BindingFlavor` /
/// mode-enum idiom (one walk, `match mode` at the few divergent
/// arms) rather than two hand-maintained copies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TsTypeMode {
    /// Entity fields / schema interfaces / trait `config{}` — the type must
    /// match what the runtime stores/serializes.
    Declared,
    /// Inferred lambda-param / array-element types — the type must accept a
    /// live value at that point (e.g. an in-memory `Date`, not just its wire
    /// string), and an unknown reference widens to `EntityRow`.
    Inferred,
}

/// A `'a' | 'b' | 'c'` string-literal union from a non-empty enum value list,
/// or `None` when there are no values. The one place enum values become a TS
/// union, shared by the `String`/`Enum`/struct-field arms of `map_type_ts`.
/// An element type ready for `[]`: `[]` binds tighter than `|`, so `A | B[]` is an array of B
/// alone. Parentheses are always valid, so any element spelling a union gets them.
pub(crate) fn array_element_ts(element: &str) -> String {
    // `readonly` applies to the whole array/tuple type that follows it.
    if element.contains('|') || element.starts_with("readonly ") {
        format!("({element})")
    } else {
        element.to_string()
    }
}

/// Whether an `OirType` reaches the `SExpr` brand anywhere (its emitted TS needs the `SExpr` type).
pub(crate) fn oir_type_uses_sexpr(oir_type: &OirType) -> bool {
    match oir_type {
        OirType::SExpr => true,
        OirType::Array { inner } | OirType::Optional { inner } => oir_type_uses_sexpr(inner),
        OirType::Map { key, value } => oir_type_uses_sexpr(key) || oir_type_uses_sexpr(value),
        OirType::Struct { fields } => fields.iter().any(|f| oir_type_uses_sexpr(&f.field_type)),
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
            .map(|v| format!("'{}'", v))
            .collect::<Vec<_>>()
            .join(" | "),
    )
}

/// One inline-struct-literal walker shared by every `OirType::Struct` emitter
/// (`map_type_ts`, `payload_struct_ts`). Owns the
/// common skeleton: unwrap a non-required field's `Optional` wrapper (so
/// `?: T | null` never double-marks optionality), then `{name}{?}: {inner}`
/// joined with `; ` inside `{ }`. The per-field `inner` type — including each
/// caller's recursive emitter and any enum-union handling — is supplied by
/// `inner_ts`, called with `(field, effective_unwrapped_type)`.
pub(crate) fn struct_fields_ts(
    fields: &[OirField],
    inner_ts: impl Fn(&OirField, &OirType) -> String,
) -> String {
    let parts: Vec<String> = fields
        .iter()
        .map(|f| {
            let (effective, is_optional) = f.effective_type();
            let optional = if is_optional { "?" } else { "" };
            format!("{}{}: {}", f.name, optional, inner_ts(f, effective))
        })
        .collect();
    format!("{{ {} }}", parts.join("; "))
}

/// The TypeScript leaf-renderer behind the shared `orbital_core` walker
/// ([`render_type`]). Every former `OirType → TS` entry point is a config of
/// this one struct — the recursion now lives once in `orbital-core`, so a new
/// `OirType` variant forces an explicit decision here (and in every other
/// backend) at compile time. The three axes that used to be separate copies:
/// `mode` (Declared entity/schema vs Inferred lambda/element), `catalog`
/// (Inferred `Reference` known-vs-`EntityRow`), and `payload` (bus-payload dates as `Date | string`, optionals
/// unwrapped, struct fields un-enumed). Enum values ride the `enum_values`
/// sidecar (a lolo `format:` union lowers to `String` + `enum_values`, so they
/// can't live on `OirType::Enum`).
pub(crate) struct TsRenderer<'a> {
    mode: TsTypeMode,
    catalog: Option<&'a HashMap<String, OirEntity>>,
    payload: bool,
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
        // in-memory `Date`; an Inferred position must accept the live value too.
        // `number` is in every union because BOTH paths store `time/now` as
        // epoch milliseconds (`Date.now()`) — a date-typed field's at-rest
        // value domain is honestly `string | number` (ISO seed or ms write),
        // and typing it `string` alone made every `time/now` write a TS2352
        // non-overlap cast (C-COMPILED-PATH-RED §25, date-as-number cluster).
        if self.payload {
            return "Date | string | number".to_string();
        }
        match self.mode {
            TsTypeMode::Declared => "string | number".to_string(),
            TsTypeMode::Inferred => "Date | string | number".to_string(),
        }
    }
    fn json(&self) -> String {
        // Declared: a Json entity field must stay assignable to the surrounding
        // `EntityRow` index signature (`Record<string, FieldValue | undefined>`)
        // — `Record<string, unknown>` breaks TS2411. Inferred: an array-element
        // Json widens to `EntityRow` so `row.<field>` reads return `FieldValue
        // | undefined`.
        match self.mode {
            TsTypeMode::Declared => "Record<string, FieldValue | undefined>".to_string(),
            TsTypeMode::Inferred => "EntityRow".to_string(),
        }
    }
    fn union_ty(&self, variants: &[OirField]) -> String {
        // A real TS discriminated union. Each variant already renders as an
        // inline struct literal carrying its own literal-typed tag field, so
        // `A | B` narrows on that tag at the use site — the whole point of
        // making this a union instead of one merged struct with every
        // variant's fields marked optional.
        let parts: Vec<String> = variants
            .iter()
            .map(|v| render_type(self, &v.field_type, None))
            .collect();
        match parts.len() {
            0 => self.json(),
            1 => parts.into_iter().next().unwrap_or_default(),
            _ => parts.join(" | "),
        }
    }
    fn reference(&self, entity: &str) -> String {
        // A PAYLOAD field referencing an entity carries the ROW, not an id.
        // The `Declared => "string"` rule below is right for entity relation
        // fields (which really do store an id at rest) but wrong here, and the
        // two share this renderer: an event declaring `{ row : BoardView }`
        // rendered `row: string` in `events.ts` while a row object arrived on
        // the bus — and it typechecked, so nothing caught it. Payload positions
        // get the row interface, matching `Inferred`, where the value really IS the row.
        if self.payload {
            return match self.catalog {
                Some(c) if c.contains_key(entity) => entity.to_string(),
                _ => "EntityRow".to_string(),
            };
        }
        match self.mode {
            // A relation FIELD stores the referenced row's id — a string —
            // on both paths; typing the member as the referenced entity's
            // interface lied about the at-rest value and made every
            // `@user.id` write a TS2352 non-overlap cast
            // (C-COMPILED-PATH-RED §25, string→Person). Inferred positions
            // (collection reads) keep the full row interface — there the
            // value really IS the row.
            TsTypeMode::Declared => "string".to_string(),
            TsTypeMode::Inferred => {
                if self.catalog.is_some_and(|c| c.contains_key(entity)) {
                    entity.to_string()
                } else {
                    "EntityRow".to_string()
                }
            }
        }
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
        match self.mode {
            TsTypeMode::Declared => "OrbitalFieldRef".to_string(),
            TsTypeMode::Inferred => "FieldValue".to_string(),
        }
    }
    fn behavior_value(&self) -> String {
        match self.mode {
            TsTypeMode::Declared => "BehaviorFieldRef".to_string(),
            TsTypeMode::Inferred => "FieldValue".to_string(),
        }
    }
    fn trait_ref(&self) -> String {
        // A `trait`-typed config field is the branded `TraitFieldRef` in a
        // declared position; in an inferred expression position it reads as a
        // plain string (the deep-scan substitutes `@trait.X` at codegen time).
        match self.mode {
            TsTypeMode::Declared => "TraitFieldRef".to_string(),
            TsTypeMode::Inferred => "string".to_string(),
        }
    }
    fn sexpr(&self) -> String {
        "SExpr".to_string()
    }
    fn type_ref(&self, name: &str) -> String {
        // The named (possibly self-referential) interface, hoisted once per
        // module by `emit_named_type_declarations` — referencing the bare
        // name here (never inlining) is what makes the type actually
        // recursive instead of an infinite unroll attempt.
        name.to_string()
    }
    fn node(&self) -> String {
        // Renderable content: string leaf, pattern node, or arrays of either.
        // `PatternValue` is assignable under `EntityRow`'s index signature
        // (`FieldValue` carries a `readonly FieldValue[]` member for exactly
        // this), so Declared and Inferred agree.
        "PatternValue".to_string()
    }
    fn array(&self, inner_ty: &OirType, inner: String) -> String {
        // `[A | B]` is an array of the union; bare `A | B[]` binds `[]` to B.
        let element = match inner_ty {
            OirType::Union { variants } if variants.len() > 1 => format!("({})", inner),
            OirType::Optional { .. } => format!("({})", inner),
            _ => inner,
        };
        match self.mode {
            TsTypeMode::Declared => format!("{}[]", element),
            TsTypeMode::Inferred => format!("readonly {}[]", element),
        }
    }
    fn tuple(&self, _items_ty: &[OirType], items: Vec<String>) -> String {
        match self.mode {
            TsTypeMode::Declared => format!("[{}]", items.join(", ")),
            TsTypeMode::Inferred => format!("readonly [{}]", items.join(", ")),
        }
    }
    fn map(&self, _key_ty: &OirType, key: String, _value_ty: &OirType, value: String) -> String {
        format!("Record<{}, {}>", key, value)
    }
    fn optional(&self, _inner_ty: &OirType, inner: String) -> String {
        // A payload struct unwraps optionality (the `?:` marker carries it);
        // declared/inferred positions spell it as a union suffix.
        if self.payload {
            return inner;
        }
        match self.mode {
            TsTypeMode::Declared => format!("{} | null", inner),
            TsTypeMode::Inferred => format!("{} | undefined", inner),
        }
    }
    fn struct_ty(&self, fields: &[OirField]) -> String {
        struct_fields_ts(fields, |f, effective| {
            // Payload structs drop the per-field enum sidecar (the payload path
            // never emitted literal unions); every other position honors it so
            // the inline struct emits the strict union, not `string`.
            if self.payload {
                render_type(self, effective, None)
            } else {
                nonempty_enum_union(f.enum_values.as_deref())
                    .unwrap_or_else(|| render_type(self, effective, f.enum_values.as_deref()))
            }
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
    // json-default rendering. Inferred-mode deltas: a known reference/TraitRef
    // is the row interface / `TraitFieldRef` (Faithful), an unknown one is
    // `EntityRow` (Widening — the widest record); payload positions carry the
    // row, not the id (Faithful).
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
    fn classify_reference(&self, entity: &str) -> TypeMappingClass {
        if self.payload {
            return TypeMappingClass::Faithful;
        }
        match self.mode {
            TsTypeMode::Declared => TypeMappingClass::Widening,
            TsTypeMode::Inferred => {
                if self.catalog.is_some_and(|c| c.contains_key(entity)) {
                    TypeMappingClass::Faithful
                } else {
                    // `EntityRow` — the widest record, not the entity's shape.
                    TypeMappingClass::Widening
                }
            }
        }
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
        match self.mode {
            TsTypeMode::Declared => TypeMappingClass::Faithful,
            TsTypeMode::Inferred => TypeMappingClass::Widening,
        }
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
    fn classify_struct_ty(&self, _fields: &[OirField]) -> TypeMappingClass {
        TypeMappingClass::Faithful
    }
}

/// Classify an `OirType` under the TS renderer's faithfulness table
/// (Phase-1 metadata; the classification never alters rendered output).
/// This is the Declared-mode classification the enumeration table cites;
/// `enum_values` is the immediate field's sidecar.
pub fn classify_oir_type(ty: &OirType, enum_values: Option<&[String]>) -> TypeMappingClass {
    classify_type(
        &TsRenderer {
            mode: TsTypeMode::Declared,
            catalog: None,
            payload: false,
        },
        ty,
        enum_values,
    )
}

/// The single canonical `OirType → TypeScript type string` mapper. Both
/// `TypeScriptBackend::map_type_with_enum` (DECLARED) and
/// `CodegenContext::oirtype_to_ts` (INFERRED) are thin wrappers over this —
/// consolidating two formerly-divergent copies whose Inferred side collapsed
/// `Enum → string` and `Struct → EntityRow`, discarding the shape downstream
/// code needs (the dominant TS-codegen root cause, CG-SWEEP-1 Category 3).
/// Delegates to the shared `orbital_core` walker via [`TsRenderer`];
/// `entity_catalog` is consulted only in Inferred mode, to decide whether a
/// `Reference` names a known entity or widens to `EntityRow`.
pub(crate) fn map_type_ts(
    ty: &OirType,
    enum_values: Option<&Vec<String>>,
    entity_catalog: Option<&HashMap<String, OirEntity>>,
    mode: TsTypeMode,
) -> String {
    render_type(
        &TsRenderer {
            mode,
            catalog: entity_catalog,
            payload: false,
        },
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
                mode: TsTypeMode::Declared,
                catalog: None,
                payload: true,
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
            OirType::Struct { fields } => fields
                .iter()
                .any(|f| self.field_type_uses_trait(&f.field_type)),
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
            OirType::Struct { fields } => fields
                .iter()
                .any(|f| self.field_type_uses_orbital(&f.field_type)),
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
            OirType::Struct { fields } => fields
                .iter()
                .any(|f| self.field_type_uses_behavior(&f.field_type)),
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
            OirType::Struct { fields } => fields
                .iter()
                .any(|f| self.field_type_uses_node(&f.field_type)),
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
            OirType::Struct { fields } => {
                for f in fields {
                    Self::collect_named_type_refs(&f.field_type, out);
                }
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
        map_type_ts(oir_type, enum_values, None, TsTypeMode::Declared)
    }
}

#[cfg(test)]
mod array_of_union_tests {
    use super::*;

    fn tagged(tag: &str) -> OirField {
        OirField::new(
            tag,
            OirType::Struct {
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
        let declared = map_type_ts(&ty, None, None, TsTypeMode::Declared);
        assert!(
            declared.starts_with('(') && declared.ends_with(")[]"),
            "{declared}"
        );
        let inferred = map_type_ts(&ty, None, None, TsTypeMode::Inferred);
        assert!(
            inferred.starts_with("readonly (") && inferred.ends_with(")[]"),
            "{inferred}"
        );
    }

    /// Control: a plain element type keeps its bare `T[]`.
    #[test]
    fn an_array_of_a_plain_type_stays_bare() {
        let ty = OirType::Array {
            inner: Box::new(OirType::String),
        };
        assert_eq!(
            map_type_ts(&ty, None, None, TsTypeMode::Declared),
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
            map_type_ts(&ty, None, None, TsTypeMode::Declared),
            "[number, number, number]"
        );
        assert_eq!(
            map_type_ts(&ty, None, None, TsTypeMode::Inferred),
            "readonly [number, number, number]"
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
        for mode in [TsTypeMode::Declared, TsTypeMode::Inferred] {
            assert_eq!(
                map_type_ts(&OirType::row("NoteRevision"), None, None, mode),
                "NoteRevision"
            );
        }
        assert_eq!(
            map_type_ts(
                &OirType::array(OirType::reference("NoteRevision")),
                None,
                None,
                TsTypeMode::Declared
            ),
            "string[]"
        );
        assert_eq!(
            map_type_ts(
                &OirType::array(OirType::row("NoteRevision")),
                None,
                None,
                TsTypeMode::Declared
            ),
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
                Some(&cat),
                TsTypeMode::Declared
            ),
            "Note"
        );
        assert_eq!(
            map_type_ts(
                &OirType::row("Elsewhere"),
                None,
                Some(&cat),
                TsTypeMode::Declared
            ),
            "EntityRow"
        );
    }

    #[test]
    fn row_classification_follows_the_rendering() {
        use orbital_core_base::ir::classify_type;
        let cat = catalog(&["Note"]);
        let r = TsRenderer {
            mode: TsTypeMode::Declared,
            catalog: Some(&cat),
            payload: false,
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

#[cfg(test)]
mod array_element_ts_tests {
    use super::array_element_ts;

    /// G-ORB-242: a `[[number]]` element is `readonly number[]`; wrapped as `readonly {elt}[]` it
    /// must read `readonly (readonly number[])[]`, never `readonly readonly number[][]` (TS1354).
    #[test]
    fn a_readonly_array_element_is_parenthesized() {
        assert_eq!(array_element_ts("readonly number[]"), "(readonly number[])");
        assert_eq!(array_element_ts("readonly [number, number]"), "(readonly [number, number])");
    }

    #[test]
    fn control_a_plain_element_is_left_bare_and_a_union_is_parenthesized() {
        assert_eq!(array_element_ts("CatalogRow"), "CatalogRow");
        assert_eq!(array_element_ts("{ items: readonly string[] }"), "{ items: readonly string[] }");
        assert_eq!(array_element_ts("string | number"), "(string | number)");
    }
}
