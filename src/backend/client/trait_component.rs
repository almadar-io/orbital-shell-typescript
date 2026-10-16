use crate::backend::*;
use crate::codegen::expr::BindingFlavor;
use orbital_core::slots::SELF_OVERLAY_PATTERN_TYPES;

/// A render-ui effect extracted from a transition, preserving any `(if …)`
/// nesting the `.lolo` source used to pick between variants (e.g.
/// `config.boardLook`/`config.browseLook` switches). Flattening a
/// `Conditional` down to a single arbitrarily-chosen branch — or dropping it
/// because it isn't a bare top-level `render-ui` — silently swaps a
/// config-driven organism's real body for whatever unrelated transition
/// happens to also land in the same state (the shipped bug: std-board's
/// `viewing_board` fell back to `CANCEL_ADD`'s "Cancelling…" loading frame,
/// and every std-browse `browseLook` collapsed onto its `master-detail`
/// guard). `If` reconstructs the branch as a real runtime ternary instead.
#[derive(Clone, Debug)]
pub(crate) enum RenderUiNode<'a> {
    Leaf(&'a OirPattern),
    If {
        condition_ts: String,
        then_node: Option<Box<RenderUiNode<'a>>>,
        else_node: Option<Box<RenderUiNode<'a>>>,
    },
}

/// One transition's touch on one slot: which state(s) it fires from, the
/// triggering event, the (possibly config-conditional) render tree, and
/// whether this is an unconditional `(render-ui <slot> null)` clear. Single
/// source of truth shared by the View's slot-writer ternary (groups by
/// slot, ignores `from_states`) and every hook variant's per-`(fromState,
/// event)` slot write/clear lookup (groups by `from_states`) — §98's fix:
/// slot visibility is gated on WHICH TRANSITION last wrote the slot, never
/// on the trait's current state.
pub(crate) struct TransitionSlotRender<'a> {
    pub(crate) from_states: Vec<String>,
    pub(crate) event: String,
    pub(crate) to_state: String,
    pub(crate) slot: String,
    pub(crate) node: RenderUiNode<'a>,
    pub(crate) is_clear: bool,
    /// The transition's index in the trait: which arm wrote the slot.
    pub(crate) arm: usize,
}

impl TypeScriptBackend {
    /// Every render-ui touch across `trait_def`'s transitions, one entry per
    /// `(transition, slot)` pair. See [`TransitionSlotRender`].
    pub(crate) fn collect_transition_slot_renders<'a>(
        &self,
        trait_def: &'a OirTrait,
    ) -> Vec<TransitionSlotRender<'a>> {
        let mut out = Vec::new();
        for (arm, trans) in trait_def.transitions.iter().enumerate() {
            let from_states: Vec<String> = match &trans.from {
                OirTransitionFrom::Single(s) => vec![s.clone()],
                OirTransitionFrom::Multiple(states) => states.clone(),
                OirTransitionFrom::Any => trait_def.states.iter().map(|s| s.name.clone()).collect(),
            };
            for effect in &trans.effects {
                for (slot, node) in self.extract_render_ui_by_slot(effect) {
                    let is_clear =
                        matches!(&node, RenderUiNode::Leaf(p) if p.pattern_type == "clear");
                    out.push(TransitionSlotRender {
                        from_states: from_states.clone(),
                        event: trans.event.clone(),
                        to_state: trans.to.clone(),
                        slot,
                        node,
                        is_clear,
                        arm,
                    });
                }
            }
        }
        out
    }

    /// Events that write one slot from transitions entering different states (guarded arms
    /// such as std-record-detail's `RecordItemLoaded` → editing | viewing). The slot's
    /// writer for these is `event>state`, so the view shows the arm that fired.
    pub(crate) fn split_writer_events(
        &self,
        trait_def: &OirTrait,
    ) -> std::collections::BTreeSet<String> {
        let mut targets: std::collections::BTreeMap<
            (String, String),
            std::collections::BTreeSet<String>,
        > = std::collections::BTreeMap::new();
        for entry in self.collect_transition_slot_renders(trait_def) {
            if entry.is_clear {
                continue;
            }
            targets
                .entry((entry.event, entry.slot))
                .or_default()
                .insert(entry.to_state);
        }
        let arm_split = self.arm_split_events(trait_def);
        targets
            .into_iter()
            .filter(|(_, to)| to.len() > 1)
            .map(|((event, _), _)| event)
            .filter(|event| !arm_split.contains(event))
            .collect()
    }

    /// Events that write one slot from guarded arms sharing a target state (std-checkout's
    /// `CheckoutStepEntered` → wizard, one step per guard). The target state cannot tell those
    /// arms apart, so their writer is `event#arm`: the index of the arm that fired.
    pub(crate) fn arm_split_events(&self, trait_def: &OirTrait) -> std::collections::BTreeSet<String> {
        let mut renders: std::collections::BTreeMap<(String, String), Vec<String>> =
            std::collections::BTreeMap::new();
        for entry in self.collect_transition_slot_renders(trait_def) {
            if !entry.is_clear {
                renders.entry((entry.event, entry.slot)).or_default().push(entry.to_state);
            }
        }
        renders
            .into_iter()
            .filter(|(_, to)| {
                let distinct: std::collections::BTreeSet<&String> = to.iter().collect();
                distinct.len() < to.len()
            })
            .map(|((event, _), _)| event)
            .collect()
    }

    /// The `slotWriter` value a render written by `event` entering `to_state` is keyed by.
    pub(crate) fn slot_writer_key(
        split: &std::collections::BTreeSet<String>,
        event: &str,
        to_state: &str,
    ) -> String {
        if split.contains(event) {
            format!("{event}>{to_state}")
        } else {
            event.to_string()
        }
    }

    /// Module-level `{Name}RenderWriter(event, newState, arm)` for a trait with split writer
    /// events; `None` when every render is keyed by its event alone. `arm` is known only where
    /// the client resolves the transition; without it an arm-split event keeps its event key.
    pub(crate) fn render_writer_fn(&self, trait_def: &OirTrait) -> Option<String> {
        let split = self.split_writer_events(trait_def);
        let arm_split = self.arm_split_events(trait_def);
        if split.is_empty() && arm_split.is_empty() {
            return None;
        }
        let list = |set: &std::collections::BTreeSet<String>| {
            set.iter().map(|e| format!("'{e}'")).collect::<Vec<_>>().join(", ")
        };
        Some(format!(
            "function {name}RenderWriter(event: string, newState: string | undefined, arm?: number): string {{\n  if (arm !== undefined && [{arms}].includes(event)) return `${{event}}#${{arm}}`;\n  return [{events}].includes(event) ? `${{event}}>${{newState}}` : event;\n}}\n\n",
            name = trait_def.name,
            arms = list(&arm_split),
            events = list(&split)
        ))
    }

    /// `type {type_name} = 'a' | 'b';` (or `never` when the trait renders
    /// nothing) — the slot vocabulary `slotWriter` dictionaries key against.
    /// Derived from [`collect_transition_slot_renders`] so the hook's typed
    /// state and the View's ternary generation can never name a slot the
    /// other doesn't know about.
    pub(crate) fn slot_union_type_decl(&self, trait_def: &OirTrait, type_name: &str) -> String {
        let slots: std::collections::BTreeSet<String> = self
            .collect_transition_slot_renders(trait_def)
            .into_iter()
            .map(|e| e.slot)
            .collect();
        if slots.is_empty() {
            format!("type {} = never;\n", type_name)
        } else {
            let variants: Vec<String> = slots.iter().map(|s| format!("'{}'", s)).collect();
            format!("type {} = {};\n", type_name, variants.join(" | "))
        }
    }

    /// Recursively pulls every `render-ui` out of one transition effect,
    /// grouped by slot, walking into `OirExpr::Conditional` branches the
    /// prior top-level-only scan skipped entirely. The condition is compiled
    /// with the RENDER binding flavor (not Guard, which maps `@config` to
    /// `undefined`) so `@config.boardLook` becomes the real `config?.boardLook`
    /// prop read available in the generated View component's scope.
    pub(crate) fn extract_render_ui_by_slot<'a>(
        &self,
        expr: &'a OirExpr,
    ) -> Vec<(String, RenderUiNode<'a>)> {
        match expr {
            OirExpr::Effect { effect } => {
                if let OirEffect::RenderUi { slot, pattern } = effect.as_ref() {
                    vec![(slot.clone(), RenderUiNode::Leaf(pattern))]
                } else {
                    Vec::new()
                }
            }
            OirExpr::Conditional {
                condition,
                then_branch,
                else_branch,
            } => {
                let then_by_slot: HashMap<String, RenderUiNode<'a>> = self
                    .extract_render_ui_by_slot(then_branch)
                    .into_iter()
                    .collect();
                let else_by_slot: HashMap<String, RenderUiNode<'a>> = self
                    .extract_render_ui_by_slot(else_branch)
                    .into_iter()
                    .collect();
                if then_by_slot.is_empty() && else_by_slot.is_empty() {
                    return Vec::new();
                }
                let condition_ts = self.expr_to_ts_flavored(condition, BindingFlavor::Render);
                let mut slots: std::collections::BTreeSet<String> =
                    std::collections::BTreeSet::new();
                slots.extend(then_by_slot.keys().cloned());
                slots.extend(else_by_slot.keys().cloned());
                slots
                    .into_iter()
                    .map(|slot| {
                        let then_node = then_by_slot.get(&slot).cloned().map(Box::new);
                        let else_node = else_by_slot.get(&slot).cloned().map(Box::new);
                        (
                            slot,
                            RenderUiNode::If {
                                condition_ts: condition_ts.clone(),
                                then_node,
                                else_node,
                            },
                        )
                    })
                    .collect()
            }
            _ => Vec::new(),
        }
    }

    /// Whether any transition writes content into the `toast` slot.
    pub(crate) fn writes_toast_slot(&self, trait_def: &OirTrait) -> bool {
        self.collect_transition_slot_renders(trait_def)
            .iter()
            .any(|e| !e.is_clear && e.slot == "toast")
    }

    /// A toast-slot write, rendered as the runtime's `SlotToasts` renders it: a `Toast`
    /// (the `notification` pattern) from the content's `variant`, `title` and `message`, whose
    /// dismiss and timeout clear the slot.
    fn render_toast_node_to_jsx(
        &self,
        node: &RenderUiNode<'_>,
        entity: Option<&str>,
        entity_fields_ref: Option<&HashMap<String, EntityFieldInfo>>,
    ) -> String {
        match node {
            RenderUiNode::Leaf(pattern) => {
                let mut toast = OirPattern::new("notification");
                for key in ["variant", "title", "message"] {
                    if let Some(value) = pattern.config.get(key) {
                        toast.config.insert(key.to_string(), value.clone());
                    }
                }
                self.pending_root_props
                    .set(Some(vec!["onDismiss={() => clearSlot('toast')}".to_string()]));
                self.pattern_to_jsx_with_data(&toast, entity, entity_fields_ref)
            }
            RenderUiNode::If { condition_ts, then_node, else_node } => {
                let then_jsx = then_node
                    .as_deref()
                    .map(|n| self.render_toast_node_to_jsx(n, entity, entity_fields_ref))
                    .unwrap_or_else(|| "null".to_string());
                let else_jsx = else_node
                    .as_deref()
                    .map(|n| self.render_toast_node_to_jsx(n, entity, entity_fields_ref))
                    .unwrap_or_else(|| "null".to_string());
                format!("({}) ? ({}) : ({})", condition_ts, then_jsx, else_jsx)
            }
        }
    }

    /// Renders a `RenderUiNode` to the same bare JSX/expression text
    /// `pattern_to_jsx_with_data` used to return directly — callers still own
    /// null-wrapping and slot-wrapper placement.
    ///
    /// `presence`: the node renders inside a modal slot's render-function
    /// children, so a self-overlaying leaf (Modal / ConfirmDialog) takes the
    /// slot presence as `isOpen` / `onExited` and plays its own exit.
    fn render_ui_node_to_jsx(
        &self,
        node: &RenderUiNode<'_>,
        entity: Option<&str>,
        entity_fields_ref: Option<&HashMap<String, EntityFieldInfo>>,
        presence: bool,
    ) -> String {
        match node {
            RenderUiNode::Leaf(pattern) => {
                if presence && SELF_OVERLAY_PATTERN_TYPES.contains(&pattern.pattern_type.as_str()) {
                    self.pending_root_props.set(Some(vec![
                        "isOpen={__presence.open}".to_string(),
                        "onExited={__presence.onExited}".to_string(),
                    ]));
                }
                self.pattern_to_jsx_with_data(pattern, entity, entity_fields_ref)
            }
            RenderUiNode::If {
                condition_ts,
                then_node,
                else_node,
            } => {
                let then_jsx = then_node
                    .as_deref()
                    .map(|n| self.render_ui_node_to_jsx(n, entity, entity_fields_ref, presence))
                    .unwrap_or_else(|| "null".to_string());
                let else_jsx = else_node
                    .as_deref()
                    .map(|n| self.render_ui_node_to_jsx(n, entity, entity_fields_ref, presence))
                    .unwrap_or_else(|| "null".to_string());
                format!("({}) ? ({}) : ({})", condition_ts, then_jsx, else_jsx)
            }
        }
    }

    /// The `pattern_type` for one render-ui leaf/branch, used both for the
    /// `<UISlotComponent>` wrapper's `data-pattern` attribute AND (as of the
    /// `wrapper_pattern_expr` ternary built alongside `inner_jsx` at the call
    /// site) to decide whether `@almadar/ui`'s `UISlotComponentInner` treats
    /// this branch as "clear" (render nothing). NOT introspection-only —
    /// `pattern === "clear"` short-circuits before `children` is read, so
    /// this must be computed per-branch, never as one static representative
    /// value for a multi-arm slot.
    /// Whether any branch leaf of this node is a self-overlaying pattern.
    fn render_ui_node_has_self_overlay(node: &RenderUiNode<'_>) -> bool {
        match node {
            RenderUiNode::Leaf(pattern) => {
                SELF_OVERLAY_PATTERN_TYPES.contains(&pattern.pattern_type.as_str())
            }
            RenderUiNode::If {
                then_node,
                else_node,
                ..
            } => {
                then_node
                    .as_deref()
                    .is_some_and(Self::render_ui_node_has_self_overlay)
                    || else_node
                        .as_deref()
                        .is_some_and(Self::render_ui_node_has_self_overlay)
            }
        }
    }

    /// The awaiting-server skeleton for `slot`: a ternary over the hook's
    /// `pendingEvent` / `pendingFrom` selecting the predicted skeleton of the
    /// transition whose server round trip is in flight (compiler-computed
    /// `await_render`, this trait's own entries), else `undefined`. `None` when
    /// no transition of this trait predicts a render into `slot`.
    fn awaiting_skeleton_expr(trait_def: &OirTrait, slot: &str) -> Option<String> {
        let mut arms: Vec<String> = Vec::new();
        for transition in &trait_def.transitions {
            for render in transition
                .await_render
                .iter()
                .filter(|r| r.trait_name == trait_def.name && r.slot == slot)
            {
                let Ok(node) = serde_json::to_string(&render.skeleton) else {
                    continue;
                };
                let from_cond = match &transition.from {
                    OirTransitionFrom::Single(s) => format!("pendingFrom === {:?}", s),
                    OirTransitionFrom::Multiple(states) => format!(
                        "[{}].includes(pendingFrom ?? '')",
                        states
                            .iter()
                            .map(|s| format!("{:?}", s))
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                    OirTransitionFrom::Any => "true".to_string(),
                };
                arms.push(format!(
                    "pendingEvent === {:?} && {} ? {} : ",
                    transition.event, from_cond, node
                ));
            }
        }
        if arms.is_empty() {
            return None;
        }
        Some(format!("({}undefined)", arms.join("")))
    }

    /// A leaf's declared `enter` (the root element's own entry), as a JS
    /// string literal. Selected per branch alongside `wrapper_pattern_expr`
    /// so `<UISlotComponent enter>` skips the theme-default slot entry exactly
    /// when the shown root animates itself (or opts out with `none`).
    fn render_ui_node_enter(&self, node: &RenderUiNode<'_>) -> Option<String> {
        match node {
            RenderUiNode::Leaf(pattern) => match pattern.config.get("enter") {
                Some(OirValue::String(v)) if v.starts_with('@') => {
                    let knob = self.binding_string_to_ts(v);
                    Some(format!(
                        "asEnterAnimation(typeof {knob} === 'string' ? {knob} : undefined)"
                    ))
                }
                Some(OirValue::String(v)) => Some(format!("{:?}", v)),
                _ => None,
            },
            RenderUiNode::If { .. } => None,
        }
    }

    fn render_ui_node_pattern_type(node: &RenderUiNode<'_>) -> String {
        match node {
            RenderUiNode::Leaf(pattern) => pattern.pattern_type.clone(),
            RenderUiNode::If {
                then_node,
                else_node,
                ..
            } => then_node
                .as_deref()
                .map(Self::render_ui_node_pattern_type)
                .or_else(|| else_node.as_deref().map(Self::render_ui_node_pattern_type))
                .unwrap_or_else(|| "unknown".to_string()),
        }
    }

    /// Generate packages/client/src/components/traits/{TraitName}View.tsx
    ///
    /// Presentation component that calls the logic hook and renders
    /// state-based JSX directly — no slot map needed.
    ///
    /// `embedded_traits`: flat set of trait names referenced via
    /// `@trait.X` by some sibling layout in the same orbital. When
    /// `trait_def.name` is in this set, the standalone
    /// `<UISlotComponent slot="..." sourceTrait="..." pattern="...">`
    /// wraps are suppressed — iframe semantics: the layout's emitted
    /// JSX already includes `<{Name}View />` at the embedded position,
    /// so wrapping the trait's render-ui in a standalone slot source
    /// would duplicate the view. Cross-slot writes (e.g. modal) are
    /// ALSO suppressed for embedded traits; the user opts into iframe
    /// composition by writing `@trait.X`, and that composition owns
    /// the trait's full render output.
    pub(crate) fn generate_trait_component(
        &self,
        trait_def: &OirTrait,
        module: &OirModule,
        embedded_traits: &HashSet<String>,
    ) -> InternalFile {
        let name = &trait_def.name;
        let is_embedded = embedded_traits.contains(name);
        let component_name = format!("{}View", name);
        let hook_name = format!("use{}Logic", name);
        self.view_value_imports.set(Default::default());

        // Gap #13: pin the qualified `Orbital.Trait` scope so render-ui
        // pattern codegen (`action_to_jsx_obj`, event-prop emission) can
        // pre-qualify event strings. Uses `trait_def.orbital_name` (set
        // by `resolve_trait` per gap #13) — NOT `module.name`, which is
        // the App scope and would mis-disambiguate when multiple orbitals
        // share trait names. Cleared after this view's pattern emission.
        self.current_trait_scope
            .set(Some(format!("{}.{}", trait_def.orbital_name, name)));
        self.current_event_scope_chain
            .set(Self::build_event_scope_chain(trait_def, module));

        // Phase E: pin the trait's linked entity so any compile_sexpr*
        // call originating from this trait's render-ui / guards /
        // effects can resolve `@entity` source types for typed lambda
        // emits. Cleared via the same caller pattern as
        // `current_trait_scope`.
        self.current_linked_entity
            .set(trait_def.linked_entity.clone());
        self.current_linked_entity_id
            .set(trait_def.linked_entity_id.clone());
        self.current_entity_ref_ids
            .set(trait_def.entity_ref_ids.clone());
        self.current_trait_embed_names
            .set(Self::build_trait_embed_names(trait_def, module));

        // Collect component imports from render_ui effects
        let component_imports = self.collect_component_imports(trait_def);

        let mut code = String::new();

        // Header
        code.push_str(&format!("/**\n * {}\n *\n", component_name));
        if let Some(desc) = &trait_def.description {
            code.push_str(&format!(" * {}\n *\n", desc));
        }
        code.push_str(" * Functional component — logic + state-based JSX rendering.\n");
        code.push_str(" *\n");
        code.push_str(" * @generated from schema\n");
        code.push_str(&format!(" * @trait {}\n */\n\n", name));

        // Imports (react-jsx transform handles JSX — no React import needed)
        code.push_str(&format!(
            "import {{ {} }} from '@/hooks/traits/{}';
",
            hook_name, hook_name
        ));
        code.push_str(&format!(
            "import type {{ {}Config }} from '@/hooks/traits/{}';\n",
            name, hook_name
        ));
        // Import EntityRow (used as fallback cast target when a @payload binding
        // is emitted on a trait with no linked_entity — see generate_pattern_from_registry).
        // FieldValue imported alongside because `[object]` runtime entity fields lower
        // to `Record<string, FieldValue | undefined>` in pattern bindings; type-only
        // import has no runtime cost when unused.
        // EntityWith is used by render-ui entity-prop casts (`as EntityWith<'f'>`)
        // emitted by `emit_entity_data_prop`; import it alongside EntityRow.
        // EventPayloadValue is the cast target of the `array/first`/`array/last`
        // emissions (operator.rs) when the source is a wide payload union.
        // EventPayload is the per-hop widening cast for deep `@payload.X.Y`
        // chains (expr.rs render-context resolution).
        code.push_str(&crate::codegen::handler_header::core_imports_clause(
            &[
                "EntityRow",
                "EntityWith",
                "EventPayload",
                "FieldValue",
                "EventPayloadValue",
            ]
            .into_iter()
            .collect(),
        ));
        // `getNestedValue` backs `object/get` / `str/template`'s dot-path
        // codegen (`codegen/operator.rs`) — reachable here whenever a
        // render-ui prop reads a nested field off a mapped row. Inlined
        // (not imported) per `GET_NESTED_VALUE_DECL`'s doc.
        code.push_str(crate::codegen::handler_header::GET_NESTED_VALUE_DECL);
        // Import all entity types referenced in render-ui effects (plus the linked entity)
        {
            let mut entity_types_hs = self.collect_referenced_entity_types(trait_def, module);
            if let Some(linked_entity) = &trait_def.linked_entity {
                entity_types_hs.insert(linked_entity.clone());
            }
            // Convert to BTreeSet for deterministic ordering and to feed the
            // aliased-import helper.
            let entity_types: std::collections::BTreeSet<String> =
                entity_types_hs.into_iter().collect();
            if !entity_types.is_empty() {
                code.push_str(&format!(
                    "import type {{ {} }} from '@app/shared';\n",
                    crate::codegen::handler_header::aliased_shared_imports_clause(&entity_types)
                ));
            }
        }

        // Component imports based on patterns used
        for (component, path) in &component_imports {
            code.push_str(&format!("import {{ {} }} from '{}';\n", component, path));
        }
        // UISlotComponent for slot wrapper (data-pattern, data-source-trait attributes)
        code.push_str("import { UISlotComponent } from '@almadar/ui/components';\n");
        code.push_str("import { TraitScopeProvider } from '@almadar/ui/providers';\n");
        // `@user.<field>` bindings in render-ui trees emit as bare `user?.X`
        // reads — bring `user` into scope exactly when the JSX will read it
        // (mirrors trait_logic's uses_user import).
        let uses_user = self.trait_render_ui_uses_user(trait_def);
        if uses_user {
            code.push_str("import { useUser } from '@almadar/ui/context';\n");
        }
        let uses_messages = self.trait_render_ui_uses_messages(trait_def);
        if uses_messages {
            code.push_str("import { useTranslate } from '@almadar/ui/hooks';\n");
        }

        // V2: EntityStore is deleted. Entities come from the reducer's
        // `data[]` state (populated by the bridge from server responses).
        // No more useEntityRef / useEntityById imports.
        code.push('\n');

        // Props interface. ALWAYS `Partial`: every caller passes a subset —
        // pages embed detail traits with just `{ entityId }` (TS2740 when the
        // prop demanded the full Config, C-COMPILED-PATH-RED §25), capturing
        // parents pass only the captured knobs. The hook merges the partial
        // over `DEFAULT_<NAME>_CONFIG` (and required ⟺ has-default, so a
        // defaultless trait's Config is all-optional), keeping `mergedConfig`
        // a complete `Config` either way.
        code.push_str(&format!("interface {}Props {{\n", component_name));
        code.push_str(&format!("  config?: Partial<{}Config>;\n", name));
        code.push_str("}\n\n");

        // Component. The caller-passed `config` prop is renamed to
        // `propsConfig` so the local `config` binding can come from the
        // hook's return — that one is `mergedConfig` (declared defaults +
        // overrides), which is what `@config.X` bindings need to resolve
        // against. Without this rename the View would read undefined when
        // mounted with no prop (e.g. orbital-verify standalone) and the
        // declared defaults would never reach the DOM.
        code.push_str(&format!(
            "export function {}({{ config: propsConfig }}: {}Props) {{\n",
            component_name, component_name
        ));

        // Call logic hook (returns mergedConfig as `config`).
        // `fields` is the per-trait reducer mirror that captures `set
        // @entity.X` effects — render-ui's `@entity.field` bindings now
        // resolve to `fields?.field` instead of `entity?.[0]?.field`,
        // because the prior heuristic always picked the first row of
        // the linked collection regardless of which row the trait was
        // operating on (silent wrong-name display on confirmation
        // dialogs, etc.).
        if uses_user {
            code.push_str("  const { user } = useUser();\n");
        }
        if uses_messages {
            code.push_str("  const { t: __t, locale: __locale } = useTranslate();\n");
        }
        let now_binding = if crate::codegen::effect::shared::trait_reads_now(trait_def) {
            "now, "
        } else {
            ""
        };
        code.push_str(&format!(
            "  const {{ state, data, lastPayload, lastEvent, slotWriter, loading, pendingEvent, pendingFrom, error, fields, dispatch, actions, {now_binding}{clear_binding}config }} = {}(propsConfig);\n\n",
            hook_name,
            clear_binding = if self.writes_toast_slot(trait_def) { "clearSlot, " } else { "" }
        ));

        // Add entity variable from linked entity.
        // V2: always read from the reducer's `data[]` state — the bridge
        // fills it from the server's EventResponse.data field.
        if let Some(entity_name) = &trait_def.linked_entity {
            code.push_str("  // Entity collection from server response data\n");
            // Type as `EntityRow[]` (the runtime invariant) — narrowing to
            // the specific entity (`as Account[]`) trips TS2352 because
            // EntityRow's `Record<string, FieldValue | undefined>` index
            // signature is too wide for TS to accept a narrowing cast.
            // Field-level narrowing for downstream `@entity.X` bindings
            // happens at the render-ui binding emit (and through the
            // typed `fields` mirror passed to the view).
            code.push_str(&format!(
                "  const entity: EntityRow[] = data['{}'] ?? [];\n",
                entity_name,
            ));
            // `_entityName` kept for any debug/log site that wants the
            // declared entity name without re-deriving from `data`'s key.
            let _ = crate::codegen::handler_header::entity_type_ref(entity_name);
            code.push_str("  // Payload from last event (for @payload bindings in render-ui)\n");
            code.push_str("  const payload = lastPayload;\n\n");
        }

        // Build entity field info map for JSX binding validation, null-coalescing,
        // and form field type injection. Maps field name → EntityFieldInfo.
        let entity_field_types: HashMap<String, EntityFieldInfo> =
            if let Some(entity_name) = &trait_def.linked_entity {
                module
                    .resolve_entity_ref(trait_def.linked_entity_id.as_deref(), entity_name)
                    .map(|e| {
                        e.fields
                            .iter()
                            .map(|f| {
                                let is_numeric =
                                    matches!(f.field_type, OirType::Number | OirType::Integer);
                                let form_type = oir_type_to_form_type(&f.field_type).to_string();
                                let enum_values = f.enum_values.clone();
                                let relation_entity = Self::field_relation_entity(f);
                                let relation_cardinality = f.relation.as_ref().map(|r| {
                                    oir_cardinality_to_relation_str(r.cardinality).to_string()
                                });
                                let element_ts_type = match &f.field_type {
                                    OirType::Array { inner } => Some(self.map_type(inner)),
                                    _ => None,
                                };
                                (
                                    f.name.clone(),
                                    EntityFieldInfo {
                                        form_type,
                                        is_numeric,
                                        enum_values,
                                        relation_entity,
                                        relation_cardinality,
                                        required: f.required,
                                        description: f.description.clone(),
                                        element_ts_type,
                                    },
                                )
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            } else {
                HashMap::new()
            };
        let entity_fields_ref = if entity_field_types.is_empty() {
            None
        } else {
            Some(&entity_field_types)
        };

        // §98 fix: gate each slot's render on WHICH TRANSITION last wrote
        // that slot (`slotWriter['<slot>']`, a per-slot mirror of the
        // interpreter's `SlotManager` — a render-ui is a persistent write to
        // a slot, live until another transition writes or clears it; a
        // STATE change by itself changes nothing). Group ALL render-ui
        // touches by slot ONLY (never by target state) — a slot's content is
        // independent of which state the trait currently sits in.
        //
        // Selection is first-wins by transition iteration order (matches the
        // order transitions appear in the .lolo source): if the same event
        // key writes the same slot from two different transitions, the
        // first-declared one wins (pre-existing dedup discipline, now
        // trait-wide instead of per-state).
        let split_writers = self.split_writer_events(trait_def);
        let arm_split = self.arm_split_events(trait_def);
        let mut slot_write_entries: std::collections::BTreeMap<
            String,
            Vec<(String, String, RenderUiNode<'_>)>,
        > = std::collections::BTreeMap::new();
        for entry in self.collect_transition_slot_renders(trait_def) {
            if entry.is_clear {
                // An unconditional `(render-ui <slot> null)` needs no ternary
                // branch — the default (no writer matches) already renders
                // `null`. Its ONLY job is at the reducer/hook layer: reset
                // `slotWriter[slot]` to `null` so a previously-open slot
                // actually closes (handled by `getRenderUiSlots`/the reducer,
                // not here).
                continue;
            }
            if arm_split.contains(&entry.event) {
                let slot_entries = slot_write_entries.entry(entry.slot.clone()).or_default();
                slot_entries.push((format!("{}#{}", entry.event, entry.arm), entry.event.clone(), entry.node.clone()));
                // Where the transition is resolved off the client, no arm comes back: the event key keeps the first arm.
                slot_entries.push((entry.event.clone(), entry.event, entry.node));
                continue;
            }
            let writer = Self::slot_writer_key(&split_writers, &entry.event, &entry.to_state);
            slot_write_entries.entry(entry.slot).or_default().push((
                writer,
                entry.event,
                entry.node,
            ));
        }

        if slot_write_entries.is_empty() {
            // No render_ui effects at all — render a simple placeholder
            code.push_str("  return null;\n");
        } else {
            // Phase E: pin the triggering event's payload schema before each
            // pattern compile so `@payload.<F>` source inference in render
            // bindings resolves to real types (the server handlers pin the
            // same way per event — without this, `array/map ?data` sources
            // fall back to the wide `readonly EntityRow[]` and lambda field
            // reads type as FieldValue).
            let pin_event_schema = |event: &str| {
                self.current_payload_schema.set(
                    trait_def
                        .events
                        .iter()
                        .find(|e| e.key == event)
                        .and_then(|e| e.payload_schema.clone()),
                );
            };

            let mut parts: Vec<String> = Vec::new();
            for (slot_name, entries) in &slot_write_entries {
                // Dedup by writer key (first occurrence wins); an event whose arms enter
                // different states is keyed per state (`split_writer_events`).
                let mut seen_events: std::collections::HashSet<String> =
                    std::collections::HashSet::new();
                let mut unique_entries: Vec<&(String, String, RenderUiNode<'_>)> = Vec::new();
                for entry in entries {
                    if seen_events.insert(entry.0.clone()) {
                        unique_entries.push(entry);
                    }
                }

                // A modal slot holding self-overlaying content hands it the slot
                // presence through render-function children, so the Modal /
                // ConfirmDialog plays its own exit when the slot clears.
                let presence = slot_name == "modal"
                    && unique_entries
                        .iter()
                        .any(|(_, _, node)| Self::render_ui_node_has_self_overlay(node));

                // Build the slotWriter-keyed selector. Default is a bare
                // `null` — no writer for this slot yet (or it was cleared) —
                // never a guessed "first entry" fallback: the interpreter's
                // slot starts empty and stays empty until something writes
                // it, so the compiled view must too.
                let (inner_jsx, wrapper_pattern_expr, wrapper_enter_expr) =
                    if unique_entries.len() == 1 {
                        let (event, trigger, node) = unique_entries[0];
                        pin_event_schema(trigger);
                        let branch_jsx = if slot_name == "toast" {
                            self.render_toast_node_to_jsx(node, trait_def.linked_entity.as_deref(), entity_fields_ref)
                        } else {
                            self.render_ui_node_to_jsx(
                                node,
                                trait_def.linked_entity.as_deref(),
                                entity_fields_ref,
                                presence,
                            )
                        };
                        let branch_pattern = Self::render_ui_node_pattern_type(node);
                        let branch_enter = self.render_ui_node_enter(node).map(|e| {
                            format!(
                                "slotWriter['{}'] === '{}' ? {} : undefined",
                                slot_name, event, e
                            )
                        });
                        (
                            format!(
                                "{{slotWriter['{}'] === '{}' ? ({}) : null}}",
                                slot_name, event, branch_jsx
                            ),
                            format!(
                                "slotWriter['{}'] === '{}' ? \"{}\" : \"clear\"",
                                slot_name, event, branch_pattern
                            ),
                            branch_enter,
                        )
                    } else {
                        // Ternary chain in JSX expression braces, keyed on
                        // `slotWriter['<slot>']` instead of `lastEvent`. Example:
                        //   {slotWriter['toast'] === 'A' ? (<X/>) :
                        //    slotWriter['toast'] === 'B' ? (<Y/>) :
                        //    null}
                        let mut selector = String::from("{");
                        // Mirrors `selector`'s branches exactly (same events,
                        // same order) so the two ternaries pick the same arm for
                        // any given writer.
                        let mut pattern_expr = String::new();
                        let mut enter_expr = String::new();
                        let mut any_enter = false;
                        for (event_name, trigger, node) in &unique_entries {
                            pin_event_schema(trigger);
                            let branch_jsx = if slot_name == "toast" {
                                self.render_toast_node_to_jsx(node, trait_def.linked_entity.as_deref(), entity_fields_ref)
                            } else {
                                self.render_ui_node_to_jsx(
                                    node,
                                    trait_def.linked_entity.as_deref(),
                                    entity_fields_ref,
                                    presence,
                                )
                            };
                            selector.push_str(&format!(
                                "slotWriter['{}'] === '{}' ? ({}) : ",
                                slot_name, event_name, branch_jsx
                            ));
                            let branch_pattern = Self::render_ui_node_pattern_type(node);
                            pattern_expr.push_str(&format!(
                                "slotWriter['{}'] === '{}' ? \"{}\" : ",
                                slot_name, event_name, branch_pattern
                            ));
                            if let Some(e) = self.render_ui_node_enter(node) {
                                any_enter = true;
                                enter_expr.push_str(&format!(
                                    "slotWriter['{}'] === '{}' ? {} : ",
                                    slot_name, event_name, e
                                ));
                            }
                        }
                        selector.push_str("null}");
                        pattern_expr.push_str("\"clear\"");
                        enter_expr.push_str("undefined");
                        (selector, pattern_expr, any_enter.then_some(enter_expr))
                    };
                // `{expr}` → `{(__presence) => (expr)}`: the closure keeps the
                // branch it last rendered, so a cleared slot re-renders it closed.
                let inner_jsx = if presence {
                    let expr = &inner_jsx[1..inner_jsx.len() - 1];
                    format!("{{(__presence) => ({})}}", expr)
                } else {
                    inner_jsx
                };

                // Portal slots (modal/drawer/toast/overlay) always need the
                // `<UISlotComponent>` wrapper — @almadar/ui's CompiledPortal
                // renders them to `document.body` regardless of where in the
                // React tree they're declared, so an embedded trait's toast/
                // modal is host chrome, never something the embedding parent
                // owns. Only non-portal slots (main/sidebar) get the bare
                // iframe treatment (found live: an embedded trait's toast
                // alert painting inline inside the composer/thread box
                // instead of the top-right portal, because the wrapper that
                // triggers CompiledPortal was skipped entirely).
                let is_portal_slot =
                    matches!(slot_name.as_str(), "modal" | "drawer" | "toast" | "overlay");
                let awaiting_expr = Self::awaiting_skeleton_expr(trait_def, slot_name);
                if is_embedded && !is_portal_slot {
                    // Iframe semantics: trait is referenced via `@trait.X` by
                    // a sibling layout. The layout's JSX already includes
                    // `<{Name}View />` at the embedded position, so emit just
                    // the inner JSX with no standalone slot wrap — wrapping
                    // here would register a duplicate slot source. While its own
                    // server round trip is in flight and nothing is written yet,
                    // the predicted skeleton stands in.
                    if let Some(aw) = &awaiting_expr {
                        parts.push(format!(
                            "{{(() => {{ const __awaiting: SkeletonNode | undefined = {aw}; return slotWriter['{slot_name}'] == null && __awaiting ? <SkeletonTree node={{__awaiting}} /> : null; }})()}}"
                        ));
                    }
                    parts.push(inner_jsx);
                } else {
                    // `pattern` must track whichever branch `slotWriter`
                    // actually selects for `children` above — @almadar/ui's
                    // UISlotComponentInner treats `pattern === "clear"` as an
                    // unconditional "render nothing", checked BEFORE
                    // `children` is even looked at.
                    let enter_attr = wrapper_enter_expr
                        .map(|e| format!(" enter={{{}}}", e))
                        .unwrap_or_default();
                    let awaiting_attr = awaiting_expr
                        .map(|e| format!(" awaitingSkeleton={{{}}}", e))
                        .unwrap_or_default();
                    parts.push(format!(
                        "<UISlotComponent slot=\"{}\" pattern={{{}}} sourceTrait=\"{}\"{}{}>{}</UISlotComponent>",
                        slot_name, wrapper_pattern_expr, name, enter_attr, awaiting_attr, inner_jsx
                    ));
                }
            }

            // Every slot is independently gated by its own writer — no
            // state condition wraps any of it, and portal slots (modal/
            // drawer/toast) coexist with base slots (main/sidebar)
            // unconditionally, matching the interpreter: a state change by
            // itself changes nothing, only a write/clear does.
            let body = if parts.len() == 1 {
                parts.remove(0)
            } else {
                format!("<>{}</>", parts.join(""))
            };
            code.push_str(&format!(
                "  return (\n    <TraitScopeProvider orbital=\"{}\" trait=\"{}\">\n      {}\n    </TraitScopeProvider>\n  );\n",
                trait_def.orbital_name, name, body
            ));
        }

        // Clear the per-event pin so the last compiled pattern's schema
        // can't leak into the next trait's view generation.
        self.current_payload_schema.set(None);

        code.push_str("}\n\n");
        code.push_str(&format!("export default {};\n", component_name));

        // Post-hoc header injection: these needs are only knowable after the
        // JSX is generated (pattern emission decides per prop), so patch the
        // always-present import line / Props anchor once the body exists.
        // `renderPatternValue` is the PatternValue→ReactNode boundary for
        // node-typed knob forwards; `__toEntityRow` narrows `@payload.<key>`
        // bindings into row-typed props (C-COMPILED-PATH-RED §25).
        if code.contains("<SkeletonTree ") {
            code = code.replacen(
                "import { UISlotComponent } from '@almadar/ui/components';\n",
                "import { UISlotComponent } from '@almadar/ui/components';\nimport { SkeletonTree } from '@almadar/ui/components';\n",
                1,
            );
        }
        if code.contains("const __awaiting: SkeletonNode") {
            code = code.replacen(
                "import { UISlotComponent } from '@almadar/ui/components';\n",
                "import { UISlotComponent } from '@almadar/ui/components';\nimport type { SkeletonNode } from '@almadar/core';\n",
                1,
            );
        }
        let entry_helpers: Vec<&str> = ["asEnterAnimation", "enterClassName"]
            .into_iter()
            .filter(|helper| code.contains(&format!("{helper}(")))
            .collect();
        if !entry_helpers.is_empty() {
            code = code.replacen(
                "import { UISlotComponent } from '@almadar/ui/components';\n",
                &format!(
                    "import {{ UISlotComponent }} from '@almadar/ui/components';\nimport {{ {} }} from '@almadar/ui/lib';\n",
                    entry_helpers.join(", ")
                ),
                1,
            );
        }
        if code.contains("renderPatternValue(") {
            code = code.replacen(
                "import { UISlotComponent } from '@almadar/ui/components';\n",
                "import { UISlotComponent, renderPatternValue } from '@almadar/ui/components';\n",
                1,
            );
        }
        let value_imports = self.view_value_imports.take();
        if !value_imports.is_empty() {
            let mut by_module: std::collections::BTreeMap<String, Vec<String>> =
                std::collections::BTreeMap::new();
            for (module, name) in value_imports {
                by_module.entry(module).or_default().push(name);
            }
            let lines: String = by_module
                .into_iter()
                .map(|(module, names)| {
                    format!("import {{ {} }} from '{}';\n", names.join(", "), module)
                })
                .collect();
            let anchor = "import { UISlotComponent";
            if let Some(at) = code.find(anchor) {
                code.insert_str(at, &lines);
            }
        }
        if code.contains("__toEntityRow(") {
            let props_anchor = format!("interface {}Props {{", component_name);
            code = code.replacen(
                &props_anchor,
                &format!(
                    "{}\n{}",
                    crate::codegen::handler_header::TO_ENTITY_ROW_DECL,
                    props_anchor
                ),
                1,
            );
        }
        // Capture-config casts (`content: (lastPayload?.error) as PatternValue`)
        // reference the PatternValue type in Views, where only the Logic hooks
        // inlined PATTERN_VALUE_DECL — inline it here too when referenced.
        // (`as PatternValue`, not bare `PatternValue` — `renderPatternValue(`
        // must not trigger the type decl.)
        if code.contains("as PatternValue") {
            let props_anchor = format!("interface {}Props {{", component_name);
            code = code.replacen(
                &props_anchor,
                &format!(
                    "{}\n{}",
                    crate::codegen::handler_header::PATTERN_VALUE_DECL,
                    props_anchor
                ),
                1,
            );
        }

        // Gap #13: clear the trait scope set at the top of this method.
        self.current_trait_scope.set(None);

        InternalFile::new(
            format!("packages/client/src/components/traits/{}View.tsx", name),
            code,
            GeneratedFileType::Page,
        )
    }
}

#[cfg(test)]
mod conditional_render_ui_tests {
    use super::*;
    use orbital_core::ir::{OirBinaryOp, OirBinding};

    fn config_render_ui_conditional(then_pattern: &str, else_pattern: &str) -> OirExpr {
        OirExpr::Conditional {
            condition: Box::new(OirExpr::BinaryOp {
                op: OirBinaryOp::Eq,
                left: Box::new(OirExpr::Binding {
                    binding: OirBinding::new(OirBindingRoot::Config, vec!["boardLook".to_string()]),
                }),
                right: Box::new(OirExpr::String {
                    value: "kanban-classic".to_string(),
                }),
            }),
            then_branch: Box::new(OirExpr::Effect {
                effect: Box::new(OirEffect::RenderUi {
                    slot: "main".to_string(),
                    pattern: OirPattern::new(then_pattern),
                }),
            }),
            else_branch: Box::new(OirExpr::Effect {
                effect: Box::new(OirEffect::RenderUi {
                    slot: "main".to_string(),
                    pattern: OirPattern::new(else_pattern),
                }),
            }),
        }
    }

    /// The bug: a top-level-only scan (`if let OirExpr::Effect = effect`)
    /// never matches `OirExpr::Conditional`, so a `(if @config.X (render-ui A)
    /// (render-ui B))` effect — std-board's boardLook switch, std-browse's
    /// browseLook switch — was invisible to codegen entirely. This proves
    /// the recursive collector finds it and keeps both branches.
    #[test]
    fn conditional_render_ui_is_not_dropped_by_a_top_level_only_scan() {
        let backend = TypeScriptBackend::new();
        let effect = config_render_ui_conditional("branch-kanban", "branch-default");

        let by_slot = backend.extract_render_ui_by_slot(&effect);
        assert_eq!(
            by_slot.len(),
            1,
            "the conditional's single slot must survive extraction"
        );
        let (slot, node) = &by_slot[0];
        assert_eq!(slot, "main");

        match node {
            RenderUiNode::If {
                condition_ts,
                then_node,
                else_node,
            } => {
                assert!(
                    condition_ts.contains("config?.boardLook") && condition_ts.contains("kanban-classic"),
                    "condition must resolve @config.boardLook to the real runtime config prop, got: {condition_ts}"
                );
                match then_node.as_deref() {
                    Some(RenderUiNode::Leaf(pattern)) => {
                        assert_eq!(pattern.pattern_type, "branch-kanban")
                    }
                    other => panic!("expected the then-branch render-ui to survive, got {other:?}"),
                }
                match else_node.as_deref() {
                    Some(RenderUiNode::Leaf(pattern)) => {
                        assert_eq!(pattern.pattern_type, "branch-default")
                    }
                    other => panic!("expected the else-branch render-ui to survive, got {other:?}"),
                }
            }
            RenderUiNode::Leaf(_) => {
                panic!("expected an If node, the conditional was flattened away")
            }
        }
    }

    /// End-to-end through JSX generation: both branches' markup must appear
    /// in the compiled output behind a real `config?.boardLook === …`
    /// ternary — not just whichever branch codegen arbitrarily kept.
    #[test]
    fn render_ui_node_to_jsx_emits_a_real_runtime_ternary_for_both_branches() {
        let backend = TypeScriptBackend::new();
        let effect =
            config_render_ui_conditional("unmapped-branch-kanban", "unmapped-branch-default");
        let by_slot = backend.extract_render_ui_by_slot(&effect);
        let (_, node) = &by_slot[0];

        let jsx = backend.render_ui_node_to_jsx(node, None, None, false);
        assert!(jsx.contains("config?.boardLook"), "got: {jsx}");
        assert!(jsx.contains("kanban-classic"), "got: {jsx}");
        // Both unmapped pattern types fall through `generate_pattern_from_registry`'s
        // `Unknown pattern: <type>` marker — a unique, registry-independent way to
        // prove BOTH branches actually made it into the emitted ternary.
        assert!(
            jsx.contains("unmapped-branch-kanban"),
            "then-branch missing from output: {jsx}"
        );
        assert!(
            jsx.contains("unmapped-branch-default"),
            "else-branch missing from output: {jsx}"
        );
    }

    /// The exact shipped regression: a board/browse-style atom has TWO
    /// transitions landing in the same state — one with the real,
    /// config-gated content (previously invisible), one unconditional
    /// (e.g. `CANCEL_ADD -> viewing_board` with a bare "Cancelling…" frame).
    /// Both must reach `state_ui`, not just the unconditional one.
    #[test]
    fn an_unconditional_sibling_transition_no_longer_hides_the_conditional_ones_content() {
        let backend = TypeScriptBackend::new();
        let content_effect = config_render_ui_conditional("board-columns", "board-kanban");
        let cancelling_effect = OirExpr::Effect {
            effect: Box::new(OirEffect::RenderUi {
                slot: "main".to_string(),
                pattern: OirPattern::new("loading-state"),
            }),
        };

        let mut entries: Vec<(String, RenderUiNode<'_>)> = Vec::new();
        for (event, effect) in [
            ("BoardItemsLoaded", &content_effect),
            ("CANCEL_ADD", &cancelling_effect),
        ] {
            for (slot, node) in backend.extract_render_ui_by_slot(effect) {
                assert_eq!(slot, "main");
                entries.push((event.to_string(), node));
            }
        }

        assert_eq!(
            entries.len(),
            2,
            "both the conditional content transition and the unconditional Cancelling…              transition must be collected for the same (state, slot) — the shipped bug              kept only the unconditional one"
        );
        assert!(entries.iter().any(|(event, _)| event == "BoardItemsLoaded"));
        assert!(entries.iter().any(|(event, _)| event == "CANCEL_ADD"));
    }
}

#[cfg(test)]
mod wrapper_pattern_tracks_active_branch_tests {
    use super::*;
    use orbital_core::ir::{OirModule, OirState, OirTransition};

    /// The exact shipped shape: a portal slot (`modal`) with an INIT arm
    /// that clears it (`render-ui modal null`, declared first — matching
    /// ChatOverlayPanel's `state idle { INIT -> idle (render-ui modal
    /// null) OPEN_PICKER -> idle (render-ui modal <Stack>…) }`) and a
    /// second arm with real content. The shipped bug: `<UISlotComponent
    /// pattern="...">` took a single static value from the FIRST entry
    /// (INIT's "clear"), so `@almadar/ui`'s `pattern === "clear"` check
    /// short-circuited to `null` for every arm — the real content never
    /// rendered even when `slotWriter['modal'] === 'OPEN_PICKER'`.
    fn chat_overlay_panel_shaped_trait() -> OirTrait {
        let mut tr = OirTrait::new("ChatOverlayPanel");
        tr.orbital_name = "ChatMessageOrbital".to_string();
        tr.states.push(OirState::initial("idle"));
        tr.transitions.push(
            OirTransition::new("idle", "idle", "INIT").with_effects(vec![OirExpr::Effect {
                effect: Box::new(OirEffect::RenderUi {
                    slot: "modal".to_string(),
                    pattern: OirPattern::new("clear"),
                }),
            }]),
        );
        tr.transitions.push(
            OirTransition::new("idle", "idle", "OPEN_PICKER").with_effects(vec![OirExpr::Effect {
                effect: Box::new(OirEffect::RenderUi {
                    slot: "modal".to_string(),
                    pattern: OirPattern::new("direct-message-picker"),
                }),
            }]),
        );
        tr
    }

    #[test]
    fn pattern_prop_is_a_ternary_keyed_on_slot_writer_not_a_static_first_entry_value() {
        let backend = TypeScriptBackend::new();
        let trait_def = chat_overlay_panel_shaped_trait();
        let module = OirModule::new("App", "1.0.0");

        let file = backend.generate_trait_component(&trait_def, &module, &HashSet::new());

        assert!(
            !file.content.contains("pattern=\"clear\""),
            "must not emit a static pattern=\"clear\" attribute — that permanently hides every \
             other branch's real content regardless of slotWriter, got: {}",
            file.content
        );
        assert!(
            file.content.contains(
                "pattern={slotWriter['modal'] === 'OPEN_PICKER' ? \"direct-message-picker\" : \"clear\"}"
            ),
            "expected the pattern prop to mirror the same slotWriter ternary as children, got: {}",
            file.content
        );
        assert!(
            file.content
                .contains("{slotWriter['modal'] === 'OPEN_PICKER' ? (<Stack")
                || file
                    .content
                    .contains("slotWriter['modal'] === 'OPEN_PICKER' ? ("),
            "children must gate on slotWriter, not on trait state — got: {}",
            file.content
        );
    }

    /// §98 (a): the ChatMessagePersistor shape — three `idle -> idle` arms
    /// each rendering `toast` (a distinct failure alert per writer) and one
    /// `INIT -> idle` arm rendering nothing. Before this fix every arm's
    /// condition was `state === 'idle'`, true from mount, so ALL THREE
    /// alerts painted simultaneously on load. After: no alert renders until
    /// one of the three failure events actually fires, and only ITS alert
    /// shows.
    #[test]
    fn slot_never_written_shows_no_content_on_load() {
        let backend = TypeScriptBackend::new();
        let mut tr = OirTrait::new("ChatMessagePersistor");
        tr.orbital_name = "ChatMessageOrbital".to_string();
        tr.states.push(OirState::initial("idle"));
        tr.transitions
            .push(OirTransition::new("idle", "idle", "INIT"));
        for event in ["SendFailed", "EditFailed", "DeleteFailed"] {
            tr.transitions
                .push(OirTransition::new("idle", "idle", event).with_effects(vec![
                    OirExpr::Effect {
                        effect: Box::new(OirEffect::RenderUi {
                            slot: "toast".to_string(),
                            pattern: OirPattern::new(&format!("alert-{}", event)),
                        }),
                    },
                ]));
        }
        let module = OirModule::new("App", "1.0.0");

        let file = backend.generate_trait_component(&tr, &module, &HashSet::new());

        assert!(
            !file.content.contains("state === "),
            "no branch may gate on the trait's current state anymore, got: {}",
            file.content
        );
        for event in ["SendFailed", "EditFailed", "DeleteFailed"] {
            assert!(
                file.content
                    .contains(&format!("slotWriter['toast'] === '{}'", event)),
                "each failure event must be its own slotWriter branch, got: {}",
                file.content
            );
        }
        // The chain's default (no writer yet, or a non-toast event fired)
        // must be a bare `null` — never a guessed first-entry fallback.
        assert!(
            file.content.contains(": null}") || file.content.contains(" : null}"),
            "default branch must be null (nothing written yet), got: {}",
            file.content
        );
    }

    /// §98 (b): `ChatMessageAttachment` — `ready --UPLOAD--> uploading`
    /// renders "Uploading…" into `main`; `uploading --AttachmentUploaded-->
    /// ready` renders `main` again. "Uploading…" must show ONLY while
    /// `slotWriter['main'] === 'UPLOAD'`, never merely because the trait
    /// sits in `uploading` (the shipped bug: `state === 'ready' ||
    /// 'uploading' || 'choosing'` painted it next to the paperclip while
    /// still in `ready`).
    #[test]
    fn render_gate_tracks_the_writing_transition_not_the_target_state() {
        let backend = TypeScriptBackend::new();
        let mut tr = OirTrait::new("ChatMessageAttachment");
        tr.orbital_name = "ChatMessageOrbital".to_string();
        tr.states.push(OirState::initial("ready"));
        tr.states.push(OirState::new("uploading"));
        tr.transitions.push(
            OirTransition::new("ready", "uploading", "UPLOAD").with_effects(vec![
                OirExpr::Effect {
                    effect: Box::new(OirEffect::RenderUi {
                        slot: "main".to_string(),
                        pattern: OirPattern::new("uploading-caption"),
                    }),
                },
            ]),
        );
        tr.transitions.push(
            OirTransition::new("uploading", "ready", "AttachmentUploaded").with_effects(vec![
                OirExpr::Effect {
                    effect: Box::new(OirEffect::RenderUi {
                        slot: "main".to_string(),
                        pattern: OirPattern::new("uploaded-caption"),
                    }),
                },
            ]),
        );
        let module = OirModule::new("App", "1.0.0");

        let file = backend.generate_trait_component(&tr, &module, &HashSet::new());

        assert!(
            !file.content.contains("'ready' || 'uploading'")
                && !file.content.contains("state === 'ready'"),
            "must never gate on target state, got: {}",
            file.content
        );
        assert!(
            file.content.contains("slotWriter['main'] === 'UPLOAD'"),
            "the Uploading… branch must key on the firing transition's event, got: {}",
            file.content
        );
    }

    /// §98 (c): a render into a slot persists across a LATER state change
    /// that doesn't rewrite that slot — render in `A -> B` (slot X), then
    /// `B -> C` with no render into X keeps A→B's render live.
    #[test]
    fn render_persists_across_a_state_change_with_no_rewrite() {
        let backend = TypeScriptBackend::new();
        let mut tr = OirTrait::new("Wizard");
        tr.orbital_name = "WizardOrbital".to_string();
        tr.states.push(OirState::initial("a"));
        tr.states.push(OirState::new("b"));
        tr.states.push(OirState::new("c"));
        tr.transitions
            .push(
                OirTransition::new("a", "b", "NEXT").with_effects(vec![OirExpr::Effect {
                    effect: Box::new(OirEffect::RenderUi {
                        slot: "main".to_string(),
                        pattern: OirPattern::new("step-two"),
                    }),
                }]),
            );
        // No render-ui here — this transition must not clear or replace
        // `main`'s writer.
        tr.transitions.push(OirTransition::new("b", "c", "ADVANCE"));
        let module = OirModule::new("App", "1.0.0");

        let file = backend.generate_trait_component(&tr, &module, &HashSet::new());

        assert!(
            file.content.contains("slotWriter['main'] === 'NEXT'"),
            "the only writer of `main` is NEXT — a later non-rendering transition must not \
             introduce a second branch or a state check, got: {}",
            file.content
        );
        assert!(
            !file.content.contains("state === "),
            "no state-based gating anywhere, got: {}",
            file.content
        );
    }

    fn loaded_trait(targets: &[(&str, &str)]) -> OirTrait {
        let mut tr = OirTrait::new("RecordDetail");
        tr.orbital_name = "RecordOrbital".to_string();
        tr.states.push(OirState::initial("loading"));
        for &(to, pattern) in targets {
            if !tr.states.iter().any(|s| s.name == to) {
                tr.states.push(OirState::new(to));
            }
            tr.transitions.push(
                OirTransition::new("loading", to, "LOADED").with_effects(vec![OirExpr::Effect {
                    effect: Box::new(OirEffect::RenderUi {
                        slot: "main".to_string(),
                        pattern: OirPattern::new(pattern),
                    }),
                }]),
            );
        }
        tr
    }

    /// std-record-detail: `RecordItemLoaded` enters `editing` (editor) or `viewing` (ledger)
    /// by guard. The view must show the arm that fired, not the first-declared one.
    #[test]
    fn guarded_arms_into_different_states_each_render_their_own_branch() {
        let tr = loaded_trait(&[("editing", "document-panel"), ("viewing", "detail-panel")]);
        let view = view_of(&tr);
        assert!(
            view.contains("slotWriter['main'] === 'LOADED>editing'"),
            "{view}"
        );
        assert!(
            view.contains("slotWriter['main'] === 'LOADED>viewing'"),
            "{view}"
        );
        let writer = TypeScriptBackend::new()
            .render_writer_fn(&tr)
            .expect("a writer function");
        assert!(
            writer.contains("RecordDetailRenderWriter") && writer.contains("'LOADED'"),
            "{writer}"
        );
    }

    /// std-checkout: `CheckoutStepEntered` stays in `wizard` and renders a different step by
    /// guard (`when (= ?step "step2")`). The view must show the arm that fired, keyed by the arm.
    #[test]
    fn guarded_arms_into_the_same_state_each_render_their_own_branch() {
        let mut tr = loaded_trait(&[("viewing", "detail-panel"), ("viewing", "document-panel")]);
        for (i, step) in ["one", "two"].iter().enumerate() {
            tr.transitions[i].guard = Some(OirExpr::eq(
                OirExpr::binding(orbital_core::ir::OirBinding::parse("@payload.step").unwrap()),
                OirExpr::string(*step),
            ));
        }
        let view = view_of(&tr);
        assert!(view.contains("slotWriter['main'] === 'LOADED#0'"), "{view}");
        assert!(view.contains("slotWriter['main'] === 'LOADED#1'"), "{view}");
        let writer = TypeScriptBackend::new()
            .render_writer_fn(&tr)
            .expect("a writer function");
        assert!(writer.contains("`${event}#${arm}`"), "{writer}");
        assert!(
            writer.contains("(event: string, newState: string | undefined, arm?: number)"),
            "the writer takes a dispatch result's newState as returned: {writer}"
        );
        let module = OirModule::new("App", "1.0.0");
        let handler = TypeScriptBackend::new().generate_transpiled_effect_handler_impl(&tr, &module, true, true);
        assert!(handler.contains("_arm = 0;") && handler.contains("_arm = 1;"), "{handler}");
        assert!(handler.contains("return { fields: _fields, newState: _newState, emits: _emits, arm: _arm };"), "{handler}");
        assert!(
            handler.contains("emits: Array<() => void>; arm: number | undefined } =>"),
            "the declared return type carries the arm it returns: {handler}"
        );
    }

    #[test]
    fn control_one_target_state_keeps_the_event_key_and_no_writer_function() {
        let tr = loaded_trait(&[("viewing", "detail-panel")]);
        let view = view_of(&tr);
        assert!(view.contains("slotWriter['main'] === 'LOADED'"), "{view}");
        assert!(!view.contains("LOADED>"), "{view}");
        assert!(TypeScriptBackend::new().render_writer_fn(&tr).is_none());
    }

    fn modal_trait(slot: &str, pattern: OirPattern) -> OirTrait {
        let mut tr = OirTrait::new("EditDialog");
        tr.orbital_name = "EditOrbital".to_string();
        tr.states.push(OirState::initial("idle"));
        tr.transitions.push(
            OirTransition::new("idle", "idle", "OPEN").with_effects(vec![OirExpr::Effect {
                effect: Box::new(OirEffect::RenderUi {
                    slot: slot.to_string(),
                    pattern,
                }),
            }]),
        );
        tr.transitions.push(
            OirTransition::new("idle", "idle", "CLOSE").with_effects(vec![OirExpr::Effect {
                effect: Box::new(OirEffect::RenderUi {
                    slot: slot.to_string(),
                    pattern: OirPattern::new("clear"),
                }),
            }]),
        );
        tr
    }

    fn view_of(tr: &OirTrait) -> String {
        TypeScriptBackend::new()
            .generate_trait_component(tr, &OirModule::new("App", "1.0.0"), &HashSet::new())
            .content
    }

    /// G-UI-039: a self-overlaying modal-slot pattern takes the slot presence
    /// through render-function children, so it plays its exit when cleared.
    #[test]
    fn self_overlay_modal_slot_takes_the_slot_presence() {
        for pattern_type in ["modal", "confirm-dialog"] {
            let view = view_of(&modal_trait(
                "modal",
                OirPattern::new(pattern_type).with_config("title", OirValue::String("Edit".into())),
            ));
            assert!(
                view.contains("{(__presence) => (slotWriter['modal'] === 'OPEN' ? ("),
                "{pattern_type}: render-function children, got: {view}"
            );
            assert!(
                view.contains("isOpen={__presence.open}"),
                "{pattern_type}: {view}"
            );
            assert!(
                view.contains("onExited={__presence.onExited}"),
                "{pattern_type}: {view}"
            );
        }
    }

    /// A toast-slot write renders as a dismissible `Toast` (the runtime's `SlotToasts`): its
    /// dismiss, and its own timeout, clear the slot.
    #[test]
    fn a_toast_slot_renders_a_toast_whose_dismiss_clears_the_slot() {
        let tr = modal_trait(
            "toast",
            OirPattern::new("alert")
                .with_config("message", OirValue::String("Order placed".into()))
                .with_config("variant", OirValue::String("success".into()))
                .with_config("dismissible", OirValue::Bool(true)),
        );
        let view = view_of(&tr);
        assert!(view.contains("<Toast "), "{view}");
        assert!(!view.contains("<Alert "), "{view}");
        assert!(view.contains("message=\"Order placed\""), "{view}");
        assert!(view.contains("variant=\"success\""), "{view}");
        assert!(view.contains("onDismiss={() => clearSlot('toast')}"), "{view}");
        assert!(view.contains(" clearSlot, "), "the view takes clearSlot from its hook:\n{view}");
        assert!(
            view.lines().any(|l| l.starts_with("import {") && l.contains("Toast")),
            "the view imports the Toast it renders:\n{view}"
        );
        let module = orbital_core::ir::OirModule::new("App", "1.0.0");
        let hook = TypeScriptBackend::new().generate_trait_logic_hook(&tr, &module).content;
        assert!(hook.contains("case 'SLOT_CLEARED':"), "{hook}");
        assert!(hook.contains("clearSlot: (slot: EditDialogSlot) => dispatchReducer({ type: 'SLOT_CLEARED', slot }),"), "{hook}");
    }

    #[test]
    fn control_a_modal_slot_keeps_its_pattern_and_no_clear_slot() {
        let view = view_of(&modal_trait("modal", OirPattern::new("alert")));
        assert!(view.contains("<Alert "), "{view}");
        assert!(!view.contains("clearSlot"), "{view}");
    }

    #[test]
    fn an_authored_is_open_yields_to_the_presence() {
        let view = view_of(&modal_trait(
            "modal",
            OirPattern::new("modal").with_config("isOpen", OirValue::Bool(true)),
        ));
        assert_eq!(
            view.matches("isOpen=").count(),
            1,
            "one isOpen attribute: {view}"
        );
        assert!(view.contains("isOpen={__presence.open}"));
    }

    #[test]
    fn control_plain_modal_slot_content_gets_no_presence() {
        let view = view_of(&modal_trait("modal", OirPattern::new("stack")));
        assert!(
            !view.contains("__presence"),
            "the Modal shell wraps plain content: {view}"
        );
    }

    #[test]
    fn control_self_overlay_pattern_outside_the_modal_slot_gets_no_presence() {
        let view = view_of(&modal_trait("main", OirPattern::new("modal")));
        assert!(!view.contains("__presence"), "{view}");
    }

    /// §98 (d): `(render-ui main null)` clears — no ternary branch for the
    /// clearing event, since the default is already `null`; the reducer
    /// side (covered in trait_logic.rs tests) is what actually resets a
    /// previously-open slot.
    #[test]
    fn bare_clear_render_ui_emits_no_ternary_branch() {
        let backend = TypeScriptBackend::new();
        let mut tr = OirTrait::new("ChatOverlayPanel");
        tr.orbital_name = "ChatMessageOrbital".to_string();
        tr.states.push(OirState::initial("idle"));
        tr.transitions.push(
            OirTransition::new("idle", "idle", "CLOSE").with_effects(vec![OirExpr::Effect {
                effect: Box::new(OirEffect::RenderUi {
                    slot: "modal".to_string(),
                    pattern: OirPattern::new("clear"),
                }),
            }]),
        );
        let module = OirModule::new("App", "1.0.0");

        let file = backend.generate_trait_component(&tr, &module, &HashSet::new());

        assert!(
            !file.content.contains("CLOSE"),
            "a trait with only a clearing render-ui has nothing to ever show — \
             CLOSE must not appear as a ternary branch, got: {}",
            file.content
        );
        assert!(
            file.content.contains("return null;"),
            "no non-clear renders anywhere in the trait means the View is a placeholder, got: {}",
            file.content
        );
    }

    /// An embedded trait (referenced via `@trait.X`) still needs the
    /// `<UISlotComponent>` wrapper around a PORTAL slot (toast/modal/drawer/
    /// overlay) — `@almadar/ui`'s `CompiledPortal` renders those to
    /// `document.body` regardless of where they're declared in the React
    /// tree, so skipping the wrapper (the iframe treatment correctly applied
    /// to non-portal slots like `main`) painted the alert inline inside
    /// whatever box embedded the trait instead of the top-right portal.
    #[test]
    fn embedded_trait_still_wraps_a_portal_slot_but_not_a_main_slot() {
        let backend = TypeScriptBackend::new();
        let mut tr = OirTrait::new("ChatMessageAttachment");
        tr.orbital_name = "ChatMessageOrbital".to_string();
        tr.states.push(OirState::initial("ready"));
        tr.transitions.push(
            OirTransition::new("ready", "ready", "AttachmentUploaded").with_effects(vec![
                OirExpr::Effect {
                    effect: Box::new(OirEffect::RenderUi {
                        slot: "toast".to_string(),
                        pattern: OirPattern::new("alert-uploaded"),
                    }),
                },
                OirExpr::Effect {
                    effect: Box::new(OirEffect::RenderUi {
                        slot: "main".to_string(),
                        pattern: OirPattern::new("attachment-icon"),
                    }),
                },
            ]),
        );
        let module = OirModule::new("App", "1.0.0");
        let embedded: HashSet<String> = ["ChatMessageAttachment".to_string()].into_iter().collect();

        let file = backend.generate_trait_component(&tr, &module, &embedded);

        assert!(
            file.content.contains("<UISlotComponent slot=\"toast\""),
            "an embedded trait's portal slot must still get the wrapper so CompiledPortal fires, got: {}",
            file.content
        );
        assert!(
            !file.content.contains("<UISlotComponent slot=\"main\""),
            "an embedded trait's non-portal slot keeps the bare iframe treatment, got: {}",
            file.content
        );
    }

    /// Positive control for the `generate_pattern_from_registry`/
    /// `try_mapped_children_jsx` Fragment-wrap fix: TWO slots written by the
    /// same transition (`main` + `sidebar`) still need `parts` joined behind
    /// ONE Fragment (the `parts.len() == 1 { .. } else { format!("<>{}</>", ..) }`
    /// guard just above this trait component's `return (...)`) — the fix
    /// only removed Fragment-wrapping a SINGLE generated element, never a
    /// genuine multi-sibling join.
    #[test]
    fn two_slots_written_by_one_transition_still_fragment_wrap_the_body() {
        let backend = TypeScriptBackend::new();
        let mut tr = OirTrait::new("TwoSlotOrbital");
        tr.orbital_name = "TwoSlotOrbital".to_string();
        tr.states.push(OirState::initial("idle"));
        tr.transitions.push(
            OirTransition::new("idle", "idle", "INIT").with_effects(vec![
                OirExpr::Effect {
                    effect: Box::new(OirEffect::RenderUi {
                        slot: "main".to_string(),
                        pattern: OirPattern::new("attachment-icon"),
                    }),
                },
                OirExpr::Effect {
                    effect: Box::new(OirEffect::RenderUi {
                        slot: "sidebar".to_string(),
                        pattern: OirPattern::new("alert-uploaded"),
                    }),
                },
            ]),
        );
        let module = OirModule::new("App", "1.0.0");

        let file = backend.generate_trait_component(&tr, &module, &HashSet::new());

        assert!(
            file.content.contains("<UISlotComponent slot=\"main\""),
            "got: {}",
            file.content
        );
        assert!(
            file.content.contains("<UISlotComponent slot=\"sidebar\""),
            "got: {}",
            file.content
        );
        assert!(
            file.content.contains("<><UISlotComponent slot=\"main\""),
            "two written slots must still be Fragment-wrapped as siblings, got: {}",
            file.content
        );
        assert!(
            file.content.contains("</UISlotComponent></>"),
            "the Fragment must close after the last slot, got: {}",
            file.content
        );
    }

    fn browse_trait(with_prediction: bool) -> OirTrait {
        use orbital_core::ir::{AwaitRender, SkeletonNode, SkeletonShape};
        let mut tr = OirTrait::new("ItemBrowse");
        tr.orbital_name = "ItemOrbital".to_string();
        tr.states.push(OirState::initial("idle"));
        tr.states.push(OirState::new("loaded"));
        let mut init = OirTransition::new("idle", "idle", "INIT");
        if with_prediction {
            init.await_render = vec![AwaitRender {
                trait_name: "ItemBrowse".to_string(),
                slot: "main".to_string(),
                skeleton: SkeletonNode::Shape {
                    shape: SkeletonShape {
                        variant: "grid".to_string(),
                        rows: None,
                        columns: None,
                        fields: None,
                    },
                },
            }];
        }
        tr.transitions.push(init);
        tr.transitions.push(
            OirTransition::new("idle", "loaded", "LOADED").with_effects(vec![OirExpr::Effect {
                effect: Box::new(OirEffect::RenderUi {
                    slot: "main".to_string(),
                    pattern: OirPattern::new("data-grid"),
                }),
            }]),
        );
        tr
    }

    #[test]
    fn predicted_render_selects_the_awaiting_skeleton_by_pending_transition() {
        let content = view_of(&browse_trait(true));
        assert!(
            content.contains(r#"awaitingSkeleton={(pendingEvent === "INIT" && pendingFrom === "idle" ? {"shape":{"variant":"grid"}} : undefined)}"#),
            "the slot wrapper must select the INIT prediction while INIT from idle is in flight, got: {}",
            content
        );
        assert!(
            !content.contains("<SkeletonTree "),
            "a wrapped slot draws through UISlotComponent, got: {}",
            content
        );
    }

    fn badge_trait(enter: &str) -> OirTrait {
        let mut tr = OirTrait::new("BadgeRender");
        tr.orbital_name = "BadgeOrbital".to_string();
        tr.states.push(OirState::initial("idle"));
        tr.transitions.push(
            OirTransition::new("idle", "idle", "INIT").with_effects(vec![OirExpr::Effect {
                effect: Box::new(OirEffect::RenderUi {
                    slot: "main".to_string(),
                    pattern: OirPattern::new("badge").with_config(
                        "enter",
                        orbital_core::ir::OirValue::String(enter.to_string()),
                    ),
                }),
            }]),
        );
        tr
    }

    #[test]
    fn a_config_bound_enter_reaches_the_slot_wrapper_as_the_narrowed_knob_not_the_binding_text() {
        let content = view_of(&badge_trait("@config.enter"));
        assert!(
            !content.contains("\"@config.enter\""),
            "the binding text must not be emitted as the enter value, got: {}",
            content
        );
        assert!(
            content.contains("enter={slotWriter['main'] === 'INIT' ? asEnterAnimation("),
            "the wrapper takes the config knob through asEnterAnimation, got: {}",
            content
        );
        assert!(
            content.contains("import { asEnterAnimation, enterClassName } from '@almadar/ui/lib';"),
            "the helper is imported once, beside the class helper, got: {}",
            content
        );
    }

    #[test]
    fn control_a_literal_enter_stays_a_string_literal_on_the_slot_wrapper() {
        let content = view_of(&badge_trait("rise"));
        assert!(
            content.contains("enter={slotWriter['main'] === 'INIT' ? \"rise\" : undefined}"),
            "got: {}",
            content
        );
        assert!(!content.contains("asEnterAnimation"), "got: {}", content);
    }

    #[test]
    fn control_no_prediction_emits_no_awaiting_skeleton() {
        let content = view_of(&browse_trait(false));
        assert!(!content.contains("awaitingSkeleton"), "got: {}", content);
        assert!(!content.contains("SkeletonTree"), "got: {}", content);
    }

    #[test]
    fn embedded_main_slot_draws_its_predicted_skeleton_inline() {
        let embedded: HashSet<String> = ["ItemBrowse".to_string()].into_iter().collect();
        let content = TypeScriptBackend::new()
            .generate_trait_component(
                &browse_trait(true),
                &OirModule::new("App", "1.0.0"),
                &embedded,
            )
            .content;
        assert!(
            content.contains("slotWriter['main'] == null && __awaiting ? <SkeletonTree node={__awaiting} /> : null"),
            "got: {}",
            content
        );
        assert!(
            content.contains("import { SkeletonTree } from '@almadar/ui/components';"),
            "got: {}",
            content
        );
        assert!(!content.contains("awaitingSkeleton="), "got: {}", content);
        // Outside a typed prop the literal would widen `variant` to `string` (TS2322).
        assert!(
            content.contains("const __awaiting: SkeletonNode | undefined = "),
            "got: {}",
            content
        );
        assert!(
            content.contains("import type { SkeletonNode } from '@almadar/core';"),
            "got: {}",
            content
        );
    }
}

#[cfg(test)]
mod message_tests {
    use super::*;
    use orbital_core::ir::{OirModule, OirState, OirTransition};

    fn view_rendering(content: OirValue) -> String {
        let mut tr = OirTrait::new("HomeView");
        tr.orbital_name = "Home".to_string();
        tr.states.push(OirState::initial("idle"));
        tr.transitions.push(
            OirTransition::new("idle", "idle", "INIT").with_effects(vec![OirExpr::Effect {
                effect: Box::new(OirEffect::RenderUi {
                    slot: "main".to_string(),
                    pattern: OirPattern::new("typography").with_config("content", content),
                }),
            }]),
        );
        TypeScriptBackend::new()
            .generate_trait_component(&tr, &OirModule::new("App", "1.0.0"), &HashSet::new())
            .content
    }

    /// G-CROSS-131: rich props decode through the owning package's decoder, imported into the view;
    /// a rich callback arg crosses into the payload as `toPayloadValue(arg)`.
    #[test]
    fn rich_props_decode_and_rich_callback_args_become_payload_values() {
        let render = |pattern: OirPattern| {
            let mut tr = OirTrait::new("CanvasView");
            tr.orbital_name = "Studio".to_string();
            tr.states.push(OirState::initial("idle"));
            tr.transitions.push(
                OirTransition::new("idle", "idle", "INIT").with_effects(vec![OirExpr::Effect {
                    effect: Box::new(OirEffect::RenderUi {
                        slot: "main".to_string(),
                        pattern,
                    }),
                }]),
            );
            TypeScriptBackend::new()
                .generate_trait_component(&tr, &OirModule::new("App", "1.0.0"), &HashSet::new())
                .content
        };
        let inspector = render(
            OirPattern::new("orb-inspector")
                .with_config("node", OirValue::String("@entity.node".into()))
                .with_config("schema", OirValue::String("@entity.program".into())),
        );
        assert!(
            inspector.contains("node={decodePreviewNodeData(fields?.node)}"),
            "{inspector}"
        );
        assert!(
            inspector.contains("schema={parseOrbitalSchema(fields?.program)}"),
            "{inspector}"
        );
        assert!(
            inspector.contains("import { decodePreviewNodeData } from '@almadar/ui/avl';"),
            "{inspector}"
        );
        assert!(
            inspector.contains("import { parseOrbitalSchema } from '@almadar/core';"),
            "{inspector}"
        );

        let canvas = render(
            OirPattern::new("flow-canvas")
                .with_config("schema", OirValue::String("@entity.program".into()))
                .with_config(
                    "nodePositions",
                    OirValue::String("@entity.positions".into()),
                )
                .with_config("onSchemaChange", OirValue::String("SCHEMA_CHANGE".into())),
        );
        assert!(canvas.contains("schema={((v: EventPayloadValue) => typeof v === 'string' ? v : parseOrbitalSchema(v))(fields?.program)}"), "{canvas}");
        assert!(
            canvas.contains("EventPayloadValue") && canvas.contains("from '@almadar/core'"),
            "{canvas}"
        );
        assert!(canvas.contains("nodePositions={((fields?.positions) == null ? undefined : decodeNodePlacements(fields?.positions))}"), "{canvas}");
        assert!(
            canvas.contains("dispatch('SCHEMA_CHANGE', { schema: toPayloadValue(schema) })"),
            "{canvas}"
        );
        assert!(
            canvas.contains("import { parseOrbitalSchema, toPayloadValue } from '@almadar/core';"),
            "{canvas}"
        );
    }

    #[test]
    fn control_a_plain_prop_gets_no_decoder_or_import() {
        let mut tr = OirTrait::new("PlainView");
        tr.orbital_name = "Studio".to_string();
        tr.states.push(OirState::initial("idle"));
        tr.transitions.push(
            OirTransition::new("idle", "idle", "INIT").with_effects(vec![OirExpr::Effect {
                effect: Box::new(OirEffect::RenderUi {
                    slot: "main".to_string(),
                    pattern: OirPattern::new("typography")
                        .with_config("content", OirValue::String("@entity.title".into())),
                }),
            }]),
        );
        let view = TypeScriptBackend::new()
            .generate_trait_component(&tr, &OirModule::new("App", "1.0.0"), &HashSet::new())
            .content;
        assert!(
            !view.contains("@almadar/ui/avl") && !view.contains("toPayloadValue"),
            "{view}"
        );
    }

    /// G-ORB-189: a required boolean prop in an inline view render takes the binding's truthiness.
    #[test]
    fn an_inline_render_coerces_a_required_boolean_binding() {
        let mut tr = OirTrait::new("PaletteView");
        tr.orbital_name = "Home".to_string();
        tr.states.push(OirState::initial("idle"));
        tr.transitions.push(
            OirTransition::new("idle", "idle", "INIT").with_effects(vec![OirExpr::Effect {
                effect: Box::new(OirEffect::RenderUi {
                    slot: "main".to_string(),
                    pattern: OirPattern::new("command-palette")
                        .with_config("open", OirValue::String("@entity.paletteOpen".into())),
                }),
            }]),
        );
        let view = TypeScriptBackend::new()
            .generate_trait_component(&tr, &OirModule::new("App", "1.0.0"), &HashSet::new())
            .content;
        assert!(
            view.contains("open={Boolean(fields?.paletteOpen)}"),
            "{view}"
        );
    }

    #[test]
    fn a_message_call_reads_the_views_translate_function() {
        let view = view_rendering(OirValue::Array(vec![
            OirValue::String("i18n/t".into()),
            OirValue::String("site:home.welcome".into()),
        ]));
        assert!(
            view.contains("import { useTranslate } from '@almadar/ui/hooks';"),
            "{view}"
        );
        assert!(
            view.contains("const { t: __t, locale: __locale } = useTranslate();"),
            "{view}"
        );
        assert!(
            view.contains("__t(") && view.contains("site:home.welcome"),
            "{view}"
        );
        assert!(!view.contains("UNSUPPORTED"), "{view}");
    }

    #[test]
    fn the_locale_binding_reads_the_views_locale() {
        let view = view_rendering(OirValue::String("@locale".into()));
        assert!(
            view.contains("const { t: __t, locale: __locale } = useTranslate();"),
            "{view}"
        );
        assert!(view.contains("__locale"), "{view}");
    }

    #[test]
    fn control_a_view_without_messages_does_not_call_use_translate() {
        let view = view_rendering(OirValue::String("Welcome".into()));
        assert!(!view.contains("useTranslate"), "{view}");
    }
}
