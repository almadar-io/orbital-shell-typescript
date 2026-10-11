//! Client-side state-timeout codegen (`generate_timeout_effects`).
//!
//! `state X for Ns { ... }` lowers a `time_bound_ms` onto the state (see
//! `OirState`/`schema::StateDefinition`) plus a synthesized or explicit
//! TIMEOUT transition. Neither the runtime nor the codegen previously
//! scheduled anything for that duration — this emits the missing timer.

use super::*;

impl TypeScriptBackend {
    /// Generate `useEffect` blocks that schedule a `TIMEOUT` dispatch for
    /// every state carrying a `time_bound_ms`. Mirrors `generate_tick_effects`'s
    /// shape but is simpler: no ref/rAF machinery is needed since this only
    /// fires once per state entry, and `dispatch` (not the tick loop's
    /// batched `dispatchReducer`) is the right call — TIMEOUT is a normal
    /// FSM event, same as any user-triggered one.
    pub(crate) fn generate_timeout_effects(&self, trait_def: &OirTrait) -> String {
        let mut code = String::new();

        for state in &trait_def.states {
            let Some(ms) = state.time_bound_ms else {
                continue;
            };
            code.push_str(&format!(
                "  // Timeout: state '{}' for {}ms\n",
                state.name, ms
            ));
            code.push_str("  useEffect(() => {\n");
            code.push_str(&format!("    if (state !== '{}') return;\n", state.name));
            code.push_str(&format!(
                "    const timer = setTimeout(() => {{ dispatch('TIMEOUT'); }}, {});\n",
                ms
            ));
            code.push_str("    return () => clearTimeout(timer);\n");
            code.push_str("  // eslint-disable-next-line react-hooks/exhaustive-deps\n");
            code.push_str("  }, [state]);\n\n");
        }

        code
    }
}

#[cfg(test)]
mod repro_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{OirState, OirTrait};

    #[test]
    fn time_bound_state_emits_scheduled_timeout() {
        let mut tr = OirTrait::new("ConfirmFlow");
        let mut confirming = OirState::initial("confirming");
        confirming.time_bound_ms = Some(30_000);
        tr.states.push(confirming);
        tr.states.push(OirState::new("confirmed"));

        let backend = TypeScriptBackend::new();
        let ts = backend.generate_timeout_effects(&tr);

        assert!(
            ts.contains("if (state !== 'confirming') return;"),
            "missing state guard:\n{ts}"
        );
        assert!(
            ts.contains("setTimeout(() => { dispatch('TIMEOUT'); }, 30000)"),
            "missing scheduled TIMEOUT dispatch:\n{ts}"
        );
        assert!(ts.contains("clearTimeout(timer)"), "missing cleanup:\n{ts}");
        // The non-time-bound state must not get a timeout block.
        assert!(
            !ts.contains("!== 'confirmed'"),
            "state without time_bound_ms should not get a timeout effect:\n{ts}"
        );
    }
}
