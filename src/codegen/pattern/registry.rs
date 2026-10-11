//! `generate_pattern_from_registry` — the render-ui pattern → JSX emitter.
//!
//! Split from the former `pattern.rs` as a pure module breakup.

use orbital_core::ir::OirValue;
use std::collections::HashMap;

use crate::backend::{
    escape_js_string, jsx_text_to_expression, to_title_case, EntityFieldInfo, TypeScriptBackend,
};
use crate::codegen::expr::BindingFlavor;
use crate::pattern_registry::{
    get_component_mapping, get_fields_contract, get_props_schema, PropSchema,
};

/// The entity-**data** element/base TS type from the registry schema — the
/// canonical `EntityRow`, lifted to `EntityWith<{ field: T; … }>` (the
/// STRUCTURAL shape synthesized from the registry's `properties`) when the
/// component declares an entity-row shape. That inline object literal is
/// structurally identical to the component's declared row type (e.g.
/// `EntityWith<CalendarEventRow>`), satisfies the `EntityWith<S extends object>`
/// constraint, and needs no import (the named row type is not exported). Falls
/// back to a required-field-key union, then `EntityRow`, when no `properties`
/// are declared. The SINGLE source for both `entity_data_cast` (the `entity`-key
/// bind) and the non-`entity`-key EntityWith-collection bind below, so the two
/// can't drift.
/// Map a form input type (`oir_type_to_form_type` output) to the display
/// type DetailPanel's typed renderer (`renderRichFieldValue`) switches on.
/// Display fields are read-only, so input-oriented types collapse to their
/// value semantics ("select"/"textarea"/"email" are all just strings whose
/// rendering is driven by `values`/content, not the widget).
fn form_type_to_display_type(form_type: &str) -> &'static str {
    match form_type {
        "date" => "date",
        "datetime-local" => "datetime",
        "url" => "url",
        "relation" => "relation",
        "number" => "number",
        "checkbox" => "boolean",
        "money" => "money",
        "file" => "file",
        _ => "string",
    }
}

/// Serialize a relation field's `{ entity, cardinality? }` descriptor —
/// `DetailRelationMeta`/`RelationConfig` in `@almadar/ui` (cardinality
/// omitted when the field carries no explicit `OirRelation`).
fn format_relation_value(entity: &str, cardinality: Option<&str>) -> String {
    match cardinality {
        Some(c) => format!("{{ entity: \"{}\", cardinality: \"{}\" }}", entity, c),
        None => format!("{{ entity: \"{}\" }}", entity),
    }
}

/// Serialize one bare detail-panel field name into the enriched DISPLAY
/// shape `{ key, type, values?, relation? }` — the compiled twin of the
/// runtime path's `enrichDetailFields` (@almadar/ui UISlotRenderer).
fn format_detail_field(name: &str, info: &EntityFieldInfo) -> String {
    let mut pairs = vec![
        format!("key: \"{}\"", name),
        format!("type: \"{}\"", form_type_to_display_type(&info.form_type)),
    ];
    if let Some(ref values) = info.enum_values {
        let values_str: Vec<String> = values
            .iter()
            .map(|v| format!("\"{}\"", escape_js_string(v)))
            .collect();
        pairs.push(format!("values: [{}]", values_str.join(", ")));
    }
    if let Some(ref rel_entity) = info.relation_entity {
        pairs.push(format!(
            "relation: {}",
            format_relation_value(rel_entity, info.relation_cardinality.as_deref())
        ));
    }
    format!("{{ {} }}", pairs.join(", "))
}

pub(super) fn entity_data_element_ts(prop: Option<&PropSchema>) -> String {
    prop.and_then(|p| {
        p.properties
            .as_ref()
            .filter(|m| !m.is_empty())
            .map(|props| {
                let required = p.required_fields.clone().unwrap_or_default();
                format!(
                    "EntityWith<{}>",
                    TypeScriptBackend::object_type_from_props(props, &required)
                )
            })
    })
    .or_else(|| {
        prop.and_then(|p| p.required_fields.as_ref())
            .filter(|v| !v.is_empty())
            .map(|fields| {
                let keys = fields
                    .iter()
                    .map(|f| format!("'{}'", f))
                    .collect::<Vec<_>>()
                    .join(" | ");
                format!("EntityWith<{}>", keys)
            })
    })
    .unwrap_or_else(|| "EntityRow".to_string())
}

/// Cast target for an entity-**data** prop — `(base, is_record)` where `base`
/// is `entity_data_element_ts` and `is_record` ⇒ a single entity (no array
/// wrap). The single uniform replacement for the old `entity_prop_cast` + the
/// generic-vs-concrete branching. Does NOT apply to `@entity.<structField>`
/// binds — those carry a real struct element type and keep their own narrowing.
fn entity_data_cast(prop: Option<&PropSchema>) -> (String, bool) {
    let base = entity_data_element_ts(prop);
    let is_record = prop.and_then(|p| p.cardinality.as_deref()) == Some("record");
    (base, is_record)
}

/// Which cast `array_coerce_prop` wraps the (array) source in before assigning
/// to a collection entity-data prop. This + `array_coerce_value` are the SINGLE
/// canonical home for the `Array.isArray(x) ? <cast> : []` JSX idiom — every
/// entity-cast (TS2352/TS4104) fix lives here, never re-inlined per call site
/// (Pillar F2; the `array_coerce_single_home` gate enforces it).
pub(super) enum ArrayCast {
    /// `(expr) as readonly ELT[]` — readonly collection (the common case).
    Readonly,
    /// `((expr) as readonly EntityRow[]) as readonly ELT[]` — EntityWith field
    /// narrowing; the `readonly EntityRow[]` intermediate dodges TS2352 (a direct
    /// `EntityRow[] as readonly EntityWith<…>[]` doesn't "sufficiently overlap").
    NarrowedReadonly,
    /// `(expr) as ELT[]` — mutable element type; assignable to BOTH a mutable
    /// (`MapMarkerData[]`, else TS4104) and a readonly array prop.
    Mutable,
    /// `((expr) as EntityRow[]) as ELT[]` — `Mutable`'s twin for a source
    /// whose elements are a UNION of structurally DISJOINT object literals
    /// (`{label,format,id,event}` vs `{label,id,event}` per `Menu.items`-style
    /// item) that doesn't "sufficiently overlap" the destination element
    /// shape for a direct cast (TS2352 — same class `NarrowedReadonly` dodges
    /// for the `EntityWith` case, mutable instead of readonly).
    NarrowedMutable,
    /// A LITERAL array of object literals: bridged through `object[]`, which any object
    /// literal upcasts to and the element shape is assignable to — unlike `EntityRow[]`,
    /// whose `FieldValue` values reject a rendered node.
    LiteralObjects,
}

/// The canonical entity-data array coercion expression:
/// `Array.isArray(expr) ? (<cast>) : []`.
pub(super) fn array_coerce_value(expr: &str, elt: &str, cast: ArrayCast) -> String {
    // `[]` binds TIGHTER than `|` — an enum-element array
    // (`array_prop_element_ts` on `items.enumValues`, e.g. CodeBlock
    // `motions`) resolves `elt` to a bare union (`'left' | 'right' | …`),
    // and every `{b}[]` template below would otherwise read as `'left' |
    // 'right' | … | ('…'[])` (only the LAST member an array, every other
    // member a bare string literal) — TS2322 against the component's real
    // `readonly (…)[]` prop. Parenthesize once here, the one place every
    // cast variant appends `[]` to `elt`.
    let elt = if elt.contains(" | ") {
        format!("({})", elt)
    } else {
        elt.to_string()
    };
    let elt = elt.as_str();
    let inner = match cast {
        ArrayCast::Readonly => format!("({e}) as readonly {b}[]", e = expr, b = elt),
        ArrayCast::NarrowedReadonly => {
            format!(
                "(({e}) as readonly EntityRow[]) as readonly {b}[]",
                e = expr,
                b = elt
            )
        }
        ArrayCast::Mutable => format!("({e}) as {b}[]", e = expr, b = elt),
        ArrayCast::NarrowedMutable => {
            format!("(({e}) as EntityRow[]) as {b}[]", e = expr, b = elt)
        }
        ArrayCast::LiteralObjects => format!("(({e}) as object[]) as {b}[]", e = expr, b = elt),
    };
    format!(
        "Array.isArray({e}) ? ({inner}) : []",
        e = expr,
        inner = inner
    )
}

/// Emit `{key}={{<array-coerce>}}` for a collection entity-data prop.
pub(super) fn array_coerce_prop(key: &str, expr: &str, elt: &str, cast: ArrayCast) -> String {
    format!(
        "{k}={{{v}}}",
        k = key,
        v = array_coerce_value(expr, elt, cast)
    )
}

/// Emit the `entity={…}` JSX for an entity-data bind. Record props take the
/// single element (unwrapping an array source via `[0]`); collections route
/// through `array_coerce_prop` (EntityWith bases use the narrowed double cast).
fn emit_entity_data_prop(expr: &str, base: &str, is_record: bool) -> String {
    if is_record {
        format!(
            "entity={{((Array.isArray({e}) ? {e}[0] : {e}) as {b})}}",
            e = expr,
            b = base
        )
    } else {
        let cast = if base.starts_with("EntityWith") {
            ArrayCast::NarrowedReadonly
        } else {
            ArrayCast::Readonly
        };
        array_coerce_prop("entity", expr, base, cast)
    }
}

/// A lambda's parameter names from what sits between `"fn"` and its body: the
/// flat run (`["fn", "a", "b", body]`) or the grouped list (`["fn", ["a", "b"], body]`).
/// Empty when either holds a non-name.
fn lambda_params(between: &[OirValue]) -> Vec<String> {
    let names: &[OirValue] = match between {
        [OirValue::Array(grouped)] => grouped,
        flat => flat,
    };
    names
        .iter()
        .map(|v| match v {
            OirValue::String(s) => Some(s.clone()),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()
        .unwrap_or_default()
}

impl TypeScriptBackend {
    /// Which field inside an array prop's descriptor objects carries a bus
    /// event — the pattern's own `kind: "event-list"` / `eventField`
    /// declaration, and nothing else. A prop that carries events without
    /// declaring it is a registry gap to close where patterns are declared,
    /// not to infer from the prop's name here.
    fn event_descriptor_field(pattern_type: &str, key: &str) -> Option<&'static str> {
        orbital_core::language::pattern_props::PATTERN_EVENT_LIST_PROPS
            .get(pattern_type)
            .and_then(|m| m.get(key))
            .copied()
    }

    /// JSX attr for an array-shaped prop whose value is a `@`-binding (§62).
    ///
    /// The `actions` / `itemActions` / `fieldNames` / `fields` arms in
    /// `generate_pattern_from_registry` compile each element at codegen time
    /// and destructure `OirValue::Array` with no other branch, so a forward
    /// like `fields: @config.fields` reached them and vanished with no
    /// diagnostic — a populated list rendered blank. A binding has no elements
    /// to compile, so the value travels whole and the per-element work those
    /// arms do is reproduced in the emitted expression:
    ///
    /// * `fieldNames` lands on `fields=` for hosts declaring no `fieldNames`
    ///   prop, exactly as the literal arm remaps it;
    /// * event descriptors are scope-qualified, because the literal path
    ///   qualifies them and an unqualified key reaches no listener.
    ///
    /// `None` when the value is not a binding (the arm's literal path owns it)
    /// or the host declares no such prop — the unknown-prop rule the default
    /// arm applies.
    fn bound_array_prop(&self, pattern_type: &str, key: &str, value: &OirValue) -> Option<String> {
        let OirValue::String(binding) = value else {
            return None;
        };
        if !binding.starts_with('@') {
            return None;
        }
        let props_schema = get_props_schema(pattern_type);
        let target =
            if key == "fieldNames" && !props_schema.is_some_and(|s| s.contains_key("fieldNames")) {
                "fields"
            } else {
                key
            };
        if props_schema.is_some_and(|s| !s.contains_key(target)) {
            return None;
        }
        let elt = Self::array_prop_element_ts(props_schema.and_then(|s| s.get(target)));
        let expr = self.binding_string_to_ts(binding);
        let coerced = array_coerce_value(&expr, &elt, ArrayCast::Readonly);
        let qualified = Self::event_descriptor_field(pattern_type, target)
            .zip(self.current_trait_scope.snapshot());
        Some(match qualified {
            Some((field, scope)) => format!(
                "{target}={{({coerced}).map((__a) => ({{ ...__a, {field}: '{scope}.' + __a.{field} }}))}}"
            ),
            None => format!("{target}={{{coerced}}}"),
        })
    }

    /// Is `key` on this pattern declared as an ARRAY-shaped prop
    /// (`propsSchema[key].types` contains `"array"`)? The gate the `"actions"`
    /// match arm keys on instead of the prop's NAME — most `actions` props
    /// really are `RecordAction[]` lists, but `alert.actions` (React prop
    /// `actions?: React.ReactNode`) declares `types: ["node"]`, and casting a
    /// node-typed forward `as readonly EntityRow[]` is a type error the
    /// pattern's own registry data already predicts. Defaults to `true` when
    /// the pattern declares no schema (or no entry for `key`) at all — the
    /// prior behavior for a pattern this registry can't inform.
    fn prop_declares_array_type(
        props_schema: Option<&'static HashMap<String, PropSchema>>,
        key: &str,
    ) -> bool {
        props_schema
            .and_then(|s| s.get(key))
            .map(|p| p.types.iter().any(|t| t == "array"))
            .unwrap_or(true)
    }

    /// A config value whose compiled expression can never evaluate to
    /// null/undefined: a Bool/Number literal, a plain String literal (bindings
    /// spell `@…`/`?…` and compile to optional chains), or an `if` sexpr whose
    /// BOTH arms are themselves statically non-nullish — the emitted ternary's
    /// condition may contain `?.`, but the result is always one of the arms.
    fn value_statically_non_nullish(value: &OirValue) -> bool {
        match value {
            OirValue::Bool(_) | OirValue::Number(_) => true,
            OirValue::String(s) => !s.starts_with('@') && !s.starts_with('?'),
            OirValue::Array(items) => matches!(
                items.as_slice(),
                [OirValue::String(op), _, then_arm, else_arm]
                    if op == "if"
                        && Self::value_statically_non_nullish(then_arm)
                        && Self::value_statically_non_nullish(else_arm)
            ),
            _ => false,
        }
    }

    /// FC-5: emit a dynamic `children: (array/map <coll> (fn item <node>))` as
    /// a React `.map()` over the collection producing the per-item node JSX.
    /// Mirrors the `renderItem` lambda codegen — the collection expression is
    /// resolved through the same binding/operator path as any prop, and the
    /// lambda param(s) are emitted bare so TS infers the element type from the
    /// mapped source (`@item.<field>` compiles to `item?.<field>`). Returns the
    /// `{(coll ?? []).map(...)}` JSX expression, or `None` when `value` is not a
    /// mapped-children tuple (the shared shape from
    /// `orbital_core::schema::SExpression::as_mapped_children`, matched here on
    /// the OIR `OirValue` mirror).
    fn try_mapped_children_jsx(
        &self,
        value: &OirValue,
        linked_entity: Option<&str>,
        entity_field_types: Option<&HashMap<String, EntityFieldInfo>>,
    ) -> Option<String> {
        let OirValue::Array(arr) = value else {
            return None;
        };
        if arr.len() != 3 || !matches!(arr.first(), Some(OirValue::String(s)) if s == "array/map") {
            return None;
        }
        let OirValue::Array(lambda) = &arr[2] else {
            return None;
        };
        if lambda.len() < 3
            || !matches!(lambda.first(), Some(OirValue::String(s)) if s == "fn" || s == "lambda")
        {
            return None;
        }
        let params = lambda_params(&lambda[1..lambda.len() - 1]);
        if params.is_empty() {
            return None;
        }
        let body = lambda.last()?;
        let mut params = params;
        if params.len() == 1 && Self::reads_binding_root(body, "index") {
            params.push("index".to_string());
        }
        let body_jsx =
            jsx_text_to_expression(self.child_to_jsx(body, linked_entity, entity_field_types));
        let coll = self.value_to_jsx_literal(&arr[1]);
        // A literal-array source (config-resolved `[]`/`[…]`) is never nullish
        // — TS 5.9 flags the guard itself as unreachable (TS2869), so only
        // guard opaque sources (same rule as operator.rs `array/map`).
        // `body_jsx` is one `generate_pattern_from_registry` call's result —
        // already a complete expression, so no extra Fragment wrap (see that
        // function's doc comment).
        // A call the registry does not declare as returning an array (`object/get`'s
        // field value) is the wide `EventPayloadValue`: cast it to an array.
        let non_array_call = matches!(&arr[1], OirValue::Array(call)
            if matches!(call.first(), Some(OirValue::String(head))
                if orbital_core::language::registry::is_known_operator(head) && !crate::codegen::infer::operator_returns_array(head)));
        let literal_array = matches!(&arr[1], OirValue::Array(items)
            if !matches!(items.first(), Some(OirValue::String(head)) if orbital_core::language::registry::is_known_operator(head)));
        if literal_array {
            Some(format!(
                "{{({}).map(({}) => ({}))}}",
                coll,
                params.join(", "),
                body_jsx
            ))
        } else if non_array_call {
            Some(format!(
                "{{(({} as readonly EventPayloadValue[] | undefined) ?? []).map(({}) => ({}))}}",
                coll,
                params.join(", "),
                body_jsx
            ))
        } else {
            Some(format!(
                "{{({} ?? []).map(({}) => ({}))}}",
                coll,
                params.join(", "),
                body_jsx
            ))
        }
    }

    /// Whether `value` reads the `@<root>` binding anywhere — the callback
    /// binds `@index` implicitly (`apply_callback` in both evaluators).
    fn reads_binding_root(value: &OirValue, root: &str) -> bool {
        match value {
            OirValue::String(s) => s
                .strip_prefix('@')
                .is_some_and(|b| b == root || b.starts_with(&format!("{root}."))),
            OirValue::Array(items) => items.iter().any(|v| Self::reads_binding_root(v, root)),
            OirValue::Object(map) => map.values().any(|v| Self::reads_binding_root(v, root)),
            _ => false,
        }
    }

    /// Whether an `if`-arm value is a bare literal — String (non-`@`),
    /// Null, Bool, or Number — eligible for `literal_prop_expr`. An Array
    /// or Object arm (nested composition) is NOT literal and falls through
    /// to the general sexpr-ternary compiler unchanged.
    fn is_literal_if_arm(value: &OirValue) -> bool {
        matches!(
            value,
            OirValue::Null | OirValue::Bool(_) | OirValue::Number(_)
        ) || matches!(value, OirValue::String(s) if !s.starts_with('@'))
    }

    /// Compile ONE literal `if`-arm value (String/Null/Bool/Number — never a
    /// binding, array, or object) to the JSX prop RHS EXPRESSION under
    /// `prop_schema_entry`'s declared kind. THE single owner for the
    /// callback wrap (registry `kind: "callback"` / `types: ["function"]`)
    /// so a literal reached directly (the plain-string default-prop arm)
    /// or through an `if` (`literal_if_prop_expr`) wraps identically.
    /// `None` means "no value for this prop": a function-typed prop's
    /// empty-string outlet-OFF encoding, or a bare `null` literal — the
    /// caller substitutes `undefined` in a dynamic ternary, or omits the
    /// prop entirely when a literal condition folds onto this arm.
    ///
    /// §83: a prop can declare BOTH `"function"` and `"string"` in `types`
    /// (`onChange`/`onClear` on `Input`/`InputGroup`/`Textarea`/`Select`/
    /// `Checkbox`) — a JS callback OR a bare declarative event name, same
    /// dual contract `action` has always had. `kind: "event-ref"` is the
    /// registry's signal for "prefer the string form": the component itself
    /// (`@almadar/ui`'s `Input.tsx`) detects a string `onChange` at runtime
    /// and emits `{value}`/`{checked}` to the bus itself (with echo
    /// cancellation so a lagging round trip never eats a keystroke) — the
    /// same contract `@almadar/runtime` gets for free by evaluating the
    /// bare event-name literal straight through. Wrapping it in a closure
    /// instead (the old unconditional `is_function` branch) silently drops
    /// whatever value the DOM event carried, since `dispatch(event)` alone
    /// carries no payload — the compiled path's controlled input never
    /// advances past its initial value. Qualify the same way `action`
    /// already does (`self.qualify_event`), since `Input.tsx`'s own
    /// `eventBus.emit('UI:' + onChange, …)` needs the full
    /// `Orbital.Trait.EVENT` key to reach the owning trait's listener.
    fn literal_prop_expr(
        &self,
        prop_schema_entry: Option<&PropSchema>,
        value: &OirValue,
    ) -> Option<String> {
        match value {
            OirValue::Null => None,
            OirValue::Bool(b) => Some(b.to_string()),
            OirValue::Number(n) => Some(n.to_string()),
            OirValue::String(s) => {
                let is_event_ref =
                    prop_schema_entry.and_then(|p| p.kind.as_deref()) == Some("event-ref");
                let is_function = !is_event_ref
                    && prop_schema_entry
                        .map(|p| p.types.iter().any(|t| t == "function"))
                        .unwrap_or(false);
                if is_event_ref {
                    let qualified = self.qualify_event(s);
                    Some(format!("\"{}\"", escape_js_string(&qualified)))
                } else if is_function {
                    // Empty string is the outlet-OFF encoding — no handler.
                    if s.is_empty() {
                        return None;
                    }
                    let callback_args = prop_schema_entry
                        .and_then(|p| p.callback_args.as_ref())
                        .filter(|args| !args.is_empty());
                    Some(match callback_args {
                        Some(args) => {
                            let names: Vec<String> = args.iter().map(|a| a.name.clone()).collect();
                            // A rich arg (a program, a node) crosses into the payload as its JSON form.
                            let fields: Vec<String> = args
                                .iter()
                                .map(|a| {
                                    if matches!(a.arg_type.as_str(), "sexpr" | "object") {
                                        let mut imports = self.view_value_imports.take();
                                        imports.insert(("@almadar/core".to_string(), "toPayloadValue".to_string()));
                                        self.view_value_imports.set(imports);
                                        format!("{0}: toPayloadValue({0})", a.name)
                                    } else {
                                        a.name.clone()
                                    }
                                })
                                .collect();
                            format!(
                                "({}) => dispatch('{}', {{ {} }})",
                                names.join(", "),
                                s,
                                fields.join(", ")
                            )
                        }
                        None => format!("() => dispatch('{}')", s),
                    })
                } else {
                    Some(format!("\"{}\"", escape_js_string(s)))
                }
            }
            _ => None,
        }
    }

    /// Compile a `["if", cond, then, else]` render-ui PROP value (both arms
    /// literal — see `is_literal_if_arm`) to the JSX prop attribute, or
    /// `None` when it isn't this shape / `cond` doesn't resolve (caller
    /// falls back to the general sexpr-ternary compiler unchanged). A
    /// literal-`bool` `cond` (config already resolved, e.g. `(if
    /// @config.allowEdit EDIT_CONTENT null)` → `["if", true, ...]`) folds at
    /// compile time — a literal-false outlet must not render a dead
    /// handler — otherwise `cond` compiles through the same
    /// `resolve_sexpr_standalone` + `expr_to_ts_flavored` pipeline
    /// `child_to_jsx`/`actions_value_to_jsx_array` use, with either literal
    /// arm's "no value" substituted as `undefined` (never `null` — event-ref
    /// props like `EventEmit<P>` and callback props reject `null`).
    fn literal_if_prop_expr(
        &self,
        key: &str,
        prop_schema_entry: Option<&PropSchema>,
        cond: &OirValue,
        then_arm: &OirValue,
        else_arm: &OirValue,
    ) -> Option<String> {
        if !Self::is_literal_if_arm(then_arm) || !Self::is_literal_if_arm(else_arm) {
            return None;
        }
        let then_expr = self.literal_prop_expr(prop_schema_entry, then_arm);
        let else_expr = self.literal_prop_expr(prop_schema_entry, else_arm);
        if let OirValue::Bool(cond_lit) = cond {
            let taken = if *cond_lit { then_expr } else { else_expr };
            return Some(match taken {
                Some(t) => format!("{}={{{}}}", key, t),
                None => String::new(),
            });
        }
        let cond_sexpr = Self::oirvalue_to_sexpr(cond);
        let cond_oir =
            orbital_core::lower::lower_sexpr(&cond_sexpr).ok()?;
        let cond_ts = self.expr_to_ts_flavored(&cond_oir, BindingFlavor::Render);
        let then_e = then_expr.unwrap_or_else(|| "undefined".to_string());
        let else_e = else_expr.unwrap_or_else(|| "undefined".to_string());
        Some(format!(
            "{}={{({}) ? {} : {}}}",
            key, cond_ts, then_e, else_e
        ))
    }

    /// Compile ONE `children` array entry to JSX — the single owner every
    /// child-position arm recurses through, so a nested `if`/object/binding
    /// child renders through the exact same machinery as a top-level one.
    /// Handles the 4-element `["if", cond, then, else]` shape (`.lolo`
    /// `(if cond <node> else-node)` inside a render tree) by compiling the
    /// condition through the same `resolve_sexpr_standalone` +
    /// `expr_to_ts_flavored` pipeline `actions_value_to_jsx_array` uses for
    /// prop-level conditionals, and recursing each arm through this function.
    /// An arm whose compiled form is a JSX EXPRESSION CONTAINER (starts with
    /// `{`, e.g. a nested `if` or the `array/map` producer) is not a valid
    /// bare expression inside the ternary's `(...)` — route it through
    /// `jsx_text_to_expression` the same way the portal-branch emitters do.
    fn child_to_jsx(
        &self,
        child: &OirValue,
        linked_entity: Option<&str>,
        entity_field_types: Option<&HashMap<String, EntityFieldInfo>>,
    ) -> String {
        if let Some(mapped) = self.try_mapped_children_jsx(child, linked_entity, entity_field_types)
        {
            return mapped;
        }
        match child {
            OirValue::Null => "null".to_string(),
            OirValue::Array(arr) => {
                if let [OirValue::String(op), cond, then_arm, else_arm] = arr.as_slice() {
                    if op == "if" && crate::codegen::is_operator_name(op) {
                        let cond_sexpr = Self::oirvalue_to_sexpr(cond);
                        if let Ok(cond_oir) =
                            orbital_core::lower::lower_sexpr(&cond_sexpr)
                        {
                            let cond_ts =
                                self.expr_to_ts_flavored(&cond_oir, BindingFlavor::Render);
                            let then_jsx = jsx_text_to_expression(self.child_to_jsx(
                                then_arm,
                                linked_entity,
                                entity_field_types,
                            ));
                            let else_jsx = jsx_text_to_expression(self.child_to_jsx(
                                else_arm,
                                linked_entity,
                                entity_field_types,
                            ));
                            return format!("{{({}) ? ({}) : ({})}}", cond_ts, then_jsx, else_jsx);
                        }
                    }
                }
                "null /* invalid child */".to_string()
            }
            OirValue::Object(child_obj) => {
                if let Some(OirValue::String(child_type)) = child_obj.get("type") {
                    let child_config: HashMap<String, OirValue> = child_obj
                        .iter()
                        .filter(|(k, _)| *k != "type")
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect();
                    self.generate_pattern_from_registry(
                        child_type,
                        &child_config,
                        linked_entity,
                        entity_field_types,
                    )
                } else {
                    "null /* missing type in child */".to_string()
                }
            }
            OirValue::String(s) => {
                // `@trait.X` binding → direct view-component reference. The
                // companion import is picked up by
                // `collect_nested_pattern_imports` so the generated file has
                // `import { XView } from '@/components/traits/XView'` in its
                // header.
                if let Some(trait_name) = self.parse_trait_binding(s) {
                    self.trait_embed_jsx(&trait_name)
                } else {
                    format!("null /* non-binding string child: {:?} */", s)
                }
            }
            _ => "null /* invalid child */".to_string(),
        }
    }

    /// Renders ONE `{type, ...config}` pattern descriptor to a JSX
    /// expression. The result is always a complete, self-contained
    /// expression usable bare wherever a single child/prop value is
    /// expected — normally exactly one `<Component .../>` tag (the final
    /// `children.is_empty()` branch below), and for the one pattern that can
    /// itself expand to several siblings (`stats` → multiple `<StatCard/>`),
    /// this function does the Fragment-wrapping internally (only when
    /// `stat_cards.len() > 1`) before returning. Callers must NEVER wrap a
    /// single call's result in an extra `<>…</>` — the caller cannot tell
    /// whether the string already needs one, and double-wrapping a single
    /// element unconditionally is exactly the class of bug that produced
    /// `<Menu trigger={<><Button .../></>} />`: `Menu.cloneElement(trigger,
    /// {ref, onClick})` cannot attach a ref to a `React.Fragment`. Only wrap
    /// when COMBINING more than one independently-generated JSX string into
    /// one expression (see the `stats` branch's own `len() == 1` guard for
    /// the pattern to copy).
    pub fn generate_pattern_from_registry(
        &self,
        pattern_type: &str,
        config: &HashMap<String, OirValue>,
        linked_entity: Option<&str>,
        entity_field_types: Option<&HashMap<String, EntityFieldInfo>>,
    ) -> String {
        // Handle "clear" pattern — used to dismiss a UI slot, not a renderable
        // component. Return the bare expression `null` (not `{null}`) so the
        // ternary builder at backend.rs:2245+ can wrap it as `(null)`. JSX-text
        // positions (single-entry inner_jsx, fallback_jsx with no other_entries)
        // wrap with `{}` themselves at the call site — see `wrap_null_for_jsx_text`.
        if pattern_type == "clear" {
            return "null".to_string();
        }
        let root_extra_props = self.pending_root_props.take();

        // Get component mapping from core registry or project extra mappings.
        // Both paths share the same codegen below.
        let (component, category) = if let Some(m) = get_component_mapping(pattern_type) {
            (m.component.clone(), m.category.clone())
        } else if let Some(m) = self
            .extra_mappings
            .as_ref()
            .and_then(|e| e.get(pattern_type))
        {
            (m.component.clone(), m.category.clone())
        } else {
            return format!("null /* Unknown pattern: {} */", pattern_type);
        };

        // Build props based on category and config
        let mut props = Vec::new();
        let mut children = String::new();
        let mut entity_handled = false;
        // Tracks whether the `entity` prop is bound to `@entity.<field>`
        // (a struct array on the linked entity). When true the renderItem
        // param type must match the entity-prop cast — emitting the
        // linked-entity name there would re-trip TS2322 ("EntityRow[] not
        // assignable to LinkedEntity[]").
        let mut entity_is_field_binding = false;
        // When the field's element type is a strict struct (`OirType::Struct`
        // surfaced via EntityFieldInfo.element_ts_type), use that as the
        // renderItem param annotation so accesses like `card?.variant` keep
        // their literal-union typing instead of widening to `FieldValue`.
        let mut entity_field_binding_element_type: Option<String> = None;
        // Lambda-param entity binding (`@col.items` inside a renderItem lambda)
        // — emit the entity prop without a forced cast and let TS infer the
        // row type from the source. The renderItem callback param also drops
        // its annotation so the inferred type flows through.
        let mut entity_is_lambda_param_binding = false;

        // Look up props schema for this pattern type to determine correct JSX generation
        let props_schema = get_props_schema(pattern_type);

        // When config has both "entity" (string name) and "data" (binding like @entity),
        // skip pre-loop entity handling — the data binding takes priority and will be
        // remapped to "entity" in the loop
        let has_data_binding = config
            .get("data")
            .is_some_and(|v| matches!(v, OirValue::String(s) if s.starts_with('@')));

        // Some patterns (e.g. FilterGroup) declare `entity: string` — the
        // entity NAME, not its data. The default entity-prop handling below
        // assumes a data binding and casts to `ReadonlyArray<Row>`, which
        // breaks when the consumer wants a literal string. Detect this
        // shape from the props schema and pass the entity through verbatim.
        let entity_prop_is_string = props_schema
            .as_ref()
            .and_then(|s| s.get("entity"))
            .map(|p| {
                p.types.iter().any(|t| t == "string")
                    && !p.types.iter().any(|t| t == "array" || t == "object")
            })
            .unwrap_or(false);

        // Patterns where `entity` accepts a record or a record-array literal
        // (e.g. `EntityDisplayProps<T>`: `entity?: T | readonly T[]`, plus
        // the template patterns). The default
        // name-or-binding path below (`value_to_string` → `data['<key>']`)
        // mis-treats inlined array literals as entity names. Detect either
        // accepted shape up-front and emit via the JSX-expression path so
        // arrays/objects render as inline literals and `@`-bindings render
        // as expressions.
        let entity_prop_is_object = props_schema
            .as_ref()
            .and_then(|s| s.get("entity"))
            .map(|p| p.types.iter().any(|t| t == "object") || p.types.iter().any(|t| t == "array"))
            .unwrap_or(false);

        // The single uniform entity-data cast target for this pattern, keyed
        // off the registry schema (cardinality + requiredFields). Used by every
        // entity-DATA bind below; the `@entity.<structField>` element-type path
        // is the one exception (it keeps its own struct narrowing).
        let (entity_base, entity_is_record) =
            entity_data_cast(props_schema.as_ref().and_then(|s| s.get("entity")));

        // Only bind `entity` when the component actually DECLARES an `entity`
        // prop. Config-only components (e.g. ContentRenderer, which `extends
        // DisplayStateProps` — no `entity` field) would otherwise get an excess
        // `entity={…}` prop (TS2322). When the schema is unknown (None), keep
        // the old behavior and emit.
        let component_declares_entity = props_schema
            .as_ref()
            .map(|s| s.contains_key("entity"))
            .unwrap_or(true);

        // Handle entity prop for ALL categories (display, form, game, template, etc.)
        if let Some(entity_val) = config
            .get("entity")
            .filter(|_| !has_data_binding && component_declares_entity)
        {
            if entity_prop_is_object {
                match entity_val {
                    OirValue::String(s) if s.starts_with('@') => {
                        // Binding ($entity.X / @payload.row / etc.) — render
                        // as a TS expression. The pattern accepts an object
                        // or array; binding had better resolve to one.
                        let expr = self.binding_string_to_ts(s);
                        // For `@entity.<field>` bindings against an array
                        // field (lolo `cards : [StatCard]`), thread the
                        // element type through so:
                        //   (a) the entity prop is cast to
                        //       `readonly StatCard[]` (otherwise TS rejects
                        //       the wide `FieldValue[]`-typed source against
                        //       the prop's `T | readonly T[]` destination)
                        //   (b) the renderItem lambda's param annotation
                        //       (downstream in the children handler) reads
                        //       `entity_field_binding_element_type` and
                        //       narrows `(card: StatCard) => …` instead of
                        //       falling back to the linked-entity name
                        //       (`(card: StatsItem) => …`), which lacks the
                        //       card-specific fields and trips TS2339 on
                        //       every `card.label`/`card.value` read.
                        let elt_for_field = if s.starts_with("@entity.") {
                            let field = s
                                .trim_start_matches("@entity.")
                                .split('.')
                                .next()
                                .unwrap_or("");
                            entity_field_types
                                .and_then(|m| m.get(field))
                                .and_then(|info| info.element_ts_type.clone())
                        } else {
                            None
                        };
                        if s.starts_with("@config.") {
                            // A `@config.X` entity binding is a typed config
                            // value — a rich state object the app supplies (e.g.
                            // a game board's `BattleEntity`), NOT entity-collection
                            // data. Bind it directly, typed as the config field,
                            // instead of array-coercing to `EntityRow[]` (which
                            // never matches a single rich-object prop).
                            props.push(format!("entity={{{}}}", expr));
                        } else if let Some(elt) = elt_for_field {
                            entity_is_field_binding = true;
                            entity_field_binding_element_type = Some(elt.clone());
                            // Guard with `Array.isArray` so a single/optional
                            // entity field (`@entity.X.y` resolving to `E |
                            // undefined`, not an array) doesn't trip TS2352 on a
                            // direct `as readonly elt[]` cast. Arrays cast through;
                            // non-arrays fall back to `[]`.
                            props.push(array_coerce_prop(
                                "entity",
                                &expr,
                                &elt,
                                ArrayCast::Readonly,
                            ));
                        } else if s.starts_with("@payload.") {
                            // `@payload.X` resolves to
                            // `EventPayloadValue | undefined`. Cast to
                            // `readonly EntityRow[]` and mark this as
                            // a lambda-param-style binding so the
                            // downstream renderItem children handler
                            // emits `(item) => …` (no type annotation)
                            // instead of `(item: <LinkedEntity>) → …`.
                            // TS then infers T contextually from the
                            // entity prop, picking EntityRow — a unified
                            // type both source and consumer agree on.
                            // Without this, the lambda annotation would
                            // force T = LinkedEntity on the JSX site,
                            // and the wider `EntityRow[]` source would
                            // fail to assign to `readonly LinkedEntity[]`.
                            // Narrow via `Array.isArray` first so
                            // primitive EventPayloadValue branches
                            // don't sneak through.
                            entity_is_lambda_param_binding = true;
                            // Cast to the prop's declared shape (EntityRow /
                            // EntityWith<…>, record vs collection) from the
                            // registry — NOT the linked entity (which ↛ EntityRow
                            // structurally, the old TS2322 source).
                            props.push(emit_entity_data_prop(
                                &expr,
                                &entity_base,
                                entity_is_record,
                            ));
                        } else {
                            // Lambda-param.field bindings (`@col.items`
                            // inside a nested renderItem) and any other
                            // residual @-binding shape. The lambda param
                            // is typed against the parent iteration's
                            // element struct (`BoardColumn`), so its
                            // `.items` field carries the struct's array
                            // type (`BoardItem[]`). The consumer pattern's
                            // entity prop is `T | readonly T[]` with T
                            // defaulting to either the trait's linked
                            // entity OR EntityRow — neither overlaps with
                            // the struct-array type structurally. Cast
                            // to `readonly EntityRow[]` (the widest type
                            // every typed entity row structurally
                            // satisfies) so the assignment compiles
                            // without sacrificing safety: BoardItem,
                            // StatCard, etc. all satisfy EntityRow's
                            // `{id?: string} & Record<string, FieldValue
                            // | undefined>` shape.
                            entity_is_lambda_param_binding = true;
                            props.push(emit_entity_data_prop(
                                &expr,
                                &entity_base,
                                entity_is_record,
                            ));
                        }
                        entity_handled = true;
                    }
                    OirValue::Object(_) | OirValue::Array(_) => {
                        let lit = self.value_to_jsx_literal(entity_val);
                        props.push(format!("entity={{{}}}", lit));
                        entity_handled = true;
                    }
                    _ => {
                        // Unknown shape — fall through to the default path.
                    }
                }
            }
            if !entity_handled && entity_prop_is_string {
                // Pattern wants the entity name as a string. Pass through
                // bare-identifier configs (`entity: "FilterTarget"`) directly;
                // skip @entity / @binding shapes (only the data-array forms
                // make sense on a string-typed prop).
                if let OirValue::String(s) = entity_val {
                    if !s.starts_with('@') {
                        props.push(format!("entity=\"{}\"", s));
                        entity_handled = true;
                    } else if s == "@entity" {
                        if let Some(linked) = linked_entity {
                            props.push(format!("entity=\"{}\"", linked));
                            entity_handled = true;
                        }
                    }
                }
            }
            if !entity_handled {
                // Three incoming shapes:
                //   1. Bare identifier string (e.g. "CartItem"): entity-type name — map to data[].
                //   2. `@entity` alone: shorthand for the trait's linked entity name — same as (1)
                //      with the linked-entity name substituted.
                //   3. Any other binding (`@payload.data`, `@config.items`, etc.): a runtime
                //      expression that already resolves to the collection. Emit it directly; do NOT
                //      use it as a map key or a type name (would produce `data['lastPayload?.data']`
                //      and `as lastPayload?.data[]` — both invalid).
                match entity_val {
                    OirValue::String(s) if s.starts_with('@') && s != "@entity" => {
                        // (3) Runtime binding expression.
                        //
                        // For `@entity.<field>` bindings, when the field is an
                        // array of struct (lolo `[StatCard]`), thread the struct
                        // shape through to the entity-prop cast AND remember it
                        // for the renderItem param annotation. That way both
                        // sides of `<DataList entity={...}>{(card) => ...}</...>`
                        // see the same narrow type — `EntityRow` would lose the
                        // struct's literal-union variants and trip the consumer
                        // pattern (StatDisplay's `variant: 'success' | ...`).
                        // For `@payload.X` bindings keep the linked-entity cast —
                        // payloads of list events are declared as the entity row.
                        // Lambda-param bindings (`@col.items` inside a nested
                        // renderItem lambda) carry a real struct type from the
                        // parent's resolved entity field — emit the binding
                        // without a forced cast and let TS infer the row type
                        // from the source. Force-casting to `linked_entity`
                        // would mis-type because the parent's struct field type
                        // is narrower than the trait's linked entity (which has
                        // extra required fields the inner struct doesn't carry).
                        let expr = self.binding_string_to_ts(s);
                        let is_known_scope = s.starts_with("@entity.")
                            || s.starts_with("@payload.")
                            || s.starts_with("@state.")
                            || s.starts_with("@config.")
                            || s.starts_with("@_item.");
                        let is_lambda_param =
                            s.starts_with('@') && s.contains('.') && !is_known_scope;
                        if s.starts_with("@config.") {
                            // A `@config.X` entity binding is a typed config value —
                            // a rich state object the app supplies (e.g. a game
                            // board's `BattleEntity`), NOT entity-collection data.
                            // Emit it directly, typed as the config field, instead
                            // of array-coercing to `EntityRow[]` (which never matches
                            // a single rich object prop).
                            props.push(format!("entity={{{}}}", expr));
                        } else if is_lambda_param {
                            entity_is_lambda_param_binding = true;
                            props.push(format!("entity={{{}}}", expr));
                        } else if let Some(struct_elt) =
                            s.strip_prefix("@entity.").and_then(|rest| {
                                let field = rest.split('.').next().unwrap_or("");
                                entity_field_types
                                    .and_then(|m| m.get(field))
                                    .and_then(|info| info.element_ts_type.clone())
                            })
                        {
                            // `@entity.<structField>` over a declared struct array
                            // (lolo `cards : [StatCard]`): keep the struct element
                            // type so the renderItem param narrows to it (literal
                            // unions survive). Not entity-DATA — its own path.
                            entity_is_field_binding = true;
                            entity_field_binding_element_type = Some(struct_elt.clone());
                            let row_ref =
                                crate::codegen::handler_header::entity_type_ref(&struct_elt);
                            props.push(array_coerce_prop(
                                "entity",
                                &expr,
                                &row_ref,
                                ArrayCast::Readonly,
                            ));
                        } else {
                            // `@payload.*`, bare `@entity`, linked-entity, or an
                            // `@entity.<scalarField>` — entity-DATA. Cast to the
                            // prop's declared shape (EntityRow / EntityWith<…>,
                            // record vs collection) from the registry.
                            props.push(emit_entity_data_prop(
                                &expr,
                                &entity_base,
                                entity_is_record,
                            ));
                        }
                    }
                    _ => {
                        // (1) or (2) — entity-name lookup path.
                        let entity = match entity_val {
                            OirValue::String(s) if s == "@entity" => {
                                linked_entity.unwrap_or("entity").to_string()
                            }
                            _ => self.value_to_string(entity_val),
                        };
                        let entity_matches_linked = linked_entity.is_some_and(|l| l == entity);
                        let src = if entity_matches_linked {
                            "entity".to_string()
                        } else {
                            format!("(data['{}'] ?? [])", entity)
                        };
                        props.push(emit_entity_data_prop(&src, &entity_base, entity_is_record));
                    }
                }
                entity_handled = true;
            }
        }

        // Process each config key
        for (key, value) in config {
            // Skip already handled or meta keys
            // Only skip entity if it was already handled by category-specific code above
            if key == "type" || (key == "entity" && entity_handled) {
                continue;
            }
            // Skip "mode" when "entityId" is present — entityId handler sets mode="edit"
            if key == "mode" && config.contains_key("entityId") {
                continue;
            }

            // Migrate: schema configs with "data" key but pattern propsSchema has no "data" prop
            // Remap to "entity" since components now use entity prop for data binding
            // If entity was already handled, skip redundant data key entirely
            if key == "data" && entity_handled {
                continue;
            }
            let key: &str = if key == "data" {
                let has_data_prop = props_schema
                    .as_ref()
                    .map(|s| s.contains_key("data"))
                    .unwrap_or(false);
                if !has_data_prop {
                    entity_handled = true;
                    "entity"
                } else {
                    "data"
                }
            } else {
                key.as_str()
            };

            match key {
                // Handle actions arrays — gated on the pattern's OWN declared
                // `actions` prop type (never on the pattern's name): a
                // `node`-typed `actions` (e.g. `alert.actions`, mirroring its
                // React prop `actions?: React.ReactNode`) is not a list of
                // action descriptors at all, and casting a `@config.actions`
                // forward `as readonly EntityRow[]` there is TS2322 against
                // `ReactNode`. Falling through to `_` lets the generic
                // node-typed-prop branch route it through `renderPatternValue`
                // like any other node config forward.
                "actions" if Self::prop_declares_array_type(props_schema, "actions") => {
                    if let Some(prop) = self.bound_array_prop(pattern_type, key, value) {
                        props.push(prop);
                    } else if let OirValue::Array(actions) = value {
                        // Check if pattern's propsSchema accepts 'actions' prop
                        let accepts_actions = props_schema
                            .as_ref()
                            .map(|s| s.contains_key("actions"))
                            .unwrap_or(true);

                        if accepts_actions {
                            // Game patterns expect event as a string prop (they handle dispatch internally)
                            // Non-game patterns need onClick handlers
                            if category == "game" {
                                // Pass through as-is for game components
                                props.push(self.config_value_to_jsx_prop_with_pattern(
                                    Some(pattern_type),
                                    "actions",
                                    value,
                                ));
                            } else {
                                // Convert to onClick handlers for non-game components.
                                // `value` (not the destructured `actions` — see
                                // C-ACTIONS-IF-FLATTENED-TO-EMPTY-OBJECTS,
                                // Almadar_Compiler_Gaps.md §27) may be a
                                // dynamic `(if cond [actions] [actions])`
                                // flattened to a 4-element OirValue::Array by
                                // resolve.rs's sexpr_to_value — recompile that
                                // shape to a real ternary instead of treating
                                // every element as a literal action object.
                                let element_ts = Self::array_prop_element_ts(
                                    props_schema.and_then(|s| s.get("actions")),
                                );
                                let actions_ts =
                                    self.actions_value_to_jsx_array(value, false, &element_ts);
                                props.push(format!("actions={{{}}}", actions_ts));
                            }
                        } else {
                            // Pattern doesn't accept 'actions' — extract submitEvent/cancelEvent
                            let has_submit = props_schema
                                .as_ref()
                                .map(|s| s.contains_key("submitEvent"))
                                .unwrap_or(false);
                            let has_cancel = props_schema
                                .as_ref()
                                .map(|s| s.contains_key("cancelEvent"))
                                .unwrap_or(false);
                            if has_submit || has_cancel {
                                for action in actions {
                                    if let OirValue::Object(obj) = action {
                                        if let Some(OirValue::String(ev)) = obj.get("event") {
                                            let is_cancel = ev == "CANCEL"
                                                || ev == "CLOSE"
                                                || obj
                                                    .get("label")
                                                    .and_then(|v| match v {
                                                        OirValue::String(s) => {
                                                            Some(s.eq_ignore_ascii_case("cancel"))
                                                        }
                                                        _ => None,
                                                    })
                                                    .unwrap_or(false);
                                            // Gap #13: qualify with `Orbital.Trait.` scope.
                                            let qualified = self.qualify_event(ev);
                                            if is_cancel && has_cancel {
                                                props
                                                    .push(format!("cancelEvent=\"{}\"", qualified));
                                            } else if has_submit {
                                                props
                                                    .push(format!("submitEvent=\"{}\"", qualified));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                // Handle itemActions - unified prop name for all components
                "itemActions" => {
                    if let Some(prop) = self.bound_array_prop(pattern_type, key, value) {
                        props.push(prop);
                    } else if let OirValue::Array(_) = value {
                        // Same `(if cond [actions] [actions])` flattening as
                        // the `actions` arm above (C-ACTIONS-IF-FLATTENED-
                        // TO-EMPTY-OBJECTS) — recompile through the
                        // conditional-aware helper so both branches'
                        // descriptors are event-qualified instead of the
                        // whole 4-element array being read as literal items.
                        let element_ts = Self::array_prop_element_ts(
                            get_props_schema(pattern_type).and_then(|s| s.get("itemActions")),
                        );
                        let actions_ts = self.actions_value_to_jsx_array(value, true, &element_ts);
                        props.push(format!("itemActions={{{}}}", actions_ts));
                    }
                }
                // Handle fieldNames -> fields mapping (unified prop name).
                // Legacy components (DataTable, CardGrid, List) only expose
                // `fields` and normalize internally, so remap. But a component
                // that declares a real `fieldNames` prop (e.g. DetailPanel has
                // both `fields` and `fieldNames`) must keep it native — else
                // both keys collapse to `fields=` and emit a duplicate JSX attr.
                "fieldNames" => {
                    if let Some(prop) = self.bound_array_prop(pattern_type, key, value) {
                        props.push(prop);
                    } else if let OirValue::Array(fields_arr) = value {
                        let field_strs: Vec<String> = fields_arr
                            .iter()
                            .map(|v| format!("\"{}\"", self.value_to_string(v)))
                            .collect();
                        let has_native = props_schema
                            .as_ref()
                            .map(|s| s.contains_key("fieldNames"))
                            .unwrap_or(false);
                        let attr = if has_native { "fieldNames" } else { "fields" };
                        props.push(format!("{}={{[{}]}}", attr, field_strs.join(", ")));
                    }
                }
                // Handle fields - unified prop name, different formats per component type
                "fields" => {
                    // `fields: []` next to a non-empty `columns:` is a legacy-authoring
                    // combo (validator requires `fields` to be declared; the actual
                    // field defs live under `columns`). Skip the empty placeholder
                    // so the `columns` handler owns the `fields=` JSX prop alone.
                    if matches!(value, OirValue::Array(a) if a.is_empty())
                        && matches!(
                            config.get("columns"),
                            Some(OirValue::Array(a)) if !a.is_empty()
                        )
                    {
                        continue;
                    }
                    // A `(list …)` constructor's items are the literal fields.
                    let list_items;
                    let value = match value {
                        OirValue::Array(a)
                            if matches!(a.first(), Some(OirValue::String(h)) if h == "list" || h == "array/of") =>
                        {
                            list_items = OirValue::Array(a[1..].to_vec());
                            &list_items
                        }
                        _ => value,
                    };
                    if let Some(prop) = self.bound_array_prop(pattern_type, key, value) {
                        props.push(prop);
                    } else if matches!(value, OirValue::Array(a) if super::prop::is_sexpr_call(a)) {
                        // A computed list (`(array/map …)`) is an expression, not field names.
                        let prop = self.config_value_to_jsx_prop_with_pattern(
                            Some(pattern_type),
                            key,
                            value,
                        );
                        if !prop.is_empty() {
                            props.push(prop);
                        }
                    } else if let OirValue::Array(fields) = value {
                        // Schema-driven element-shape branching: look up the
                        // pattern's `fields.items.types` in the registry.
                        // - If items.types contains "string" but NOT "object",
                        //   render strings as-is, objects literally (mixed
                        //   element union — entity-detail / detail-panel /
                        //   timeline shape).
                        // - Otherwise the element is an object schema (form
                        //   SchemaField, table-view Column) — fall through
                        //   to the wrap-strings-as-objects path below.
                        let fields_item_types: Option<&[String]> = props_schema
                            .and_then(|s| s.get("fields"))
                            .and_then(|p| p.items.as_ref())
                            .map(|i| i.types.as_slice());
                        let element_accepts_string = fields_item_types
                            .map(|ts| {
                                ts.iter().any(|t| t == "string")
                                    && !ts.iter().any(|t| t == "object")
                            })
                            .unwrap_or(false);
                        if element_accepts_string {
                            let field_strs: Vec<String> = fields
                                .iter()
                                .map(|v| match v {
                                    OirValue::Object(obj) => {
                                        let pairs: Vec<String> = obj
                                            .iter()
                                            .map(|(k, fv)| {
                                                let val_str = self.value_to_jsx_literal(fv);
                                                format!("{}: {}", k, val_str)
                                            })
                                            .collect();
                                        format!("{{ {} }}", pairs.join(", "))
                                    }
                                    _ => format!("\"{}\"", self.value_to_string(v)),
                                })
                                .collect();
                            props.push(format!("fields={{[{}]}}", field_strs.join(", ")));
                        } else {
                            // Determine if this is a form pattern (uses SchemaField: { name, label })
                            // or a display pattern (uses Column: { key, header })
                            let is_form = pattern_type == "form-section"
                                || pattern_type == "form"
                                || pattern_type == "inline-edit-form"
                                || pattern_type == "wizard-step"
                                || pattern_type.contains("form");
                            // Display twin of the form injection: detail-panel
                            // gets the same entity-schema enrichment onto the
                            // DISPLAY shape ({ key, type, values, relation:
                            // "<Entity>" }) with no SchemaField remaps —
                            // mirrors enrichDetailFields in @almadar/ui's
                            // UISlotRenderer (runtime path).
                            let is_detail = pattern_type == "detail-panel";
                            let field_objs: Vec<String> = fields
                                .iter()
                                .map(|v| match v {
                                    // If it's an object, serialize its properties
                                    OirValue::Object(obj) => {
                                        let mut pairs: Vec<String> = obj
                                            .iter()
                                            .filter_map(|(k, field_val)| {
                                                // For form fields, remap/filter SchemaField props
                                                if is_form {
                                                    // Remap 'default' → 'defaultValue' (SchemaField uses defaultValue)
                                                    let key = if k == "default" {
                                                        "defaultValue"
                                                    } else {
                                                        k.as_str()
                                                    };
                                                    // Filter out props not valid on SchemaField
                                                    if key == "entity"
                                                        || key == "collection"
                                                        || key == "seedCount"
                                                    {
                                                        return None;
                                                    }
                                                    let val_str =
                                                        self.value_to_jsx_literal(field_val);
                                                    Some(format!("{}: {}", key, val_str))
                                                } else {
                                                    let val_str =
                                                        self.value_to_jsx_literal(field_val);
                                                    Some(format!("{}: {}", k, val_str))
                                                }
                                            })
                                            .collect();
                                        // For form fields: inject type/values/relation from entity schema
                                        // when not already present in the config object
                                        if is_form {
                                            let field_name = obj
                                                .get("name")
                                                .or(obj.get("field"))
                                                .map(|v| self.value_to_string(v));
                                            if let Some(ref name) = field_name {
                                                if let Some(info) = entity_field_types
                                                    .and_then(|m| m.get(name.as_str()))
                                                {
                                                    if !obj.contains_key("type")
                                                        && !obj.contains_key("inputType")
                                                    {
                                                        pairs.push(format!(
                                                            "type: \"{}\"",
                                                            info.form_type
                                                        ));
                                                    }
                                                    if let Some(enum_values) =
                                                        info.enum_values.as_ref()
                                                    {
                                                        if !obj.contains_key("values")
                                                            && !obj.contains_key("options")
                                                        {
                                                            let values_str: Vec<String> =
                                                                enum_values
                                                                    .iter()
                                                                    .map(|v| {
                                                                        format!(
                                                                            "\"{}\"",
                                                                            escape_js_string(v)
                                                                        )
                                                                    })
                                                                    .collect();
                                                            pairs.push(format!(
                                                                "values: [{}]",
                                                                values_str.join(", ")
                                                            ));
                                                        }
                                                    }
                                                    if let Some(relation_entity) =
                                                        info.relation_entity.as_ref()
                                                    {
                                                        if !obj.contains_key("relation") {
                                                            pairs.push(format!(
                                                                "relation: {}",
                                                                format_relation_value(
                                                                    relation_entity,
                                                                    info.relation_cardinality
                                                                        .as_deref()
                                                                )
                                                            ));
                                                        }
                                                    }
                                                    if info.required
                                                        && !obj.contains_key("required")
                                                    {
                                                        pairs.push("required: true".to_string());
                                                    }
                                                    if let Some(desc) = info.description.as_ref() {
                                                        if !obj.contains_key("hint")
                                                            && !obj.contains_key("help")
                                                        {
                                                            pairs.push(format!(
                                                                "hint: \"{}\"",
                                                                escape_js_string(desc)
                                                            ));
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        // Detail display fields: inject schema
                                        // type/values/relation unless the author
                                        // typed the entry (author override wins,
                                        // same rule as the runtime path).
                                        if is_detail && !obj.contains_key("type") {
                                            let field_name = obj
                                                .get("key")
                                                .or(obj.get("name"))
                                                .map(|v| self.value_to_string(v));
                                            if let Some(ref name) = field_name {
                                                if let Some(info) = entity_field_types
                                                    .and_then(|m| m.get(name.as_str()))
                                                {
                                                    pairs.push(format!(
                                                        "type: \"{}\"",
                                                        form_type_to_display_type(&info.form_type)
                                                    ));
                                                    if let Some(enum_values) =
                                                        info.enum_values.as_ref()
                                                    {
                                                        if !obj.contains_key("values") {
                                                            let values_str: Vec<String> =
                                                                enum_values
                                                                    .iter()
                                                                    .map(|v| {
                                                                        format!(
                                                                            "\"{}\"",
                                                                            escape_js_string(v)
                                                                        )
                                                                    })
                                                                    .collect();
                                                            pairs.push(format!(
                                                                "values: [{}]",
                                                                values_str.join(", ")
                                                            ));
                                                        }
                                                    }
                                                    if let Some(relation_entity) =
                                                        info.relation_entity.as_ref()
                                                    {
                                                        if !obj.contains_key("relation") {
                                                            pairs.push(format!(
                                                                "relation: {}",
                                                                format_relation_value(
                                                                    relation_entity,
                                                                    info.relation_cardinality
                                                                        .as_deref()
                                                                )
                                                            ));
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        format!("{{ {} }}", pairs.join(", "))
                                    }
                                    OirValue::String(s) => {
                                        // For form fields: enrich with entity type info
                                        if is_form {
                                            if let Some(info) =
                                                entity_field_types.and_then(|m| m.get(s.as_str()))
                                            {
                                                let mut pairs = vec![
                                                    format!("name: \"{}\"", s),
                                                    format!("label: \"{}\"", to_title_case(s)),
                                                    format!("type: \"{}\"", info.form_type),
                                                ];
                                                if let Some(ref values) = info.enum_values {
                                                    let values_str: Vec<String> = values
                                                        .iter()
                                                        .map(|v| {
                                                            format!("\"{}\"", escape_js_string(v))
                                                        })
                                                        .collect();
                                                    pairs.push(format!(
                                                        "values: [{}]",
                                                        values_str.join(", ")
                                                    ));
                                                }
                                                if let Some(ref rel_entity) = info.relation_entity {
                                                    pairs.push(format!(
                                                        "relation: {}",
                                                        format_relation_value(
                                                            rel_entity,
                                                            info.relation_cardinality.as_deref()
                                                        )
                                                    ));
                                                }
                                                if info.required {
                                                    pairs.push("required: true".to_string());
                                                }
                                                if let Some(ref desc) = info.description {
                                                    pairs.push(format!(
                                                        "hint: \"{}\"",
                                                        escape_js_string(desc)
                                                    ));
                                                }
                                                return format!("{{ {} }}", pairs.join(", "));
                                            }
                                        }
                                        if is_detail {
                                            if let Some(info) =
                                                entity_field_types.and_then(|m| m.get(s.as_str()))
                                            {
                                                return format_detail_field(s, info);
                                            }
                                        }
                                        format!(
                                            "{{ name: \"{}\", label: \"{}\" }}",
                                            s,
                                            to_title_case(s)
                                        )
                                    }
                                    _ => {
                                        let name = self.value_to_string(v);
                                        // For form fields: enrich with entity type info
                                        if is_form {
                                            if let Some(info) = entity_field_types
                                                .and_then(|m| m.get(name.as_str()))
                                            {
                                                let mut pairs = vec![
                                                    format!("name: \"{}\"", name),
                                                    format!("label: \"{}\"", to_title_case(&name)),
                                                    format!("type: \"{}\"", info.form_type),
                                                ];
                                                if let Some(ref values) = info.enum_values {
                                                    let values_str: Vec<String> = values
                                                        .iter()
                                                        .map(|v| {
                                                            format!("\"{}\"", escape_js_string(v))
                                                        })
                                                        .collect();
                                                    pairs.push(format!(
                                                        "values: [{}]",
                                                        values_str.join(", ")
                                                    ));
                                                }
                                                if let Some(ref rel_entity) = info.relation_entity {
                                                    pairs.push(format!(
                                                        "relation: {}",
                                                        format_relation_value(
                                                            rel_entity,
                                                            info.relation_cardinality.as_deref()
                                                        )
                                                    ));
                                                }
                                                if info.required {
                                                    pairs.push("required: true".to_string());
                                                }
                                                if let Some(ref desc) = info.description {
                                                    pairs.push(format!(
                                                        "hint: \"{}\"",
                                                        escape_js_string(desc)
                                                    ));
                                                }
                                                return format!("{{ {} }}", pairs.join(", "));
                                            }
                                        }
                                        if is_detail {
                                            if let Some(info) = entity_field_types
                                                .and_then(|m| m.get(name.as_str()))
                                            {
                                                return format_detail_field(&name, info);
                                            }
                                        }
                                        format!(
                                            "{{ name: \"{}\", label: \"{}\" }}",
                                            name,
                                            to_title_case(&name)
                                        )
                                    }
                                })
                                .collect();
                            // Each element is a per-item object literal
                            // built by hand above (author config + injected
                            // schema fields) — never went through
                            // `narrow_wide_array_to_prop_type` (that owner
                            // only sees an S-expression-compiled operator
                            // result), so an author key the display/
                            // SchemaField shape doesn't declare (`header`
                            // where the registry names it `label`, say)
                            // lands as an excess property (TS2353). Cast
                            // through the SAME registry-declared
                            // element-shape owner (`array_prop_element_ts`
                            // + `array_coerce_value`), never keyed on the
                            // pattern name.
                            let literal = format!("[{}]", field_objs.join(", "));
                            // An empty `fields: []` already satisfies any
                            // array-typed prop with zero error — skip the
                            // cast rather than risk forcing it through a
                            // synthesized shape that doesn't structurally
                            // match the real component type (a separate
                            // synthesizer gap, not this element's excess
                            // property).
                            if fields.is_empty() {
                                props.push(format!("fields={{{}}}", literal));
                            } else {
                                let elt = Self::array_prop_element_ts(
                                    props_schema.and_then(|s| s.get("fields")),
                                );
                                let cast = if elt.trim_start().starts_with('{') {
                                    ArrayCast::NarrowedMutable
                                } else {
                                    ArrayCast::Mutable
                                };
                                props.push(array_coerce_prop("fields", &literal, &elt, cast));
                            }
                        }
                    }
                }
                // Handle form submit handler
                "onSubmit" => {
                    let event = self.value_to_string(value);
                    // Check if propsSchema says onSubmit is a string type (e.g., Form pattern)
                    let is_string_prop = props_schema
                        .as_ref()
                        .and_then(|s| s.get("onSubmit"))
                        .map(|entry| entry.types.iter().any(|t| t == "string"))
                        .unwrap_or(false);
                    if is_string_prop {
                        props.push(format!("onSubmit=\"{}\"", event));
                    } else {
                        props.push(format!(
                            "onSubmit={{(formData: EventPayload) => dispatch('{}', formData)}}",
                            event
                        ));
                    }
                }
                // Handle cancel handler — maps to onCancel or onClose based on propsSchema
                "onCancel" => {
                    let event = self.value_to_string(value);
                    let has_on_cancel = props_schema
                        .as_ref()
                        .map(|s| s.contains_key("onCancel"))
                        .unwrap_or(true);
                    let has_on_close = props_schema
                        .as_ref()
                        .map(|s| s.contains_key("onClose"))
                        .unwrap_or(false);
                    // Check if the target prop is a string type (e.g., Form pattern)
                    let cancel_prop_name = if has_on_cancel {
                        "onCancel"
                    } else if has_on_close {
                        "onClose"
                    } else {
                        "onCancel"
                    };
                    let is_string_prop = props_schema
                        .as_ref()
                        .and_then(|s| s.get(cancel_prop_name))
                        .map(|entry| entry.types.iter().any(|t| t == "string"))
                        .unwrap_or(false);
                    if is_string_prop {
                        props.push(format!("{}=\"{}\"", cancel_prop_name, event));
                    } else if has_on_cancel {
                        props.push(format!("onCancel={{() => dispatch('{}')}}", event));
                    } else if has_on_close {
                        props.push(format!("onClose={{() => dispatch('{}')}}", event));
                    } else {
                        props.push(format!("onCancel={{() => dispatch('{}')}}", event));
                    }
                }
                // Handle entityId for edit mode
                "entityId" => {
                    // Use entity from EntityStore (first item when available) as primary
                    // initialData source, falling back to event payload for backward compat.
                    // In EDIT state, `entity` is [entityById] from useEntityById, so [0] is the record.
                    props.push("initialData={(Array.isArray(entity) && entity.length > 0 ? entity[0] : __toEntityRow(lastPayload?.row ?? lastPayload?.data))}".to_string());
                    if !props.iter().any(|p| p.contains("mode=")) {
                        props.push("mode=\"edit\"".to_string());
                    }
                }
                // A binding-valued `initialData` (authored `@entity` /
                // `@payload.<key>`) targets a ROW-typed prop (`EntityRow |
                // undefined`), but `@entity` compiles to the COLLECTION and a
                // payload read to the wide `EventPayloadValue` union
                // (C-COMPILED-PATH-RED §25). Narrow at the boundary: the
                // trait-bound row for `@entity`, the inline `__toEntityRow`
                // record guard for payload reads. Non-binding values fall
                // through to the generic prop path.
                "initialData"
                    if matches!(value, OirValue::String(s)
                        if s == "@entity" || s.starts_with("@payload.")) =>
                {
                    let OirValue::String(s) = value else {
                        unreachable!()
                    };
                    if s == "@entity" {
                        props.push(
                            "initialData={(Array.isArray(entity) && entity.length > 0 ? entity[0] : undefined)}"
                                .to_string(),
                        );
                    } else {
                        props.push(format!(
                            "initialData={{__toEntityRow({})}}",
                            self.binding_string_to_ts(s)
                        ));
                    }
                }
                // Handle stats items - render multiple StatCards
                "items" if pattern_type == "stats" => {
                    if let OirValue::Array(items) = value {
                        let stat_cards: Vec<String> = items
                            .iter()
                            .map(|item| {
                                if let OirValue::Object(obj) = item {
                                    let label = obj
                                        .get("label")
                                        .map(|v| self.value_to_string(v))
                                        .unwrap_or_default();
                                    let val = obj
                                        .get("value")
                                        .map(|v| self.value_to_jsx_expr(v))
                                        .unwrap_or_else(|| "''".to_string());
                                    format!(
                                        "<StatCard {} value={{{}}} />",
                                        super::prop::jsx_string_prop("label", &label),
                                        val
                                    )
                                } else {
                                    "<StatCard />".to_string()
                                }
                            })
                            .collect();
                        // For stats, return multiple components wrapped in fragment
                        return if stat_cards.len() == 1 {
                            stat_cards[0].clone()
                        } else {
                            format!("<>{}</>", stat_cards.join(""))
                        };
                    }
                }
                // Handle description -> subtitle for cards
                "description" if pattern_type == "card" => {
                    props.push(super::prop::jsx_string_prop(
                        "subtitle",
                        &self.value_to_string(value),
                    ));
                }
                // Handle showBack for page headers
                "showBack" => {
                    if let OirValue::Bool(true) = value {
                        props.push("showBack={true}".to_string());
                    }
                }
                // Handle renderItem lambda: ["fn", "paramName", { pattern body }]
                // Generates: {(paramName: <RowType>) => (<PatternJSX />)}
                // The lambda param (e.g., "item") is used directly as the variable name.
                // @item.field in the body compiles to item?.field. No invisible rewriting.
                //
                // Row type: the trait's `linked_entity` — every field declared
                // on the entity is narrowly typed via the generated interface
                // (including literal-union enums), so @item.status renders as
                // `"active" | "inactive" | "pending"` rather than `unknown`.
                // Falls back to `EntityRow` when the trait has no linked entity.
                "renderItem" => {
                    // Shape: the flat `["fn","item","index",{ pattern body }]` form —
                    // the canonical lowering `compile_lambda` and the validator's
                    // ≤2-arity endorsement both produce. Params are the String
                    // sequence between `"fn"` and the trailing pattern-body Object.
                    if let OirValue::Array(lambda) = value {
                        let is_fn = matches!(
                            lambda.first(),
                            Some(OirValue::String(s)) if s == "fn"
                        );
                        if is_fn && lambda.len() >= 3 {
                            let params = lambda_params(&lambda[1..lambda.len() - 1]);
                            if let Some(OirValue::Object(body_obj)) = lambda.last() {
                                if let (false, Some(OirValue::String(body_type))) =
                                    (params.is_empty(), body_obj.get("type"))
                                {
                                    let body_config: HashMap<String, OirValue> = body_obj
                                        .iter()
                                        .filter(|(k, _)| *k != "type")
                                        .map(|(k, v)| (k.clone(), v.clone()))
                                        .collect();
                                    // @item.field compiles to item?.field via sexpr_to_ts.
                                    let body_jsx = self.generate_pattern_from_registry(
                                        body_type,
                                        &body_config,
                                        linked_entity,
                                        entity_field_types,
                                    );
                                    // Row type for the FIRST param. @almadar/ui's
                                    // renderItem prop is universally
                                    // `(item: EntityRow, index: number) => ReactNode`,
                                    // and the param is CONTRAVARIANT — a narrower
                                    // param (the bound struct or linked entity)
                                    // makes the lambda non-assignable (`EntityRow`
                                    // can't be passed to `(card: StatCard)`), TS2322.
                                    // So param 0 is `EntityRow`; the body coerces
                                    // each `card?.<field>` read (String()/Number()/
                                    // `as union`) the same EntityRow-at-the-boundary
                                    // way as the rest of Phase 0. When the entity is
                                    // a lambda-param binding TS infers it, so bare.
                                    let row_type: String = "EntityRow".to_string();
                                    let decls: Vec<String> = params
                                        .iter()
                                        .enumerate()
                                        .map(|(i, p)| {
                                            if i == 0 && !entity_is_lambda_param_binding {
                                                format!("{}: {}", p, row_type)
                                            } else if p == "index" {
                                                // The component calls renderItem
                                                // with (item, index: number).
                                                format!("{}: number", p)
                                            } else {
                                                p.clone()
                                            }
                                        })
                                        .collect();
                                    // A component that declares a named
                                    // `renderItem` prop (e.g. SortableList,
                                    // RepeatableFormSection) gets it as a prop;
                                    // one that takes a children render-prop (e.g.
                                    // DataList) gets it as the function child.
                                    let has_render_item_prop = props_schema
                                        .as_ref()
                                        .map(|s| s.contains_key("renderItem"))
                                        .unwrap_or(false);
                                    if has_render_item_prop {
                                        // When `entity` is cast to `readonly
                                        // <Struct>[]` (a struct-array field
                                        // binding), a component whose
                                        // `renderItem?: (item: T) => …` ties `T`
                                        // to the branded `EntityCollection<T>`
                                        // does NOT infer `T` from the cast — `T`
                                        // falls back to `EntityRow`, widening
                                        // every `card.<field>` read to
                                        // `FieldValue` (TS2322 vs e.g.
                                        // `StatDisplay.max: number`). Annotate
                                        // the first param with the SAME element
                                        // type cast onto `entity` so `T`
                                        // resolves to the struct. For a
                                        // concrete-param `renderItem` (no field
                                        // binding, e.g. SortableList), leave
                                        // params bare so TS infers them from the
                                        // prop's declared signature — annotating
                                        // there would mismatch the component's
                                        // own item type.
                                        let param_decl = if entity_is_field_binding
                                            && entity_field_binding_element_type.is_some()
                                        {
                                            decls.join(", ")
                                        } else {
                                            params.join(", ")
                                        };
                                        // `body_jsx` is one
                                        // `generate_pattern_from_registry`
                                        // call's result — already a complete
                                        // expression, no extra Fragment wrap.
                                        props.push(format!(
                                            "renderItem={{({}) => ({})}}",
                                            param_decl, body_jsx
                                        ));
                                    } else {
                                        children =
                                            format!("{{({}) => ({})}}", decls.join(", "), body_jsx);
                                    }
                                }
                            }
                        }
                    }
                }
                // Handle children prop for container patterns (vstack, hstack, box, grid, etc.)
                // For data-grid/data-list, use renderItem instead of children.
                "children" => {
                    // FC-5: `children: (array/map <coll> (fn item <node>))` — the
                    // whole value is one dynamic producer, checked before the
                    // list interpretation (a bare `array/map` is also an Array).
                    if let Some(mapped) =
                        self.try_mapped_children_jsx(value, linked_entity, entity_field_types)
                    {
                        children = mapped;
                    } else if let OirValue::Array(child_patterns) = value {
                        // FC-5 / §65: each entry (including a nested
                        // `["if", cond, then, else]` conditional child) routes
                        // through the one `child_to_jsx` owner — see there.
                        let child_jsx: Vec<String> = child_patterns
                            .iter()
                            .map(|child| {
                                self.child_to_jsx(child, linked_entity, entity_field_types)
                            })
                            .collect();
                        children = child_jsx.join("");
                    } else if let OirValue::String(s) = value {
                        // String child — used by patterns whose `children` prop
                        // is typed `children: string` (e.g. PullQuote, where
                        // the quote text is the JSX-children slot, not a
                        // separate prop). Emit the string as the JSX inner
                        // content; codegen wraps the parent component around
                        // it. If the string is a `@trait.X` binding, resolve
                        // it through the trait-view path instead.
                        if let Some(trait_name) = self.parse_trait_binding(s) {
                            children = self.trait_embed_jsx(&trait_name);
                        } else if s.starts_with("@config.") {
                            // A `@config.X` here is a BINDING, not literal text.
                            // Every other prop arm resolves it through
                            // `binding_string_to_ts` (see the entity-prop arms
                            // above); this slot did not, so an unsupplied knob
                            // — `children: @config.children` forwarded by the
                            // generated `ui-*.lolo` factories — reached the DOM
                            // as the seven characters `@config.children` and
                            // painted (S16c). Resolving it yields `undefined`
                            // when unsupplied, so a component whose body falls
                            // back (`children ?? content`) renders the fallback.
                            //
                            // The knob is node-typed (`PatternValue`), which is
                            // NOT a `ReactNode` — a supplied pattern object must
                            // resolve through the same registry machinery the
                            // interpreted path uses, so route through
                            // `renderPatternValue` (@almadar/ui), the compiled
                            // path's PatternValue→element boundary
                            // (C-COMPILED-PATH-RED §25). Scalar knobs pass
                            // through it unchanged.
                            children =
                                format!("{{renderPatternValue({})}}", self.binding_string_to_ts(s));
                        } else {
                            children = escape_js_string(s);
                        }
                    } else if let OirValue::Object(child_obj) = value {
                        // Single object child — used by layout wrapper patterns.
                        // The child pattern may specify its own `entity` for data binding;
                        // falls back to the trait's linked entity if none specified.
                        if let Some(OirValue::String(child_type)) = child_obj.get("type") {
                            let child_entity = child_obj.get("entity").and_then(|v| {
                                if let OirValue::String(s) = v {
                                    Some(s.as_str())
                                } else {
                                    None
                                }
                            });
                            let child_config: HashMap<String, OirValue> = child_obj
                                .iter()
                                .filter(|(k, _)| *k != "type")
                                .map(|(k, v)| (k.clone(), v.clone()))
                                .collect();
                            children = self.generate_pattern_from_registry(
                                child_type,
                                &child_config,
                                child_entity.or(linked_entity),
                                entity_field_types,
                            );
                        }
                    }
                }
                // Numeric `columns` passes through verbatim; the array form is
                // remapped to `fields` on the table-like patterns below.
                "columns" => {
                    if let OirValue::Number(n) = value {
                        props.push(format!("columns={{{}}}", n));
                    } else if let OirValue::Array(arr) = value {
                        // columns is an alias for fields ONLY on the table-like
                        // patterns (DataGrid/DataList/DataTable + shorthand
                        // wrappers). Other patterns
                        // declare `columns` as their own
                        // prop — the remap would silently break them by
                        // emitting `fields=[...]` and dropping the real
                        // `columns` content (or worse, doubling up). Gate the
                        // remap on the target pattern accordingly.
                        let columns_aliases_fields =
                            matches!(pattern_type, "data-grid" | "data-list" | "data-table");
                        if !columns_aliases_fields {
                            let prop = self.config_value_to_jsx_prop_with_pattern(
                                Some(pattern_type),
                                key,
                                value,
                            );
                            if !prop.is_empty() {
                                props.push(prop);
                            }
                            continue;
                        }
                        // The `fields` handler (above) owns the `fields=` JSX attr
                        // and emits it UNLESS `fields` is empty AND `columns` is
                        // non-empty (the legacy combo where field defs live under
                        // `columns`). Mirror that exactly: the columns→fields alias
                        // should populate `fields=` ONLY in that deferred case (or
                        // when there's no `fields` key at all). Otherwise both
                        // handlers emit `fields=` and TS rejects the duplicate
                        // (TS17001). Generated factories declare both `fields` and
                        // `columns` defaulting to `[]`, which is the case that
                        // regressed before this guard.
                        let fields_present = config.contains_key("fields");
                        let fields_empty = matches!(
                            config.get("fields"),
                            Some(OirValue::Array(a)) if a.is_empty()
                        ) || !fields_present;
                        let columns_empty = arr.is_empty();
                        let fields_handler_emits =
                            fields_present && !(fields_empty && !columns_empty);
                        if fields_handler_emits {
                            continue;
                        }
                        // DataGrid/DataList/DataTable: { name, label } field definitions
                        // Remap schema names: field/key → name, header → label
                        let col_objs: Vec<String> = arr
                            .iter()
                            .map(|v| match v {
                                OirValue::String(s) => {
                                    format!(
                                        "{{ name: \"{}\", label: \"{}\" }}",
                                        s,
                                        to_title_case(s)
                                    )
                                }
                                OirValue::Object(map) => {
                                    let mut pairs: Vec<String> = Vec::new();
                                    for (k, field_val) in map {
                                        let val_str = self.value_to_jsx_literal(field_val);
                                        // Remap schema column props to { name, label } format
                                        let mapped_key = match k.as_str() {
                                            "field" | "key" => "name",
                                            "header" => "label",
                                            other => other,
                                        };
                                        pairs.push(format!("{}: {}", mapped_key, val_str));
                                    }
                                    format!("{{ {} }}", pairs.join(", "))
                                }
                                _ => {
                                    let name = self.value_to_string(v);
                                    format!(
                                        "{{ name: \"{}\", label: \"{}\" }}",
                                        name,
                                        to_title_case(&name)
                                    )
                                }
                            })
                            .collect();
                        props.push(format!("fields={{[{}]}}", col_objs.join(", ")));
                    } else {
                        let prop = self.config_value_to_jsx_prop_with_pattern(
                            Some(pattern_type),
                            key,
                            value,
                        );
                        if !prop.is_empty() {
                            props.push(prop);
                        }
                    }
                }
                // Default: use propsSchema to determine correct JSX generation
                _ => {
                    // Schema uses `event` on buttons but the React component prop
                    // is named `action`. Only remap when the pattern actually has
                    // `action` and lacks `event` — patterns like `search-input`
                    // expose `event` as a real prop and would otherwise lose the
                    // value to the unknown-prop filter below.
                    let key = if key == "event"
                        && props_schema
                            .as_ref()
                            .is_some_and(|s| !s.contains_key("event") && s.contains_key("action"))
                    {
                        "action"
                    } else {
                        key
                    };

                    // Check if the prop has a schema type in the pattern registry
                    let prop_schema_entry = props_schema.as_ref().and_then(|s| s.get(key));
                    let prop_types = prop_schema_entry.map(|s| &s.types);

                    // If propsSchema exists but this key is NOT in it, skip (unknown prop)
                    if props_schema.is_some() && prop_schema_entry.is_none() {
                        continue;
                    }

                    let is_number_prop = prop_types
                        .map(|types| types.iter().any(|t| t == "number"))
                        .unwrap_or(false);

                    // `["if", cond, literalA, literalB]` — after config
                    // resolution, an authored `(if @config.x A null)` prop
                    // value is exactly this shape (§C-CALLBACK-IF-TERNARY:
                    // std-tree `onNodeAction`, std-record-detail
                    // `editEvent`/`titleCommitEvent`). Compile through the
                    // one owner before the generic sexpr-ternary compiler
                    // (which knows nothing of this prop's callback/event-ref
                    // kind) ever sees it.
                    if let OirValue::Array(arr) = value {
                        if let [OirValue::String(op), cond, then_arm, else_arm] = arr.as_slice() {
                            if op == "if" && crate::codegen::is_operator_name(op) {
                                if let Some(prop) = self.literal_if_prop_expr(
                                    key,
                                    prop_schema_entry,
                                    cond,
                                    then_arm,
                                    else_arm,
                                ) {
                                    if !prop.is_empty() {
                                        props.push(prop);
                                    }
                                    continue;
                                }
                            }
                        }
                    }

                    // Handle @bindings with null-coalescing for number props
                    if let OirValue::String(s) = value {
                        if s.starts_with('@') {
                            if let Some(trait_name) = self.parse_trait_binding(s) {
                                // A `@trait.X` binding is never a
                                // string/ReactNode value to coerce — it's a
                                // direct view-component reference, regardless
                                // of the destination prop's declared type
                                // (this default arm's own `is_node_prop` case
                                // below would otherwise wrap it in
                                // `String(... ?? '')`, same bug as
                                // `config_value_to_jsx_prop_with_pattern`).
                                // Route through the one owner.
                                props.push(format!(
                                    "{}={{{}}}",
                                    key,
                                    self.trait_embed_jsx(&trait_name)
                                ));
                                continue;
                            }
                            let ts_expr = self.binding_string_to_ts(s);
                            // Check entity field info for this binding
                            let field_name = Self::extract_entity_field_name(s);
                            let field_info = field_name
                                .and_then(|name| entity_field_types.and_then(|eft| eft.get(name)));
                            // If this is an @entity binding and the field doesn't exist on the entity, skip it.
                            // Don't skip @payload, @state, @config, or lambda param bindings.
                            let is_entity_binding =
                                s.starts_with("@entity.") || s.starts_with("@_item.");
                            if is_entity_binding
                                && field_name.is_some()
                                && entity_field_types.is_some()
                                && field_info.is_none()
                            {
                                continue;
                            }
                            if Self::required_boolean_prop(Some(pattern_type), key) {
                                props.push(format!("{}={{Boolean({})}}", key, ts_expr));
                                continue;
                            }
                            if let Some(decoded) = self.decode_rich_prop(Some(pattern_type), key, &ts_expr) {
                                props.push(format!("{}={{{}}}", key, decoded));
                                continue;
                            }
                            // Determine if this binding resolves to a numeric value:
                            // 1. propsSchema says the prop type is "number", OR
                            // 2. The binding refers to a numeric entity field
                            let is_numeric_binding =
                                field_info.map(|f| f.is_numeric).unwrap_or(false);
                            let needs_default =
                                (is_number_prop || is_numeric_binding) && ts_expr.contains("?.");
                            let prop_optional = get_props_schema(pattern_type)
                                .and_then(|schema| schema.get(key as &str))
                                .is_some_and(|p| !p.required);
                            // Node-typed props (ReactNode) receive polymorphic
                            // payload values like `lastPayload.message`, whose
                            // static type is `EventPayloadValue` (wider than
                            // ReactNode). Coerce at the boundary so runtime
                            // string values render without a type error.
                            let is_node_prop = prop_types
                                .map(|types| types.iter().any(|t| t == "node"))
                                .unwrap_or(false);
                            // A string-only prop (e.g. Badge `label`) receiving
                            // a numeric entity field (e.g. `@entity.memoryCount`)
                            // needs a String(...) cast — the numeric `?? 0`
                            // fallback alone keeps the value numeric and fails
                            // TS2322. Applies when the prop types list contains
                            // "string" but not "number".
                            let is_string_only_prop = prop_types
                                .map(|types| {
                                    types.iter().any(|t| t == "string")
                                        && !types.iter().any(|t| t == "number")
                                })
                                .unwrap_or(false);
                            // Payload bindings (`@payload.X`) resolve to
                            // `lastPayload?.X` whose static type is
                            // `EventPayloadValue | undefined` — wider than
                            // any concrete prop type. When the consumer
                            // expects a string-only prop (e.g. Alert
                            // `message`, Badge `label`), wrap with
                            // String(...) so the union narrows at the
                            // boundary. Same treatment as a numeric entity
                            // field flowing into a string-only prop.
                            let _is_payload_binding = s.starts_with("@payload.");
                            // A `string | number` prop (e.g. stat-display.value)
                            // bound to a non-numeric entity field or any payload
                            // binding produces `EventPayloadValue | undefined`,
                            // which is wider than the prop's accepted union and
                            // fails TS2322 even with `?? 0`. Narrow it to the
                            // union: a number stays a number, anything else String(...).
                            let is_string_or_number_prop = prop_types
                                .map(|types| {
                                    types.iter().any(|t| t == "string")
                                        && types.iter().any(|t| t == "number")
                                })
                                .unwrap_or(false);
                            // Payload bindings (`@payload.X`) resolve to a
                            // typed payload read whose static type is
                            // `EventPayloadValue | undefined` — wider than
                            // most prop types. Wrap with String(...) to
                            // narrow when the prop is string-only. Same
                            // treatment for `@_item.X` (list-row bindings)
                            // and `@entity.X` when the field is a plain
                            // string (typed entity reads still produce
                            // `string | undefined` via `Partial<E>`).
                            // SKIP the wrap when the entity field has
                            // `enum_values` (strict union) — wrapping
                            // would widen the union back to plain string
                            // and break assignment to consumer-side
                            // strict-union props (e.g. Alert `variant`).
                            let is_runtime_typed_binding =
                                s.starts_with("@payload.") || s.starts_with("@_item.");
                            // A `@config.<knob>` read resolves to the trait's
                            // config bag, typed `EventPayloadValue` — as wide as
                            // a payload read. A string-only destination (Button
                            // `label` fed by a call-site `buttonLabel` forward)
                            // needs the same String(...) narrowing; enum
                            // destinations are already handled by the union-cast
                            // branch above (§25 tail, C-CONFIG-FORWARD-STRING).
                            let is_config_bag_binding = s.starts_with("@config.");
                            // Check the entity field's enum_values via
                            // the catalog. `@entity.X` paths look up
                            // X on the current linked entity.
                            let entity_field_has_enum =
                                if let Some(path) = s.strip_prefix("@entity.") {
                                    let field_name = path.split('.').next().unwrap_or("");
                                    let catalog = self.entity_catalog.borrow();
                                    let linked = self.current_linked_entity.borrow();
                                    linked
                                        .as_ref()
                                        .and_then(|n| catalog.get(n))
                                        .and_then(|e| e.find_field(field_name))
                                        .and_then(|f| f.enum_values.as_ref())
                                        .map(|v| !v.is_empty())
                                        .unwrap_or(false)
                                } else {
                                    false
                                };
                            let is_entity_string_binding =
                                s.starts_with("@entity.") && !entity_field_has_enum;
                            // Lambda-variable bindings (e.g. `@item.name`,
                            // `@card.value`, `@row.status` — any binding
                            // whose first segment isn't a known scope)
                            // resolve to `<param>?.<field>` whose static
                            // type, via the param's inferred element-type
                            // annotation (`EntityRow`), is
                            // `FieldValue | undefined` — wider than a
                            // string-only consumer prop accepts.
                            // Treating this branch the same as
                            // @payload / @_item / @entity-string keeps
                            // the String(...) coercion uniform across
                            // every field-access binding shape.
                            let is_known_scope_binding = s.starts_with("@entity.")
                                || s.starts_with("@payload.")
                                || s.starts_with("@state.")
                                || s.starts_with("@config.")
                                || s.starts_with("@user.")
                                || s.starts_with("@trait.")
                                || s.starts_with("@_item.");
                            let is_lambda_param_field_binding =
                                s.starts_with('@') && s.contains('.') && !is_known_scope_binding;
                            // SKIP coercion when the consumer prop is a
                            // bounded enum union (e.g. `variant: "primary"
                            // | "success" | ...`). String(...) widens
                            // back to plain `string` which won't fit the
                            // enum; the runtime value still flows
                            // through unchanged, but TS rejects the
                            // assignment. For these props, leave the
                            // binding alone and let the validator's enum
                            // rule catch any genuine value mismatches.
                            let enum_union =
                                orbital_core::language::pattern_props::get_prop_enum_values(pattern_type, key)
                                    .filter(|v: &&[&str]| !v.is_empty())
                                    .map(|v| {
                                        v.iter()
                                            .map(|x| format!("'{}'", x))
                                            .collect::<Vec<_>>()
                                            .join(" | ")
                                    });
                            let prop_has_enum_destination = enum_union.is_some();
                            let is_array_prop = prop_types
                                .map(|types| types.iter().any(|t| t == "array"))
                                .unwrap_or(false);
                            // The component prop is a real `Date` (registry type
                            // `date`/`datetime`/`timestamp`); the binding resolves
                            // to its serialized string/number form. Bridge to a
                            // `Date` at the JSX boundary with `new Date(...)`.
                            let is_date_prop = prop_types
                                .map(|types| {
                                    types
                                        .iter()
                                        .any(|t| t == "date" || t == "datetime" || t == "timestamp")
                                })
                                .unwrap_or(false);
                            // Polymorphic `as`/element prop (registry type
                            // `component`): the binding is an element-name string;
                            // cast to `keyof React.JSX.IntrinsicElements`, which
                            // both `ElementType` and `keyof IntrinsicElements`
                            // props accept.
                            let is_component_prop = prop_types
                                .map(|types| types.iter().any(|t| t == "component"))
                                .unwrap_or(false);
                            if is_component_prop {
                                props.push(format!(
                                    "{}={{{} as keyof React.JSX.IntrinsicElements}}",
                                    key, ts_expr
                                ));
                            } else if let Some(union) = enum_union {
                                // Bounded string-literal-union prop bound to a wide
                                // `FieldValue | undefined` binding — a single cast
                                // to the declared union typechecks (the literal
                                // union is assignable to FieldValue, so they
                                // overlap — no TS2352, and no banned double cast).
                                // Runtime value is unchanged; genuine out-of-union
                                // values are caught by the validator's enum rule.
                                props.push(format!("{}={{{} as {}}}", key, ts_expr, union));
                            } else if is_string_or_number_prop
                                && !is_numeric_binding
                                && ts_expr.contains("?.")
                            {
                                // A number stays a number (the component formats it); anything else becomes text.
                                if prop_optional {
                                    props.push(format!(
                                        "{}={{({} == null ? undefined : typeof {} === 'number' ? {} : String({}))}}",
                                        key, ts_expr, ts_expr, ts_expr, ts_expr
                                    ));
                                } else {
                                    props.push(format!(
                                        "{}={{(typeof {} === 'number' ? {} : String({} ?? ''))}}",
                                        key, ts_expr, ts_expr, ts_expr
                                    ));
                                }
                            } else if is_string_only_prop
                                && !prop_has_enum_destination
                                && ts_expr.contains("?.")
                                && (is_numeric_binding
                                    || is_runtime_typed_binding
                                    || is_config_bag_binding
                                    || is_entity_string_binding
                                    || is_lambda_param_field_binding)
                            {
                                if prop_optional {
                                    props.push(format!(
                                        "{}={{({} == null ? undefined : String({}))}}",
                                        key, ts_expr, ts_expr
                                    ));
                                } else {
                                    props.push(format!("{}={{{}}}", key, crate::codegen::effect::shared::string_coerce_ts(&ts_expr)));
                                }
                            } else if needs_default {
                                // Number-typed prop. `Number(... ?? 0)` because the
                                // source may be a loose `card?.<field>` read
                                // (`FieldValue | undefined` under an EntityRow
                                // renderItem param) — bare `?? 0` would leave it
                                // `FieldValue`, not `number` (TS2322). Number() of an
                                // already-numeric expr is a runtime/type no-op.
                                // A numeric literal-union prop (`cols: 1 | … | 6`)
                                // additionally asserts the coercion down to the
                                // union (number → member, legal overlap) so the
                                // component prop typechecks; out-of-union values
                                // are the validator's enum rule's job.
                                let numeric_union =
                                    super::prop::numeric_union_ts(pattern_type, key);
                                // An optional prop the source leaves unset stays unset, as on the
                                // runtime path: the component keeps its own default.
                                match (numeric_union, prop_optional) {
                                    (Some(union), true) => props.push(format!(
                                        "{}={{({} == null ? undefined : (Number({}) as {}))}}",
                                        key, ts_expr, ts_expr, union
                                    )),
                                    (Some(union), false) => props.push(format!(
                                        "{}={{(Number({} ?? 0)) as {}}}",
                                        key, ts_expr, union
                                    )),
                                    (None, true) => props.push(format!(
                                        "{}={{({} == null ? undefined : Number({}))}}",
                                        key, ts_expr, ts_expr
                                    )),
                                    (None, false) => {
                                        props.push(format!("{}={{Number({} ?? 0)}}", key, ts_expr))
                                    }
                                }
                            } else if is_node_prop && is_config_bag_binding {
                                // A `@config.<knob>` forward's runtime value is
                                // a PatternValue tree (a renderable node
                                // graph — `alert.actions`, `*.children`, …),
                                // not raw text: route through the compiled
                                // path's PatternValue→element boundary.
                                // `String(...)` here would dump
                                // "[object Object]" for anything but a bare
                                // string knob (Codegen defect 9 — the
                                // `alert.actions` array-cast bug's sibling:
                                // wrong arm for a node-typed prop, this time
                                // one node-typed arm shadowing another).
                                props.push(format!("{}={{renderPatternValue({})}}", key, ts_expr));
                            } else if is_node_prop {
                                // Every OTHER `@`-scope bound to a node-typed
                                // prop (`@payload.X`, `@entity.X`, `@_item.X`,
                                // …) is typically fed literal display text —
                                // keep the String(...) coercion so a runtime
                                // string value renders without a type error.
                                props.push(format!("{}={{{}}}", key, crate::codegen::effect::shared::string_coerce_ts(&ts_expr)));
                            } else if is_array_prop {
                                // Only a genuinely WIDE payload read (`@payload.X`
                                // / `@_item.X` → `EventPayloadValue`) needs the
                                // registry-shape cast — `?? []` can't narrow it.
                                // Typed `@entity.X` fields AND typed lambda-param
                                // fields (`@card.sparklineData`, where `card` is a
                                // typed row) already carry their correct element
                                // type, so `?? []` preserves it — avoids both the
                                // `EntityRow` fallback (primitive props like a
                                // sparkline `number[]`) and registry object-shape
                                // drift (a chart's `{label,value}[]`).
                                //
                                // `is_lambda_param_field_binding` (`@card.X`) is now
                                // a read off an `EntityRow` renderItem param (param
                                // is contravariantly EntityRow, see row_type above),
                                // so the field is `FieldValue | undefined` — `?? []`
                                // can't narrow it to the prop's `number[]`/object[]
                                // element shape. Cast it like a wide payload read.
                                let is_entity_with_collection = prop_schema_entry
                                    .and_then(|p| p.required_fields.as_ref())
                                    .is_some_and(|v| !v.is_empty());
                                if is_entity_with_collection {
                                    // EntityWith-collection prop (declares
                                    // `requiredFields`, e.g. calendar `events`)
                                    // bound to entity data (`EntityRow[]`). Cast to
                                    // the prop's STRUCTURAL EntityWith element via
                                    // the shared `entity_data_element_ts` (so this
                                    // can't drift from `entity_data_cast`) — the
                                    // loose source then satisfies the field-refined
                                    // prop, the non-`entity`-key analogue of
                                    // `emit_entity_data_prop`.
                                    let elt = entity_data_element_ts(prop_schema_entry);
                                    props.push(array_coerce_prop(
                                        key,
                                        &ts_expr,
                                        &elt,
                                        ArrayCast::NarrowedReadonly,
                                    ));
                                } else if is_runtime_typed_binding
                                    || is_config_bag_binding
                                    || is_lambda_param_field_binding
                                    // An `@entity.<field>` read of a json/[object]
                                    // field types as `FieldValue | undefined` —
                                    // when the prop declares a STRUCT element
                                    // (registry `items.properties`), `?? []`
                                    // leaves `EntityRow[]`, which misses the
                                    // struct's required fields (§25 tail class 4:
                                    // import-preview `units`/`skipped`). Typed
                                    // primitive/shaped entity arrays don't hit
                                    // this arm — no `items.properties`, so the
                                    // `?? []` fallback below still preserves
                                    // their element types.
                                    || (is_entity_string_binding
                                        && prop_schema_entry
                                            .and_then(|p| p.items.as_ref())
                                            .and_then(|i| i.properties.as_ref())
                                            .is_some_and(|m| !m.is_empty()))
                                {
                                    // `@config.<knob>` is as wide as a payload read
                                    // (`EventPayloadValue`) — `?? []` can't narrow
                                    // it to the prop's element shape (§37 tail:
                                    // Menu `items` fed by a config forward).
                                    // `NarrowedMutable` for an object-shaped
                                    // element: the config source can widen to
                                    // a messy nested union that doesn't
                                    // "sufficiently overlap" a single named
                                    // element shape for a direct `as ELT[]`
                                    // (TS2352, e.g. std-marketing-campaign's
                                    // LineChart `data`); the `EntityRow[]`
                                    // intermediate's index signature is
                                    // comparable to any object shape first.
                                    let elt = Self::array_prop_element_ts(prop_schema_entry);
                                    let cast = if elt.trim_start().starts_with('{') {
                                        ArrayCast::NarrowedMutable
                                    } else {
                                        ArrayCast::Mutable
                                    };
                                    props.push(array_coerce_prop(key, &ts_expr, &elt, cast));
                                } else {
                                    props.push(format!("{}={{({}) ?? []}}", key, ts_expr));
                                }
                            } else if is_date_prop {
                                // Required `Date` prop → always a real `Date`.
                                // A bound value hydrates via `new Date(...)`; a
                                // null/undefined value defaults to today so the
                                // leaf component's `date: Date` contract holds
                                // (symmetric with the runtime edge in
                                // UISlotRenderer). Optional prop → preserve
                                // `undefined` so `prop?: Date` typechecks and the
                                // component's own default still fires when absent.
                                let required =
                                    prop_schema_entry.map(|s| s.required).unwrap_or(false);
                                if required {
                                    props.push(format!(
                                        "{}={{{expr} == null ? new Date() : new Date({expr} as string | number)}}",
                                        key, expr = ts_expr
                                    ));
                                } else {
                                    props.push(format!(
                                        "{}={{{expr} == null ? undefined : new Date({expr} as string | number)}}",
                                        key, expr = ts_expr
                                    ));
                                }
                            } else {
                                props.push(format!("{}={{{}}}", key, ts_expr));
                            }
                            continue;
                        }
                    }

                    let is_plain_string =
                        matches!(value, OirValue::String(s) if !s.starts_with('@'));

                    if is_plain_string {
                        if let Some(types) = prop_types {
                            let val_str = self.value_to_string(value);
                            if types.iter().any(|t| t == "function") {
                                // C2: callback prop bound to an event name. Routed
                                // through the one literal-value owner (also used by
                                // the `if`-prop compiler above) so a direct literal
                                // and an `if` arm wrap identically. `None` is the
                                // outlet-OFF encoding (`@offByDefault` knobs resolve
                                // to "") — omit the prop so presence-gated
                                // affordances (Badge's remove ×) stay hidden,
                                // mirroring the runtime renderer's empty-string skip
                                // in UISlotRenderer.
                                match self.literal_prop_expr(prop_schema_entry, value) {
                                    Some(expr) => props.push(format!("{}={{{}}}", key, expr)),
                                    None => continue,
                                }
                            } else if types.iter().any(|t| t == "array") {
                                // Schema says array: look up from data collection.
                                // Cast to `readonly EntityRow[]` (no-as-any rule
                                // rejects bare `as any`); data['<X>'] is typed
                                // `EntityRow[]` natively so the cast is a no-op
                                // for typed paths and a defense-in-depth for
                                // dynamic key lookups.
                                props.push(format!(
                                    "{}={{(data['{}'] || []) as readonly EntityRow[]}}",
                                    key, val_str
                                ));
                            } else if types.iter().any(|t| t == "object") {
                                // Schema says object: only use entity binding when value starts with @.
                                // If the value is a plain string literal (no @ prefix), pass through as string prop.
                                if val_str.starts_with('@') {
                                    props.push(format!(
                                        "{}={{(lastPayload || {{}}) as EventPayload}}",
                                        key
                                    ));
                                } else {
                                    let prop = self.config_value_to_jsx_prop_with_pattern(
                                        Some(pattern_type),
                                        key,
                                        value,
                                    );
                                    if !prop.is_empty() {
                                        props.push(prop);
                                    }
                                }
                            } else {
                                // Known type (string, number, boolean) - pass through normally
                                let prop = self.config_value_to_jsx_prop_with_pattern(
                                    Some(pattern_type),
                                    key,
                                    value,
                                );
                                if !prop.is_empty() {
                                    props.push(prop);
                                }
                            }
                        } else {
                            // No schema info - fallback to existing behavior
                            let prop = self.config_value_to_jsx_prop_with_pattern(
                                Some(pattern_type),
                                key,
                                value,
                            );
                            if !prop.is_empty() {
                                props.push(prop);
                            }
                        }
                    } else {
                        // Check if propsSchema says this is a "node" type — render as JSX
                        let is_node_prop = prop_types
                            .map(|types| types.iter().any(|t| t == "node"))
                            .unwrap_or(false);

                        if is_node_prop {
                            if let OirValue::Object(node_obj) = value {
                                if let Some(OirValue::String(node_type)) = node_obj.get("type") {
                                    let node_config: HashMap<String, OirValue> = node_obj
                                        .iter()
                                        .filter(|(k, _)| *k != "type")
                                        .map(|(k, v)| (k.clone(), v.clone()))
                                        .collect();
                                    let node_jsx = self.generate_pattern_from_registry(
                                        node_type,
                                        &node_config,
                                        linked_entity,
                                        entity_field_types,
                                    );
                                    // `node_jsx` is a single
                                    // `generate_pattern_from_registry` call's
                                    // result — already a complete
                                    // expression (its own doc comment), so no
                                    // extra Fragment wrap here. A `node`-typed
                                    // prop populated this way is exactly the
                                    // `trigger`/`icon`/`header`/`footer`/
                                    // `actions` element-descriptor shape:
                                    // wrapping a single element in `<>…</>`
                                    // broke `Menu`'s `cloneElement(trigger,
                                    // {ref, onClick})` (a Fragment can't take
                                    // a ref).
                                    props.push(format!("{}={{{}}}", key, node_jsx));
                                } else {
                                    let prop = self.config_value_to_jsx_prop_with_pattern(
                                        Some(pattern_type),
                                        key,
                                        value,
                                    );
                                    if !prop.is_empty() {
                                        props.push(prop);
                                    }
                                }
                            } else {
                                // NOTE: a plain `OirValue::String` (including a
                                // `@config.`-bound one) never reaches this arm —
                                // every String value is fully handled and
                                // `continue`d by the `@`-binding / plain-string
                                // branches above (the `is_node_prop &&
                                // is_config_bag_binding` arm there is the one
                                // real owner of "@config.X forwarded to a
                                // node-typed prop"). This arm only sees the
                                // OTHER OirValue shapes (Array, Bool, Number, …).
                                let prop = self.config_value_to_jsx_prop_with_pattern(
                                    Some(pattern_type),
                                    key,
                                    value,
                                );
                                if !prop.is_empty() {
                                    props.push(prop);
                                }
                            }
                        } else {
                            // Non-string value or @binding - use existing prop generation
                            let prop = self.config_value_to_jsx_prop_with_pattern(
                                Some(pattern_type),
                                key,
                                value,
                            );
                            if !prop.is_empty() {
                                // For number-typed props, add ?? 0 fallback to prevent
                                // component crashes when entity data is undefined.
                                // Skip if the expression already has a `??` coalesce
                                // (e.g. `count={(entity)?.length ?? 0}` from the
                                // `count`/`length` sexpr operator) — double-wrapping
                                // produces `?? 0 ?? 0` which TS2881s as "never nullish".
                                // Also skip statically non-nullish values (an `if`
                                // sexpr with literal arms emits a ternary whose
                                // condition contains `?.` but whose result never
                                // is nullish) — `?? 0` there TS2869s.
                                if is_number_prop
                                    && prop.contains("?.")
                                    && !prop.contains(" ?? ")
                                    && !Self::value_statically_non_nullish(value)
                                {
                                    let fallback_prop = prop.replacen("}", " ?? 0}", 1);
                                    props.push(fallback_prop);
                                } else {
                                    props.push(prop);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Add mode="create" for forms without entityId
        if get_fields_contract(pattern_type) == Some("form")
            && !config.contains_key("entityId")
            && !props.iter().any(|p| p.contains("mode="))
        {
            props.push("mode=\"create\"".to_string());
        }

        // Auto-generate relationsData for every @fieldsContract pattern with
        // relation fields — form/detail patterns (fields ModalRecordModal
        // etc. authors) AND the column-bearing display patterns (table-view/
        // data-list/data-grid, which author `columns` — `fields`
        // is checked first so the form/detail shape is unchanged). Reads
        // populated relation entities from the data context. Covers three
        // authoring shapes: config objects carrying an explicit relation
        // ({entity} object or bare entity-name string), and bare string field
        // names resolved through the linked entity's schema
        // (entity_field_types) — the shape the whole ModalRecordModal corpus
        // uses.
        if get_fields_contract(pattern_type).is_some()
            && props_schema.is_some_and(|s| s.contains_key("relationsData"))
            && !props.iter().any(|p| p.starts_with("relationsData="))
        {
            let field_list = config
                .get("fields")
                .or_else(|| config.get("columns"))
                .and_then(|v| match v {
                    OirValue::Array(arr) => Some(arr),
                    _ => None,
                });
            if let Some(fields_arr) = field_list {
                let mut relation_entries: Vec<String> = Vec::new();
                for field_val in fields_arr {
                    let (field_name, explicit_relation): (Option<&str>, Option<&str>) =
                        match field_val {
                            OirValue::Object(field_obj) => {
                                let name = field_obj
                                    // `field` is TableView's column-to-entity-field
                                    // override (defaults to `key`); `name`/`key`
                                    // cover every other field-def shape.
                                    .get("field")
                                    .or(field_obj.get("name"))
                                    .or(field_obj.get("key"))
                                    .and_then(|v| {
                                        if let OirValue::String(s) = v {
                                            Some(s.as_str())
                                        } else {
                                            None
                                        }
                                    });
                                let relation = field_obj.get("relation").and_then(|v| match v {
                                    OirValue::Object(rel) => rel.get("entity").and_then(|e| {
                                        if let OirValue::String(s) = e {
                                            Some(s.as_str())
                                        } else {
                                            None
                                        }
                                    }),
                                    OirValue::String(s) => Some(s.as_str()),
                                    _ => None,
                                });
                                (name, relation)
                            }
                            OirValue::String(s) => (Some(s.as_str()), None),
                            _ => (None, None),
                        };

                    let Some(fname) = field_name else { continue };
                    let relation_entity = explicit_relation.or_else(|| {
                        entity_field_types
                            .and_then(|m| m.get(fname))
                            .and_then(|info| info.relation_entity.as_deref())
                    });
                    if let Some(rentity) = relation_entity {
                        relation_entries.push(format!(
                            "{}: (data['{}'] ?? []).map((r: EntityRow) => ({{ value: r.id as string, label: (r.name || r.title || r.id) as string }}))",
                            fname, rentity
                        ));
                    }
                }
                if !relation_entries.is_empty() {
                    props.push(format!(
                        "relationsData={{{{ {} }}}}",
                        relation_entries.join(", ")
                    ));
                }
            }
        }

        // Add default values for required props that are missing from the schema config
        if let Some(schema) = props_schema {
            for (prop_name, prop_def) in schema.iter() {
                if prop_def.required {
                    // `children` is delivered as JSX inner content (already
                    // accumulated in `children` above by the "children" =>
                    // handler at L703 or the wrapper-pattern path at L747).
                    // Emitting `children={[]}` here would clash with the
                    // nested JSX — React/TS rejects two `children` attrs.
                    if prop_name == "children" {
                        continue;
                    }
                    // Check if this prop is already in the generated props list
                    let prop_prefix = format!("{}=", prop_name);
                    let prop_prefix_space = format!("{} ", prop_name);
                    let already_set = props
                        .iter()
                        .any(|p| p.starts_with(&prop_prefix) || p.starts_with(&prop_prefix_space));
                    if !already_set {
                        // Add a safe default based on the prop's type
                        if let Some(first_type) = prop_def.types.first() {
                            match first_type.as_str() {
                                "array" => {
                                    props.push(format!("{}={{[]}}", prop_name));
                                }
                                // A single allowed value (a draw child's `type`) is the only valid default.
                                "string" => match orbital_core::language::pattern_props::get_prop_enum_values(pattern_type, prop_name).as_deref() {
                                    Some([only]) => props.push(format!("{}=\"{}\"", prop_name, only)),
                                    _ => props.push(format!("{}=\"\"", prop_name)),
                                },
                                "number" => {
                                    props.push(format!("{}={{0}}", prop_name));
                                }
                                "boolean" => {
                                    props.push(format!("{}={{false}}", prop_name));
                                }
                                // Skip complex types (node, function, object, custom) — can't provide a safe default
                                _ => {}
                            }
                        }
                    }
                }
            }
        }

        fold_entry_props(&mut props, props_schema);
        strip_skeleton_props(&mut props, props_schema);

        if let Some(extra) = root_extra_props {
            for attr in &extra {
                let name = attr.split('=').next().unwrap_or(attr);
                props.retain(|p| p.split('=').next() != Some(name));
            }
            props.extend(extra);
        }

        // Generate JSX
        if children.is_empty() {
            if props.is_empty() {
                format!("<{} />", component)
            } else {
                format!("<{} {} />", component, props.join(" "))
            }
        } else {
            format!(
                "<{} {}>{}</{}>",
                component,
                props.join(" "),
                children,
                component
            )
        }
    }
}

/// `name` and right-hand side of one emitted JSX attribute (`name=rhs`).
fn split_jsx_attr(attr: &str) -> (&str, &str) {
    match attr.split_once('=') {
        Some((name, rhs)) => (name, rhs),
        None => (attr, ""),
    }
}

/// A JSX attribute's right-hand side as a JS expression: `{expr}` → `expr`,
/// a quoted literal stays as-is.
fn jsx_attr_expr(rhs: &str) -> String {
    match rhs.strip_prefix('{').and_then(|r| r.strip_suffix('}')) {
        Some(inner) => inner.to_string(),
        None => rhs.to_string(),
    }
}

/// Element entry: props the registry declares `kind: "entry"` (`enter`,
/// `enterDelay`) never reach the component — they fold into its `className`
/// as `enterClassName(...)`, the same `@almadar/ui` helper the runtime
/// renderer applies per node, so both paths draw the identical class.
pub(crate) fn fold_entry_props(
    props: &mut Vec<String>,
    props_schema: Option<&HashMap<String, PropSchema>>,
) {
    let Some(schema) = props_schema else { return };
    let is_entry = |name: &str| schema.get(name).and_then(|p| p.kind.as_deref()) == Some("entry");
    let mut enter: Option<String> = None;
    let mut delay: Option<String> = None;
    for attr in props.iter() {
        let (name, rhs) = split_jsx_attr(attr);
        if !is_entry(name) {
            continue;
        }
        match name {
            "enter" => enter = Some(jsx_attr_expr(rhs)),
            "enterDelay" => delay = Some(jsx_attr_expr(rhs)),
            _ => {}
        }
    }
    props.retain(|attr| !is_entry(split_jsx_attr(attr).0));
    let Some(enter) = enter else { return };
    let call = match delay {
        Some(d) => format!("enterClassName({}, {})", enter, d),
        None => format!("enterClassName({})", enter),
    };
    match props
        .iter()
        .position(|attr| split_jsx_attr(attr).0 == "className")
    {
        Some(pos) => {
            let existing = jsx_attr_expr(split_jsx_attr(&props[pos]).1);
            props[pos] = format!(
                "className={{[{}, {}].filter(Boolean).join(\" \")}}",
                existing, call
            );
        }
        None => props.push(format!("className={{{}}}", call)),
    }
}

/// An injected universal `skeleton` (registry `kind: "skeleton"`) only feeds
/// the awaiting-skeleton prediction; a component that declares the prop
/// (no kind) receives it and draws it in its own loading state.
pub(crate) fn strip_skeleton_props(
    props: &mut Vec<String>,
    props_schema: Option<&HashMap<String, PropSchema>>,
) {
    let Some(schema) = props_schema else { return };
    props.retain(|attr| {
        schema
            .get(split_jsx_attr(attr).0)
            .and_then(|p| p.kind.as_deref())
            != Some("skeleton")
    });
}

#[cfg(test)]
mod entry_fold_tests {
    use super::*;

    fn prop(kind: Option<&str>) -> PropSchema {
        let v = match kind {
            Some(k) => serde_json::json!({ "types": ["string"], "kind": k }),
            None => serde_json::json!({ "types": ["string"] }),
        };
        serde_json::from_value(v).expect("prop schema")
    }

    fn schema() -> HashMap<String, PropSchema> {
        let mut m = HashMap::new();
        for (name, kind) in [
            ("enter", Some("entry")),
            ("enterDelay", Some("entry")),
            ("className", None),
            ("content", None),
        ] {
            m.insert(name.to_string(), prop(kind));
        }
        m
    }

    #[test]
    fn entry_props_fold_into_class_name_and_leave_the_component() {
        let s = schema();
        let mut props = vec![
            "content=\"hi\"".to_string(),
            "enter=\"rise\"".to_string(),
            "enterDelay={2}".to_string(),
        ];
        fold_entry_props(&mut props, Some(&s));
        assert_eq!(
            props,
            vec![
                "content=\"hi\"".to_string(),
                "className={enterClassName(\"rise\", 2)}".to_string()
            ]
        );
    }

    #[test]
    fn an_existing_class_name_keeps_its_value_beside_the_entry() {
        let s = schema();
        let mut props = vec![
            "className=\"p-4\"".to_string(),
            "enter=\"fade\"".to_string(),
        ];
        fold_entry_props(&mut props, Some(&s));
        assert_eq!(
            props,
            vec![
                "className={[\"p-4\", enterClassName(\"fade\")].filter(Boolean).join(\" \")}"
                    .to_string()
            ]
        );
    }

    #[test]
    fn control_no_entry_props_leaves_props_untouched() {
        let s = schema();
        let mut props = vec![
            "content=\"hi\"".to_string(),
            "className=\"p-4\"".to_string(),
        ];
        fold_entry_props(&mut props, Some(&s));
        assert_eq!(
            props,
            vec![
                "content=\"hi\"".to_string(),
                "className=\"p-4\"".to_string()
            ]
        );
    }

    #[test]
    fn an_injected_skeleton_prop_never_reaches_the_component() {
        let mut s = schema();
        s.insert("skeleton".to_string(), prop(Some("skeleton")));
        let mut props = vec![
            "content=\"hi\"".to_string(),
            "skeleton=\"list\"".to_string(),
        ];
        strip_skeleton_props(&mut props, Some(&s));
        assert_eq!(props, vec!["content=\"hi\"".to_string()]);
    }

    #[test]
    fn control_a_declared_skeleton_prop_reaches_the_component() {
        let mut s = schema();
        s.insert("skeleton".to_string(), prop(None));
        let mut props = vec!["skeleton=\"list\"".to_string()];
        strip_skeleton_props(&mut props, Some(&s));
        assert_eq!(props, vec!["skeleton=\"list\"".to_string()]);
    }

    #[test]
    fn edge_a_prop_named_enter_without_the_entry_kind_is_a_normal_prop() {
        let mut s = schema();
        s.insert("enter".to_string(), prop(None));
        let mut props = vec!["enter=\"rise\"".to_string()];
        fold_entry_props(&mut props, Some(&s));
        assert_eq!(props, vec!["enter=\"rise\"".to_string()]);
    }
}

#[cfg(test)]
mod relation_field_tests {
    use super::*;

    fn relation_field_info(entity: &str, cardinality: Option<&str>) -> EntityFieldInfo {
        EntityFieldInfo {
            form_type: "relation".to_string(),
            is_numeric: false,
            enum_values: None,
            relation_entity: Some(entity.to_string()),
            relation_cardinality: cardinality.map(|c| c.to_string()),
            required: true,
            description: None,
            element_ts_type: None,
        }
    }

    #[test]
    fn format_relation_value_includes_cardinality_when_present() {
        assert_eq!(
            format_relation_value("Person", Some("many")),
            "{ entity: \"Person\", cardinality: \"many\" }"
        );
    }

    #[test]
    fn format_relation_value_omits_cardinality_when_absent() {
        assert_eq!(
            format_relation_value("Person", None),
            "{ entity: \"Person\" }"
        );
    }

    #[test]
    fn detail_field_emits_object_relation_with_cardinality() {
        let info = relation_field_info("Card", Some("many"));
        let out = format_detail_field("cards", &info);
        assert_eq!(
            out,
            "{ key: \"cards\", type: \"relation\", relation: { entity: \"Card\", cardinality: \"many\" } }"
        );
    }

    #[test]
    fn detail_field_omits_cardinality_when_field_carries_none() {
        let info = relation_field_info("Card", None);
        let out = format_detail_field("cards", &info);
        assert_eq!(
            out,
            "{ key: \"cards\", type: \"relation\", relation: { entity: \"Card\" } }"
        );
    }

    /// `entity-field → emitted descriptor`, end to end through the real
    /// `form` pattern's field-enrichment path: a `many`-cardinality relation
    /// on the linked entity must survive into the generated `<Form>` JSX.
    /// std-wizard computes a step's form fields: `fields: (array/map @entity.currentFields
    /// (fn f { name: @f }))`. An operator call is an expression, not a list of field names.
    #[test]
    fn a_computed_form_fields_list_compiles_to_an_expression() {
        let backend = TypeScriptBackend::new();
        let lambda_body = {
            let mut o = HashMap::new();
            o.insert("name".to_string(), OirValue::String("@f".to_string()));
            OirValue::Object(o)
        };
        let mut config = HashMap::new();
        config.insert(
            "fields".to_string(),
            OirValue::Array(vec![
                OirValue::String("array/map".to_string()),
                OirValue::String("@entity.currentFields".to_string()),
                OirValue::Array(vec![
                    OirValue::String("fn".to_string()),
                    OirValue::String("f".to_string()),
                    lambda_body,
                ]),
            ]),
        );
        let jsx = backend.generate_pattern_from_registry("form", &config, Some("Step"), None);
        assert!(
            !jsx.contains("name: \"array/map\""),
            "operator read as a field name: {jsx}"
        );
        assert!(jsx.contains(".map("), "expected the map to compile: {jsx}");
    }

    /// std-board's `formFields : [string] = (title description stage notes)` inlines as a
    /// `(list …)` constructor: its items are the field names, and `list` is not one.
    #[test]
    fn a_list_constructor_of_form_fields_is_its_field_names() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "fields".to_string(),
            OirValue::Array(vec![
                OirValue::String("list".to_string()),
                OirValue::String("title".to_string()),
                OirValue::String("stage".to_string()),
            ]),
        );
        let jsx = backend.generate_pattern_from_registry("form", &config, Some("Card"), None);
        assert!(jsx.contains("name: \"title\""), "{jsx}");
        assert!(jsx.contains("name: \"stage\""), "{jsx}");
        assert!(!jsx.contains("name: \"list\""), "{jsx}");
    }

    #[test]
    fn control_a_literal_form_fields_list_stays_field_names() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "fields".to_string(),
            OirValue::Array(vec![OirValue::String("title".to_string())]),
        );
        let jsx = backend.generate_pattern_from_registry("form", &config, Some("Step"), None);
        assert!(jsx.contains("name: \"title\""), "{jsx}");
    }

    #[test]
    fn many_cardinality_survives_into_form_field_injection() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "fields".to_string(),
            OirValue::Array(vec![OirValue::String("assignees".to_string())]),
        );
        let mut entity_field_types = HashMap::new();
        entity_field_types.insert(
            "assignees".to_string(),
            relation_field_info("Person", Some("many")),
        );

        let jsx = backend.generate_pattern_from_registry(
            "form",
            &config,
            Some("Ticket"),
            Some(&entity_field_types),
        );

        assert!(
            jsx.contains("relation: { entity: \"Person\", cardinality: \"many\" }"),
            "expected the many-cardinality relation descriptor in the emitted form fields, got: {}",
            jsx
        );
    }

    /// Same entity-field → emitted-descriptor path through `detail-panel`'s
    /// DISPLAY field enrichment (`format_detail_field`).
    #[test]
    fn many_cardinality_survives_into_detail_panel_field_injection() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "fields".to_string(),
            OirValue::Array(vec![OirValue::String("assignees".to_string())]),
        );
        let mut entity_field_types = HashMap::new();
        entity_field_types.insert(
            "assignees".to_string(),
            relation_field_info("Person", Some("many")),
        );

        let jsx = backend.generate_pattern_from_registry(
            "detail-panel",
            &config,
            Some("Ticket"),
            Some(&entity_field_types),
        );

        assert!(
            jsx.contains("relation: { entity: \"Person\", cardinality: \"many\" }"),
            "expected the many-cardinality relation descriptor in the emitted detail fields, got: {}",
            jsx
        );
    }

    /// `relationsData` auto-injection must key off the DECLARED propsSchema,
    /// not the `fieldsContract` gate alone: `document-details` shares
    /// `detail-panel`'s `display` fields contract but its React component
    /// (and registry propsSchema) has no `relationsData` prop — injecting it
    /// anyway produced a bogus `Property 'relationsData' does not exist`
    /// TS2322. `detail-panel` DOES declare it and must keep getting it.
    #[test]
    fn relations_data_only_injected_when_pattern_declares_it() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "fields".to_string(),
            OirValue::Array(vec![OirValue::String("assignees".to_string())]),
        );
        let mut entity_field_types = HashMap::new();
        entity_field_types.insert(
            "assignees".to_string(),
            relation_field_info("Person", Some("many")),
        );

        let no_relations_data = backend.generate_pattern_from_registry(
            "document-details",
            &config,
            Some("Ticket"),
            Some(&entity_field_types),
        );
        assert!(
            !no_relations_data.contains("relationsData="),
            "document-details has no relationsData prop in its schema, got: {}",
            no_relations_data
        );

        let with_relations_data = backend.generate_pattern_from_registry(
            "detail-panel",
            &config,
            Some("Ticket"),
            Some(&entity_field_types),
        );
        assert!(
            with_relations_data.contains("relationsData="),
            "detail-panel declares relationsData and must still get it, got: {}",
            with_relations_data
        );
    }

    /// `relationsData` auto-injection must also read the entity-bound field
    /// list from `columns` (the wire key table-view/data-list/data-grid
    /// author) when `fields` is absent, and must resolve the
    /// entity field from a column's `field` override in preference to its
    /// `key` — mirrors `TableViewColumn`'s `{key, field}` contract, where
    /// `field` (defaulting to `key`) names the actual entity field. Exercised
    /// through `detail-panel` (already `relationsData`-declaring in the baked
    /// registry) since the column-bearing patterns' own registry entries
    /// (fieldsContract + relationsData propsSchema) sync separately —
    /// `pattern-sync patterns`/`rust` + `make release install` — owned by the
    /// coordinator pass, not this crate.
    #[test]
    fn relations_data_reads_columns_key_and_field_override() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        let mut column = HashMap::new();
        column.insert(
            "key".to_string(),
            OirValue::String("interviewer".to_string()),
        );
        column.insert(
            "field".to_string(),
            OirValue::String("assignees".to_string()),
        );
        config.insert(
            "columns".to_string(),
            OirValue::Array(vec![OirValue::Object(column)]),
        );

        let mut entity_field_types = HashMap::new();
        entity_field_types.insert(
            "assignees".to_string(),
            relation_field_info("Person", Some("many")),
        );

        let jsx = backend.generate_pattern_from_registry(
            "detail-panel",
            &config,
            Some("Ticket"),
            Some(&entity_field_types),
        );

        assert!(
            jsx.contains("relationsData={{ assignees:"),
            "expected relationsData keyed by the column's `field` override (\"assignees\"), not its `key` (\"interviewer\"), got: {}",
            jsx
        );
    }
}

#[cfg(test)]
mod drawable_items_tests {
    use super::*;

    fn mesh() -> OirValue {
        let mut m = HashMap::new();
        m.insert("type".to_string(), OirValue::String("draw-mesh".to_string()));
        m.insert("shape".to_string(), OirValue::String("sphere".to_string()));
        m.insert("radius".to_string(), OirValue::Number(1.0));
        OirValue::Object(m)
    }

    /// G-ORB-164: a draw-group's `items` are drawable data the painter reads; as JSX
    /// elements the group painted nothing (the almadar.io hero scene was blank compiled).
    #[test]
    fn drawable_items_compile_to_data_not_elements() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert("items".to_string(), OirValue::Array(vec![mesh()]));
        let jsx = backend.generate_pattern_from_registry("draw-group", &config, None, None);
        assert!(!jsx.contains("<DrawMesh"), "{jsx}");
        assert!(jsx.contains("type: \"draw-mesh\""), "{jsx}");
        assert!(jsx.contains("radius: 1"), "{jsx}");
    }

    #[test]
    fn control_an_empty_drawable_list_stays_empty() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert("items".to_string(), OirValue::Array(vec![]));
        let jsx = backend.generate_pattern_from_registry("draw-group", &config, None, None);
        assert!(jsx.contains("items={[]}"), "{jsx}");
    }
}

#[cfg(test)]
mod required_discriminant_tests {
    use super::*;

    /// G-ORB-164: a draw child's `type` is a required string whose only allowed value is the
    /// pattern's own name. Defaulting it to `""` left the canvas with nothing it could draw.
    #[test]
    fn a_missing_single_value_required_prop_takes_that_value() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert("shape".to_string(), OirValue::String("sphere".to_string()));
        let jsx = backend.generate_pattern_from_registry("draw-mesh", &config, None, None);
        assert!(jsx.contains("type=\"draw-mesh\""), "{jsx}");
        assert!(!jsx.contains("type=\"\""), "{jsx}");
    }

    #[test]
    fn control_a_missing_free_text_required_prop_stays_empty() {
        let backend = TypeScriptBackend::new();
        let config = HashMap::new();
        let jsx = backend.generate_pattern_from_registry("notification", &config, None, None);
        assert!(jsx.contains("message=\"\""), "{jsx}");
    }
}

#[cfg(test)]
mod string_or_number_prop_tests {
    use super::*;

    /// std-stats feeds `@card.value` (a number) into stat-display's `value: number | string`;
    /// the component formats numbers (currency, percent), so the number must reach it as one.
    #[test]
    fn a_wide_binding_into_a_string_or_number_prop_keeps_its_number() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert("value".to_string(), OirValue::String("@payload.total".to_string()));
        config.insert("label".to_string(), OirValue::String("Total".to_string()));
        config.insert("format".to_string(), OirValue::String("currency".to_string()));
        let jsx = backend.generate_pattern_from_registry("stat-display", &config, None, None);
        assert!(jsx.contains("=== 'number'"), "number not preserved: {jsx}");
    }

    #[test]
    fn control_a_wide_binding_into_a_string_only_prop_is_still_a_string() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert("value".to_string(), OirValue::Number(1.0));
        config.insert("label".to_string(), OirValue::String("@payload.name".to_string()));
        let jsx = backend.generate_pattern_from_registry("stat-display", &config, None, None);
        assert!(jsx.contains("String("), "string-only prop lost its coercion: {jsx}");
        assert!(!jsx.contains("label={(typeof"), "{jsx}");
    }
}

#[cfg(test)]
mod entity_prop_operator_expression_tests {
    use super::*;

    /// End-to-end reproduction of std-notes' `NoteTagNotesOverlay`: a
    /// `data-list` pattern's `entity:` prop bound to a filter expression
    /// over a payload field typed `[Note]` (via `OirTrait.events[].
    /// payload_schema`, `Array<Reference<Note>>` — the shape
    /// `payload_field_to_oir_type`, orbital-compiler's `resolve.rs`, now
    /// produces for an entity-marked payload field instead of flattening it
    /// to an anonymous struct). The emitted cast must name the declared
    /// entity (`readonly Note[]`, assignable to `readonly EntityRow[]`),
    /// never an inline structural literal (which fails TS2322 against a
    /// DERIVED entity interface like `Author` — no index signature).
    #[test]
    fn data_list_entity_filter_over_declared_entity_payload_emits_named_type() {
        let backend = TypeScriptBackend::new();

        let mut catalog = HashMap::new();
        catalog.insert("Note".to_string(), orbital_core::ir::OirEntity::new("Note"));
        backend.entity_catalog.set(catalog);

        let mut payload_schema = HashMap::new();
        payload_schema.insert(
            "data".to_string(),
            orbital_core::ir::OirType::array(orbital_core::ir::OirType::reference("Note")),
        );
        backend.current_payload_schema.set(Some(payload_schema));

        // `(array/filter ?data (fn row (array/includes @row.tagIds @entity.pendingId)))`
        // — `?data` is `.lolo` sugar for `@payload.data`, already resolved by
        // the time it reaches the `.orb` IR this config mirrors.
        let entity_expr = OirValue::Array(vec![
            OirValue::String("array/filter".to_string()),
            OirValue::String("@payload.data".to_string()),
            OirValue::Array(vec![
                OirValue::String("fn".to_string()),
                OirValue::String("row".to_string()),
                OirValue::Array(vec![
                    OirValue::String("array/includes".to_string()),
                    OirValue::String("@row.tagIds".to_string()),
                    OirValue::String("@entity.pendingId".to_string()),
                ]),
            ]),
        ]);
        let mut config = HashMap::new();
        config.insert("entity".to_string(), entity_expr);
        config.insert("fields".to_string(), OirValue::Array(vec![]));

        let jsx = backend.generate_pattern_from_registry("data-list", &config, Some("Note"), None);

        assert!(
            jsx.contains("readonly Note[]"),
            "expected the declared entity's own row interface, got: {}",
            jsx
        );
        assert!(
            !jsx.contains("id: string"),
            "must not fall back to an inline structural literal, got: {}",
            jsx
        );
    }
}

#[cfg(test)]
mod conditional_item_actions_codegen_tests {
    use super::*;

    fn descriptor(event: &str) -> OirValue {
        let mut obj = HashMap::new();
        obj.insert("label".to_string(), OirValue::String("Edit".to_string()));
        obj.insert("event".to_string(), OirValue::String(event.to_string()));
        OirValue::Object(obj)
    }

    fn conditional_item_actions(then_event: &str, else_event: &str) -> OirValue {
        OirValue::Array(vec![
            OirValue::String("if".to_string()),
            OirValue::Array(vec![
                OirValue::String("=".to_string()),
                OirValue::String("@user.role".to_string()),
                OirValue::String("reader".to_string()),
            ]),
            OirValue::Array(vec![descriptor(then_event)]),
            OirValue::Array(vec![descriptor(else_event)]),
        ])
    }

    /// A conditional (`if`-wrapped) `itemActions` config must scope-qualify
    /// AND emit descriptors from BOTH branches as a real TS ternary — not
    /// treat the 4-element `["if", cond, then, else]` array as a flat list
    /// of literal action objects (the same flattening trap `actions` was
    /// fixed for, C-ACTIONS-IF-FLATTENED-TO-EMPTY-OBJECTS).
    #[test]
    fn item_actions_conditional_qualifies_and_emits_both_branches() {
        let backend = TypeScriptBackend::new();
        backend
            .current_trait_scope
            .set(Some("MyOrbital.MyTrait".to_string()));
        let mut config = HashMap::new();
        config.insert(
            "itemActions".to_string(),
            conditional_item_actions("EDIT_ITEM", "VIEW_ITEM"),
        );

        let jsx = backend.generate_pattern_from_registry("data-list", &config, None, None);

        assert!(
            jsx.contains("itemActions={"),
            "expected an itemActions attribute, got: {}",
            jsx
        );
        assert!(
            jsx.contains("? [") && jsx.contains("] : ["),
            "expected a real ternary between the two branches, got: {}",
            jsx
        );
        assert!(
            jsx.contains("event: \"MyOrbital.MyTrait.EDIT_ITEM\""),
            "then-branch event must be scope-qualified, got: {}",
            jsx
        );
        assert!(
            jsx.contains("event: \"MyOrbital.MyTrait.VIEW_ITEM\""),
            "else-branch event must be scope-qualified, got: {}",
            jsx
        );
    }

    /// Literal (non-conditional) `itemActions` codegen is unaffected —
    /// byte-identical qualification/emission to the pre-fix direct path.
    #[test]
    fn item_actions_literal_list_still_qualifies_and_emits() {
        let backend = TypeScriptBackend::new();
        backend
            .current_trait_scope
            .set(Some("MyOrbital.MyTrait".to_string()));
        let mut config = HashMap::new();
        config.insert(
            "itemActions".to_string(),
            OirValue::Array(vec![descriptor("EDIT_ITEM")]),
        );

        let jsx = backend.generate_pattern_from_registry("data-list", &config, None, None);

        assert!(
            jsx.contains("itemActions={[{ label: \"Edit\", event: \"MyOrbital.MyTrait.EDIT_ITEM\" }]}"),
            "expected the literal single-item itemActions list unaffected by the conditional fix, got: {}",
            jsx
        );
    }
}

#[cfg(test)]
mod computed_and_row_conditional_item_actions_tests {
    use super::*;

    fn s(v: &str) -> OirValue {
        OirValue::String(v.to_string())
    }

    fn arr(items: Vec<OirValue>) -> OirValue {
        OirValue::Array(items)
    }

    /// `(array/filter @config.itemActions (fn action <roles gate>))` — the
    /// list every generated `ui-*` factory and std atom hands its host pattern.
    fn role_filtered(knob: &str) -> OirValue {
        arr(vec![
            s("array/filter"),
            s(&format!("@config.{knob}")),
            arr(vec![
                s("fn"),
                s("action"),
                arr(vec![
                    s("or"),
                    arr(vec![
                        s("="),
                        arr(vec![
                            s("array/len"),
                            arr(vec![s("object/get"), s("@action"), s("roles"), arr(vec![])]),
                        ]),
                        OirValue::Number(0.0),
                    ]),
                    arr(vec![
                        s("array/includes"),
                        arr(vec![s("object/get"), s("@action"), s("roles"), arr(vec![])]),
                        s("@config.viewerRole"),
                    ]),
                ]),
            ]),
        ])
    }

    fn row_when() -> OirValue {
        arr(vec![
            s("fn"),
            s("row"),
            arr(vec![
                s("="),
                arr(vec![s("object/get"), s("@row"), s("ownerId")]),
                s("@user.id"),
            ]),
        ])
    }

    fn descriptor(event: &str, when: Option<OirValue>) -> OirValue {
        let mut obj = HashMap::new();
        obj.insert("label".to_string(), s("Edit"));
        obj.insert("event".to_string(), s(event));
        if let Some(w) = when {
            obj.insert("when".to_string(), w);
        }
        OirValue::Object(obj)
    }

    fn jsx_for(pattern: &str, actions: OirValue) -> String {
        let backend = TypeScriptBackend::new();
        backend
            .current_trait_scope
            .set(Some("MyOrbital.MyTrait".to_string()));
        let mut config = HashMap::new();
        config.insert("itemActions".to_string(), actions);
        backend.generate_pattern_from_registry(pattern, &config, None, None)
    }

    /// A computed (operator-call) `itemActions` list must compile to a real
    /// TS expression over the config list, not one `{}` per operand.
    #[test]
    fn role_filtered_item_actions_compile_to_a_filter_expression_not_empty_objects() {
        let jsx = jsx_for("data-grid", role_filtered("itemActions"));
        assert!(
            !jsx.contains("[{}, {}, {}]"),
            "the operator call was read as three literal descriptors: {jsx}"
        );
        assert!(jsx.contains("itemActions={"), "{jsx}");
        assert!(
            jsx.contains(".filter("),
            "expected the role filter to compile, got: {jsx}"
        );
        assert!(
            jsx.contains(")[]).filter("),
            "the source list must be cast to the element shape BEFORE it is filtered, got: {jsx}"
        );
        assert!(
            jsx.contains("'MyOrbital.MyTrait.' + __a.event"),
            "computed descriptors must be scope-qualified at render time, got: {jsx}"
        );
        assert!(
            jsx.contains("when?: never") && jsx.contains(")[]).map((__a)"),
            "the computed list must be cast to the host's declared element shape, \
             with the closure-or-S-expression `when` spelled `never`, got: {jsx}"
        );
    }

    /// The same computed list inside an `if` branch is lowered per branch.
    #[test]
    fn role_filtered_list_inside_a_conditional_branch_compiles_too() {
        let cond = arr(vec![s("="), s("@user.role"), s("reader")]);
        let value = arr(vec![
            s("if"),
            cond,
            role_filtered("itemActions"),
            arr(vec![descriptor("VIEW_ITEM", None)]),
        ]);
        let jsx = jsx_for("data-list", value);
        assert!(jsx.contains(".filter("), "{jsx}");
        assert!(
            jsx.contains("event: \"MyOrbital.MyTrait.VIEW_ITEM\""),
            "{jsx}"
        );
        assert!(!jsx.contains("{}, {}"), "{jsx}");
    }

    /// A literal descriptor's `when` survives as the S-expression data the
    /// interpreter delivers, beside the scope-qualified event.
    #[test]
    fn literal_descriptor_carries_when_as_data() {
        let jsx = jsx_for(
            "data-list",
            arr(vec![descriptor("EDIT_ITEM", Some(row_when()))]),
        );
        assert!(
            jsx.contains("when: [\"fn\", \"row\", [\"=\", [\"object/get\", \"@row\", \"ownerId\"], \"@user.id\"]]"),
            "the row condition must be emitted verbatim as data, got: {jsx}"
        );
        assert!(
            jsx.contains("event: \"MyOrbital.MyTrait.EDIT_ITEM\""),
            "{jsx}"
        );
    }

    /// Control: a descriptor with no `when` emits none, byte-identical to before.
    #[test]
    fn literal_descriptor_without_when_emits_no_when() {
        let jsx = jsx_for("data-list", arr(vec![descriptor("EDIT_ITEM", None)]));
        assert!(!jsx.contains("when:"), "{jsx}");
        assert!(
            jsx.contains(
                "itemActions={[{ label: \"Edit\", event: \"MyOrbital.MyTrait.EDIT_ITEM\" }]}"
            ),
            "{jsx}"
        );
    }

    /// Edge: a mixed literal list keeps `when` only on the descriptors that declare it.
    #[test]
    fn when_is_emitted_only_on_the_descriptor_that_declares_it() {
        let jsx = jsx_for(
            "data-list",
            arr(vec![
                descriptor("VIEW_ITEM", None),
                descriptor("EDIT_ITEM", Some(row_when())),
            ]),
        );
        assert_eq!(jsx.matches("when:").count(), 1, "{jsx}");
    }
}

#[cfg(test)]
mod conditional_children_codegen_tests {
    use super::*;

    /// A `children` array entry that is a 4-element `["if", cond, then,
    /// else]` array (`.lolo` `(if cond <node> null)` inside a render tree —
    /// e.g. std-notes' `NoteTagBrowse`) must compile to a real TS ternary via
    /// `child_to_jsx`, not fall through the array/Object/String match to the
    /// `"null /* invalid child */"` string literal — which landed in JSX TEXT
    /// position and rendered the literal text while the conditional node
    /// (the button) never rendered at all.
    #[test]
    fn if_array_child_compiles_to_ternary_not_invalid_child() {
        let backend = TypeScriptBackend::new();

        let mut typography_obj = HashMap::new();
        typography_obj.insert(
            "type".to_string(),
            OirValue::String("typography".to_string()),
        );

        let mut button_obj = HashMap::new();
        button_obj.insert("type".to_string(), OirValue::String("button".to_string()));
        button_obj.insert("label".to_string(), OirValue::String("Edit".to_string()));
        button_obj.insert("event".to_string(), OirValue::String("NEW_TAG".to_string()));

        let mut data_grid_obj = HashMap::new();
        data_grid_obj.insert(
            "type".to_string(),
            OirValue::String("data-grid".to_string()),
        );

        let if_child = OirValue::Array(vec![
            OirValue::String("if".to_string()),
            OirValue::Array(vec![
                OirValue::String("=".to_string()),
                OirValue::String("@user.role".to_string()),
                OirValue::String("admin".to_string()),
            ]),
            OirValue::Object(button_obj),
            OirValue::Null,
        ]);

        let mut config = HashMap::new();
        config.insert(
            "children".to_string(),
            OirValue::Array(vec![
                OirValue::Object(typography_obj),
                if_child,
                OirValue::Object(data_grid_obj),
            ]),
        );

        let jsx = backend.generate_pattern_from_registry("stack", &config, None, None);

        assert!(
            jsx.contains("? (<Button"),
            "expected a real ternary then-arm rendering the Button, got: {}",
            jsx
        );
        assert!(
            jsx.contains(") : (null)"),
            "expected the else-arm to be the bare `null` expression, got: {}",
            jsx
        );
        assert!(
            !jsx.contains("invalid child"),
            "the if-array child must not fall through to the invalid-child fallback, got: {}",
            jsx
        );
    }

    fn obj(entries: &[(&str, OirValue)]) -> OirValue {
        OirValue::Object(
            entries
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
        )
    }

    fn s(v: &str) -> OirValue {
        OirValue::String(v.to_string())
    }

    fn mapped_children(body: OirValue) -> HashMap<String, OirValue> {
        let mut config = HashMap::new();
        config.insert(
            "children".to_string(),
            OirValue::Array(vec![
                s("array/map"),
                s("@config.rows"),
                OirValue::Array(vec![s("fn"), s("row"), body]),
            ]),
        );
        config
    }

    /// std-media-section maps rows through `(fn row (if <cond> {…} {…}))` and
    /// reads `@index` (bound by both evaluators' `apply_callback`); the
    /// compiled path flattened it into three invalid children.
    #[test]
    fn mapped_children_with_an_if_body_compile_to_a_map_of_ternaries() {
        let backend = TypeScriptBackend::new();
        let body = OirValue::Array(vec![
            s("if"),
            OirValue::Array(vec![s("=="), s("@row.mediaSrc"), s("")]),
            obj(&[("type", s("typography")), ("content", s("@row.heading"))]),
            obj(&[
                ("type", s("split")),
                (
                    "reverse",
                    OirValue::Array(vec![s("=="), s("@index"), OirValue::Number(1.0)]),
                ),
            ]),
        ]);
        let jsx =
            backend.generate_pattern_from_registry("stack", &mapped_children(body), None, None);

        assert!(
            !jsx.contains("invalid child") && !jsx.contains("non-binding"),
            "{jsx}"
        );
        assert!(jsx.contains(".map((row, index) => ("), "{jsx}");
        assert!(jsx.contains("? (<Typography"), "{jsx}");
        assert!(jsx.contains(": (<Split"), "{jsx}");
    }

    #[test]
    fn control_mapped_children_with_an_object_body_bind_only_the_declared_param() {
        let backend = TypeScriptBackend::new();
        let body = obj(&[("type", s("typography")), ("content", s("@row.heading"))]);
        let jsx =
            backend.generate_pattern_from_registry("stack", &mapped_children(body), None, None);

        assert!(jsx.contains(".map((row) => (<Typography"), "{jsx}");
    }
}

#[cfg(test)]
mod conditional_prop_literal_codegen_tests {
    use super::*;

    fn if_prop(cond: OirValue, then_arm: OirValue, else_arm: OirValue) -> OirValue {
        OirValue::Array(vec![
            OirValue::String("if".to_string()),
            cond,
            then_arm,
            else_arm,
        ])
    }

    /// A resolved literal-`true` condition (config already resolved, e.g.
    /// `(if @config.childAction ADD_CHILD null)` → `["if", true, ...]`)
    /// folds at compile time to the taken arm's callback wrapper — no dead
    /// ternary, no `null` arm a `((id: string) => void) | undefined` prop
    /// would reject (TS2322).
    #[test]
    fn if_literal_true_on_callback_prop_folds_to_dispatch_wrapper() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "onNodeAction".to_string(),
            if_prop(
                OirValue::Bool(true),
                OirValue::String("ADD_CHILD".to_string()),
                OirValue::Null,
            ),
        );

        let jsx = backend.generate_pattern_from_registry("file-tree", &config, None, None);

        assert!(
            jsx.contains("onNodeAction={(id) => dispatch('ADD_CHILD', { id })}"),
            "expected a literal-true condition to fold to the bare dispatch wrapper, got: {}",
            jsx
        );
        assert!(
            !jsx.contains(": null"),
            "must not leave a dead `: null` ternary arm, got: {}",
            jsx
        );
    }

    /// A resolved literal-`false` condition folds onto the `null` arm, which
    /// carries no value for this prop — the outlet must be OMITTED, not
    /// rendered as a dead `() => dispatch(...)` handler that never should
    /// have fired.
    #[test]
    fn if_literal_false_on_callback_prop_omits_the_prop() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "onNodeAction".to_string(),
            if_prop(
                OirValue::Bool(false),
                OirValue::String("ADD_CHILD".to_string()),
                OirValue::Null,
            ),
        );

        let jsx = backend.generate_pattern_from_registry("file-tree", &config, None, None);

        assert!(
            !jsx.contains("onNodeAction="),
            "a literal-false outlet must not render a dead handler, got: {}",
            jsx
        );
    }

    /// A genuinely dynamic condition (`@config.x`) compiles to a real TS
    /// ternary — the callback wrap applies to the taken arm and the
    /// no-value arm becomes `undefined` (never `null`, which the prop's
    /// `((id: string) => void) | undefined` type would reject).
    #[test]
    fn if_dynamic_cond_on_callback_prop_emits_ternary_with_undefined() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "onNodeAction".to_string(),
            if_prop(
                OirValue::String("@config.childAction".to_string()),
                OirValue::String("ADD_CHILD".to_string()),
                OirValue::Null,
            ),
        );

        let jsx = backend.generate_pattern_from_registry("file-tree", &config, None, None);

        assert!(
            jsx.contains("? (id) => dispatch('ADD_CHILD', { id }) : undefined"),
            "expected a real ternary with an `undefined` else-arm, got: {}",
            jsx
        );
        assert!(
            !jsx.contains(": null"),
            "an optional callback prop must never receive a `null` arm, got: {}",
            jsx
        );
    }

    /// An `event-ref` prop (registry `kind: "event-ref"`, TS type
    /// `EventEmit<P> = string & {...}`, e.g. `document-panel.editEvent`)
    /// takes the plain-string literal arm as-is and the no-value arm as
    /// `undefined` — `null` is not a `string`.
    #[test]
    fn if_on_event_ref_prop_emits_undefined_not_null() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "editEvent".to_string(),
            if_prop(
                OirValue::String("@config.allowEdit".to_string()),
                OirValue::String("EDIT_CONTENT".to_string()),
                OirValue::Null,
            ),
        );

        let jsx = backend.generate_pattern_from_registry("document-panel", &config, None, None);

        assert!(
            jsx.contains("? \"EDIT_CONTENT\" : undefined"),
            "expected the event-ref prop's dead arm to compile to `undefined`, not `null`, got: {}",
            jsx
        );
        assert!(
            !jsx.contains(": null"),
            "an EventEmit<P> prop must never receive a `null` arm (TS2322), got: {}",
            jsx
        );
    }
}

/// §83 (Almadar_Compiler_Gaps.md): `onChange`/`onClear` on `input`/
/// `input-group`/`textarea`/`select`/`checkbox` declare `types:
/// ["function","string"]` (a JS callback OR a bare declarative event
/// name, same dual contract `action` has). Before the fix, `literal_prop_expr`
/// saw `"function"` in `types` and ALWAYS wrapped the value in a
/// value-dropping `() => dispatch(event)` closure — a controlled input's
/// keystroke never reached the transition's `?value` payload. The registry
/// now marks these `kind: "event-ref"`, and codegen must prefer the plain
/// qualified string (the form `@almadar/ui`'s `Input.tsx` itself detects
/// and turns into a bus emit carrying `{value}`/`{checked}`), matching how
/// `@almadar/runtime` already behaves for the identical `.lolo` binding.
#[cfg(test)]
mod dual_mode_event_ref_prop_codegen_tests {
    use super::*;

    #[test]
    fn onchange_on_dual_typed_input_prop_emits_qualified_string_not_closure() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "onChange".to_string(),
            OirValue::String("DRAFT_CHANGED".to_string()),
        );

        let jsx = backend.generate_pattern_from_registry("input", &config, None, None);

        assert!(
            jsx.contains("onChange={\"DRAFT_CHANGED\"}"),
            "expected the declarative string form (no captured value is dropped), got: {}",
            jsx
        );
        assert!(
            !jsx.contains("() => dispatch('DRAFT_CHANGED')"),
            "must not wrap a dual-typed event-ref prop in a value-dropping closure, got: {}",
            jsx
        );
    }

    #[test]
    fn onchange_on_dual_typed_checkbox_prop_emits_qualified_string_not_closure() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "onChange".to_string(),
            OirValue::String("TOGGLE_ACTIVE".to_string()),
        );

        let jsx = backend.generate_pattern_from_registry("checkbox", &config, None, None);

        assert!(
            jsx.contains("onChange={\"TOGGLE_ACTIVE\"}"),
            "expected the declarative string form, got: {}",
            jsx
        );
        assert!(
            !jsx.contains("() => dispatch('TOGGLE_ACTIVE')"),
            "must not wrap checkbox's dual-typed onChange in a closure, got: {}",
            jsx
        );
    }

    /// A genuinely callback-only prop (`types: ["function"]`, no
    /// `kind: "event-ref"` — e.g. `switch.onChange`) must keep wrapping in
    /// the `dispatch(...)` closure; the fix must not regress single-mode
    /// callback props.
    #[test]
    fn onchange_on_callback_only_switch_prop_still_wraps_in_dispatch_closure() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "onChange".to_string(),
            OirValue::String("TOGGLED".to_string()),
        );

        let jsx = backend.generate_pattern_from_registry("switch", &config, None, None);

        assert!(
            jsx.contains("onChange={(checked) => dispatch('TOGGLED', { checked })}"),
            "callback-only (non-event-ref) props must keep the dispatch-closure wrap, got: {}",
            jsx
        );
    }
}

#[cfg(test)]
mod node_typed_actions_codegen_tests {
    use super::*;

    /// Codegen defect (9): `alert.actions` declares `propsSchema.actions.types
    /// == ["node"]` (its React prop is `actions?: React.ReactNode`, not a
    /// list of action descriptors) — a `@config.actions` forward must be
    /// routed through `renderPatternValue`, never the array-coercion arm
    /// (`Array.isArray(...) ? (... as readonly EntityRow[]) : []`), which is
    /// TS2322 against `ReactNode`. Reproduces the exact
    /// `std-record-detail.lolo` error-state shape
    /// (`(render-ui main { ... type: alert, variant: error })` composed by
    /// `TimesheetViewer` in `std-time-tracking.lolo`) once its call site
    /// forwards `actions: @config.actions`.
    #[test]
    fn alert_actions_config_forward_routes_through_render_pattern_value_not_array_cast() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "actions".to_string(),
            OirValue::String("@config.actions".to_string()),
        );

        let jsx = backend.generate_pattern_from_registry("alert", &config, None, None);

        assert!(
            !jsx.contains("as readonly EntityRow[]"),
            "a node-typed actions prop must never emit the array cast, got: {}",
            jsx
        );
        assert!(
            jsx.contains("actions={renderPatternValue("),
            "expected the node-typed config forward to route through renderPatternValue, got: {}",
            jsx
        );
    }

    /// An `actions` prop the registry declares `types: ["array"]` for (the
    /// common case — `RecordAction[]` lists on detail/list patterns) keeps
    /// going through the array-coercion arm; this defect's fix is keyed on
    /// the prop's declared type, not a blanket bypass of `bound_array_prop`.
    #[test]
    fn array_typed_actions_config_forward_still_casts_as_an_array() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "actions".to_string(),
            OirValue::String("@config.actions".to_string()),
        );

        let jsx = backend.generate_pattern_from_registry("detail-panel", &config, None, None);

        assert!(
            jsx.contains("as readonly"),
            "an array-typed actions prop must keep its array cast, got: {}",
            jsx
        );
    }
}

#[cfg(test)]
mod absent_optional_prop_tests {
    use super::*;

    /// std-breakout's canvas: `tileWidth` and `backgroundColor` are optional knobs the
    /// organism leaves unset. The runtime passes `undefined`, so the component uses its
    /// own default; the compiled prop must not invent `0` / `''` (a `tileWidth` of 0
    /// paints every cell zero pixels wide — a blank board).
    #[test]
    fn an_absent_optional_knob_stays_absent() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "tileWidth".to_string(),
            OirValue::String("@config.tileWidth".to_string()),
        );
        config.insert(
            "backgroundColor".to_string(),
            OirValue::String("@config.backgroundColor".to_string()),
        );
        let jsx = backend.generate_pattern_from_registry("canvas", &config, None, None);
        assert!(
            !jsx.contains("tileWidth={Number(config?.tileWidth ?? 0)}"),
            "{jsx}"
        );
        assert!(
            jsx.contains(
                "tileWidth={(config?.tileWidth == null ? undefined : Number(config?.tileWidth))}"
            ),
            "{jsx}"
        );
        assert!(
            !jsx.contains("backgroundColor={String(config?.backgroundColor ?? '')}"),
            "{jsx}"
        );
        assert!(jsx.contains("backgroundColor={(config?.backgroundColor == null ? undefined : String(config?.backgroundColor))}"), "{jsx}");
    }

    #[test]
    fn control_a_required_number_prop_keeps_its_default() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "value".to_string(),
            OirValue::String("@config.progress".to_string()),
        );
        let jsx = backend.generate_pattern_from_registry("progress-bar", &config, None, None);
        assert!(
            jsx.contains("value={Number(config?.progress ?? 0)}"),
            "{jsx}"
        );
    }
}

#[cfg(test)]
mod authored_text_attribute_tests {
    use super::*;

    /// A card's `description` becomes its `subtitle`; authored text with an apostrophe or
    /// a quote must survive as text (and keep the TSX valid), not break or show `\'`.
    #[test]
    fn a_card_description_needing_an_escape_is_an_expression() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "description".to_string(),
            OirValue::String("Don't say \"never\"".to_string()),
        );
        let jsx = backend.generate_pattern_from_registry("card", &config, None, None);
        assert!(
            jsx.contains("subtitle={'Don\\'t say \\\"never\\\"'}"),
            "{jsx}"
        );
    }

    #[test]
    fn control_a_plain_card_description_stays_an_attribute() {
        let backend = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "description".to_string(),
            OirValue::String("Plain".to_string()),
        );
        let jsx = backend.generate_pattern_from_registry("card", &config, None, None);
        assert!(jsx.contains("subtitle=\"Plain\""), "{jsx}");
    }
}

#[cfg(test)]
mod mapped_children_source_tests {
    use super::*;

    fn call(items: Vec<OirValue>) -> OirValue {
        OirValue::Array(items)
    }
    fn st(v: &str) -> OirValue {
        OirValue::String(v.to_string())
    }
    fn item_node() -> OirValue {
        let mut o = HashMap::new();
        o.insert("type".to_string(), st("typography"));
        o.insert("content".to_string(), st("@entry.label"));
        OirValue::Object(o)
    }

    /// orb.almadar.io's footer: `children: (array/map (object/get @column "links" []) (fn entry …))`.
    /// `object/get` yields a field value, not an array; the mapped source needs the
    /// nullable-array cast (TS2339 on `.map`, TS7006 on `entry` otherwise).
    #[test]
    fn mapped_children_over_a_non_array_call_cast_the_source() {
        let b = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "children".to_string(),
            call(vec![
                st("array/map"),
                call(vec![
                    st("object/get"),
                    st("@column"),
                    st("links"),
                    call(vec![]),
                ]),
                call(vec![st("fn"), st("entry"), item_node()]),
            ]),
        );
        let jsx = b.generate_pattern_from_registry("stack", &config, None, None);
        assert!(
            jsx.contains("as readonly EventPayloadValue[] | undefined) ?? []).map((entry) =>"),
            "{jsx}"
        );
    }

    #[test]
    fn control_mapped_children_over_an_array_call_keep_the_bare_source() {
        let b = TypeScriptBackend::new();
        let mut config = HashMap::new();
        config.insert(
            "children".to_string(),
            call(vec![
                st("array/map"),
                call(vec![st("array/range"), OirValue::Number(3.0)]),
                call(vec![st("fn"), st("entry"), item_node()]),
            ]),
        );
        let jsx = b.generate_pattern_from_registry("stack", &config, None, None);
        assert!(!jsx.contains("EventPayloadValue[]"), "{jsx}");
    }
}

#[cfg(test)]
mod render_item_lambda_shape_tests {
    use super::*;

    fn s(v: &str) -> OirValue {
        OirValue::String(v.to_string())
    }

    fn grid_with(render_item: OirValue) -> String {
        let mut body = std::collections::BTreeMap::new();
        body.insert("type".to_string(), s("typography"));
        body.insert("content".to_string(), s("@col.label"));
        let mut lambda = match render_item {
            OirValue::Array(head) => head,
            _ => unreachable!(),
        };
        lambda.push(OirValue::Object(body.into_iter().collect()));
        let mut config = HashMap::new();
        config.insert("entity".to_string(), s("@entity.boards"));
        config.insert("renderItem".to_string(), OirValue::Array(lambda));
        TypeScriptBackend::new().generate_pattern_from_registry("data-grid", &config, None, None)
    }

    /// std-board's `(fn (col colIndex) …)` lowers to the grouped
    /// `["fn", ["col", "colIndex"], body]`; codegen dropped it, so every
    /// compiled board drew empty columns.
    #[test]
    fn a_grouped_param_render_item_is_emitted() {
        let jsx = grid_with(OirValue::Array(vec![
            s("fn"),
            OirValue::Array(vec![s("col"), s("colIndex")]),
        ]));
        assert!(jsx.contains("(col") && jsx.contains("colIndex"), "{jsx}");
    }

    #[test]
    fn control_a_flat_param_render_item_is_emitted() {
        let jsx = grid_with(OirValue::Array(vec![s("fn"), s("col"), s("colIndex")]));
        assert!(jsx.contains("(col") && jsx.contains("colIndex"), "{jsx}");
    }
}
