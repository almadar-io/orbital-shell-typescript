//! Render-ui pattern → JSX emission.
//!
//! Shared between Express (`backend.rs`) and Hono (`backend_hono.rs`).
//! The Hono backend's client component generation delegates to
//! `generate_pattern_from_registry` here via `self.X(...)`, so the
//! logic is framework-agnostic.
//!
//! Extracted from `backend.rs` as Phase 3e.6 of the DRY refactor.

mod action;
mod prop;
mod registry;

// ---------------------------------------------------------------------
// Tests for render-ui pattern emission + @trait.X binding resolution.
//
// Migrated from `backend.rs::tests` as part of Phase 3e.7. Tests cover:
//   1. `parse_trait_binding` accepts the canonical `@trait.Pascal` form
//      and rejects the forms the validator turns away.
//   2. `generate_pattern_from_registry` emits `<XView />` inline when a
//      pattern's `children:` array contains `@trait.X`.
//   3. `collect_component_imports` picks up the matching `@/components/
//      traits/XView` import so the generated file header includes it.
// ---------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use crate::TypeScriptBackend;
    use orbital_core_base::ir::OirValue;

    #[test]
    fn trait_binding_parse_accepts_canonical_form() {
        let backend = TypeScriptBackend::default();
        assert_eq!(
            backend.parse_trait_binding("@trait.ItemBrowse"),
            Some("ItemBrowse".to_string())
        );
        assert_eq!(
            backend.parse_trait_binding("@trait.A"),
            Some("A".to_string())
        );
    }

    #[test]
    fn trait_binding_parse_rejects_non_pascal_case() {
        let backend = TypeScriptBackend::default();
        assert!(backend.parse_trait_binding("@trait.itemBrowse").is_none());
        assert!(backend.parse_trait_binding("@trait.item_browse").is_none());
        assert!(backend.parse_trait_binding("@trait.123Foo").is_none());
    }

    #[test]
    fn trait_binding_parse_rejects_extra_segments() {
        // `@trait.X.slot` was the former cross-slot pull syntax. Rejected.
        let backend = TypeScriptBackend::default();
        assert!(backend
            .parse_trait_binding("@trait.ItemBrowse.main")
            .is_none());
        assert!(backend.parse_trait_binding("@trait.Foo.bar.baz").is_none());
    }

    #[test]
    fn trait_binding_parse_rejects_non_binding_strings() {
        let backend = TypeScriptBackend::default();
        assert!(backend.parse_trait_binding("@entity.title").is_none());
        assert!(backend.parse_trait_binding("@trait").is_none());
        assert!(backend.parse_trait_binding("").is_none());
        assert!(backend.parse_trait_binding("plain-text").is_none());
    }

    #[test]
    fn children_walker_emits_trait_view_for_binding() {
        // Exercise the JSX emission path: a `stack` with a single
        // `@trait.ItemSearch` child renders `<ItemSearchView />` inline,
        // carrying the composing View's route context so the embedded trait's
        // auto-INIT sees `:id` and the navigate state (§58). Without the
        // forward it was emitted bare and dispatched INIT with no payload at
        // all.
        let backend = TypeScriptBackend::default();
        let mut config = orbital_core_base::ir::OirObject::new();
        config.insert(
            "children".to_string(),
            OirValue::Array(vec![OirValue::String("@trait.ItemSearch".to_string())]),
        );
        let jsx = backend.generate_pattern_from_registry("stack", &config, Some("Item"), None);
        assert!(
            jsx.contains(
                "<ItemSearchView config={{ entityId: propsConfig?.entityId, \
                 routeParams: propsConfig?.routeParams, \
                 initPayload: propsConfig?.initPayload }} />"
            ),
            "expected <ItemSearchView /> with forwarded route context, got: {}",
            jsx
        );
    }

    #[test]
    fn children_walker_injects_callsite_payload_capture_config() {
        // A child trait with a call-site payload capture is embedded with a
        // `config={{ <knob>: lastPayload?.<field> }}` attribute resolving the
        // capture against the COMPOSING View's event payload.
        let backend = TypeScriptBackend::default();
        backend.trait_callsite_captures.set({
            let mut m = std::collections::HashMap::new();
            m.insert(
                "ErrText".to_string(),
                vec![(
                    "content".to_string(),
                    "error".to_string(),
                    "string".to_string(),
                )],
            );
            m
        });
        let mut config = orbital_core_base::ir::OirObject::new();
        config.insert(
            "children".to_string(),
            OirValue::Array(vec![OirValue::String("@trait.ErrText".to_string())]),
        );
        let jsx = backend.generate_pattern_from_registry("stack", &config, Some("Item"), None);
        // The capture rides alongside the forwarded route context (§58): both
        // travel through the same `config` attribute.
        assert!(
            jsx.contains(
                "<ErrTextView config={{ entityId: propsConfig?.entityId, \
                 routeParams: propsConfig?.routeParams, \
                 initPayload: propsConfig?.initPayload, \
                 content: (lastPayload?.error) as string }} />"
            ),
            "expected capture config injection, got: {}",
            jsx
        );
    }

    #[test]
    fn children_walker_handles_mix_of_binding_and_pattern_children() {
        let backend = TypeScriptBackend::default();

        // Build a child pattern object: { type: "box" }
        let mut box_obj = orbital_core_base::ir::OirObject::new();
        box_obj.insert("type".to_string(), OirValue::String("box".to_string()));

        let mut stack_config = orbital_core_base::ir::OirObject::new();
        stack_config.insert(
            "children".to_string(),
            OirValue::Array(vec![
                OirValue::String("@trait.Foo".to_string()),
                OirValue::Object(box_obj),
                OirValue::String("@trait.Bar".to_string()),
            ]),
        );

        let jsx =
            backend.generate_pattern_from_registry("stack", &stack_config, Some("Item"), None);
        // Both embeds carry the forwarded route context (§58).
        for name in ["Foo", "Bar"] {
            assert!(
                jsx.contains(&format!(
                    "<{}View config={{{{ entityId: propsConfig?.entityId, \
                     routeParams: propsConfig?.routeParams, \
                     initPayload: propsConfig?.initPayload }}}} />",
                    name
                )),
                "missing <{}View /> with route context: {}",
                name,
                jsx
            );
        }
    }

    #[test]
    fn fc5_array_map_children_entry_emits_map() {
        // A `children` array entry `["array/map", "@entity.items", ["fn",
        // "item", { type: badge, label: "@item.name" }]]` must codegen a
        // `.map()` over the collection producing the per-item node JSX.
        let backend = TypeScriptBackend::default();
        let mut badge = orbital_core_base::ir::OirObject::new();
        badge.insert("type".to_string(), OirValue::String("badge".to_string()));
        badge.insert(
            "label".to_string(),
            OirValue::String("@item.name".to_string()),
        );
        let map_tuple = OirValue::Array(vec![
            OirValue::String("array/map".to_string()),
            OirValue::String("@entity.items".to_string()),
            OirValue::Array(vec![
                OirValue::String("fn".to_string()),
                OirValue::String("item".to_string()),
                OirValue::Object(badge),
            ]),
        ]);
        let mut config = orbital_core_base::ir::OirObject::new();
        config.insert("children".to_string(), OirValue::Array(vec![map_tuple]));
        let jsx = backend.generate_pattern_from_registry("stack", &config, Some("Item"), None);
        assert!(
            jsx.contains(".map((item) =>"),
            "expected a `.map((item) => …)` in generated JSX, got: {}",
            jsx
        );
        assert!(
            jsx.contains("fields?.items"),
            "expected the collection binding resolved (fields?.items), got: {}",
            jsx
        );
        assert!(
            jsx.contains("item?.name"),
            "expected @item.name compiled to item?.name in the item node, got: {}",
            jsx
        );
    }

    // C-COMPILED-PATH-RED §25 TS2869: a config-resolved LITERAL collection
    // (`(array/map [] …)` after compose inlined an empty default) is never
    // nullish — the `?? []` guard must be dropped, and kept for opaque
    // binding sources.
    #[test]
    fn fc5_literal_collection_drops_nullish_guard() {
        let backend = TypeScriptBackend::default();
        let mut badge = orbital_core_base::ir::OirObject::new();
        badge.insert("type".to_string(), OirValue::String("badge".to_string()));
        badge.insert("label".to_string(), OirValue::String("@n.name".to_string()));
        let map_tuple = OirValue::Array(vec![
            OirValue::String("array/map".to_string()),
            OirValue::Array(vec![]),
            OirValue::Array(vec![
                OirValue::String("fn".to_string()),
                OirValue::String("n".to_string()),
                OirValue::Object(badge),
            ]),
        ]);
        let mut config = orbital_core_base::ir::OirObject::new();
        config.insert("children".to_string(), map_tuple);
        let jsx = backend.generate_pattern_from_registry("stack", &config, Some("Item"), None);
        assert!(
            jsx.contains("([]).map((n) =>"),
            "literal collection must map without a `?? []` guard, got: {}",
            jsx
        );
        assert!(
            !jsx.contains("[] ?? []"),
            "no unreachable nullish guard on a literal collection: {}",
            jsx
        );
    }

    // C-ACTIONS-IF-FLATTENED-TO-EMPTY-OBJECTS (Almadar_Compiler_Gaps.md §27):
    // an `actions={(if <cond> [<action-objects>] [<action-objects>])}`
    // JSX prop is flattened by resolve.rs's `sexpr_to_value` into an
    // ordinary 4-element `OirValue::Array(["if", cond, then, else])` —
    // `SExpression::Array` has no distinct operator-call variant. Before
    // the fix, `registry.rs`'s "actions" arm treated every element as a
    // literal action object, so all 4 non-object slots rendered as `{}`
    // via `action_to_jsx_obj`'s fallback. Pin the real ternary output —
    // both branches through `action_to_jsx_obj` (event qualified), the
    // condition re-lowered through the standalone resolver.
    #[test]
    fn actions_dynamic_if_compiles_to_real_ternary_not_flattened_objects() {
        let backend = TypeScriptBackend::default();
        let mut cancel_action = orbital_core_base::ir::OirObject::new();
        cancel_action.insert(
            "label".to_string(),
            OirValue::String("Cancel appointment".to_string()),
        );
        cancel_action.insert(
            "event".to_string(),
            OirValue::String("CANCEL_APPOINTMENT".to_string()),
        );
        let cond = OirValue::Array(vec![
            OirValue::String("=".to_string()),
            OirValue::String("@entity.customerId".to_string()),
            OirValue::String("@user.id".to_string()),
        ]);
        let dynamic_actions = OirValue::Array(vec![
            OirValue::String("if".to_string()),
            cond,
            OirValue::Array(vec![OirValue::Object(cancel_action)]),
            OirValue::Array(vec![]),
        ]);
        let mut config = orbital_core_base::ir::OirObject::new();
        config.insert("actions".to_string(), dynamic_actions);
        let jsx =
            backend.generate_pattern_from_registry("detail-panel", &config, Some("Item"), None);

        assert!(
            !jsx.contains("actions={[{}, {}, {}, {}]}"),
            "actions must not flatten to four empty objects, got: {}",
            jsx
        );
        assert!(
            jsx.contains(
                "actions={((fields?.customerId === user?.id)) ? [{ label: \"Cancel appointment\", event: \"CANCEL_APPOINTMENT\" }] : []}"
            ),
            "actions must compile to a real ternary with the action object intact, got: {}",
            jsx
        );
    }

    #[test]
    fn fc5_bare_array_map_children_value_emits_map() {
        // `children: (array/map …)` — the whole value is one producer.
        let backend = TypeScriptBackend::default();
        let mut badge = orbital_core_base::ir::OirObject::new();
        badge.insert("type".to_string(), OirValue::String("badge".to_string()));
        badge.insert(
            "label".to_string(),
            OirValue::String("@q.title".to_string()),
        );
        let map_tuple = OirValue::Array(vec![
            OirValue::String("array/map".to_string()),
            OirValue::String("@config.questions".to_string()),
            OirValue::Array(vec![
                OirValue::String("fn".to_string()),
                OirValue::String("q".to_string()),
                OirValue::Object(badge),
            ]),
        ]);
        let mut config = orbital_core_base::ir::OirObject::new();
        config.insert("children".to_string(), map_tuple);
        let jsx = backend.generate_pattern_from_registry("stack", &config, Some("Item"), None);
        assert!(
            jsx.contains(".map((q) =>") && jsx.contains("config?.questions"),
            "expected `.map((q) => …)` over config?.questions, got: {}",
            jsx
        );
    }

    #[test]
    fn node_prop_single_element_descriptor_emits_bare_element_no_fragment() {
        // The exact shipped shape (ChatMessageAttachment's Menu `trigger`):
        // a single `{type: "button", ...}` descriptor on a `node`-typed
        // prop. `Menu` (@almadar/ui) does `React.cloneElement(trigger,
        // {ref, onClick})` — a Fragment can't take a ref, so wrapping the
        // ONE generated element in `<>…</>` broke it with "Invalid prop
        // 'ref' supplied to React.Fragment".
        let backend = TypeScriptBackend::default();
        let mut trigger = orbital_core_base::ir::OirObject::new();
        trigger.insert("type".to_string(), OirValue::String("button".to_string()));
        trigger.insert("label".to_string(), OirValue::String("".to_string()));
        trigger.insert(
            "icon".to_string(),
            OirValue::String("paperclip".to_string()),
        );
        trigger.insert(
            "variant".to_string(),
            OirValue::String("ghost".to_string()),
        );
        let mut config = orbital_core_base::ir::OirObject::new();
        config.insert("trigger".to_string(), OirValue::Object(trigger));
        config.insert("items".to_string(), OirValue::Array(vec![]));
        let jsx = backend.generate_pattern_from_registry("menu", &config, None, None);
        assert!(
            jsx.contains("trigger={<Button"),
            "expected a bare single <Button/> element on `trigger`, got: {}",
            jsx
        );
        assert!(
            !jsx.contains("trigger={<>"),
            "a single element-valued prop must never be Fragment-wrapped, got: {}",
            jsx
        );
    }

    // The positive control for "two-or-more siblings still need a Fragment"
    // lives in `backend/client/trait_component.rs`
    // (`two_slots_written_by_one_transition_still_fragment_wrap_the_body`):
    // this file's own `"items" if pattern_type == "stats"` multi-StatCard
    // branch (registry.rs) turned out unreachable through
    // `generate_pattern_from_registry`'s public entry — `get_component_mapping`
    // has no `"stats"` key (only `stats-grid`/`stats-organism`), so any call
    // with `pattern_type == "stats"` returns the early `Unknown pattern`
    // marker before that branch's own key loop ever runs. Pre-existing, not
    // touched by this fix; flagged rather than silently exercised as "still
    // works" by a test that never actually reaches it.

    #[test]
    fn fc5_array_map_children_body_is_not_fragment_wrapped() {
        // Same bug class as the `menu.trigger` case, in the `array/map`
        // children lowering (`try_mapped_children_jsx`): each iteration's
        // body is one `generate_pattern_from_registry` call — already a
        // complete expression — so the `.map(...)` callback must return it
        // bare, not `<>…</>`-wrapped.
        let backend = TypeScriptBackend::default();
        let mut badge = orbital_core_base::ir::OirObject::new();
        badge.insert("type".to_string(), OirValue::String("badge".to_string()));
        badge.insert(
            "label".to_string(),
            OirValue::String("@q.title".to_string()),
        );
        let map_tuple = OirValue::Array(vec![
            OirValue::String("array/map".to_string()),
            OirValue::String("@config.questions".to_string()),
            OirValue::Array(vec![
                OirValue::String("fn".to_string()),
                OirValue::String("q".to_string()),
                OirValue::Object(badge),
            ]),
        ]);
        let mut config = orbital_core_base::ir::OirObject::new();
        config.insert("children".to_string(), map_tuple);
        let jsx = backend.generate_pattern_from_registry("stack", &config, Some("Item"), None);
        assert!(
            jsx.contains(".map((q) => (<Badge"),
            "expected a bare <Badge/> per iteration, got: {}",
            jsx
        );
        assert!(
            !jsx.contains(".map((q) => (<>"),
            "a single-element map body must never be Fragment-wrapped, got: {}",
            jsx
        );
    }
}
