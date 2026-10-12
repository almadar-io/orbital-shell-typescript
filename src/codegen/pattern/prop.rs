//! Config-value → JSX prop / literal conversion for render-ui patterns.
//!
//! Split from `pattern/registry.rs` as a pure module breakup.

use std::collections::HashMap;

use orbital_core::ir::OirValue;

use crate::backend::{escape_js_string, TypeScriptBackend};
use crate::codegen::expr::RENDER_PAYLOAD_VAR;
use crate::pattern_registry::{get_component_mapping, get_props_schema};

impl TypeScriptBackend {
    /// `Some(required)` when `key` on `pattern_type` is a Date-typed prop
    /// (registry `date`/`datetime`/`timestamp`), carrying whether it's required;
    /// `None` otherwise. Both the `@`-binding branch (wrap the resolved expr)
    /// and the literal branch (wrap a `@config`-substituted date default that
    /// arrives here as a bare string) consult this, so a date never reaches the
    /// JSX boundary as a `string` where a `Date` is required (CG-SWEEP-1 Cat 13).
    fn prop_date_coercion(pattern_type: Option<&str>, key: &str) -> Option<bool> {
        let prop_types = pattern_type.and_then(|pt| {
            orbital_core::language::pattern_props::get_prop_types(pt, key)
        })?;
        if !prop_types
            .iter()
            .any(|t| *t == "date" || *t == "datetime" || *t == "timestamp")
        {
            return None;
        }
        let required = pattern_type
            .and_then(|pt| get_props_schema(pt)?.get(key))
            .map(|s| s.required)
            .unwrap_or(false);
        Some(required)
    }

    /// Narrow `compiled` — the emitted TS for ANY operator-call prop value
    /// (`try_compile_sexpr_prop`) — to what `key`'s declared `types` promise.
    /// The compiled result is honestly wide whenever the chain bottoms out
    /// in `object/get`/`getNestedValue` (`FieldValue | undefined`, or an
    /// array of it): directly (`(object/get @item "variant")`), wrapped by
    /// another scalar op (`(str/default (object/get …) "")`), or one hop out
    /// through an `array/map` lambda whose body/object-literal members read
    /// through it. A `node`-typed destination (`ReactNode`, e.g. Badge/Alert
    /// `children`, Typography `content`) routes through `renderPatternValue`
    /// (`@almadar/ui`) exactly like a `@config.X` node forward — `FieldValue`
    /// includes `Date` and arbitrary nested objects, neither a `ReactNode`,
    /// so leaving it bare is TS2322. An `array`-typed destination routes
    /// through `narrow_wide_array_to_prop_type` — the same registry-element-
    /// shape owner used for a wide `@`-binding fed into an array prop
    /// (`needs_array_coerce`, below). Every OTHER structural type (`object`/
    /// `function`/`component`/`asset`/`icon`/`sexpr`) has its own owner
    /// elsewhere in this module and is returned unchanged; `date`-family
    /// props go through `prop_date_coercion` upstream of this call and won't
    /// reach here needing widening. `None`/unknown types (no registry entry)
    /// pass through unchanged — nothing to narrow to. A value whose compiled
    /// shape already matches the prop (a `str/concat` into a `string` prop)
    /// narrows to a harmless identity wrap, never a regression.
    /// `never_nullish`: the value's emitted TS is never nullish, so its coercion takes
    /// no `?? fallback` (TS2869 otherwise).
    /// A rich prop with a registry decoder (G-CROSS-131): the compiled value is decoded into the
    /// component's type by the owning package's decoder (imported into the view). A string passes
    /// through for a `T | string` prop; an absent value stays absent for an optional prop.
    pub(crate) fn decode_rich_prop(&self, pattern_type: Option<&str>, key: &str, compiled: &str) -> Option<String> {
        let prop = pattern_type.and_then(|pt| get_props_schema(pt)?.get(key))?;
        let decoder = prop.decoder.as_ref()?;
        let mut imports = self.view_value_imports.take();
        imports.insert((decoder.from.clone(), decoder.name.clone()));
        self.view_value_imports.set(imports);
        let decode = if decoder.accepts_string {
            format!("((v: EventPayloadValue) => typeof v === 'string' ? v : {}(v))({compiled})", decoder.name)
        } else {
            format!("{}({compiled})", decoder.name)
        };
        Some(if prop.required { decode } else { format!("(({compiled}) == null ? undefined : {decode})") })
    }

    /// The prop is declared `boolean` only and required.
    /// Whether the pattern declares `key` required: its value type then admits no `undefined`.
    pub(crate) fn required_prop(pattern_type: Option<&str>, key: &str) -> bool {
        pattern_type
            .and_then(|pt| get_props_schema(pt)?.get(key).map(|p| p.required))
            .unwrap_or(false)
    }

    /// `string | number`, with `| undefined` only when the prop is optional.
    pub(crate) fn string_or_number_ts(pattern_type: Option<&str>, key: &str) -> &'static str {
        if Self::required_prop(pattern_type, key) {
            "string | number"
        } else {
            "string | number | undefined"
        }
    }

    pub(crate) fn required_boolean_prop(pattern_type: Option<&str>, key: &str) -> bool {
        Self::required_prop(pattern_type, key)
            && pattern_type
                .and_then(|pt| orbital_core::language::pattern_props::get_prop_types(pt, key))
                .is_some_and(|types| !types.is_empty() && types.iter().all(|t| *t == "boolean"))
    }

    pub(crate) fn narrow_wide_accessor_to_prop_type(
        pattern_type: Option<&str>,
        key: &str,
        compiled: &str,
        never_nullish: bool,
    ) -> String {
        let or = |fallback: &str| {
            if never_nullish {
                String::new()
            } else {
                format!(" ?? {fallback}")
            }
        };
        let Some(types) = pattern_type.and_then(|pt| {
            orbital_core::language::pattern_props::get_prop_types(pt, key)
        }) else {
            return compiled.to_string();
        };
        if types.iter().any(|t| *t == "node") {
            return format!("renderPatternValue({})", compiled);
        }
        if types.iter().any(|t| *t == "array") {
            return Self::narrow_wide_array_to_prop_type(pattern_type, key, compiled);
        }
        let is_structural = types.iter().any(|t| {
            matches!(
                *t,
                "object"
                    | "function"
                    | "component"
                    | "icon"
                    | "sexpr"
                    | "date"
                    | "datetime"
                    | "timestamp"
            )
        });
        if is_structural {
            return compiled.to_string();
        }
        // Enum/union destination BEFORE the plain-string fallback: an
        // operator-compiled value (e.g. an `(if …)` ternary building a
        // Badge `variant`) is honestly a wide `string` at this point, not
        // the prop's narrow string-literal union — `String(x ?? '')`
        // keeps it a plain `string` (TS2322 against `BadgeVariant |
        // undefined`) and CAN also trip TS2869 on an already-non-nullish
        // ternary. Mirrors the `@`-binding branch's enum handling below,
        // the one other owner of this cast.
        if let Some(values) = pattern_type
            .and_then(|pt| {
                orbital_core::language::pattern_props::get_prop_enum_values(pt, key)
            })
            .filter(|v| !v.is_empty())
        {
            let union = values
                .iter()
                .map(|v| format!("'{}'", v))
                .collect::<Vec<_>>()
                .join(" | ");
            return format!("({} as {})", compiled, union);
        }
        // `asset` is core's `AssetUrl` (= `string`).
        let has_string = types.iter().any(|t| *t == "string" || *t == "asset");
        let has_number = types.iter().any(|t| *t == "number");
        let has_boolean = types.iter().any(|t| *t == "boolean");
        if let Some(union) = pattern_type.and_then(|pt| numeric_union_ts(pt, key)) {
            return format!("(Number({}{}) as {})", compiled, or("0"), union);
        }
        if has_string && has_number {
            format!("(({}) as {})", compiled, Self::string_or_number_ts(pattern_type, key))
        } else if has_string {
            let t = compiled.trim_start();
            // A literal (a knob conditional folded at codegen) is already a string.
            if t.starts_with('"') || t.starts_with('\'') || t.starts_with('`') {
                compiled.to_string()
            } else {
                format!("String({}{})", compiled, or("''"))
            }
        } else if has_number {
            format!("Number({}{})", compiled, or("0"))
        } else if has_boolean && Self::required_boolean_prop(pattern_type, key) {
            format!("Boolean({})", compiled)
        } else if has_boolean {
            format!("(({}) as boolean | undefined)", compiled)
        } else {
            compiled.to_string()
        }
    }

    /// Narrow a wide-elemented array expression — an `object/get` read
    /// directly, or the result of an `array/map` chain whose lambda body (or
    /// object-literal members inside it) reads through `object/get`
    /// (`getNestedValue`, honestly `FieldValue | undefined` per element) — to
    /// the array prop's declared element shape. Converges on the SAME
    /// registry-driven element-shape owner (`array_prop_element_ts`, synced
    /// from `items.types`/`items.properties`) and the SAME canonical
    /// `Array.isArray(x) ? (x as ELT[]) : []` idiom (`array_coerce_value`)
    /// already used for a wide `@`-binding fed into an array prop
    /// (`needs_array_coerce`, below) — never a second cast style. A single
    /// `as ELT[]` cast on the WHOLE array result (rather than per element or
    /// per object-literal member) both fixes the array-assignability error
    /// and removes the per-member contextual-typing errors TS otherwise runs
    /// against an object-literal element (verified against tsc: `Mutable`
    /// assigns to both a mutable and a `readonly` array prop).
    fn narrow_wide_array_to_prop_type(
        pattern_type: Option<&str>,
        key: &str,
        compiled: &str,
    ) -> String {
        let is_array_prop = pattern_type
            .and_then(|pt| {
                orbital_core::language::pattern_props::get_prop_types(pt, key)
            })
            .is_some_and(|types| types.iter().any(|t| *t == "array"));
        if !is_array_prop {
            return compiled.to_string();
        }
        let prop_entry = pattern_type.and_then(|pt| get_props_schema(pt)?.get(key));
        // An entity collection declares its row shape at the top level, as for an `@`-binding.
        if prop_entry
            .and_then(|p| p.required_fields.as_ref())
            .is_some_and(|v| !v.is_empty())
        {
            let elt = super::registry::entity_data_element_ts(prop_entry);
            return super::registry::array_coerce_value(
                compiled,
                &elt,
                super::registry::ArrayCast::NarrowedReadonly,
            );
        }
        let elt = Self::array_prop_element_ts(prop_entry);
        // `NarrowedMutable` for an object-shaped element: a wide accessor
        // chain (e.g. a nested `array/map`/`array/groupBy` result) can
        // widen to a messy nested union (`(string | (string | {…})[])[]`)
        // that doesn't "sufficiently overlap" a single named element shape
        // for a direct `as ELT[]` (TS2352) — the `EntityRow[]`
        // intermediate's index signature is comparable to any object shape
        // first. A primitive element (`string[]`)/`EntityRow` fallback
        // doesn't have that problem and keeps the plain `Mutable` cast.
        let cast = if elt.trim_start().starts_with('{') {
            super::registry::ArrayCast::NarrowedMutable
        } else {
            super::registry::ArrayCast::Mutable
        };
        super::registry::array_coerce_value(compiled, &elt, cast)
    }

    /// Compile an OIR config value into a JSX prop expression.
    ///
    /// `pattern_type` is consulted via the pattern registry to decide whether
    /// a binding into a `node`-typed prop needs `String(expr ?? '')` coercion
    /// (binding sources like `lastPayload.message` resolve to
    /// `EventPayloadValue`, which is wider than `ReactNode`). Pass `None`
    /// when no pattern context is available (e.g. a standalone value).
    /// A drawable descriptor as a TS data literal: nested `draw-*` objects stay objects (their
    /// `type` a literal), so a group's `items` reach the painter as the same data the runtime gives it.
    fn drawable_data_literal(&self, value: &OirValue) -> String {
        match value {
            OirValue::Object(obj) => {
                let mut keys: Vec<&String> = obj.keys().collect();
                keys.sort();
                let pairs: Vec<String> = keys
                    .into_iter()
                    .map(|k| {
                        let v = &obj[k];
                        let lit = match (k.as_str(), v) {
                            ("type", OirValue::String(t)) => format!("{} as const", serde_json::to_string(t).unwrap_or_default()),
                            _ => self.drawable_data_literal(v),
                        };
                        format!("{}: {}", crate::codegen::ts_member_name(k), lit)
                    })
                    .collect();
                format!("{{{}}}", pairs.join(", "))
            }
            OirValue::Array(items) => format!(
                "[{}]",
                items.iter().map(|v| self.drawable_data_literal(v)).collect::<Vec<_>>().join(", ")
            ),
            OirValue::String(st) if st.starts_with('@') => self.binding_string_to_ts(st),
            other => self.value_to_jsx_literal(other),
        }
    }

    pub(crate) fn config_value_to_jsx_prop_with_pattern(
        &self,
        pattern_type: Option<&str>,
        key: &str,
        value: &OirValue,
    ) -> String {
        let filled;
        let value = match (
            pattern_type.and_then(|pt| get_props_schema(pt)?.get(key)),
            value,
        ) {
            (Some(prop), OirValue::Object(_) | OirValue::Array(_)) => {
                filled =
                    fill_absent_nullable_keys(value, prop.properties.as_ref(), prop.items.as_ref());
                &filled
            }
            _ => value,
        };
        // Keys that contain S-expressions with lambda variables for runtime evaluation
        let is_runtime_key = matches!(
            key,
            "filter"
                | "condition"
                | "dataSource"
                | "hiddenCalculations"
                | "violationTriggers"
                | "cardTemplate"
                | "expression"
                | "hidden"
        );

        match value {
            OirValue::String(s) => {
                if s.starts_with('@') {
                    if let Some(trait_name) = self.parse_trait_binding(s) {
                        // A `@trait.X` binding is never a string/ReactNode
                        // value to coerce — it's a direct view-component
                        // reference, regardless of the prop's declared
                        // type. Route through the one owner (mirrors the
                        // children-array and literal-context arms of this
                        // same emitter).
                        format!("{}={{{}}}", key, self.trait_embed_jsx(&trait_name))
                    } else if is_runtime_key {
                        // Preserve as string for runtime S-expression evaluation
                        jsx_string_prop(key, s)
                    } else {
                        // Binding — use JSX expression. If the prop's registered
                        // type is `node` (ReactNode) or `string`, coerce with
                        // String(... ?? '') because the binding's return type
                        // (EventPayloadValue / FieldValue) is a wider union
                        // than ReactNode/string admits — numeric entity fields
                        // (e.g. `@entity.memoryCount` on a Badge `label`)
                        // otherwise emit `number` where `string` is required.
                        // The coercion is a no-op at runtime for string values.
                        let expr = self.binding_string_to_ts(s);
                        let prop_types = pattern_type.and_then(|pt| {
                            orbital_core::language::pattern_props::get_prop_types(
                                pt, key,
                            )
                        });
                        let enum_values = pattern_type.and_then(|pt| {
                            orbital_core::language::pattern_props::get_prop_enum_values(pt, key)
                        });
                        let needs_string_coerce = prop_types
                            .map(|types| {
                                let has_string =
                                    types.iter().any(|t| *t == "string" || *t == "node");
                                let accepts_number = types.contains(&"number");
                                has_string && !accepts_number
                            })
                            .unwrap_or(false);
                        // A `string | number` prop (`stat-display.value`,
                        // `badge.label`, …) fed a wide `@`-binding: neither
                        // `String(...)`-coerce (would drop the numeric member
                        // the prop explicitly accepts) nor a bare pass-through
                        // (the binding's static type — `EventPayloadValue` /
                        // `FieldValue`, or a `scalar`-typed `@config.<knob>`
                        // read, `string | number | boolean | null` — is wider
                        // than `string | number`: it can carry `boolean` /
                        // `null` / a nested object) typechecks. Cast to the
                        // prop's own declared union — the same idiom
                        // `narrow_wide_accessor_to_prop_type` (this module)
                        // already uses for a compiled-sexpr source reaching
                        // the identical destination shape.
                        let needs_string_or_number_coerce = prop_types
                            .map(|types| types.contains(&"string") && types.contains(&"number"))
                            .unwrap_or(false);
                        let needs_array_coerce = prop_types
                            .map(|types| types.contains(&"array"))
                            .unwrap_or(false);
                        // The component prop is a real `Date` (registry type
                        // `date`/`datetime`/`timestamp`), but the binding
                        // resolves to its serialized string/number form. Bridge
                        // to a `Date` at the JSX boundary with `new Date(...)`.
                        // `Some(required)` iff the prop is Date-typed; the same
                        // helper drives the literal branch below.
                        let date_coercion = Self::prop_date_coercion(pattern_type, key);
                        // Polymorphic `as`/element prop: element-name string cast
                        // to `keyof React.JSX.IntrinsicElements`.
                        let needs_component_coerce = prop_types
                            .map(|types| types.iter().any(|t| *t == "component"))
                            .unwrap_or(false);
                        // Enum/union destinations first: a dynamic binding resolves
                        // to the wide `FieldValue | undefined`, which TS won't accept
                        // against a narrow string-literal-union prop (e.g. button
                        // `variant`, badge `severity`). A single cast to the declared
                        // union typechecks (the literal union is assignable to
                        // FieldValue, so they overlap — no TS2352).
                        if let Some(decoded) = self.decode_rich_prop(pattern_type, key, &expr) {
                            format!("{}={{{}}}", key, decoded)
                        } else if needs_component_coerce {
                            format!("{}={{{} as keyof React.JSX.IntrinsicElements}}", key, expr)
                        } else if let Some(values) = enum_values.filter(|v| !v.is_empty()) {
                            let union = values
                                .iter()
                                .map(|v| format!("'{}'", v))
                                .collect::<Vec<_>>()
                                .join(" | ");
                            format!("{}={{{} as {}}}", key, expr, union)
                        } else if let Some(prop_required) = date_coercion {
                            // Required `Date` prop → bare `new Date(...)` (always
                            // `Date`). Optional prop → preserve `undefined` so
                            // `prop?: Date` typechecks and the component's own
                            // default still fires when the binding is absent.
                            if prop_required {
                                format!(
                                    "{}={{new Date({expr} as string | number)}}",
                                    key,
                                    expr = expr
                                )
                            } else {
                                format!(
                                    "{}={{{expr} == null ? undefined : new Date({expr} as string | number)}}",
                                    key, expr = expr
                                )
                            }
                        } else if Self::required_boolean_prop(pattern_type, key) {
                            // A required boolean takes the runtime's truthiness of the value.
                            format!("{}={{Boolean({})}}", key, expr)
                        } else if needs_string_coerce {
                            format!("{}={{{}}}", key, crate::codegen::effect::shared::string_coerce_ts(&expr))
                        } else if needs_string_or_number_coerce {
                            format!(
                                "{}={{({} as {})}}",
                                key,
                                expr,
                                Self::string_or_number_ts(pattern_type, key)
                            )
                        } else if needs_array_coerce {
                            // Strict `readonly T[]` prop fed by a wide payload
                            // binding (`@payload.X` → `EventPayloadValue`).
                            // `?? []` leaves the element type wide, so narrow
                            // with `Array.isArray` and cast to the prop's
                            // declared element shape (synthesized from the
                            // registry, `EntityRow` fallback).
                            let prop_entry =
                                pattern_type.and_then(|pt| get_props_schema(pt)?.get(key));
                            let elt = Self::array_prop_element_ts(prop_entry);
                            super::registry::array_coerce_prop(
                                key,
                                &expr,
                                &elt,
                                super::registry::ArrayCast::Readonly,
                            )
                        } else {
                            format!("{}={{{}}}", key, expr)
                        }
                    }
                } else if s.contains('{') || s.contains('}') {
                    // Braces are JSX-special: expression syntax even with nothing to escape.
                    format!("{}={{'{}'}}", key, escape_js_string(s))
                } else if Self::prop_date_coercion(pattern_type, key).is_some() {
                    // A `@config.<date>` default is substituted to a literal date
                    // string before codegen reaches here; the destination prop is
                    // a real `Date`. Wrap it (Cat 13). An empty default →
                    // `undefined` (valid for the optional date props this fires
                    // on; a required empty date is a content bug caught upstream).
                    if s.is_empty() {
                        format!("{}={{undefined}}", key)
                    } else {
                        format!("{}={{new Date(\"{}\")}}", key, escape_js_string(s))
                    }
                } else if Self::is_event_name_prop(key) {
                    // Gap #13: event-name props (`action`, `submitEvent`, etc.)
                    // get the trait scope prefix so the host emits the
                    // qualified `UI:Orbital.Trait.EVENT` bus key.
                    let qualified = self.qualify_event(s);
                    jsx_string_prop(key, &qualified)
                } else {
                    jsx_string_prop(key, s)
                }
            }
            OirValue::Number(n) => format!("{}={{{}}}", key, n),
            OirValue::Bool(b) => format!("{}={{{}}}", key, b),
            OirValue::Null => format!("{}={{null}}", key),
            OirValue::Array(arr) => {
                // Check if this array is an s-expression operator call (e.g., ["map", "@Entity", ...])
                if let Some((compiled, never_nullish)) = self
                    .try_compile_sexpr_prop_facts(arr, crate::codegen::expr::BindingFlavor::Render)
                {
                    // Any operator-call prop value can bottom out in an
                    // `object/get` (`getNestedValue`) read — directly
                    // (`(object/get @item "variant")`), wrapped by another
                    // scalar op (`(str/default (object/get …) "")`), or one
                    // hop out through an `array/map` lambda whose body/
                    // object-literal members read through it — and
                    // `object/get`'s own codegen is honestly `FieldValue |
                    // undefined` (or an array of that), wider than almost any
                    // declared prop. Narrow the WHOLE compiled result at this
                    // ONE boundary, keyed on the destination's declared
                    // `types`/`items` (never the operator or pattern name);
                    // a value whose compiled shape already matches the prop
                    // (a `str/concat` into a `string` prop, an `array/sort`
                    // of an already-typed array) narrows to a harmless
                    // identity wrap (`String(x ?? '')`, `x as ELT[]` where
                    // `x` already satisfies `ELT[]`), never a regression.
                    if let Some(decoded) = self.decode_rich_prop(pattern_type, key, &compiled) {
                        return format!("{}={{{}}}", key, decoded);
                    }
                    let expr = Self::narrow_wide_accessor_to_prop_type(
                        pattern_type,
                        key,
                        &compiled,
                        never_nullish,
                    );
                    // `.lolo` `null` is "no value"; an optional prop's TS type takes `undefined`.
                    let prop_optional = pattern_type
                        .and_then(|pt| get_props_schema(pt)?.get(key))
                        .is_some_and(|p| !p.required);
                    if prop_optional && sexpr_always_null(arr) {
                        return format!("{}={{undefined}}", key);
                    }
                    if prop_optional && sexpr_may_yield_null(arr) {
                        // Nothing narrowed the value: tsc cannot narrow a repeated call expression,
                        // so map null with `??` (same value, typed `T | undefined`).
                        if expr == compiled {
                            return format!("{}={{(({}) ?? undefined)}}", key, compiled);
                        }
                        // Narrowing maps a nullish value to the prop's empty shape (`[]`, `''`),
                        // so the null test reads the value before it.
                        return format!("{}={{(({}) == null ? undefined : {})}}", key, compiled, expr);
                    }
                    return format!("{}={{{}}}", key, expr);
                }
                // Drawable descriptors are data the painter reads, never rendered elements.
                let drawable_items = pattern_type
                    .and_then(|pt| get_props_schema(pt)?.get(key))
                    .and_then(|p| p.items.as_ref())
                    .is_some_and(|items| items.drawable_slot);
                if drawable_items {
                    let items: Vec<String> = arr.iter().map(|v| self.drawable_data_literal(v)).collect();
                    return format!("{}={{[{}]}}", key, items.join(", "));
                }
                // For arrays like actions, items, columns - use context-aware literal for runtime keys
                if is_runtime_key {
                    let items: Vec<String> = arr
                        .iter()
                        .map(|v| self.value_to_jsx_literal_with_context(v, Some(key)))
                        .collect();
                    format!("{}={{[{}]}}", key, items.join(", "))
                } else {
                    let items: Vec<String> =
                        arr.iter().map(|v| self.value_to_jsx_literal(v)).collect();
                    let literal = format!("[{}]", items.join(", "));
                    // A LITERAL array prop value (`Menu.items`,
                    // `DataGrid.fields`) never went through
                    // `try_compile_sexpr_prop` above (it isn't an operator
                    // call), so it skipped `narrow_wide_array_to_prop_type`
                    // entirely and landed here raw — assigned straight into
                    // the JSX prop position, which puts TS through EXCESS
                    // PROPERTY CHECKS against each object-literal element
                    // (a `format`/`header` field the pattern's declared
                    // element shape doesn't carry trips TS2353). Cast the
                    // WHOLE array to the registry-declared element shape —
                    // the same owner (`array_prop_element_ts` +
                    // `array_coerce_value`) `narrow_wide_array_to_prop_type`
                    // uses for a wide accessor — keyed on the destination's
                    // declared `types`/`items`, never the pattern name. A
                    // type ASSERTION (not a plain assignment) sidesteps the
                    // excess-property check while staying honest to the
                    // declared shape.
                    // An EMPTY literal (`[]`) already satisfies ANY array
                    // type with zero error (TS infers `never[]`, assignable
                    // everywhere) — there is no excess-property element to
                    // narrow, and forcing it through a synthesized element
                    // shape that doesn't structurally match the REAL
                    // component type (a separate, pre-existing synthesizer
                    // gap — e.g. a mixed `items.types` prop) would introduce
                    // a TS2322 that wasn't there before. Only a non-empty
                    // literal needs the cast.
                    let is_array_prop = !arr.is_empty()
                        && pattern_type
                            .and_then(|pt| {
                                orbital_core::language::pattern_props::get_prop_types(
                                    pt, key,
                                )
                            })
                            .is_some_and(|types| types.iter().any(|t| *t == "array"));
                    let expr = if is_array_prop {
                        let prop_entry = pattern_type.and_then(|pt| get_props_schema(pt)?.get(key));
                        let elt = Self::array_prop_element_ts(prop_entry);
                        // An OBJECT-literal element type (`{ … }`): each element is its own
                        // object literal, so a heterogeneous list infers as a union of
                        // disjoint shapes a direct `as ELT[]` can reject (TS2352). Bridge
                        // through `object[]`, which every object literal upcasts to and
                        // the element shape is assignable to (values may be rendered
                        // nodes, so not `EntityRow[]`). A primitive element keeps `Mutable`.
                        let cast = if elt.trim_start().starts_with('{') {
                            super::registry::ArrayCast::LiteralObjects
                        } else {
                            super::registry::ArrayCast::Mutable
                        };
                        super::registry::array_coerce_value(&literal, &elt, cast)
                    } else {
                        literal
                    };
                    format!("{}={{{}}}", key, expr)
                }
            }
            OirValue::Object(obj) => {
                // For object props - use context-aware literal for runtime keys.
                // Schema-aware coercion: when the parent pattern declares
                // this prop's `properties` map (e.g. dialogue-box's
                // `dialogue: { text: string, speaker: string }`), check
                // each nested key's declared type. For nested string-only
                // fields whose value is a `@`-binding, wrap with
                // `String(... ?? '')` so the wider FieldValue|undefined
                // source narrows at the boundary. This mirrors the
                // top-level prop coercion above without requiring a
                // schema lookup at every binding site.
                let nested_prop_schema = pattern_type.and_then(|pt| {
                    orbital_core::language::registry::get_pattern(pt)
                        .and_then(|p| p.props_schema.get(key))
                        .and_then(|prop| prop.properties.as_ref())
                });
                // The members the component's object type requires (registry `propertyRequired`),
                // and their schemas.
                let object_prop = pattern_type.and_then(|pt| get_props_schema(pt)?.get(key));
                let required_members: &[String] =
                    object_prop.and_then(|p| p.property_required.as_deref()).unwrap_or(&[]);
                let member_schemas = object_prop.and_then(|p| p.properties.as_ref());
                let pairs: Vec<String> = obj
                    .iter()
                    .filter_map(|(k, v)| {
                        // Omit an empty-string value for a nested ENUM-typed field:
                        // the destination sub-field is a bounded union (e.g.
                        // Asset.style: VisualStyle) that `""` can't satisfy, and the
                        // field is optional, so dropping it lets the component default
                        // apply (CG-SWEEP-1 Cat 11). A non-empty invalid enum literal
                        // is a content bug rejected at validate, not dropped here.
                        if let OirValue::String(s) = v {
                            if s.is_empty()
                                && nested_prop_schema
                                    .and_then(|p| p.get(k.as_str()))
                                    .and_then(|np| np.enum_values.as_ref())
                                    .is_some_and(|vals| !vals.is_empty())
                            {
                                return None;
                            }
                        }
                        // Propagate runtime context for nested keys
                        let context = if is_runtime_key
                            || matches!(
                                k.as_str(),
                                "filter" | "condition" | "expression" | "cardTemplate" | "hidden"
                            ) {
                            Some(k.as_str())
                        } else {
                            None
                        };
                        // Lookup nested key's declared type. When string-
                        // only AND value is a binding, coerce.
                        if let OirValue::String(s) = v {
                            if s.starts_with('@') && context.is_none() {
                                let nested_is_string_only = nested_prop_schema
                                    .and_then(|p| p.get(k.as_str()))
                                    .map(|np| {
                                        np.types.iter().any(|t| t == "string")
                                            && !np.types.iter().any(|t| t == "number")
                                    })
                                    .unwrap_or(false);
                                if nested_is_string_only {
                                    let expr = self.binding_string_to_ts(s);
                                    return Some(format!("{}: {}", k, crate::codegen::effect::shared::string_coerce_ts(&expr)));
                                }
                                // A number-only member: unset stays unset, as on the runtime path.
                                let nested = nested_prop_schema.and_then(|p| p.get(k.as_str()));
                                let member_required = required_members.iter().any(|r| r == k)
                                    || nested.is_some_and(|np| np.required.required_on_parent());
                                // A required array member: the canonical array coercion to its
                                // element shape (a missing list is the empty list).
                                let member = member_schemas.and_then(|m| m.get(k.as_str()));
                                let array_member =
                                    member.is_some_and(|m| !m.types.is_empty() && m.types.iter().all(|t| t == "array"));
                                if member_required && array_member {
                                    let expr = self.binding_string_to_ts(s);
                                    let elt = Self::array_items_element_ts(member.and_then(|m| m.items.as_deref()));
                                    let cast = super::registry::ArrayCast::NarrowedReadonly;
                                    return Some(format!("{}: {}", k, super::registry::array_coerce_value(&expr, &elt, cast)));
                                }
                                if nested.is_some_and(|np| !np.types.is_empty() && np.types.iter().all(|t| t == "number")) {
                                    let expr = self.binding_string_to_ts(s);
                                    return Some(if member_required {
                                        format!("{}: Number({} ?? 0)", k, expr)
                                    } else {
                                        format!("{}: ({e} == null ? undefined : Number({e}))", k, e = expr)
                                    });
                                }
                            }
                        }
                        Some(format!(
                            "{}: {}",
                            k,
                            self.value_to_jsx_literal_with_context(v, context)
                        ))
                    })
                    .collect();
                format!("{}={{{{{}}}}}", key, pairs.join(", "))
            }
        }
    }

    /// Convert OirValue to a JSX literal (for use inside expressions)
    pub(crate) fn value_to_jsx_literal(&self, value: &OirValue) -> String {
        self.value_to_jsx_literal_with_context(value, None)
    }

    /// Convert OirValue to a JSX literal with context awareness
    /// When inside certain keys (filter, condition, dataSource, etc.), preserve @bindings as strings
    /// for runtime evaluation instead of compiling them to TypeScript
    /// Build the ` config={{ … }}` attribute for an embedded `<XView />`.
    ///
    /// Two things travel through it:
    ///
    /// 1. **The route context** (`entityId` / `routeParams` / `initPayload`),
    ///    forwarded from the COMPOSING View's own `propsConfig`. A page body
    ///    hands these to every trait it mounts directly, but a trait reached
    ///    through a composition (`@trait.X` embed / layout slot) used to be
    ///    emitted as a bare `<XView />` — so its auto-INIT fired with no
    ///    payload at all, its `?id` never bound, and an entity-bound detail
    ///    trait fetched with no id and rendered its not-found arm over a row
    ///    that exists (C-EMBEDDED-TRAIT-GETS-NO-ROUTE-PAYLOAD, §58). These
    ///    three are universal `Config` members on every generated trait, so
    ///    forwarding them is type-safe at any depth, and the chain composes:
    ///    the page seeds the outermost view, each embed passes it on.
    /// 2. **Call-site captures** — knobs the child trait declares as captured
    ///    from the triggering payload, resolved against the composing View's
    ///    `lastPayload` and read by the child as `@config.<knob>`.
    /// 3. **The whole composing payload** (`callsitePayload: lastPayload`) —
    ///    only for a child `trait_callsite_payload_flagged` (a NESTED
    ///    `@callsitePayload.<path>` reference somewhere in the child that no
    ///    single typed knob above covers). The child reads any depth back
    ///    via `config?.callsitePayload?.<path>`
    ///    (`compile_callsite_payload_ref`, codegen/expr.rs).
    pub(crate) fn embedded_view_config_attr(&self, trait_name: &str) -> String {
        let mut entries: Vec<String> = vec![
            "entityId: propsConfig?.entityId".to_string(),
            "routeParams: propsConfig?.routeParams".to_string(),
            "initPayload: propsConfig?.initPayload".to_string(),
        ];
        if let Some(pairs) = self.trait_callsite_captures.borrow().get(trait_name) {
            entries.extend(pairs.iter().map(|(knob, field, ts_type)| {
                // Assert the wide payload read down to the knob's declared
                // member type (union -> member, always a legal TS assertion)
                // so the child's Config prop typechecks without `as any`.
                format!(
                    "{}: ({}) as {}",
                    knob,
                    self.binding_string_to_ts(&format!("@payload.{field}")),
                    ts_type
                )
            }));
        }
        if self
            .trait_callsite_payload_flagged
            .borrow()
            .contains(trait_name)
        {
            entries.push(format!("callsitePayload: {}", RENDER_PAYLOAD_VAR));
        }
        format!(" config={{{{ {} }}}}", entries.join(", "))
    }

    /// The one owner for lowering a resolved `@trait.X` binding to its
    /// direct view-component reference — every codegen site that hits a
    /// `parse_trait_binding` match (children arrays, node-typed props,
    /// string-typed props) renders through this, never a second copy.
    pub(crate) fn trait_embed_jsx(&self, trait_name: &str) -> String {
        format!(
            "<{}View{} />",
            trait_name,
            self.embedded_view_config_attr(trait_name)
        )
    }

    pub(crate) fn value_to_jsx_literal_with_context(
        &self,
        value: &OirValue,
        parent_key: Option<&str>,
    ) -> String {
        // Keys that contain S-expressions with lambda variables (@item, @f, @o, etc.)
        // These should be preserved as data for runtime evaluation, not compiled
        let is_runtime_context = matches!(
            parent_key,
            Some("filter")
                | Some("condition")
                | Some("expression")
                | Some("cardTemplate")
                | Some("hidden")
        );

        match value {
            OirValue::String(s) => {
                if s.starts_with('@') {
                    if is_runtime_context {
                        // Preserve as string for runtime S-expression evaluation
                        format!("\"{}\"", escape_js_string(s))
                    } else if let Some(trait_name) = self.parse_trait_binding(s) {
                        // `@trait.X` references in any prop position lower to
                        // an inline `<XView />` JSX expression. Mirrors the
                        // children-array scan on this same pattern emitter and
                        // the runtime-path `substituteTraitRefsDeep` in
                        // `UISlotRenderer.tsx`. Field-level type-checking is
                        // already done by the orbital validator on `trait`-
                        // typed config fields (`ORB_BINDING_TRAIT_INVALID_FORMAT`).
                        self.trait_embed_jsx(&trait_name)
                    } else {
                        self.binding_string_to_ts(s)
                    }
                } else {
                    format!("\"{}\"", escape_js_string(s))
                }
            }
            OirValue::Number(n) => n.to_string(),
            OirValue::Bool(b) => b.to_string(),
            OirValue::Null => "null".to_string(),
            OirValue::Array(arr) => {
                // Check if this array is an s-expression operator call (e.g., ["map", "@Entity", ...])
                if let Some(compiled) = self.try_compile_sexpr_prop(arr) {
                    return compiled;
                }
                // If we're in a runtime context (like filter), preserve the entire array as data
                if is_runtime_context {
                    let items: Vec<String> = arr
                        .iter()
                        .map(|v| self.value_to_jsx_literal_with_context(v, parent_key))
                        .collect();
                    format!("[{}]", items.join(", "))
                } else {
                    let items: Vec<String> =
                        arr.iter().map(|v| self.value_to_jsx_literal(v)).collect();
                    format!("[{}]", items.join(", "))
                }
            }
            OirValue::Object(obj) => {
                // If this object is a render-ui pattern config (has a "type" field
                // whose value is a known pattern), render it as JSX via the
                // canonical pattern emitter instead of a raw object literal —
                // raw objects crash React with error #31.
                if let Some(OirValue::String(pattern_type)) = obj.get("type") {
                    let is_known = get_component_mapping(pattern_type).is_some()
                        || self
                            .extra_mappings
                            .as_ref()
                            .map(|e| e.contains_key(pattern_type.as_str()))
                            .unwrap_or(false);
                    if is_known {
                        let config: orbital_core::ir::OirObject = obj
                            .iter()
                            .filter(|(k, _)| *k != "type")
                            .map(|(k, v)| (k.clone(), v.clone()))
                            .collect();
                        return self.generate_pattern_from_registry(
                            pattern_type,
                            &config,
                            None,
                            None,
                        );
                    }
                }
                let pairs: Vec<String> = obj
                    .iter()
                    .map(|(k, v)| {
                        // Check if this key should trigger runtime context
                        let context_key = if matches!(
                            k.as_str(),
                            "filter"
                                | "condition"
                                | "expression"
                                | "cardTemplate"
                                | "dataSource"
                                | "hiddenCalculations"
                                | "violationTriggers"
                                | "hidden"
                        ) {
                            Some(k.as_str())
                        } else if is_runtime_context {
                            // Propagate runtime context to nested values
                            parent_key
                        } else {
                            None
                        };
                        if let OirValue::String(s) = v {
                            if s.starts_with('@') {
                                // A binding reads its value, as at the top level.
                                return format!(
                                    "{}: {}",
                                    crate::codegen::ts_ident::ts_member_name(k),
                                    self.value_to_jsx_literal_with_context(v, context_key)
                                );
                            }
                            // String literals must not widen to `string`
                            // (DrawableNode[] assignability, TS2322). Twin of
                            // the expr.rs Object-arm rule.
                            format!(
                                "{}: \"{}\" as const",
                                crate::codegen::ts_ident::ts_member_name(k),
                                escape_js_string(s)
                            )
                        } else {
                            format!(
                                "{}: {}",
                                crate::codegen::ts_ident::ts_member_name(k),
                                self.value_to_jsx_literal_with_context(v, context_key)
                            )
                        }
                    })
                    .collect();
                format!("{{{}}}", pairs.join(", "))
            }
        }
    }
}

/// `value` with every absent `nullable` key written as `null`, walking objects through
/// `properties` and arrays through `items` — `.orb` data omits a `null` key, and a TS
/// type declaring it `T | null` (no `?`) still needs it present.
pub(crate) fn fill_absent_nullable_keys(
    value: &OirValue,
    properties: Option<&HashMap<String, crate::pattern_registry::PropTypeSchema>>,
    items: Option<&crate::pattern_registry::PropTypeSchema>,
) -> OirValue {
    match value {
        OirValue::Object(obj) => {
            let Some(props) = properties else {
                return value.clone();
            };
            let mut out = obj.clone();
            for (key, child) in props {
                match out.get(key) {
                    Some(v) => {
                        let filled = fill_absent_nullable_keys(
                            v,
                            child.properties.as_ref(),
                            child.items.as_deref(),
                        );
                        out.insert(key.clone(), filled);
                    }
                    None if child.nullable => {
                        out.insert(key.clone(), OirValue::Null);
                    }
                    None => {}
                }
            }
            OirValue::Object(out)
        }
        OirValue::Array(arr) => match items {
            Some(item) if !is_sexpr_call(arr) => OirValue::Array(
                arr.iter()
                    .map(|v| {
                        fill_absent_nullable_keys(
                            v,
                            item.properties.as_ref(),
                            item.items.as_deref(),
                        )
                    })
                    .collect(),
            ),
            _ => value.clone(),
        },
        _ => value.clone(),
    }
}

/// An operator call (`["array/map", …]`) rather than a data array.
pub(crate) fn is_sexpr_call(arr: &[OirValue]) -> bool {
    matches!(arr.first(), Some(OirValue::String(head)) if orbital_core::language::registry::is_known_operator(head))
}

/// Whether an S-expression call can evaluate to `null`: a `null` branch, a one-armed
/// `if`, a `when`, or the result of a `let`/`do` that can.
/// An `if` whose condition is a literal (a knob folded at the call site) and whose taken
/// branch is `null`, or whose branches are both `null`: the prop is absent.
fn sexpr_always_null(call: &[OirValue]) -> bool {
    fn null(v: &OirValue) -> bool {
        match v {
            OirValue::Null => true,
            OirValue::Array(call) => sexpr_always_null(call),
            _ => false,
        }
    }
    let Some(OirValue::String(head)) = call.first() else {
        return false;
    };
    if head != "if" || call.len() != 4 {
        return false;
    }
    match &call[1] {
        OirValue::Bool(true) => null(&call[2]),
        OirValue::Bool(false) => null(&call[3]),
        _ => null(&call[2]) && null(&call[3]),
    }
}

fn sexpr_may_yield_null(call: &[OirValue]) -> bool {
    fn may(v: &OirValue) -> bool {
        match v {
            OirValue::Null => true,
            OirValue::Array(call) => sexpr_may_yield_null(call),
            _ => false,
        }
    }
    let Some(OirValue::String(head)) = call.first() else {
        return false;
    };
    match head.as_str() {
        "if" => call.len() < 4 || call[2..].iter().any(may),
        "when" => true,
        "let" | "do" => call.last().is_some_and(may),
        _ => false,
    }
}

/// A numeric literal-union prop's TS type (`cols: 1 | 2 | … | 6`), from the registry.
pub(crate) fn numeric_union_ts(pattern_type: &str, key: &str) -> Option<String> {
    let values = get_props_schema(pattern_type)?
        .get(key)?
        .numeric_enum_values
        .as_ref()
        .filter(|v| !v.is_empty())?;
    Some(
        values
            .iter()
            .map(|n| {
                if n.fract() == 0.0 {
                    format!("{}", *n as i64)
                } else {
                    format!("{}", n)
                }
            })
            .collect::<Vec<_>>()
            .join(" | "),
    )
}

/// A string literal as a JSX prop. An attribute string (`key="…"`) is taken verbatim —
/// JSX processes no escapes in it — so a string that needs any escape goes out as a JS
/// expression instead.
pub(crate) fn jsx_string_prop(key: &str, s: &str) -> String {
    let escaped = escape_js_string(s);
    if escaped == s {
        format!("{key}=\"{s}\"")
    } else {
        format!("{key}={{'{escaped}'}}")
    }
}

#[cfg(test)]
mod literal_object_array_tests {
    use super::*;

    fn obj(pairs: &[(&str, OirValue)]) -> OirValue {
        OirValue::Object(
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
        )
    }

    /// orb.almadar.io's "source" accordions: items whose `content` is a rendered node.
    /// The `EntityRow[]` bridge cast requires `FieldValue` values, which a JSX element is
    /// not (TS2352); `object[]` bridges any object literal to the element shape.
    #[test]
    fn a_literal_object_array_with_node_values_bridges_through_object() {
        let b = TypeScriptBackend::new();
        let node = obj(&[
            ("type", OirValue::String("typography".into())),
            ("content", OirValue::String("hi".into())),
        ]);
        let item = obj(&[
            ("id", OirValue::String("src".into())),
            ("title", OirValue::String("Source".into())),
            ("content", node),
        ]);
        let out = b.config_value_to_jsx_prop_with_pattern(
            Some("accordion"),
            "items",
            &OirValue::Array(vec![item]),
        );
        assert!(out.contains("as object[]) as "), "{out}");
        assert!(!out.contains("as EntityRow[]) as "), "{out}");
    }
}

#[cfg(test)]
mod absent_nullable_key_tests {
    use super::*;
    use crate::pattern_registry::PropTypeSchema;

    fn schema(json: serde_json::Value) -> PropTypeSchema {
        serde_json::from_value(json).unwrap()
    }

    fn obj(pairs: &[(&str, OirValue)]) -> OirValue {
        OirValue::Object(
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
        )
    }

    /// `.orb` data omits a `null` key; a TS type with `guard: SExpr | null` (no `?`) still
    /// needs it. The registry marks such a member `nullable`, and the literal gets the
    /// `null` the language already means (std-orb docs' `avl-state-machine` transitions).
    #[test]
    fn an_absent_nullable_key_is_written_as_null_at_any_depth() {
        let s = schema(serde_json::json!({
            "types": ["object"],
            "properties": { "transitions": { "types": ["array"], "items": {
                "types": ["object"],
                "properties": { "event": { "types": ["string"] }, "guard": { "types": ["sexpr"], "nullable": true } }
            } } }
        }));
        let value = obj(&[(
            "transitions",
            OirValue::Array(vec![obj(&[("event", OirValue::String("GO".into()))])]),
        )]);
        let filled = fill_absent_nullable_keys(&value, s.properties.as_ref(), s.items.as_deref());
        let OirValue::Object(top) = filled else {
            panic!()
        };
        let OirValue::Array(ts) = &top["transitions"] else {
            panic!()
        };
        let OirValue::Object(t) = &ts[0] else {
            panic!()
        };
        assert_eq!(t.get("guard"), Some(&OirValue::Null));
    }

    /// Against the real registry: an `avl-state-machine` `trait` literal whose transition
    /// omits `guard` gets `guard: null` (TS2741 on `TraitTransitionInfo` otherwise).
    #[test]
    fn an_avl_trait_literal_gets_its_absent_guard_as_null() {
        let b = TypeScriptBackend::new();
        let transition = obj(&[
            ("from", OirValue::String("a".into())),
            ("to", OirValue::String("b".into())),
            ("event", OirValue::String("GO".into())),
            ("effects", OirValue::Array(vec![])),
            ("index", OirValue::Number(0.0)),
        ]);
        let value = obj(&[
            ("name", OirValue::String("T".into())),
            ("linkedEntity", OirValue::String("E".into())),
            ("states", OirValue::Array(vec![])),
            ("transitions", OirValue::Array(vec![transition])),
            ("emittedEvents", OirValue::Array(vec![])),
            ("listenedEvents", OirValue::Array(vec![])),
        ]);
        let out =
            b.config_value_to_jsx_prop_with_pattern(Some("avl-state-machine"), "trait", &value);
        assert!(out.contains("guard: null"), "{out}");
    }

    #[test]
    fn control_a_present_key_and_a_non_nullable_absent_key_are_left_alone() {
        let s = schema(serde_json::json!({
            "types": ["object"],
            "properties": { "guard": { "types": ["sexpr"], "nullable": true }, "note": { "types": ["string"] } }
        }));
        let value = obj(&[("guard", OirValue::String("x".into()))]);
        let OirValue::Object(t) =
            fill_absent_nullable_keys(&value, s.properties.as_ref(), s.items.as_deref())
        else {
            panic!()
        };
        assert_eq!(t.get("guard"), Some(&OirValue::String("x".into())));
        assert!(
            !t.contains_key("note"),
            "a non-nullable absent key stays absent"
        );
    }
}

#[cfg(test)]
mod never_nullish_prop_tests {
    use super::*;

    fn st(v: &str) -> OirValue {
        OirValue::String(v.to_string())
    }

    /// orb.almadar.io: `className: (if @config.compact "hidden" "pt-2")`. A ternary of
    /// string literals is never nullish; `String(x ?? '')` on it is TS2869.
    #[test]
    fn a_never_nullish_value_is_coerced_without_a_fallback() {
        let b = TypeScriptBackend::new();
        let v = OirValue::Array(vec![
            st("if"),
            st("@config.compact"),
            st("hidden"),
            st("pt-2"),
        ]);
        let out = b.config_value_to_jsx_prop_with_pattern(Some("stack"), "className", &v);
        assert!(!out.contains("?? ''"), "{out}");
        assert!(out.starts_with("className={String("), "{out}");
    }

    #[test]
    fn control_a_maybe_nullish_value_keeps_its_fallback() {
        let b = TypeScriptBackend::new();
        let v = OirValue::Array(vec![st("object/get"), st("@config.style"), st("className")]);
        let out = b.config_value_to_jsx_prop_with_pattern(Some("stack"), "className", &v);
        assert!(out.contains("?? '')"), "{out}");
    }
}

#[cfg(test)]
mod absent_value_prop_tests {
    use super::*;

    fn link() -> OirValue {
        let mut o = orbital_core::ir::OirObject::new();
        o.insert("label".to_string(), OirValue::String("Next".to_string()));
        o.insert("href".to_string(), OirValue::String("/next".to_string()));
        OirValue::Object(o)
    }

    fn sexpr(items: Vec<OirValue>) -> OirValue {
        OirValue::Array(items)
    }

    /// std-doc-page: `next: (if (== @config.nextHref "") null @config.next)`. In `.lolo`
    /// `null` is "no link"; an optional TS prop takes `undefined`, never `null`.
    /// G-ORB-189: `command-palette open` is a required boolean; an entity boolean read
    /// (`fields?.paletteOpen`, `boolean | undefined`) takes the runtime's truthiness.
    #[test]
    fn a_required_boolean_prop_takes_the_truthiness_of_a_binding() {
        let b = TypeScriptBackend::new();
        let out = b.config_value_to_jsx_prop_with_pattern(Some("command-palette"), "open", &OirValue::String("@entity.paletteOpen".into()));
        assert_eq!(out, "open={Boolean(fields?.paletteOpen)}");
    }

    #[test]
    fn control_an_optional_boolean_prop_keeps_the_absent_value() {
        let b = TypeScriptBackend::new();
        let out = b.config_value_to_jsx_prop_with_pattern(Some("button"), "disabled", &OirValue::String("@entity.busy".into()));
        assert!(!out.contains("Boolean("), "{out}");
    }

    #[test]
    fn a_knob_folded_to_its_null_branch_leaves_a_list_prop_absent() {
        let b = TypeScriptBackend::new();
        let v = sexpr(vec![
            OirValue::String("if".into()),
            OirValue::Bool(false),
            OirValue::Array(vec![]),
            OirValue::Null,
        ]);
        let out = b.config_value_to_jsx_prop_with_pattern(Some("dashboard-layout"), "notifications", &v);
        assert_eq!(out, "notifications={undefined}");
        let on = sexpr(vec![
            OirValue::String("if".into()),
            OirValue::Bool(true),
            OirValue::Array(vec![]),
            OirValue::Null,
        ]);
        let out = b.config_value_to_jsx_prop_with_pattern(Some("dashboard-layout"), "notifications", &on);
        assert_ne!(out, "notifications={undefined}", "control: the taken branch is a list: {out}");
    }

    #[test]
    fn a_null_branch_into_an_optional_prop_is_absent() {
        let b = TypeScriptBackend::new();
        let cond = sexpr(vec![
            OirValue::String("==".into()),
            OirValue::String("@config.nextHref".into()),
            OirValue::String(String::new()),
        ]);
        let v = sexpr(vec![
            OirValue::String("if".into()),
            cond.clone(),
            OirValue::Null,
            link(),
        ]);
        let out = b.config_value_to_jsx_prop_with_pattern(Some("doc-pagination"), "next", &v);
        assert!(out.ends_with(") ?? undefined)}"), "{out}");

        let when = sexpr(vec![OirValue::String("when".into()), cond, link()]);
        let out = b.config_value_to_jsx_prop_with_pattern(Some("doc-pagination"), "next", &when);
        assert!(
            out.ends_with(") ?? undefined)}"),
            "a `when` yields null when false: {out}"
        );
    }

    /// G-ORB-242: cosmic-zoom's `systemDependencies: (if @entity.hasDependencies
    /// @entity.dependencies null)`. Nothing narrows an object value, and tsc cannot narrow a
    /// repeated call expression, so `(X) == null ? undefined : X` kept `null` (TS2322); `?? undefined`
    /// maps null the same way and types as `T | undefined`.
    #[test]
    fn a_maybe_null_value_nothing_narrows_maps_null_with_nullish_coalescing() {
        let b = TypeScriptBackend::new();
        let v = sexpr(vec![
            OirValue::String("if".into()),
            OirValue::String("@entity.hasDependencies".into()),
            OirValue::String("@entity.dependencies".into()),
            OirValue::Null,
        ]);
        let out = b.config_value_to_jsx_prop_with_pattern(Some("flow-canvas"), "systemDependencies", &v);
        assert!(out.ends_with(") ?? undefined)}"), "{out}");
        assert!(!out.contains("== null ? undefined"), "{out}");
    }

    #[test]
    fn control_an_expression_that_never_yields_null_is_left_alone() {
        let b = TypeScriptBackend::new();
        let cond = sexpr(vec![
            OirValue::String("==".into()),
            OirValue::String("@config.nextHref".into()),
            OirValue::String(String::new()),
        ]);
        let v = sexpr(vec![OirValue::String("if".into()), cond, link(), link()]);
        let out = b.config_value_to_jsx_prop_with_pattern(Some("doc-pagination"), "next", &v);
        assert!(!out.contains("?? undefined"), "{out}");
    }
}

/// std-board's `dragGroup: (if @config.draggable @col.key "")` folds to `""` with a literal
/// knob; a compiled string literal into a string prop is already a string (TS2869 otherwise).
#[cfg(test)]
mod literal_string_prop_tests {
    use super::*;

    #[test]
    fn a_compiled_string_literal_into_a_string_prop_is_left_alone() {
        let out = TypeScriptBackend::narrow_wide_accessor_to_prop_type(Some("data-list"), "dragGroup", "\"\"", false);
        assert_eq!(out, "\"\"");
    }

    #[test]
    fn control_a_wide_read_into_a_string_prop_keeps_the_coercion() {
        let out = TypeScriptBackend::narrow_wide_accessor_to_prop_type(Some("data-list"), "dragGroup", "col?.key", false);
        assert_eq!(out, "String(col?.key ?? '')");
    }
}

/// std-browse field `labels`/`colorMap` keyed by a status value: `in-stock` is not a TS
/// identifier, so the emitted object literal must quote it (TS1005 otherwise).
#[cfg(test)]
mod object_key_quoting_tests {
    use super::*;

    #[test]
    fn a_key_that_is_not_an_identifier_is_quoted() {
        let b = TypeScriptBackend::new();
        let mut obj = orbital_core::ir::OirObject::new();
        obj.insert("in-stock".to_string(), OirValue::String("In stock".to_string()));
        obj.insert("low".to_string(), OirValue::String("Low".to_string()));
        let out = b.value_to_jsx_literal(&OirValue::Object(obj));
        assert!(out.contains("\"in-stock\": \"In stock\" as const"), "{out}");
        assert!(out.contains("low: \"Low\" as const"), "control: an identifier stays bare: {out}");
    }
}

#[cfg(test)]
mod numeric_union_prop_tests {
    use super::*;

    /// orb.almadar.io's footer: `cols: (math/min 4 (array/len …))` into SimpleGrid's
    /// `cols: 1 | … | 6`. An operator-compiled number is a plain `number`; the prop wants
    /// the literal union, asserted exactly as the binding path already does.
    #[test]
    fn an_operator_compiled_number_into_a_numeric_union_prop_asserts_the_union() {
        let out = TypeScriptBackend::narrow_wide_accessor_to_prop_type(
            Some("simple-grid"),
            "cols",
            "Math.min(4, 6)",
            false,
        );
        assert!(out.ends_with(" as 1 | 2 | 3 | 4 | 5 | 6)"), "{out}");
    }

    /// orb.almadar.io's blog cards: `src: (object/get @item "image" "")` into Image's
    /// `src: AssetUrl` (= `string`). A field read is wide; an asset destination is a string.
    #[test]
    fn a_field_read_into_an_asset_prop_is_coerced_to_string() {
        let out = TypeScriptBackend::narrow_wide_accessor_to_prop_type(
            Some("image"),
            "src",
            "getNestedValue(item, \"image\")",
            false,
        );
        assert_eq!(out, "String(getNestedValue(item, \"image\") ?? '')");
    }

    #[test]
    fn control_a_plain_number_prop_has_no_union() {
        let out = TypeScriptBackend::narrow_wide_accessor_to_prop_type(
            Some("progress-bar"),
            "value",
            "Math.min(4, 6)",
            false,
        );
        assert!(!out.contains(" as 1"), "{out}");
    }
}

#[cfg(test)]
mod escaping_tests {
    use super::*;

    // Reproduces the std-almadar-studio codegen bug: a config/props string
    // containing `"`, `\`, and a newline must come out escaped, never emitted
    // raw inside a quoted TS literal (TS1005 on the unescaped `"`).
    const RAW: &str = "Or just ask the agent: \"add a progress bar\"\nvia \\backslash";

    #[test]
    fn object_field_string_escapes_quotes_backslash_newline() {
        let backend = TypeScriptBackend::new();
        let mut fields = orbital_core::ir::OirObject::new();
        fields.insert("description".to_string(), OirValue::String(RAW.to_string()));
        let out = backend.value_to_jsx_literal_with_context(&OirValue::Object(fields), None);
        assert_eq!(
            out,
            "{description: \"Or just ask the agent: \\\"add a progress bar\\\"\\nvia \\\\backslash\" as const}"
        );
        assert!(
            !out.contains('\n'),
            "raw newline must not reach the TS literal"
        );
    }

    /// std-breakout's HUD: `stats: [{ label: "Score", value: @entity.score }]` reaches the
    /// pattern props as data; a binding string inside an object must read the entity, as
    /// the same string at the top level does — never the literal `"@entity.score"`.
    #[test]
    fn a_binding_string_inside_an_object_reads_the_binding() {
        let backend = TypeScriptBackend::new();
        let mut fields = orbital_core::ir::OirObject::new();
        fields.insert("label".to_string(), OirValue::String("Score".to_string()));
        fields.insert(
            "value".to_string(),
            OirValue::String("@entity.score".to_string()),
        );
        let out = backend.value_to_jsx_literal_with_context(
            &OirValue::Array(vec![OirValue::Object(fields)]),
            None,
        );
        let top = backend.value_to_jsx_literal_with_context(
            &OirValue::String("@entity.score".to_string()),
            None,
        );
        assert!(
            !out.contains("\"@entity.score\""),
            "the binding must not stay a literal: {out}"
        );
        assert!(
            out.contains(&format!("value: {top}")),
            "same read as at the top level ({top}): {out}"
        );
        assert!(
            out.contains("label: \"Score\" as const"),
            "control: a plain string stays a literal: {out}"
        );
    }

    #[test]
    fn control_a_binding_string_under_a_runtime_key_stays_data() {
        let backend = TypeScriptBackend::new();
        let mut fields = orbital_core::ir::OirObject::new();
        fields.insert(
            "field".to_string(),
            OirValue::String("@item.done".to_string()),
        );
        let out =
            backend.value_to_jsx_literal_with_context(&OirValue::Object(fields), Some("filter"));
        assert!(
            out.contains("\"@item.done\""),
            "a runtime-evaluated key keeps its binding as data: {out}"
        );
    }

    /// A JSX attribute string (`key="…"`) never processes escapes, so an escaped
    /// newline or apostrophe renders as a literal `\n` / `\'` (orb.almadar.io's docs
    /// tables showed raw `\n`). Any string needing an escape goes out as an expression.
    #[test]
    fn a_string_needing_an_escape_is_an_expression_never_an_attribute_string() {
        let backend = TypeScriptBackend::new();
        for (raw, expected) in [
            ("Tag | Meaning\n|---|", "content={'Tag | Meaning\\n|---|'}"),
            ("Don't stop", "content={'Don\\'t stop'}"),
            ("a\\b", "content={'a\\\\b'}"),
            ("tab\there", "content={'tab\\there'}"),
        ] {
            let out = backend.config_value_to_jsx_prop_with_pattern(
                None,
                "content",
                &OirValue::String(raw.to_string()),
            );
            assert_eq!(out, expected, "{raw:?}");
        }
        let plain = backend.config_value_to_jsx_prop_with_pattern(
            None,
            "content",
            &OirValue::String("plain text".to_string()),
        );
        assert_eq!(
            plain, "content=\"plain text\"",
            "control: a string needing no escape stays an attribute"
        );
        let event = backend.config_value_to_jsx_prop_with_pattern(
            None,
            "action",
            &OirValue::String("SAVE".to_string()),
        );
        assert!(
            event.starts_with("action=\""),
            "control: an event name stays an attribute: {event}"
        );
    }

    #[test]
    fn jsx_prop_string_escapes_quotes_backslash_newline() {
        let backend = TypeScriptBackend::new();
        let out = backend.config_value_to_jsx_prop_with_pattern(
            None,
            "description",
            &OirValue::String(RAW.to_string()),
        );
        assert_eq!(
            out,
            "description={'Or just ask the agent: \\\"add a progress bar\\\"\\nvia \\\\backslash'}"
        );
        assert!(
            !out.contains('\n'),
            "raw newline must not reach the TS literal"
        );
    }
}

#[cfg(test)]
mod trait_binding_prop_tests {
    use super::*;

    /// A `@trait.X` binding into a `node`-typed prop (`dashboard-layout`'s
    /// `sidebarContent`) must lower to a direct `<XView />` reference, never
    /// the `String(expr ?? '')` coercion the prop's declared node-ness would
    /// otherwise trigger — that both mis-typechecks (TS2869: the left side
    /// of `??` is a string literal, never nullish) and silently renders the
    /// literal binding text instead of the trait's view.
    #[test]
    fn trait_binding_into_node_prop_emits_view_not_string_coerce() {
        let backend = TypeScriptBackend::new();
        let out = backend.config_value_to_jsx_prop_with_pattern(
            Some("dashboard-layout"),
            "sidebarContent",
            &OirValue::String("@trait.NoteTree".to_string()),
        );
        assert!(
            out.contains("<NoteTreeView"),
            "expected a direct NoteTreeView reference, got: {}",
            out
        );
        assert!(
            !out.contains("String("),
            "a trait embed must never be wrapped in String(... ?? ''), got: {}",
            out
        );
    }
}

#[cfg(test)]
mod object_prop_member_tests {
    use super::*;

    /// kflow-import feeds import-progress `counts.committed` from `?committed`: a payload read
    /// is `EventPayloadValue`, the member a `number` (TS2322).
    #[test]
    fn a_number_member_of_an_object_prop_coerces_a_wide_binding() {
        let backend = TypeScriptBackend::new();
        let mut counts = orbital_core::ir::OirObject::new();
        counts.insert("committed".to_string(), OirValue::String("@payload.committed".to_string()));
        let out = backend.config_value_to_jsx_prop_with_pattern(Some("import-progress"), "counts", &OirValue::Object(counts));
        assert!(
            out.contains("committed: (lastPayload?.committed == null ? undefined : Number(lastPayload?.committed))"),
            "{out}"
        );
    }

    /// G-ORB-242: cosmic-zoom feeds flow-canvas `scene: { steps: @entity.scene, cursor: @entity.cursor }`;
    /// the component's `{ steps: readonly AvlPlayStep[]; cursor: number }` requires both members
    /// (registry `propertyRequired`), so neither may be `undefined` (TS2322).
    #[test]
    fn required_members_of_an_object_prop_never_pass_undefined() {
        let backend = TypeScriptBackend::new();
        let mut scene = orbital_core::ir::OirObject::new();
        scene.insert("steps".to_string(), OirValue::String("@entity.scene".to_string()));
        scene.insert("cursor".to_string(), OirValue::String("@entity.cursor".to_string()));
        let out = backend.config_value_to_jsx_prop_with_pattern(Some("flow-canvas"), "scene", &OirValue::Object(scene));
        assert!(out.contains("cursor: Number(fields?.cursor ?? 0)"), "{out}");
        assert!(out.contains("steps: Array.isArray(fields?.scene) ?"), "{out}");
        assert!(out.contains(": []"), "a missing step list is the empty list: {out}");
    }

    #[test]
    fn control_a_number_literal_member_stays_literal() {
        let backend = TypeScriptBackend::new();
        let mut counts = orbital_core::ir::OirObject::new();
        counts.insert("committed".to_string(), OirValue::Number(3.0));
        let out = backend.config_value_to_jsx_prop_with_pattern(Some("import-progress"), "counts", &OirValue::Object(counts));
        assert!(out.contains("committed: 3"), "{out}");
    }
}

#[cfg(test)]
mod string_or_number_prop_binding_tests {
    use super::*;

    /// A wide `@`-binding (a `scalar`-typed `@config.<knob>` read, honestly
    /// `string | number | boolean | null`, is the exact shape a `.lolo`
    /// `number,string`-mixed prop's config knob now emits — see
    /// `resolveType`'s scalar-union arm in `tools/almadar-pattern-sync`) fed
    /// into a `string | number` prop (`stat-display.value`) must cast to the
    /// prop's own declared union — never a bare pass-through (accepts
    /// `boolean`/`null` the prop doesn't) and never `String(...)` (would
    /// reject a genuine `number`). `value` is required, so the union admits
    /// no `undefined` (TS2322); an optional prop keeps it (badge `label` below).
    #[test]
    fn scalar_config_binding_into_string_or_number_prop_casts_to_the_declared_union() {
        let backend = TypeScriptBackend::new();
        let out = backend.config_value_to_jsx_prop_with_pattern(
            Some("stat-display"),
            "value",
            &OirValue::String("@config.value".to_string()),
        );
        assert_eq!(
            out,
            "value={(config?.value as string | number)}"
        );
    }
}

#[cfg(test)]
mod object_get_scalar_prop_narrowing_tests {
    use super::*;

    /// `n` compiles as an `@`-style lambda-param binding (bare identifier),
    /// matching how `object/get`'s first arg reads inside an `array/map`
    /// render-item lambda (`@item`-shaped) rather than as a quoted literal.
    fn object_get(entity: &str, path: &str) -> OirValue {
        OirValue::Array(vec![
            OirValue::String("object/get".to_string()),
            OirValue::String(format!("@{}", entity)),
            OirValue::String(path.to_string()),
        ])
    }

    /// `object/get`'s own codegen is honestly `FieldValue | undefined` — a
    /// Badge `label: string | number` fed `(object/get n "variant")` inside a
    /// `.map()` row (the exact `InlineAlertRender11`-adjacent shape) must
    /// narrow at this JSX-prop boundary, not emit the bare wide read.
    #[test]
    fn string_and_number_prop_casts_to_the_declared_union() {
        let backend = TypeScriptBackend::new();
        let out = backend.config_value_to_jsx_prop_with_pattern(
            Some("badge"),
            "label",
            &object_get("n", "variant"),
        );
        assert!(
            out.starts_with("label={((getNestedValue(")
                && out.ends_with(", \"variant\")) as string | number | undefined)}"),
            "expected a cast to the prop's declared string|number union, got: {}",
            out
        );
    }

    /// A string-only prop gets the same `String(... ?? '')` idiom used
    /// elsewhere in this module for wide `@`-bindings — not a bare cast.
    #[test]
    fn string_only_prop_gets_string_coercion() {
        let backend = TypeScriptBackend::new();
        let out = backend.config_value_to_jsx_prop_with_pattern(
            Some("detail-panel"),
            "searchValue",
            &object_get("n", "message"),
        );
        assert!(
            out.starts_with("searchValue={String(getNestedValue(")
                && out.ends_with(", \"message\") ?? '')}"),
            "expected a String(... ?? '') coercion, got: {}",
            out
        );
    }

    /// A `node`-typed destination (`ReactNode`) routes through
    /// `renderPatternValue` — `FieldValue` (getNestedValue's return type)
    /// includes `Date` and arbitrary nested objects, neither a valid
    /// `ReactNode`, so a bare pass-through is TS2322 (the exact
    /// `ApprovalRequestNotificationsOverlayView.tsx` Typography `content`
    /// shape found alongside Codegen defect (9)).
    #[test]
    fn node_typed_prop_routes_through_render_pattern_value() {
        let backend = TypeScriptBackend::new();
        let out = backend.config_value_to_jsx_prop_with_pattern(
            Some("alert"),
            "actions",
            &object_get("n", "actions"),
        );
        assert!(
            out.starts_with("actions={renderPatternValue(getNestedValue(")
                && out.ends_with(", \"actions\"))}"),
            "a node-typed destination must route through renderPatternValue, got: {}",
            out
        );
    }
}

#[cfg(test)]
mod array_map_of_get_prop_narrowing_tests {
    use super::*;

    /// `(array/map @entity (fn t (object/get @t path)))` — the exact shape
    /// `NoteTagStripView`'s `TagInput.value` and `NoteTreeView`'s
    /// `FileTree.items` compile to: a `.map()` row whose body reads through
    /// `object/get`/`getNestedValue`, honestly `FieldValue | undefined` per
    /// element.
    fn array_map_of_get(source: &str, param: &str, path: &str) -> OirValue {
        OirValue::Array(vec![
            OirValue::String("array/map".to_string()),
            OirValue::String(format!("@{}", source)),
            OirValue::Array(vec![
                OirValue::String("fn".to_string()),
                OirValue::String(param.to_string()),
                OirValue::Array(vec![
                    OirValue::String("object/get".to_string()),
                    OirValue::String(format!("@{}", param)),
                    OirValue::String(path.to_string()),
                ]),
            ]),
        ])
    }

    /// `array/map` over `getNestedValue` reads yields `(FieldValue |
    /// undefined)[]` — TagInput's `value` prop declares `types: ["array"]`,
    /// `items: { types: ["string"] }` (`std-tag-strip`'s NoteTagStripView
    /// shape). The WHOLE map result must cast to the declared element array
    /// (`array_prop_element_ts` + `array_coerce_value`), not just the read
    /// inside a single element.
    #[test]
    fn array_map_of_get_into_string_array_prop_casts_the_whole_result() {
        let backend = TypeScriptBackend::new();
        let value = array_map_of_get("entity", "t", "name");
        let out = backend.config_value_to_jsx_prop_with_pattern(Some("tag-input"), "value", &value);
        assert!(
            out.starts_with("value={Array.isArray(") && out.ends_with(") as string[]) : []}"),
            "expected the whole array/map result Array.isArray-guarded and cast to string[], got: {}",
            out
        );
        assert!(
            out.contains("getNestedValue("),
            "expected the per-row read to still go through getNestedValue, got: {}",
            out
        );
    }

    /// Same shape, but the destination declares a named-struct array element
    /// (`file-tree`'s `items`: `items.properties` synthesizes `{ icon?:
    /// string; id: string; label: string; parentId?: string }`, `std-tree`'s
    /// NoteTreeView shape). The synthesized structural type — not `EntityRow`
    /// — is what the whole `.map()` result casts to.
    #[test]
    fn array_map_of_get_into_named_struct_array_prop_casts_the_whole_result() {
        let backend = TypeScriptBackend::new();
        let value = array_map_of_get("entity", "t", "id");
        let out = backend.config_value_to_jsx_prop_with_pattern(Some("file-tree"), "items", &value);
        assert!(
            out.starts_with("items={Array.isArray(")
                && out.ends_with(
                    ") as { icon?: string; id: string; label: string; parentId?: string }[]) : []}"
                ),
            "expected the whole array/map result cast to the file-tree item struct, got: {}",
            out
        );
    }

    /// An object-literal `array/map` body (`(fn t {id: (object/get @t "id"),
    /// label: (object/get @t "label")})`) — the exact `NoteTreeView` shape:
    /// each member is a wide `object/get` read. The outer cast to the
    /// declared struct array (same as the scalar-body test above) resolves
    /// BOTH the array-assignability error and the per-member contextual-
    /// typing errors TS would otherwise run against the object literal —
    /// there is no separate per-member coercion to maintain.
    #[test]
    fn array_map_of_object_literal_into_named_struct_array_prop_casts_the_whole_result() {
        let backend = TypeScriptBackend::new();
        let mut fields = orbital_core::ir::OirObject::new();
        fields.insert(
            "id".to_string(),
            OirValue::Array(vec![
                OirValue::String("object/get".to_string()),
                OirValue::String("@t".to_string()),
                OirValue::String("id".to_string()),
            ]),
        );
        fields.insert(
            "label".to_string(),
            OirValue::Array(vec![
                OirValue::String("object/get".to_string()),
                OirValue::String("@t".to_string()),
                OirValue::String("title".to_string()),
            ]),
        );
        let value = OirValue::Array(vec![
            OirValue::String("array/map".to_string()),
            OirValue::String("@entity".to_string()),
            OirValue::Array(vec![
                OirValue::String("fn".to_string()),
                OirValue::String("t".to_string()),
                OirValue::Object(fields),
            ]),
        ]);
        let out = backend.config_value_to_jsx_prop_with_pattern(Some("file-tree"), "items", &value);
        assert!(
            out.starts_with("items={Array.isArray(")
                && out.ends_with(
                    ") as { icon?: string; id: string; label: string; parentId?: string }[]) : []}"
                ),
            "expected the whole array/map-of-object-literal result cast to the file-tree item struct, got: {}",
            out
        );
        // `array_coerce_value`'s `Array.isArray(x) ? (x as T[]) : []` idiom
        // repeats the compiled `.map()` expression in both the guard and the
        // cast arm, so each of the two object-literal members' `getNestedValue`
        // reads appears twice (4 total) — never zero.
        assert!(
            out.matches("getNestedValue(").count() == 4,
            "expected both object-literal members to still read through getNestedValue, got: {}",
            out
        );
    }
}

#[cfg(test)]
mod entity_collection_operator_tests {
    use crate::TypeScriptBackend;

    /// std-record-detail feeds `(object/get @entity.loadedRow @config.threadField)` to
    /// detail-panel's `thread`, an entity collection declaring its row shape at the top level.
    #[test]
    fn an_operator_read_into_an_entity_collection_prop_casts_to_its_row_shape() {
        let out = TypeScriptBackend::narrow_wide_accessor_to_prop_type(
            Some("detail-panel"),
            "thread",
            "getNestedValue(fields?.loadedRow, \"thread\")",
            false,
        );
        assert!(out.contains("authorName"), "{out}");
        assert!(!out.contains("as EntityRow[])"), "{out}");
    }

    #[test]
    fn control_a_primitive_array_prop_keeps_its_element_type() {
        let out = TypeScriptBackend::narrow_wide_accessor_to_prop_type(
            Some("sparkline"),
            "data",
            "getNestedValue(row, \"series\")",
            false,
        );
        assert!(out.contains("number[]"), "{out}");
    }
}
