//! Which of a trait's events run their leg against the browser store.

use crate::backend::*;

/// Whether `expr` holds a `browser/beacon` at any depth: the compiled client has no executor of its own, so a
/// beacon is delivered by the browser store's one http driver, reached as a browser leg like a keyless `http`.
fn runs_beacon(expr: &OirExpr) -> bool {
    match expr {
        OirExpr::Effect { effect } if matches!(effect.as_ref(), OirEffect::BrowserBeacon { .. }) => true,
        OirExpr::Conditional { condition, then_branch, else_branch } => {
            (!condition.is_statically_false() && runs_beacon(then_branch)) || runs_beacon(else_branch)
        }
        _ => expr.child_exprs().into_iter().any(runs_beacon),
    }
}

/// Whether `expr` holds a `browser/prompt` or `browser/embed` at any depth: the on-device model is a host port of
/// the browser store, so the transition is a browser leg like a beacon.
fn runs_on_device_model(expr: &OirExpr) -> bool {
    match expr {
        OirExpr::Effect { effect }
            if matches!(effect.as_ref(), OirEffect::BrowserPrompt { .. } | OirEffect::BrowserEmbed { .. }) =>
        {
            true
        }
        OirExpr::Conditional { condition, then_branch, else_branch } => {
            (!condition.is_statically_false() && runs_on_device_model(then_branch)) || runs_on_device_model(else_branch)
        }
        _ => expr.child_exprs().into_iter().any(runs_on_device_model),
    }
}

impl TypeScriptBackend {
    /// The events whose leg goes to the browser store: the core set (`OirTrait::browser_leg_events`) plus every live
    /// transition or client tick that sends a `browser/beacon`.
    pub(crate) fn trait_browser_leg_events(trait_def: &OirTrait, module: &OirModule) -> BTreeSet<String> {
        let residence = orbital_core_base::runs_on::Residence::of_module(module);
        let mut events = trait_def.browser_leg_events(&residence);
        events.extend(
            trait_def
                .transitions
                .iter()
                .filter(|t| !t.guard.as_ref().is_some_and(|g| g.is_statically_false()))
                .filter(|t| t.effects.iter().any(|e| runs_beacon(e) || runs_on_device_model(e)))
                .map(|t| t.event.clone()),
        );
        events.extend(
            trait_def
                .ticks
                .iter()
                .filter(|t| !t.background && t.effects.iter().any(|e| runs_beacon(e) || runs_on_device_model(e)))
                .map(|t| orbital_core_base::bus_event::tick_event_key(&t.name)),
        );
        events
    }
}
