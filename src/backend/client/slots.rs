//! The slots a trait's transitions render into, as the per-trait logic hook reads them.

use crate::backend::*;
use crate::codegen::expr::BindingFlavor;


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
        let arm_line = if arm_split.is_empty() {
            String::new()
        } else {
            format!(
                "  if (arm !== undefined && [{}].includes(event)) return `${{event}}#${{arm}}`;\n",
                list(&arm_split)
            )
        };
        let state_line = if split.is_empty() {
            "  return event;\n".to_string()
        } else {
            format!(
                "  return [{}].includes(event) ? `${{event}}>${{newState}}` : event;\n",
                list(&split)
            )
        };
        Some(format!(
            "function {name}RenderWriter(event: string, newState: string | undefined, arm?: number): string {{\n{arm_line}{state_line}}}\n\n",
            name = trait_def.name,
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
}
