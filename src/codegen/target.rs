//! Target-abstraction traits for client codegen.
//!
//! Two traits let a non-web shell (e.g. React Native) plug in its own
//! component renderer and effect emitter without reimplementing
//! trait-logic, expr, or effect codegen.
//!
//! `WebComponentRenderer` and `WebClientEffectEmitter` are the
//! defaults — they produce exactly the same output as the web backend.

use std::collections::HashMap;

use crate::backend::{EntityFieldInfo, TypeScriptBackend};

/// Turns a resolved pattern (type + config) into a component string.
///
/// The web default (`WebComponentRenderer`) delegates to
/// `TypeScriptBackend::generate_pattern_from_registry`, which emits
/// `@almadar/ui` JSX.  A React-Native shell supplies its own impl that
/// returns native-element strings instead, calling back into
/// `render_component` for nested child patterns.
pub trait ComponentRenderer: Send + Sync {
    /// Return the rendered element/JSX string for `pattern_type`.
    ///
    /// `backend` is provided so implementations can call back into
    /// expr codegen, binding resolution, and child pattern rendering
    /// without duplicating that logic.
    fn render_component(
        &self,
        backend: &TypeScriptBackend,
        pattern_type: &str,
        config: &orbital_core_base::ir::OirObject,
        linked_entity: Option<&str>,
        entity_field_types: Option<&HashMap<String, EntityFieldInfo>>,
    ) -> String;
}

/// Emits the two client-side effect strings that differ between
/// web (React Router + EventBus) and mobile (React Navigation + native bus).
///
/// Only `Navigate` and `Emit` are abstracted here — all other effect
/// arms (`Set`, `Log`, `Notify`, …) are target-agnostic and remain
/// inline in `transpile_client_effect`.
pub trait ClientEffectEmitter: Send + Sync {
    /// Emit a `navigate(…)` call for the given path TS expression.
    fn emit_navigate(&self, path_ts: &str, indent: &str) -> String;

    /// Emit a crumb-carrying navigate: stage the crumb as the label of the
    /// navigation-stack entry the target page records, then navigate. The
    /// path expression is held in a scoped const so the stack API and the
    /// navigate call evaluate it once.
    fn emit_navigate_with_crumb(&self, path_ts: &str, crumb_ts: &str, indent: &str) -> String {
        format!(
            "{indent}{{\n{indent}  const __navPath = {path};\n{indent}  navStack.beginNavigate(__navPath, {crumb});\n{indent}  navigate(__navPath);\n{indent}}}",
            indent = indent,
            path = path_ts,
            crumb = crumb_ts,
        )
    }

    /// Emit a `navigate-back`: pop the orbital's navigation stack and
    /// navigate to the previous entry.
    fn emit_navigate_back(&self, indent: &str) -> String {
        format!("{}navStack.back();", indent)
    }

    /// Emit a `navigate(…)` call carrying `payload_ts` through router
    /// history state (read back on the destination page via
    /// `useLocation().state` and merged into INIT — see pages.rs /
    /// `generate_auto_init_effect`). Default drops the payload and degrades
    /// to a plain navigate, same shape as `emit_navigate_with_crumb`'s
    /// existing default degrade.
    fn emit_navigate_with_payload(
        &self,
        path_ts: &str,
        payload_ts: Option<&str>,
        indent: &str,
    ) -> String {
        let _ = payload_ts;
        self.emit_navigate(path_ts, indent)
    }

    /// Combined crumb + payload navigate. `crumb` and `payload_ts` ride
    /// separate channels client-side (the nav-stack entry label vs. router
    /// history state — the crumb never enters `location.state`, so there is
    /// no key to collide with an INIT-bound payload key), so the default
    /// simply keeps the crumb behavior and drops the payload — same degrade
    /// shape as `emit_navigate_with_crumb`'s own default.
    fn emit_navigate_with_crumb_and_payload(
        &self,
        path_ts: &str,
        crumb_ts: &str,
        payload_ts: Option<&str>,
        indent: &str,
    ) -> String {
        let _ = payload_ts;
        self.emit_navigate_with_crumb(path_ts, crumb_ts, indent)
    }

    /// Emit an event-bus publish for `event`.
    ///
    /// `payload_ts` is `Some(expr)` when the effect carries a payload.
    /// `source_ts` is the `, { trait: '…' }` source-stamp suffix (may be empty).
    fn emit_event_bus(
        &self,
        event: &str,
        payload_ts: Option<&str>,
        source_ts: &str,
        indent: &str,
    ) -> String;
}

// ── Web defaults ──────────────────────────────────────────────────────────────

/// Web `ComponentRenderer`: delegates to `TypeScriptBackend::generate_pattern_from_registry`.
/// Output is byte-identical to the pre-trait code path.
pub struct WebComponentRenderer;

impl ComponentRenderer for WebComponentRenderer {
    fn render_component(
        &self,
        backend: &TypeScriptBackend,
        pattern_type: &str,
        config: &orbital_core_base::ir::OirObject,
        linked_entity: Option<&str>,
        entity_field_types: Option<&HashMap<String, EntityFieldInfo>>,
    ) -> String {
        backend.generate_pattern_from_registry(
            pattern_type,
            config,
            linked_entity,
            entity_field_types,
        )
    }
}

/// Web `ClientEffectEmitter`: React Router `navigate()` + EventBus `eventBus.emit()`.
/// Strings are byte-identical to the pre-trait `transpile_client_effect` arms.
pub struct WebClientEffectEmitter;

impl ClientEffectEmitter for WebClientEffectEmitter {
    fn emit_navigate(&self, path_ts: &str, indent: &str) -> String {
        format!("{}navigate({});", indent, path_ts)
    }

    fn emit_navigate_with_payload(
        &self,
        path_ts: &str,
        payload_ts: Option<&str>,
        indent: &str,
    ) -> String {
        match payload_ts {
            Some(p) => format!("{}navigate({}, {{ state: {} }});", indent, path_ts, p),
            None => format!("{}navigate({});", indent, path_ts),
        }
    }

    fn emit_navigate_with_crumb_and_payload(
        &self,
        path_ts: &str,
        crumb_ts: &str,
        payload_ts: Option<&str>,
        indent: &str,
    ) -> String {
        match payload_ts {
            None => self.emit_navigate_with_crumb(path_ts, crumb_ts, indent),
            Some(p) => format!(
                "{indent}{{\n{indent}  const __navPath = {path};\n{indent}  navStack.beginNavigate(__navPath, {crumb});\n{indent}  navigate(__navPath, {{ state: {payload} }});\n{indent}}}",
                indent = indent,
                path = path_ts,
                crumb = crumb_ts,
                payload = p,
            ),
        }
    }

    fn emit_event_bus(
        &self,
        event: &str,
        payload_ts: Option<&str>,
        source_ts: &str,
        indent: &str,
    ) -> String {
        match payload_ts {
            Some(p) => format!("{}eventBus.emit('{}', {}{});", indent, event, p, source_ts),
            None if !source_ts.is_empty() => {
                format!(
                    "{}eventBus.emit('{}', undefined{});",
                    indent, event, source_ts
                )
            }
            None => format!("{}eventBus.emit('{}');", indent, event),
        }
    }
}
