//! Action-object and event-name helpers for render-ui pattern emission.
//!
//! Split from `pattern/registry.rs` as a pure module breakup.

use orbital_core::ir::{OirModule, OirTrait, OirValue};
use std::collections::{HashMap, HashSet};

use crate::backend::TypeScriptBackend;
use crate::codegen::expr::BindingFlavor;
use crate::pattern_registry::{PropSchema, PropTypeSchema};

impl TypeScriptBackend {
    /// Compile an `actions` config value to a JSX array expression,
    /// resolving a genuinely dynamic `(if <cond> [<action-objects>]
    /// [<action-objects>])` to a real TS ternary instead of a static array.
    ///
    /// `SExpression` has no distinct "operator call" variant (`Array` is
    /// "either a function call `[op, ...args]` or a list" —
    /// `orbital-core/src/schema/sexpr.rs`), so `resolve.rs`'s
    /// `sexpr_to_value` (which builds render-ui pattern config values)
    /// flattens `(if cond [obj] [])` into an ordinary 4-element
    /// `OirValue::Array(["if", cond, [obj], []])` — indistinguishable at
    /// this point from a literal 4-item actions array. The (now-fixed)
    /// caller in `registry.rs` treated every element as an action object,
    /// so each of the 4 non-object slots (the op string, the condition, and
    /// the two branch ARRAYS) rendered as `{}` via `action_to_jsx_obj`'s
    /// non-object fallback (C-ACTIONS-IF-FLATTENED-TO-EMPTY-OBJECTS,
    /// `docs/Almadar_Compiler_Gaps.md` §27).
    ///
    /// Detects that shape and recompiles: the condition is re-lowered
    /// through the canonical `resolve_sexpr_standalone` +
    /// `expr_to_ts_flavored` pipeline (mirrors
    /// `entity_refs::try_compile_sexpr_prop`), while each branch recurses
    /// through this same function so the actual action objects still go
    /// through `action_to_jsx_obj` (event-qualification, field allowlist —
    /// the ordinary literal-array path a plain `if`-free `actions` value
    /// already took, unaffected by this fix). `(array/concat ...)` gets the
    /// same treatment — each argument recurses and is spread, so
    /// `concat + nested if` compositions emit `[...lits, ...(cond ? A : B)]`
    /// (§40, same flattening trap as §27).
    pub(crate) fn actions_value_to_jsx_array(
        &self,
        value: &OirValue,
        with_row: bool,
        element_ts: &str,
    ) -> String {
        if let OirValue::Array(arr) = value {
            if let [OirValue::String(op), cond, then_branch, else_branch] = arr.as_slice() {
                if op == "if" && crate::codegen::is_operator_name(op) {
                    let cond_sexpr = Self::oirvalue_to_sexpr(cond);
                    if let Ok(cond_oir) =
                        orbital_core::lower::lower_sexpr(&cond_sexpr)
                    {
                        let cond_ts = self.expr_to_ts_flavored(&cond_oir, BindingFlavor::Render);
                        let then_ts =
                            self.actions_value_to_jsx_array(then_branch, with_row, element_ts);
                        let else_ts =
                            self.actions_value_to_jsx_array(else_branch, with_row, element_ts);
                        return format!("({}) ? {} : {}", cond_ts, then_ts, else_ts);
                    }
                }
            }
            if let Some((OirValue::String(op), args)) = arr.split_first() {
                if op == "array/concat" && !args.is_empty() {
                    let parts: Vec<String> = args
                        .iter()
                        .map(|a| {
                            format!(
                                "...({})",
                                self.actions_value_to_jsx_array(a, with_row, element_ts)
                            )
                        })
                        .collect();
                    return format!("[{}]", parts.join(", "));
                }
            }
            // `(array/filter <list> <lambda>)` — the role gate every generated
            // list factory applies. The SOURCE list is cast to the host prop's
            // element shape BEFORE filtering, so the lambda reads typed
            // descriptors even when a descriptor carries a compiled `when`
            // closure (a bare literal element would not be assignable to the
            // payload-value parameter `getNestedValue` takes).
            if let [OirValue::String(op), source, lambda] = arr.as_slice() {
                if op == "array/filter" {
                    if let Some(filtered) =
                        self.compile_filtered_actions(source, lambda, element_ts)
                    {
                        return self.qualify_computed_actions(&filtered, element_ts);
                    }
                }
            }
            // Any other operator call over the list (`array/filter`, `array/map`,
            // …): the array is a COMPUTED action list, not literal items.
            // Reading its elements as descriptors emitted one `{}` per operand
            // (the same flattening trap as `if`/`array/concat`), which erased
            // every role-filtered `itemActions` list. Lower it through the one
            // expression emitter, then scope-qualify the resulting descriptors'
            // events at runtime exactly as a bound `@config` list is.
            if let Some(computed) = self.try_compile_sexpr_prop(arr) {
                return self.qualify_computed_actions(&computed, element_ts);
            }
            let action_objs: Vec<String> = arr
                .iter()
                .map(|a| self.action_to_jsx_obj(a, with_row))
                .collect();
            return format!("[{}]", action_objs.join(", "));
        }
        "[]".to_string()
    }

    /// Lower one operand of a computed action list through the one canonical
    /// lowering + expression emitter (render binding flavor).
    fn compile_action_operand(&self, operand: &OirValue) -> Option<String> {
        let sexpr = Self::oirvalue_to_sexpr(operand);
        let lowered = orbital_core::lower::lower_sexpr(&sexpr).ok()?;
        Some(self.expr_to_ts_flavored(&lowered, BindingFlavor::Render))
    }

    /// `((<list> ?? []) as readonly ELT[]).filter(<lambda>)` — see the
    /// `array/filter` arm of `actions_value_to_jsx_array`. A literal list has
    /// no nullish case, so it skips the guard (TS2869).
    fn compile_filtered_actions(
        &self,
        source: &OirValue,
        lambda: &OirValue,
        element_ts: &str,
    ) -> Option<String> {
        let source_ts = self.compile_action_operand(source)?;
        let lambda_ts = self.compile_action_operand(lambda)?;
        let elt = crate::backend::array_element_ts(element_ts);
        let guarded = if source_ts.trim_start().starts_with('[') {
            source_ts
        } else {
            format!("{source_ts} ?? []")
        };
        Some(format!(
            "(({guarded}) as readonly {elt}[]).filter({lambda_ts})"
        ))
    }

    /// Scope-qualify the `event` of every descriptor a computed action list
    /// yields (the literal path qualifies at codegen; a computed list only
    /// exists at render time). A descriptor without an `event` (a navigating
    /// action) passes through untouched.
    ///
    /// The list is cast to the host prop's declared element shape first: an
    /// empty source literal infers `never[]`, and a source whose elements
    /// carry a compiled `when` closure would otherwise widen past the prop.
    fn qualify_computed_actions(&self, computed: &str, element_ts: &str) -> String {
        let elt = crate::backend::array_element_ts(element_ts);
        let typed = format!("(({computed}) as readonly {elt}[])");
        match self.current_trait_scope.snapshot() {
            Some(scope) => format!(
                "{typed}.map((__a) => __a.event ? ({{ ...__a, event: '{scope}.' + __a.event }}) : __a)"
            ),
            None => typed,
        }
    }

    /// Convert an action object to JSX with onClick handler
    pub(crate) fn action_to_jsx_obj(&self, action: &OirValue, with_row: bool) -> String {
        if let OirValue::Object(obj) = action {
            let label = obj
                .get("label")
                .map(|v| self.value_to_string(v))
                .unwrap_or_default();
            let event = obj
                .get("event")
                .map(|v| self.value_to_string(v))
                .unwrap_or_default();
            let variant = obj.get("variant").map(|v| self.value_to_string(v));

            // Gap #13: pre-qualify the event string with the surrounding
            // `Orbital.Trait` scope so the host (DataList / DataGrid /
            // PageHeader) emits `UI:Orbital.Trait.EVENT` on click. Bus
            // listeners (own `useUIEvents`, cross-trait `eventBus.on` in
            // the trait logic hook) subscribe to that exact qualified
            // key — no source-trait predicate, no bare-key fallback.
            let qualified_event = self.qualify_event(&event);

            // Build action object with event for closed-circuit pattern
            // PageHeader will emit UI:EVENT via event bus when clicked
            let mut parts = vec![format!("label: \"{}\"", label)];
            if !qualified_event.is_empty() {
                parts.push(format!("event: \"{}\"", qualified_event));
            }
            // `as const` keeps the union-literal type alive in computed
            // contexts (spread/ternary from §40) where contextual typing
            // no longer reaches the object literal.
            if let Some(v) = variant {
                parts.push(format!("variant: \"{}\" as const", v));
            }
            // Converged navigation prop: `navigatesTo` with `{{row.field}}`
            // interpolation, honored by the host components (CardGrid/
            // DataGrid) — previously only the JS runtime carried it and the
            // compiled path silently dropped it
            // (C-ITEMACTION-HREF-CONTRACT-DIVERGENCE).
            if let Some(nav) = obj.get("navigatesTo").map(|v| self.value_to_string(v)) {
                if !nav.is_empty() {
                    parts.push(format!("navigatesTo: \"{}\"", nav));
                }
            }
            if let Some(icon) = obj.get("icon").map(|v| self.value_to_string(v)) {
                if !icon.is_empty() {
                    parts.push(format!("icon: \"{}\"", icon));
                }
            }
            // The per-row condition travels as DATA (`["fn", "row", body]`), the
            // form the interpreter delivers, so the host component evaluates
            // it with the one shared evaluator — never re-lowered to TS here,
            // where `@user`/`@row` have no scope.
            if let Some(when) = obj.get("when") {
                parts.push(format!(
                    "when: {}",
                    crate::backend::oir_value_to_ts_literal(when)
                ));
            }
            // No onClick emitted: `DataGridItemAction` / `DataListItemAction`
            // declare { label, event, icon?, variant? } only. The host component
            // internally emits `UI:{event}` through its own handler when the
            // action button fires, so the action object stays EventPayload-
            // assignable and doesn't need a consumer-supplied callback.
            let _ = with_row;

            format!("{{ {} }}", parts.join(", "))
        } else {
            "{}".to_string()
        }
    }

    /// Gap #13: prepend the surrounding `Orbital.Trait.` scope to an event
    /// identifier, producing the qualified form host components emit on the
    /// bus (`UI:Orbital.Trait.EVENT`). When no scope is set (codegen running
    /// outside a trait View, e.g. shared shell code) the bare identifier is
    /// returned unchanged — system-scope events like `NOTIFY` flow through
    /// uncovered.
    ///
    /// Checks `current_event_scope_chain` first: an embedded/hoisted trait's
    /// action config often names an event the trait ITSELF has no transition
    /// for (an embedded `ButtonRender`'s `action` is provided by whatever
    /// embeds it) — the runtime's embed routing delivers such an event to
    /// the HOST, never to the embedded trait's own bus key
    /// (C-EMBED-ACTION-SELF-SCOPED-NOT-HOST-SCOPED). The chain is
    /// innermost-first; the first entry whose OWN transitions declare
    /// `event` wins, so a trait that genuinely handles its own event (most
    /// traits, most events) is unaffected — only a bare identifier nothing
    /// in the current trait reacts to walks outward.
    pub(crate) fn qualify_event(&self, event: &str) -> String {
        if event.is_empty() {
            return String::new();
        }
        for (events, scope) in self.current_event_scope_chain.snapshot().iter() {
            if events.contains(event) {
                return format!("{}.{}", scope, event);
            }
        }
        let scope = self.current_trait_scope.snapshot();
        match scope.as_deref() {
            Some(s) => format!("{}.{}", s, event),
            None => event.to_string(),
        }
    }

    /// Build `current_event_scope_chain` for `trait_def`: innermost-first
    /// `(owned event set, "Orbital.Trait" scope)` for itself, then for
    /// `host_trait`, then that trait's own host, walking until a trait
    /// declares no host or a cycle would repeat a name already seen
    /// (defensive only — `host_trait` is computed acyclically by
    /// `EmbedGraph`, which the resolve phase feeds).
    ///
    /// What counts as "owned" is deliberately ASYMMETRIC between self and
    /// ancestors:
    /// - **Self**: only its own TRANSITIONS. An embedded atom's `emits {}`
    ///   is frequently itself a config-ref rename of the embedder's chosen
    ///   event name (`ButtonRender`'s `@config.action -> external {}`
    ///   resolves to literally `NEW_MESSAGE -> external {}` on the
    ///   materialized embed) — real per-instance data, but an ECHO of the
    ///   embedder's vocabulary, not evidence the embedded trait itself owns
    ///   the name. Counting it here made every embedded action match
    ///   itself immediately, undoing the whole point of walking to a host
    ///   (verified regression: NEW_MESSAGE/OPEN_PINNED/OPEN_THREAD all
    ///   fell back to self-scope again with self-emits counted).
    /// - **Ancestors**: transitions AND `emits {}` both count. An ancestor
    ///   that declares an event in `emits {}` with NO self-transition (e.g.
    ///   `ChatRoom`'s `CREATE_CHANNEL -> external {}`, consumed by a
    ///   sibling trait's `listens` block, not by ChatRoom itself) is
    ///   exactly as much the semantic owner as one with a real
    ///   self-transition — the runtime's embed routing still delivers the
    ///   embedded child's click to THIS ancestor's qualified scope, never
    ///   the child's own.
    pub(crate) fn build_event_scope_chain(
        trait_def: &OirTrait,
        module: &OirModule,
    ) -> Vec<(HashSet<String>, String)> {
        let mut chain = Vec::new();
        let mut visited: HashSet<&str> = HashSet::new();
        let mut current = trait_def;
        let mut is_self = true;
        loop {
            if !visited.insert(current.name.as_str()) {
                break;
            }
            let events: HashSet<String> = if is_self {
                current.transitions.iter().map(|t| t.event.clone()).collect()
            } else {
                current
                    .transitions
                    .iter()
                    .map(|t| t.event.clone())
                    .chain(current.emits.iter().map(|e| e.event.clone()))
                    .collect()
            };
            chain.push((events, format!("{}.{}", current.orbital_name, current.name)));
            let Some(host_name) = current.host_trait.as_deref() else {
                break;
            };
            let Some(host) = module.traits.iter().find(|t| t.name == host_name) else {
                break;
            };
            current = host;
            is_self = false;
        }
        chain
    }

    /// Whether a render-ui prop key carries an event identifier that the
    /// host component emits on the bus. Codegen pre-qualifies these strings
    /// with the trait scope so the host's `eventBus.emit('UI:' + value)`
    /// produces a qualified key.
    pub(crate) fn is_event_name_prop(key: &str) -> bool {
        matches!(
            key,
            "action"
                | "event"
                | "submitEvent"
                | "cancelEvent"
                | "hoverEvent"
                | "longPressEvent"
                | "loadMoreEvent"
        )
    }

    /// Element TS type for an array-typed prop bound to a wide payload read
    /// (`lastPayload?.X` / `@payload.X` → `EventPayloadValue`). The registry
    /// carries the element's structural shape (`items.properties` / `required`)
    /// but no named type, so we synthesize the structural object literal — it
    /// is structurally identical to the prop's declared element type (e.g.
    /// `MapMarkerData`) and assigns to the strict array prop. Falls back to
    /// `EntityRow` when the prop declares no element shape.
    pub(crate) fn array_prop_element_ts(prop: Option<&PropSchema>) -> String {
        let items = match prop.and_then(|p| p.items.as_ref()) {
            Some(items) => items,
            None => return "EntityRow".to_string(),
        };
        let props = match items.properties.as_ref() {
            Some(props) if !props.is_empty() => props,
            // No object `properties` → a PRIMITIVE-element array (`number[]`,
            // `string[]`) or an opaque object array. Resolve the element from
            // the items' `types` (`number`/`string`/… → that primitive;
            // `object` → `EntityRow`) so e.g. a sparkline `number[]` casts to
            // `number[]`, not the `EntityRow[]` fallback.
            _ => return Self::prop_type_schema_to_ts(items),
        };
        let required = items.required.clone().unwrap_or_default();
        Self::object_type_from_props(props, &required)
    }

    /// Synthesize a structural object-type literal `{ a: T; b?: U }` from a
    /// registry `properties` map + its `required` field set. The registry
    /// knows the field shape but not the named row type, so both consumers —
    /// `array_prop_element_ts` (array-element shape under `items`) and
    /// `entity_data_cast` (entity-data prop shape at the top level) — emit this
    /// structural literal, which is structurally identical to (and assigns to)
    /// the component's declared type, satisfies `EntityWith<S extends object>`,
    /// and needs no import of the named row type.
    pub(crate) fn object_type_from_props(
        props: &HashMap<String, PropTypeSchema>,
        required: &[String],
    ) -> String {
        let mut keys: Vec<&String> = props.keys().collect();
        keys.sort();
        let fields: Vec<String> = keys
            .into_iter()
            .map(|k| {
                let ty = Self::prop_type_schema_to_ts(&props[k]);
                let optional = if required.iter().any(|r| r == k) {
                    ""
                } else {
                    "?"
                };
                format!("{}{}: {}", k, optional, ty)
            })
            .collect();
        format!("{{ {} }}", fields.join("; "))
    }

    /// Render a `PropTypeSchema` as a faithful TS type so a synthesized
    /// structural shape matches the component's declared row/element type
    /// field-for-field: enum unions from `enumValues` (enum fields lower to
    /// `string` + `enumValues`), `readonly E[]` for arrays (recursing `items`),
    /// an inline object literal for object shapes (recursing `properties`), else
    /// the primitive. `string`/`icon`/`node`/`asset` and other string-ish leaf
    /// kinds map to `string`.
    fn prop_type_schema_to_ts(schema: &PropTypeSchema) -> String {
        // An S-expression the compiled shell may deliver as a closure
        // (`types: ["sexpr", "function"]`, an action item's per-row `when`)
        // has no structural spelling: the array form and the closure form
        // are both valid values. `never` is comparable to both, and the
        // shape is cast-only.
        if schema.types.iter().any(|t| t == "sexpr") && schema.types.iter().any(|t| t == "function")
        {
            return "never".to_string();
        }
        // Recursive element reference (registry `cyclic: true`, e.g. menu
        // `subMenu`): a structural literal can't spell the recursion, and the
        // `EntityRow` fallback fails assignment to the component's named
        // recursive type (`MenuItem[]`). `never` is assignable to every
        // element type, and the shape is cast-only — runtime values flow
        // through unchanged.
        if schema.cyclic {
            return "never".to_string();
        }
        if let Some(vals) = schema.enum_values.as_ref().filter(|v| !v.is_empty()) {
            return vals
                .iter()
                .map(|v| format!("'{}'", v))
                .collect::<Vec<_>>()
                .join(" | ");
        }
        let mut parts: Vec<String> = schema
            .types
            .iter()
            .map(|t| match t.as_str() {
                "number" => "number".to_string(),
                "boolean" => "boolean".to_string(),
                "array" => {
                    // MUTABLE element array (`T[]`, not `readonly T[]`): a
                    // mutable array assigns to BOTH a mutable field
                    // (`features: string[]`) and a readonly one, whereas
                    // `readonly T[]` fails against a mutable target (TS2322).
                    let elt = schema
                        .items
                        .as_deref()
                        .map(Self::prop_type_schema_to_ts)
                        .unwrap_or_else(|| "EntityRow".to_string());
                    // `[]` binds TIGHTER than `|` — an enum-element array
                    // (`items.enumValues`) recurses to a bare union
                    // (`'left' | 'right' | …`), and appending `[]` straight
                    // onto that reads as `'left' | 'right' | … | ('…'[])`
                    // (only the LAST member is an array; every other
                    // member is a bare string literal) — TS2322 against
                    // the component's real `readonly (…)[]` prop. Wrap the
                    // element type in parens whenever it's itself a union.
                    if elt.contains(" | ") {
                        format!("({})[]", elt)
                    } else {
                        format!("{}[]", elt)
                    }
                }
                "object" => schema
                    .properties
                    .as_ref()
                    .filter(|m| !m.is_empty())
                    .map(|props| {
                        let required = schema.required.clone().unwrap_or_default();
                        Self::object_type_from_props(props, &required)
                    })
                    // A property-less object MEMBER (registry `mapValue` /
                    // freeform maps, e.g. import-preview `fields`): the
                    // `EntityRow` fallback carries `| undefined` values and
                    // fails assignment to a strict `Record<string, FieldValue>`
                    // target. `never` assigns to every object type, and the
                    // shape is cast-only.
                    .unwrap_or_else(|| "never".to_string()),
                // A callback field ("function") can't be spelled structurally
                // — its signature varies per component (`() => void`,
                // handlers with args). `never` assigns to every function
                // type, and the shape is cast-only.
                "function" => "never".to_string(),
                _ => "string".to_string(),
            })
            .collect();
        parts.dedup();
        if parts.is_empty() {
            parts.push("string".to_string());
        }
        parts.join(" | ")
    }
}

#[cfg(test)]
mod host_scope_tests {
    use super::*;
    use crate::backend::TypeScriptBackend;
    use orbital_core::ir::{OirModule, OirTransition};

    /// The shipped bug: an embedded `ButtonRender`'s `action` config names
    /// `NEW_MESSAGE` — an event only its HOST (`ChatRoom`) has a transition
    /// for. Qualifying under the embedded trait's own scope produced a bus
    /// key nothing listens to; the button silently did nothing on click.
    #[test]
    fn qualify_event_walks_to_the_host_when_the_embedded_trait_owns_no_transition_for_it() {
        let mut host = OirTrait::new("ChatRoom");
        host.orbital_name = "ChatMessageOrbital".to_string();
        host.transitions.push(OirTransition::new("composing", "composing", "NEW_MESSAGE"));

        let mut embedded = OirTrait::new("ChatMessageOrbitalInlineButtonRender4");
        embedded.orbital_name = "ChatMessageOrbital".to_string();
        embedded.host_trait = Some("ChatRoom".to_string());
        // No transition on NEW_MESSAGE — ButtonRender only ever EMITS it.

        let mut module = OirModule::new("app", "1.0.0");
        module.traits.push(host);
        module.traits.push(embedded.clone());

        let backend = TypeScriptBackend::new();
        backend.current_trait_scope.set(Some(format!(
            "{}.{}",
            embedded.orbital_name, embedded.name
        )));
        backend
            .current_event_scope_chain
            .set(TypeScriptBackend::build_event_scope_chain(&embedded, &module));

        assert_eq!(
            backend.qualify_event("NEW_MESSAGE"),
            "ChatMessageOrbital.ChatRoom.NEW_MESSAGE",
            "must qualify under the HOST (ChatRoom), not the embedded trait's own synthetic name"
        );
    }

    /// A trait that genuinely owns the transition for an event (the common
    /// case — most traits, most events) keeps self-scoping. The host chain
    /// must never override a trait's OWN handled events.
    #[test]
    fn qualify_event_self_scopes_when_the_current_trait_owns_the_transition() {
        let mut host = OirTrait::new("TaskBoard");
        host.orbital_name = "TaskOrbital".to_string();

        let mut child = OirTrait::new("TaskBoardCard");
        child.orbital_name = "TaskOrbital".to_string();
        child.host_trait = Some("TaskBoard".to_string());
        child
            .transitions
            .push(OirTransition::new("idle", "idle", "OPEN_CARD"));

        let mut module = OirModule::new("app", "1.0.0");
        module.traits.push(host);
        module.traits.push(child.clone());

        let backend = TypeScriptBackend::new();
        backend
            .current_trait_scope
            .set(Some(format!("{}.{}", child.orbital_name, child.name)));
        backend
            .current_event_scope_chain
            .set(TypeScriptBackend::build_event_scope_chain(&child, &module));

        assert_eq!(
            backend.qualify_event("OPEN_CARD"),
            "TaskOrbital.TaskBoardCard.OPEN_CARD",
            "a trait with its own transition on this event must self-scope, host chain notwithstanding"
        );
    }

    /// Nested embeds (A embeds B embeds C): C's event, unowned by both B and
    /// itself, resolves all the way out to A.
    #[test]
    fn qualify_event_walks_a_multi_level_embed_chain() {
        let mut root = OirTrait::new("Root");
        root.orbital_name = "Orb".to_string();
        root.transitions.push(OirTransition::new("s", "s", "DEEP_EVENT"));

        let mut middle = OirTrait::new("Middle");
        middle.orbital_name = "Orb".to_string();
        middle.host_trait = Some("Root".to_string());

        let mut leaf = OirTrait::new("Leaf");
        leaf.orbital_name = "Orb".to_string();
        leaf.host_trait = Some("Middle".to_string());

        let mut module = OirModule::new("app", "1.0.0");
        module.traits.push(root);
        module.traits.push(middle);
        module.traits.push(leaf.clone());

        let backend = TypeScriptBackend::new();
        backend
            .current_trait_scope
            .set(Some(format!("{}.{}", leaf.orbital_name, leaf.name)));
        backend
            .current_event_scope_chain
            .set(TypeScriptBackend::build_event_scope_chain(&leaf, &module));

        assert_eq!(backend.qualify_event("DEEP_EVENT"), "Orb.Root.DEEP_EVENT");
    }

    /// An unresolvable event (a system event like `NOTIFY`, or a value
    /// nothing in the chain declares) falls back to self-scope unchanged —
    /// no regression for the cases this mechanism doesn't understand.
    #[test]
    fn qualify_event_falls_back_to_self_scope_when_nothing_in_the_chain_owns_it() {
        let mut embedded = OirTrait::new("SomeInlineRender1");
        embedded.orbital_name = "Orb".to_string();
        embedded.host_trait = Some("Host".to_string());

        let mut host = OirTrait::new("Host");
        host.orbital_name = "Orb".to_string();
        // Host declares no transition for "NOTIFY" either.

        let mut module = OirModule::new("app", "1.0.0");
        module.traits.push(host);
        module.traits.push(embedded.clone());

        let backend = TypeScriptBackend::new();
        backend
            .current_trait_scope
            .set(Some(format!("{}.{}", embedded.orbital_name, embedded.name)));
        backend
            .current_event_scope_chain
            .set(TypeScriptBackend::build_event_scope_chain(&embedded, &module));

        assert_eq!(
            backend.qualify_event("NOTIFY"),
            "Orb.SomeInlineRender1.NOTIFY",
            "unresolved anywhere in the chain — falls back to self-scope, not fabricated"
        );
    }

    /// The exact shipped shape for `CREATE_CHANNEL`: the host declares the
    /// event in `emits {}` with NO self-transition at all (a sibling
    /// trait's `listens` block is the real reaction) — this must still
    /// count as the host owning it.
    #[test]
    fn qualify_event_walks_to_a_host_that_only_declares_the_event_as_an_emit() {
        let mut host = OirTrait::new("ChatRoom");
        host.orbital_name = "ChatMessageOrbital".to_string();
        host.emits.push(orbital_core::ir::OirEmit::new("CREATE_CHANNEL"));
        // No transition on CREATE_CHANNEL — a sibling trait's `listens`
        // block is what actually reacts to it.

        let mut embedded = OirTrait::new("ChatMessageOrbitalInlineButtonRender7");
        embedded.orbital_name = "ChatMessageOrbital".to_string();
        embedded.host_trait = Some("ChatRoom".to_string());
        // Config-ref rename baked this in too (real per-instance data, but
        // must NOT count for the self entry — see the regression this
        // guards, below).
        embedded.emits.push(orbital_core::ir::OirEmit::new("CREATE_CHANNEL"));

        let mut module = OirModule::new("app", "1.0.0");
        module.traits.push(host);
        module.traits.push(embedded.clone());

        let backend = TypeScriptBackend::new();
        backend.current_trait_scope.set(Some(format!(
            "{}.{}",
            embedded.orbital_name, embedded.name
        )));
        backend
            .current_event_scope_chain
            .set(TypeScriptBackend::build_event_scope_chain(&embedded, &module));

        assert_eq!(
            backend.qualify_event("CREATE_CHANNEL"),
            "ChatMessageOrbital.ChatRoom.CREATE_CHANNEL",
            "the host's bare emits{{}} declaration must win over the embedded trait's own \
             (config-ref-renamed) echo of the same event"
        );
    }

    /// Regression guard: an embedded trait's OWN `emits {}` is frequently a
    /// config-ref rename ECHOING the embedder's chosen event name, not
    /// evidence the embedded trait itself owns it. Counting self's emits
    /// broke this exact case in review (every button matched itself
    /// immediately and never reached the host).
    #[test]
    fn qualify_event_ignores_the_embedded_traits_own_emits_declaration() {
        let mut host = OirTrait::new("ChatRoom");
        host.orbital_name = "ChatMessageOrbital".to_string();
        host.transitions.push(OirTransition::new("composing", "composing", "NEW_MESSAGE"));

        let mut embedded = OirTrait::new("ChatMessageOrbitalInlineButtonRender4");
        embedded.orbital_name = "ChatMessageOrbital".to_string();
        embedded.host_trait = Some("ChatRoom".to_string());
        // The config-ref rename (`@config.action -> external {}` resolving
        // to `NEW_MESSAGE -> external {}`) bakes this in on the embedded
        // trait too — real data, but must not win self-scope.
        embedded.emits.push(orbital_core::ir::OirEmit::new("NEW_MESSAGE"));

        let mut module = OirModule::new("app", "1.0.0");
        module.traits.push(host);
        module.traits.push(embedded.clone());

        let backend = TypeScriptBackend::new();
        backend.current_trait_scope.set(Some(format!(
            "{}.{}",
            embedded.orbital_name, embedded.name
        )));
        backend
            .current_event_scope_chain
            .set(TypeScriptBackend::build_event_scope_chain(&embedded, &module));

        assert_eq!(
            backend.qualify_event("NEW_MESSAGE"),
            "ChatMessageOrbital.ChatRoom.NEW_MESSAGE",
            "self's own emits{{}} must not shadow the host's real transition"
        );
    }
}
