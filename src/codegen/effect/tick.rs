//! Client-side tick-loop codegen (`generate_tick_effects`).

use super::*;

use super::shared::{unlowerable_expr_label, walk_effect_block, EffectBlockSink};

/// Where a `(set @entity.X …)` inside a tick writes: the per-trait loop
/// mutates a local `_ent` copy (batched into one TICK dispatch), the
/// `[shared]` coalesced driver pushes `EntityFieldWrite`s against `scratch`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TickWrite {
    Ent,
    Writes,
}

impl TickWrite {
    /// The per-frame variable `@entity.X` reads are rewritten onto.
    fn local_var(self) -> &'static str {
        match self {
            TickWrite::Ent => "_ent",
            TickWrite::Writes => "frame",
        }
    }
}

/// `EffectBlockSink` for `emit_tick_effect_block` — real `if`/`else`
/// statements around `_ent`/`scratch`-rewritten writes, mirroring the
/// hand-rolled walker it replaces byte-for-byte for `let`/`do`/`Call{"if"|"when"}`,
/// now also reached for a resolved `OirExpr::Conditional`.
struct TickEmitSink<'a> {
    trait_def: &'a OirTrait,
    module: &'a OirModule,
    mode: TickWrite,
    out: &'a mut String,
    written_fields: &'a mut Vec<String>,
}

impl EffectBlockSink for TickEmitSink<'_> {
    fn on_let_binding(
        &mut self,
        backend: &TypeScriptBackend,
        name: &str,
        value: &OirExpr,
        indent: &str,
    ) {
        let val = TypeScriptBackend::tick_entity_read_to_local(
            &backend.expr_to_client_ts(value),
            self.mode.local_var(),
        );
        self.out
            .push_str(&format!("{indent}const {name} = {val};\n"));
    }

    fn render_condition(
        &mut self,
        backend: &TypeScriptBackend,
        condition: &OirExpr,
        _indent: &str,
    ) -> String {
        TypeScriptBackend::tick_entity_read_to_local(
            &backend.expr_to_client_ts(condition),
            self.mode.local_var(),
        )
    }

    fn on_scope_open(&mut self, indent: &str) {
        self.out.push_str(&format!("{indent}{{\n"));
    }

    fn on_scope_close(&mut self, indent: &str) {
        self.out.push_str(&format!("{indent}}}\n"));
    }

    fn on_condition_open(&mut self, cond_ts: &str, indent: &str) {
        self.out.push_str(&format!("{indent}if ({cond_ts}) {{\n"));
    }

    fn on_condition_else(&mut self, indent: &str) {
        self.out.push_str(&format!("{indent}}} else {{\n"));
    }

    fn on_condition_close(&mut self, indent: &str) {
        self.out.push_str(&format!("{indent}}}\n"));
    }

    fn on_effect(&mut self, backend: &TypeScriptBackend, effect: &OirEffect, indent: &str) {
        match effect {
            OirEffect::Set { target, value, .. } => {
                let field_name = target.path.join(".");
                if !self.written_fields.contains(&field_name) {
                    self.written_fields.push(field_name.clone());
                }
                let value_ts = TypeScriptBackend::tick_entity_read_to_local(
                    &backend.expr_to_client_ts(value),
                    self.mode.local_var(),
                );
                match self.mode {
                    TickWrite::Ent => {
                        self.out
                            .push_str(&format!("{indent}_ent['{field_name}'] = {value_ts};\n"));
                    }
                    TickWrite::Writes => {
                        // The frame holds `FieldValue`s: convert at the boundary.
                        self.out.push_str(&format!(
                            "{indent}writes.push({{ field: '{field_name}', value: ((__v) => (isFieldValue(__v) ? __v : undefined))({value_ts}) }});\n"
                        ));
                    }
                }
            }
            // A tick's other effects run as a transition's do: an emit publishes the
            // source-qualified keys `listens` routes subscribe to, deferred into `_emits`
            // until the frame commits (the caller declares and flushes it).
            other => {
                if let Some(stmt) = backend.transpile_client_effect(
                    other,
                    indent,
                    Some(&self.trait_def.name),
                    Some((self.module, &self.trait_def.orbital_name)),
                ) {
                    self.out
                        .push_str(&TypeScriptBackend::tick_entity_read_to_local(
                            &stmt,
                            self.mode.local_var(),
                        ));
                    self.out.push('\n');
                }
            }
        }
    }

    fn on_unlowerable(&mut self, expr: &OirExpr, indent: &str) {
        self.out.push_str(&format!(
            "{indent}throw new Error('orb: unlowered effect expression {}');\n",
            unlowerable_expr_label(expr)
        ));
    }
}

/// `EffectBlockSink` for `collect_tick_effect` — a pure DETECTOR (see that
/// method's doc comment): branch text (`if (...) {`/`} else {`) is never
/// rendered, so `render_condition`/`on_condition_*` are no-ops and both
/// branches of a conditional simply get scanned unconditionally, exactly as
/// the old `Call{"if"|"when"}`-only descent already did for its two arms —
/// now including a resolved `OirExpr::Conditional`.
struct TickDetectSink<'a> {
    trait_def: &'a OirTrait,
    local_var: &'a str,
    let_prelude: &'a mut Vec<String>,
    field_assignments: &'a mut Vec<(String, String)>,
    other_statements: &'a mut Vec<String>,
}

impl EffectBlockSink for TickDetectSink<'_> {
    fn on_let_binding(
        &mut self,
        backend: &TypeScriptBackend,
        name: &str,
        value: &OirExpr,
        _indent: &str,
    ) {
        let val = TypeScriptBackend::tick_entity_read_to_local(
            &backend.expr_to_client_ts(value),
            self.local_var,
        );
        self.let_prelude.push(format!("const {} = {};", name, val));
    }

    fn render_condition(
        &mut self,
        _backend: &TypeScriptBackend,
        _condition: &OirExpr,
        _indent: &str,
    ) -> String {
        String::new()
    }

    fn on_scope_open(&mut self, _indent: &str) {}
    fn on_scope_close(&mut self, _indent: &str) {}
    fn on_condition_open(&mut self, _cond_ts: &str, _indent: &str) {}
    fn on_condition_else(&mut self, _indent: &str) {}
    fn on_condition_close(&mut self, _indent: &str) {}

    fn on_effect(&mut self, backend: &TypeScriptBackend, effect: &OirEffect, _indent: &str) {
        match effect {
            OirEffect::Set { target, value, .. } => {
                let field_name = target.path.join(".");
                let value_ts = TypeScriptBackend::tick_entity_read_to_local(
                    &backend.expr_to_client_ts(value),
                    self.local_var,
                );
                self.field_assignments.push((field_name, value_ts));
            }
            other => {
                if let Some(stmt) = backend.transpile_client_effect(
                    other,
                    "        ",
                    Some(&self.trait_def.name),
                    None,
                ) {
                    self.other_statements
                        .push(TypeScriptBackend::tick_entity_read_to_local(
                            &stmt,
                            self.local_var,
                        ));
                }
            }
        }
    }

    // Detection only scans for writes; a shape this backend can't lower at
    // all contributes none, same as the old bare-value no-op.
    fn on_unlowerable(&mut self, _expr: &OirExpr, _indent: &str) {}
}

impl TypeScriptBackend {
    /// Generate useEffect blocks for client-side tick execution.
    ///
    /// For `interval: "frame"` ticks, generates a `requestAnimationFrame` loop.
    /// For time-based ticks (ms, s, m), generates `setInterval`.
    /// Each tick evaluates its guard condition before executing effects.
    ///
    /// Uses refs to avoid stale closures: the rAF/interval callback reads the
    /// latest state and entity from refs, so the effect only restarts when
    /// `state` changes (not on every tick update).
    ///
    /// Persistence gate: a tick only runs its synchronous effects CLIENT-SIDE
    /// when the trait's linked entity is `[runtime]` (in-memory). For a
    /// persisted entity the per-frame `set` advances the row server-side, so
    /// emitting a client-side optimistic mutation here would race the server
    /// and double-advance the field — those ticks stay server-side. Same
    /// `OirPersistence::Runtime` discriminator the rest of the codegen uses
    /// (handlers.rs `needs_runtime_entity_store`, backend_hono.rs).
    /// The client-loop ticks whose effects write browser-stored data: each firing also sends one
    /// `runTick` leg to the browser store (`sendTick`), which runs those effects there (drift D-1).
    pub(crate) fn browser_leg_ticks(
        &self,
        trait_def: &OirTrait,
        module: &OirModule,
    ) -> std::collections::BTreeSet<String> {
        if !self.runs_client_tick_loop(trait_def, module) {
            return std::collections::BTreeSet::new();
        }
        let legs = Self::trait_browser_leg_events(trait_def, module);
        trait_def
            .ticks
            .iter()
            .filter(|t| legs.contains(&orbital_core_base::bus_event::tick_event_key(&t.name)))
            .map(|t| t.name.clone())
            .collect()
    }

    /// The per-trait client tick loop exists for a trait with a client-run tick
    /// (`tick_runs_on_client`) that is not on a `[shared]` entity (see `generate_tick_effects`).
    fn runs_client_tick_loop(&self, trait_def: &OirTrait, module: &OirModule) -> bool {
        self.shared_linked_entity(trait_def, module).is_none()
            && trait_def.ticks.iter().any(|t| {
                crate::backend::client::ticks::tick_runs_on_client(trait_def, t, module)
            })
    }

    /// The trait runs a client tick loop with a `[visible]` tick, so its hook imports and calls
    /// `useTickVisibility`.
    pub(crate) fn uses_tick_visibility(&self, trait_def: &OirTrait, module: &OirModule) -> bool {
        self.runs_client_tick_loop(trait_def, module)
            && trait_def.ticks.iter().any(|t| {
                t.while_visible
                    && crate::backend::client::ticks::tick_runs_on_client(trait_def, t, module)
            })
    }

    /// A `[shared]` entity's writer ticks: a `[visible]` writer follows every trait bound to the
    /// entity, since a writer renders nothing itself.
    pub(crate) fn shared_driver_uses_tick_visibility(
        &self,
        module: &OirModule,
        render_trait: &OirTrait,
        entity: &OirEntity,
    ) -> bool {
        module.traits.iter().any(|t| {
            t.orbital_name == render_trait.orbital_name
                && t.links_entity(entity)
                && self.trait_tick_writes_entity(t)
                && t.ticks.iter().any(|tick| tick.while_visible)
        })
    }

    pub(crate) fn generate_tick_effects(&self, trait_def: &OirTrait, module: &OirModule) -> String {
        let mut code = String::new();
        let leg_ticks = self.browser_leg_ticks(trait_def, module);

        // Persisted-entity ticks advance server-side, and a `[shared]` entity's writer ticks
        // run through one per-orbital `runTickFrame` driver (`generate_shared_tick_driver`).
        if !self.runs_client_tick_loop(trait_def, module) {
            return code;
        }

        // Emit shared refs for tick access to latest state/entity.
        // This loop only exists for `[runtime]` entities (the gate above), and
        // their row lives in the `fields` mirror: transitions write it
        // (EVENT_SUCCESS) and the view reads it. The tick loop reads/writes
        // the SAME mirror — `data[collection]` is never seeded for runtime
        // entities, so reading it here advanced a phantom row while the
        // rendered frame never moved (C-TICK-RUNTIME-ENTITY-MIRROR).
        let linked_entity_name = trait_def.linked_entity.as_deref().unwrap_or("Entity");
        code.push_str(
            "  // Refs for tick loops — avoid stale closures in rAF/interval callbacks\n",
        );
        code.push_str("  const _tickStateRef = useRef(state);\n");
        code.push_str("  const _tickEntityRef = useRef<EntityRow>({ ...fields });\n");
        code.push_str("  _tickStateRef.current = state;\n");
        code.push_str("  _tickEntityRef.current = { ...fields };\n\n");
        if self.uses_tick_visibility(trait_def, module) {
            code.push_str(&format!(
                "  const _tickVisible = useTickVisibility({});\n\n",
                serde_json::to_string(&[&trait_def.name]).expect("a trait name serializes")
            ));
        }

        for tick in &trait_def.ticks {
            if !crate::backend::client::ticks::tick_runs_on_client(trait_def, tick, module) {
                continue;
            }
            // Transpile guard condition with ref replacements (`fields?.`
            // included — the guard reads the same live mirror as the body,
            // never the mount-time closure).
            let guard_ts = tick
                .guard
                .as_ref()
                .map(|g| {
                    let raw = self.expr_to_client_ts(g);
                    raw.replace("(state ", "(_tickStateRef.current ")
                        .replace("(state)", "(_tickStateRef.current)")
                        .replace(" state)", " _tickStateRef.current)")
                        .replace("state ===", "_tickStateRef.current ===")
                        .replace("state !==", "_tickStateRef.current !==")
                        .replace("entity?.[0]?.", "_tickEntityRef.current?.")
                        .replace("entity?.", "_tickEntityRef.current?.")
                        .replace("(entity)", "(_tickEntityRef.current)")
                        .replace("fields?.", "_tickEntityRef.current?.")
                })
                .unwrap_or_else(|| "true".to_string());
            // `appliesTo`: the tick runs only while the trait is in one of these states.
            let guard_ts = if tick.applies_to.is_empty() {
                guard_ts
            } else {
                let states: Vec<String> = tick
                    .applies_to
                    .iter()
                    .map(|state| serde_json::to_string(state).expect("a state name serializes"))
                    .collect();
                format!(
                    "[{}].includes(_tickStateRef.current) && ({guard_ts})",
                    states.join(", ")
                )
            };

            // `[visible]`: pauses while the trait's output is off screen (LOLO §11).
            let guard_ts = if tick.while_visible {
                format!("_tickVisible() && ({guard_ts})")
            } else {
                guard_ts
            };

            // Build the tick body: local entity copy, then the effects as
            // STATEMENTS (statement-level `if`/`when` control flow survives —
            // C-TICK-CONDITIONAL-EFFECTS-DROPPED), then one batched dispatch.
            let mut tick_body = String::new();
            tick_body.push_str("        // Local entity copy for atomic tick computation\n");
            // EventPayloadValue-typed (NOT EntityRow/FieldValue): the tick
            // writes into the same mirror the transitions write
            // (`Record<string, EventPayloadValue | undefined>`), and the
            // batched TICK updates flow into `fields` — keeping the whole
            // client write path on ONE value type avoids the
            // EventPayloadValue-vs-FieldValue assignment friction.
            tick_body.push_str("        const _ent: Record<string, EventPayloadValue | undefined> = { ..._tickEntityRef.current };\n");
            let legs = leg_ticks.contains(&tick.name);
            if legs {
                // The leg replays the tick from the pre-tick state and row.
                tick_body.push_str(
                    "        const _legRow = { ..._tickEntityRef.current } as EntityRow;\n",
                );
            }

            let mut written_fields: Vec<String> = Vec::new();
            let mut effects_ts = String::new();
            for effect_expr in &tick.effects {
                self.emit_tick_effect_block(
                    effect_expr,
                    trait_def,
                    module,
                    TickWrite::Ent,
                    "        ",
                    &mut effects_ts,
                    &mut written_fields,
                );
            }
            if effects_ts.is_empty() && !legs {
                continue;
            }
            let defers_emits = effects_ts.contains("_emits.push(");
            if defers_emits {
                tick_body.push_str("        const _emits: Array<() => void> = [];\n");
            }
            tick_body.push_str(&effects_ts);

            // Single batched dispatch with all field updates (fields a branch
            // didn't touch carry their prior value — harmless).
            if !written_fields.is_empty() {
                tick_body.push_str(&format!(
                    "        dispatchReducer({{ type: 'TICK', collection: '{}', updates: {{ {} }} }});\n",
                    linked_entity_name,
                    written_fields.iter()
                        .map(|f| format!("'{}': _ent['{}']", f, f))
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }

            // Sync ref so next frame reads fresh values (avoids stale closure between rAF frames)
            tick_body.push_str("        _tickEntityRef.current = _ent as EntityRow;\n");
            if defers_emits {
                tick_body.push_str("        for (const _emit of _emits) _emit();\n");
            }
            if legs {
                tick_body.push_str(&format!(
                    "        void sendTick('{}', _tickStateRef.current, _legRow);\n",
                    tick.name
                ));
            }

            let stamps_now = tick
                .guard
                .iter()
                .chain(tick.effects.iter())
                .any(super::shared::expr_reads_now);
            code.push_str(&self.emit_interval_driver(
                &tick.name,
                &tick.interval,
                &guard_ts,
                &tick_body,
                stamps_now,
            ));
        }

        code
    }

    /// Wrap `tick_body` in the rAF/interval/cron driver shell matching
    /// `interval`. Extracted from the per-trait loop above (Phase 8) so
    /// the coalesced `[shared]`-entity driver
    /// (`generate_shared_tick_driver`) shares the exact same clock
    /// wiring — only the body/guard differ per caller. Byte-identical to
    /// the inline match this replaced (verified by the pre-existing
    /// `generate_tick_effects` repro tests).
    fn emit_interval_driver(
        &self,
        tick_name: &str,
        interval: &OirInterval,
        guard_ts: &str,
        tick_body: &str,
        stamps_now: bool,
    ) -> String {
        let mut code = String::new();
        let tick_cc = to_camel_case(tick_name);
        // Each firing is its own dispatch: stamp `now` once, before the guard.
        let stamp = if stamps_now {
            "      const now = Date.now();\n      __lastNow.current = now;\n"
        } else {
            ""
        };

        match interval {
            OirInterval::Frame => {
                code.push_str(&format!("  // Tick: {} (every frame)\n", tick_name));
                code.push_str(&format!("  const {}Ref = useRef<number>(0);\n", tick_cc));
                code.push_str("  useEffect(() => {\n");
                code.push_str("    let running = true;\n");
                code.push_str("    const tick = () => {\n");
                code.push_str("      if (!running) return;\n");
                code.push_str(stamp);
                code.push_str(&format!("      if ({}) {{\n", guard_ts));
                code.push_str(tick_body);
                code.push_str("      }\n");
                code.push_str(&format!(
                    "      {}Ref.current = requestAnimationFrame(tick);\n",
                    tick_cc
                ));
                code.push_str("    };\n");
                code.push_str(&format!(
                    "    {}Ref.current = requestAnimationFrame(tick);\n",
                    tick_cc
                ));
                code.push_str("    return () => {\n");
                code.push_str("      running = false;\n");
                code.push_str(&format!(
                    "      cancelAnimationFrame({}Ref.current);\n",
                    tick_cc
                ));
                code.push_str("    };\n");
                code.push_str("  // eslint-disable-next-line react-hooks/exhaustive-deps\n");
                code.push_str("  }, []);\n\n");
            }
            OirInterval::Cron { expression } => {
                code.push_str(&self.generate_cron_tick_effect(
                    tick_name, expression, guard_ts, tick_body, stamps_now,
                ));
            }
            interval => {
                let ms = match interval {
                    OirInterval::Milliseconds { value } => *value,
                    OirInterval::Seconds { value } => *value * 1000,
                    OirInterval::Minutes { value } => *value * 60 * 1000,
                    OirInterval::Frame | OirInterval::Cron { .. } => unreachable!(),
                };
                code.push_str(&format!("  // Tick: {} (every {}ms)\n", tick_name, ms));
                code.push_str("  useEffect(() => {\n");
                code.push_str("    const interval = setInterval(() => {\n");
                code.push_str(stamp);
                code.push_str(&format!("      if ({}) {{\n", guard_ts));
                code.push_str(tick_body);
                code.push_str("      }\n");
                code.push_str(&format!("    }}, {});\n", ms));
                code.push_str("    return () => clearInterval(interval);\n");
                code.push_str("  // eslint-disable-next-line react-hooks/exhaustive-deps\n");
                code.push_str("  }, []);\n\n");
            }
        }
        code
    }

    /// Deterministic IR check: does `trait_def`'s linked entity resolve to
    /// a `[shared]` entity in this module? Single source of truth (the
    /// `OirEntity.shared` flag set by resolve.rs/lower/entity.rs) reused by
    /// both this file and `generate_shared_trait_logic_hook` — no name or
    /// heuristic matching.
    pub(crate) fn shared_linked_entity<'m>(
        &self,
        trait_def: &OirTrait,
        module: &'m OirModule,
    ) -> Option<&'m OirEntity> {
        let name = trait_def.linked_entity.as_deref()?;
        module
            .resolve_entity_ref(trait_def.linked_entity_id.as_deref(), name)
            .filter(|e| e.shared)
    }

    /// Does `trait_def` have at least one tick whose effects `(set @entity.X)`
    /// a field? Classifies a trait as a WRITER for the `[shared]`-entity
    /// coalescing driver — reuses the canonical `collect_tick_effect` walker
    /// (same one that flattens a tick's `let`/`do` wrapper for the ordinary
    /// per-trait loop above) purely to test for a non-empty field-write set.
    /// No separate expression walker.
    pub(crate) fn trait_tick_writes_entity(&self, trait_def: &OirTrait) -> bool {
        trait_def.ticks.iter().any(|tick| {
            let mut let_prelude: Vec<String> = Vec::new();
            let mut field_assignments: Vec<(String, String)> = Vec::new();
            let mut other_statements: Vec<String> = Vec::new();
            for effect_expr in &tick.effects {
                self.collect_tick_effect(
                    effect_expr,
                    trait_def,
                    "scratch",
                    &mut let_prelude,
                    &mut field_assignments,
                    &mut other_statements,
                );
            }
            !field_assignments.is_empty()
        })
    }

    /// Coalesce every sibling writer trait's tick effects (same orbital,
    /// same `[shared]` linked entity, in `module.traits` declaration order
    /// — the contract's "binding order", deterministic and structural) into
    /// ONE ordered writer-closure list, and emit the sole rAF/interval
    /// driver for this shared orbital: a single `useEffect` that calls
    /// `runTickFrame` once per frame. Called exactly once, from the render
    /// trait's hook (`generate_shared_trait_logic_hook` — the sole consumer
    /// of the merged entity state), never from a writer trait's own hook.
    ///
    /// Each writer closure is transpiled straight from its owning tick's
    /// effects via the same `collect_tick_effect` walker used above, with
    /// `@entity.X` reads/writes rewritten onto the closure's `scratch`
    /// parameter (never `_ent` — there is no per-trait local copy here,
    /// only the shared running frame). The merge itself is never
    /// re-implemented: `runTickFrame`/`mergeEntityFrame` (imported from
    /// `@almadar/ui`/`@almadar/core`) own it. Every emitted identifier
    /// (entity id, trait/tick names, field names) is derived from the .orb
    /// source — nothing is hardcoded.
    ///
    /// Coalescing cadence: all writers contributing to one shared entity are
    /// expected to author the same tick interval (they run in the same
    /// frame). This driver takes the FIRST (binding-order) writer tick's
    /// interval as canonical — a deterministic tie-break, not a guess. A
    /// future validator pass should reject mismatched intervals on the same
    /// `[shared]` entity outright.
    /// The one trait whose hook runs a `[shared]` entity's tick driver: the
    /// first rendering trait bound to it, in binding (declaration) order.
    pub(crate) fn shared_tick_driver_host<'a>(
        &self,
        module: &'a OirModule,
        orbital_name: &str,
        entity: &OirEntity,
    ) -> Option<&'a str> {
        module
            .traits
            .iter()
            .find(|t| {
                t.orbital_name == orbital_name
                    && t.links_entity(entity)
                    && self.trait_has_render_ui_effect(t)
            })
            .map(|t| t.name.as_str())
    }

    /// Seed the shared store from the entity's declared field defaults (`x: number = 0`) so
    /// every reader sees them at frame 0 — idempotent + no-notify, from the same
    /// `OirField.default` source the interpreter seeds from (frame-0 parity). Every hook that
    /// reads or commits the shared entity emits it: the store keeps whichever seed or commit
    /// lands first.
    pub(crate) fn shared_entity_seed(entity: &OirEntity) -> String {
        let default_pairs: Vec<String> = entity
            .fields
            .iter()
            .filter_map(|f| {
                f.default.as_ref().map(|d| {
                    format!(
                        "'{}': {}",
                        f.name,
                        crate::backend::oir_value_to_ts_literal(d)
                    )
                })
            })
            .collect();
        if default_pairs.is_empty() {
            return String::new();
        }
        format!(
            "  _sharedStore.seed(_sharedEntityId, {{ {} }});\n",
            default_pairs.join(", ")
        )
    }

    /// `host`: this hook runs the driver (writers + interval loop); every other
    /// rendering trait on the entity gets only the store prelude.
    pub(crate) fn generate_shared_tick_driver(
        &self,
        module: &OirModule,
        render_trait: &OirTrait,
        entity: &OirEntity,
        host: bool,
    ) -> String {
        let mut code = String::new();
        code.push_str("  // [shared] entity store + coalesced tick driver\n");
        // Read from `SharedEntityStoreContext` (provided once per page,
        // `generate_page_component`) rather than creating a private
        // `useSharedEntityStore()` instance — this trait's own dispatch (if
        // any) and sibling writer traits' dispatch all need the SAME store
        // instance the tick driver mutates, not a disconnected one.
        code.push_str("  const _sharedStore = useSharedEntityStoreContext();\n");
        code.push_str(&format!("  const _sharedEntityId = '{}';\n", entity.name));

        code.push_str(&Self::shared_entity_seed(entity));

        if !host {
            return code;
        }

        let writer_traits: Vec<&OirTrait> = module
            .traits
            .iter()
            .filter(|t| {
                t.orbital_name == render_trait.orbital_name
                    && t.links_entity(entity)
                    && self.trait_tick_writes_entity(t)
            })
            .collect();

        if self.shared_driver_uses_tick_visibility(module, render_trait, entity) {
            let group: Vec<&str> = module
                .traits
                .iter()
                .filter(|t| t.orbital_name == render_trait.orbital_name && t.links_entity(entity))
                .map(|t| t.name.as_str())
                .collect();
            code.push_str(&format!(
                "  const _sharedTickVisible = useTickVisibility({});\n",
                serde_json::to_string(&group).expect("trait names serialize")
            ));
        }
        // Writers defer their emits here; the driver fires them once the frame commits.
        code.push_str("  const _sharedTickEmitsRef = useRef<Array<() => void>>([]);\n");
        code.push_str(
            "  const _sharedWritersRef = useRef<ReadonlyArray<(scratch: EntityFrameState) => readonly EntityFieldWrite[]>>([\n",
        );
        let mut driver_interval: Option<OirInterval> = None;
        for (writer, tick) in writer_traits
            .iter()
            .copied()
            .flat_map(|t| t.ticks.iter().map(move |tick| (t, tick)))
        {
            let mut written_fields: Vec<String> = Vec::new();
            let mut body = String::new();
            for effect_expr in &tick.effects {
                self.emit_tick_effect_block(
                    effect_expr,
                    writer,
                    module,
                    TickWrite::Writes,
                    "        ",
                    &mut body,
                    &mut written_fields,
                );
            }
            if written_fields.is_empty() {
                continue;
            }
            // First writing tick in binding order fixes the driver cadence.
            driver_interval.get_or_insert_with(|| tick.interval.clone());

            let guard_ts = tick
                .guard
                .as_ref()
                .map(|g| Self::tick_entity_read_to_local(&self.expr_to_client_ts(g), "frame"))
                .unwrap_or_else(|| "true".to_string());
            let guard_ts = if tick.while_visible {
                format!("_sharedTickVisible() && ({guard_ts})")
            } else {
                guard_ts
            };

            code.push_str(&format!("    // writer {}.{}\n", writer.name, tick.name));
            code.push_str("    (scratch: EntityFrameState): readonly EntityFieldWrite[] => {\n");
            if tick
                .guard
                .iter()
                .chain(tick.effects.iter())
                .any(super::shared::expr_reads_now)
            {
                code.push_str("      const now = Date.now();\n");
            }
            code.push_str("      const writes: EntityFieldWrite[] = [];\n");
            // Read the frame as the per-trait tick reads its row (an `EventPayloadValue` view).
            code.push_str(
                "      const frame: Record<string, EventPayloadValue | undefined> = scratch;\n",
            );
            if body.contains("_emits.push(") {
                code.push_str("      const _emits = _sharedTickEmitsRef.current;\n");
            }
            code.push_str(&format!("      if ({}) {{\n", guard_ts));
            code.push_str(&body);
            code.push_str("      }\n");
            code.push_str("      return writes;\n");
            code.push_str("    },\n");
        }
        code.push_str("  ]);\n\n");

        let interval = driver_interval.unwrap_or(OirInterval::Frame);
        let driver_name = format!("{}SharedTick", entity.name);
        let driver_body = "        runTickFrame(_sharedEntityId, _sharedWritersRef.current, _sharedStore);\n        for (const _emit of _sharedTickEmitsRef.current.splice(0)) _emit();\n";
        code.push_str(&self.emit_interval_driver(
            &driver_name,
            &interval,
            "true",
            driver_body,
            false,
        ));
        code
    }

    /// Generate a `useEffect` for a cron-scheduled tick (`ticks { ... every
    /// "0 9 * * *" }`). The cron expression is a compile-time constant by
    /// the time it reaches codegen (`resolve_tick` already validated it via
    /// `orbital_core::cron::parse_cron` before producing `OirInterval::Cron`),
    /// so the match-sets are resolved ONCE here and emitted as plain array
    /// literals — the generated bundle does zero cron *parsing*, only a
    /// 5-field `includes()` check on a 1s poll, deduped per calendar minute.
    /// Firing semantics (poll cadence, minute dedup) mirror
    /// `packages/almadar-runtime/src/TickScheduler.ts`'s `addCron` and
    /// `orbital-server`'s `schedule_cron` exactly, so all engines agree.
    fn generate_cron_tick_effect(
        &self,
        tick_name: &str,
        expression: &str,
        guard_ts: &str,
        tick_body: &str,
        stamps_now: bool,
    ) -> String {
        let fields = orbital_core_base::cron::parse_cron(expression).unwrap_or_else(|e| {
            panic!(
                "codegen invariant violated: OirInterval::Cron carried an invalid \
                 expression '{expression}' (resolve_tick should have rejected this \
                 before it ever reached codegen): {e}"
            )
        });
        let as_js_array = |values: &std::collections::HashSet<u32>| -> String {
            let mut sorted: Vec<u32> = values.iter().copied().collect();
            sorted.sort_unstable();
            format!(
                "[{}]",
                sorted
                    .iter()
                    .map(|v| v.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };

        let mut code = String::new();
        code.push_str(&format!(
            "  // Tick: {tick_name} (cron: \"{expression}\")\n"
        ));
        code.push_str(&format!(
            "  const _cronMinute = {};\n",
            as_js_array(&fields.minute)
        ));
        code.push_str(&format!(
            "  const _cronHour = {};\n",
            as_js_array(&fields.hour)
        ));
        code.push_str(&format!(
            "  const _cronDay = {};\n",
            as_js_array(&fields.day)
        ));
        code.push_str(&format!(
            "  const _cronMonth = {};\n",
            as_js_array(&fields.month)
        ));
        code.push_str(&format!(
            "  const _cronWeekday = {};\n",
            as_js_array(&fields.weekday)
        ));
        code.push_str("  useEffect(() => {\n");
        code.push_str("    let lastFiredMinuteKey = -1;\n");
        code.push_str("    const interval = setInterval(() => {\n");
        code.push_str("      const cronAt = new Date();\n");
        code.push_str(
            "      const minuteKey = cronAt.getFullYear() * 1e8 + cronAt.getMonth() * 1e6 + cronAt.getDate() * 1e4 + cronAt.getHours() * 100 + cronAt.getMinutes();\n",
        );
        code.push_str(
            "      const cronMatch = _cronMinute.includes(cronAt.getMinutes()) && _cronHour.includes(cronAt.getHours()) && _cronDay.includes(cronAt.getDate()) && _cronMonth.includes(cronAt.getMonth() + 1) && _cronWeekday.includes(cronAt.getDay());\n",
        );
        code.push_str("      if (minuteKey !== lastFiredMinuteKey && cronMatch) {\n");
        code.push_str("        lastFiredMinuteKey = minuteKey;\n");
        if stamps_now {
            code.push_str(
                "        const now = cronAt.getTime();\n        __lastNow.current = now;\n",
            );
        }
        code.push_str(&format!("        if ({guard_ts}) {{\n"));
        code.push_str(tick_body);
        code.push_str("        }\n");
        code.push_str("      }\n");
        code.push_str("    }, 1000);\n");
        code.push_str("    return () => clearInterval(interval);\n");
        code.push_str("  // eslint-disable-next-line react-hooks/exhaustive-deps\n");
        code.push_str("  }, []);\n\n");
        code
    }

    /// Rewrite `@entity.X` reads (which the client emitter renders as
    /// `fields?.X` — the trait-fields mirror the TICK reducer does NOT touch)
    /// onto the per-frame local copy, so a tick reads the value it just
    /// wrote. Also normalizes the bare `entity?.[0]?.` / `entity?.` forms.
    /// `local_var` is `"_ent"` for the ordinary per-trait tick loop (a
    /// mutable local copy of the linked-entity row) and `"scratch"` for the
    /// `[shared]`-entity coalesced driver (the running frame a writer
    /// closure receives as its sole parameter) — same rewrite, different
    /// target, so both paths share one walker.
    fn tick_entity_read_to_local(s: &str, local_var: &str) -> String {
        s.replace("entity?.[0]?.", &format!("{}?.", local_var))
            .replace("entity?.", &format!("{}?.", local_var))
            .replace("fields?.", &format!("{}?.", local_var))
    }

    /// Emit tick effect-expressions as STATEMENTS, preserving statement-level
    /// control flow via `walk_effect_block`: `(let …)` / `(do …)` flatten,
    /// `(if c a b?)` / `(when c body)` AND a resolved `OirExpr::Conditional`
    /// all emit real `if` blocks, so conditional writes are never silently
    /// dropped (C-TICK-CONDITIONAL-EFFECTS-DROPPED and the resolved-`if`
    /// drop it left standing). `written_fields` collects the ordered,
    /// de-duplicated entity fields written anywhere in the block — the
    /// per-trait batched TICK dispatch carries the prior value for fields a
    /// branch didn't touch, which is harmless. Every other effect is
    /// transpiled as a transition's is; an emit defers into the caller's `_emits`.
    fn emit_tick_effect_block(
        &self,
        expr: &OirExpr,
        trait_def: &OirTrait,
        module: &OirModule,
        mode: TickWrite,
        indent: &str,
        out: &mut String,
        written_fields: &mut Vec<String>,
    ) {
        let mut sink = TickEmitSink {
            trait_def,
            module,
            mode,
            out,
            written_fields,
        };
        walk_effect_block(self, expr, indent, &mut sink);
    }

    /// Flatten one tick effect-expression into (let-prelude, field-assignments,
    /// non-set statements) via `walk_effect_block`, reusing the canonical
    /// `expr_to_client_ts` emitter for every value — never a second
    /// expression walker. `local_var` names the per-frame variable `@entity.X`
    /// reads/writes are rewritten onto (`"_ent"` or `"scratch"` — see
    /// `tick_entity_read_to_local`). Now used only by
    /// `trait_tick_writes_entity` for writer DETECTION (emission lives in
    /// `emit_tick_effect_block`); it descends both `if`/`when` AND a resolved
    /// `Conditional`'s branches unconditionally, so a trait whose writes are
    /// all conditional is still classified as a writer.
    fn collect_tick_effect(
        &self,
        expr: &OirExpr,
        trait_def: &OirTrait,
        local_var: &str,
        let_prelude: &mut Vec<String>,
        field_assignments: &mut Vec<(String, String)>,
        other_statements: &mut Vec<String>,
    ) {
        let mut sink = TickDetectSink {
            trait_def,
            local_var,
            let_prelude,
            field_assignments,
            other_statements,
        };
        walk_effect_block(self, expr, "", &mut sink);
    }
}

#[cfg(test)]
mod repro_tests {
    use crate::TypeScriptBackend;
    use orbital_core_base::ir::{
        OirBinding, OirEffect, OirEntity, OirExpr, OirField, OirInterval, OirModule, OirPattern,
        OirPersistence, OirState, OirTick, OirTrait, OirTransition, OirType,
    };

    fn bind(s: &str) -> OirExpr {
        OirExpr::binding(OirBinding::parse(s).expect("binding"))
    }

    // Build the platformer-shaped tick OirExpr the way `resolve_sexpr` does for
    // a single top-level
    // (let ((vy1 ...)(px1 ...)) (do (set @entity.player (object/merge ...)) (render-ui ...)))
    #[test]
    fn platformer_let_do_tick_advances_player_into_render_store() {
        // let bindings: array of [name-string, value-expr] pairs (resolve_sexpr
        // treats the bindings list as an array literal of 2-elem arrays).
        let bindings = OirExpr::array(vec![
            OirExpr::array(vec![
                OirExpr::string("vy1"),
                OirExpr::add(bind("@entity.player.vy"), OirExpr::number(1.0)),
            ]),
            OirExpr::array(vec![
                OirExpr::string("px1"),
                OirExpr::add(bind("@entity.player.x"), bind("@entity.player.vx")),
            ]),
        ]);

        let merge = OirExpr::call(
            "object/merge",
            vec![
                bind("@entity.player"),
                OirExpr::object(orbital_core_base::ir::OirFields::from([
                    ("x".to_string(), bind("@px1")),
                    ("vy".to_string(), bind("@vy1")),
                ])),
            ],
        );
        let set_player = OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.player").unwrap(),
            merge,
        ));
        let render = OirExpr::effect(OirEffect::RenderUi {
            slot: "main".to_string(),
            pattern: OirPattern::new("game-platformer"),
        });
        let do_block = OirExpr::call("do", vec![set_player, render]);
        let let_expr = OirExpr::call("let", vec![bindings, do_block]);

        let mut tick = OirTick::new("gameflowTick", OirInterval::Frame);
        tick.effects.push(let_expr);

        let mut tr = OirTrait::new("PlatformerBoard");
        tr.linked_entity = Some("PlatformerGame".to_string());
        tr.ticks.push(tick);

        let mut module = OirModule::new("Plat", "0.1.0");
        module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "PlatformerGame".to_string(),
            description: None,
            collection: "PlatformerGame".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });

        let backend = TypeScriptBackend::new();
        let ts = backend.generate_tick_effects(&tr, &module);

        // The `let`/`do` wrapper must be desugared: a rAF loop runs, the `let`
        // locals are declared (with `@entity.X` reads pulled onto the local
        // `_ent` copy), the merged player is computed, and the result is
        // dispatched into the render store (`state.data[<collection>][0]`).
        assert!(
            ts.contains("requestAnimationFrame(tick)"),
            "no rAF loop:\n{ts}"
        );
        assert!(
            ts.contains("const let__vy1 = (+((_ent?.player as EventPayload | undefined)?.vy ?? 0) + 1)"),
            "let-local vy1 not emitted onto _ent copy:\n{ts}"
        );
        assert!(
            ts.contains("const let__px1 ="),
            "let-local px1 not emitted:\n{ts}"
        );
        assert!(
            ts.contains("_ent['player'] = Object.assign({}, _ent?.player,"),
            "set @entity.player (object/merge) not written to local copy:\n{ts}"
        );
        assert!(
            ts.contains(
                "dispatchReducer({ type: 'TICK', collection: 'PlatformerGame', updates: { 'player': _ent['player'] } })"
            ),
            "merged player not dispatched into render store:\n{ts}"
        );
    }

    /// A per-trait tick's emit routes like a transition's (G-ORB-113): the source-qualified
    /// key a sibling's `listens` subscribes to, fired after the tick's TICK dispatch.
    #[test]
    fn tick_emit_publishes_the_source_qualified_key_after_the_dispatch() {
        let mut tick = OirTick::new("clock", OirInterval::Frame);
        tick.effects.push(OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.score").unwrap(),
            OirExpr::number(1.0),
        )));
        tick.effects
            .push(OirExpr::effect(OirEffect::emit_with_payload(
                "PING",
                OirExpr::object(orbital_core_base::ir::OirFields::from([(
                    "n".to_string(),
                    bind("@entity.score"),
                )])),
            )));
        let mut tr = OirTrait::new("Clock");
        tr.orbital_name = "Game".to_string();
        tr.linked_entity = Some("Game".to_string());
        tr.ticks.push(tick);
        let mut module = OirModule::new("Game", "0.1.0");
        module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Game".to_string(),
            description: None,
            collection: "Game".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });

        let ts = TypeScriptBackend::new().generate_tick_effects(&tr, &module);

        assert!(
            ts.contains("emitCascadeEvent(eventBus, 'Game', 'Clock', { event: 'PING', payload: _p"),
            "the tick emit must publish the source-qualified key:\n{ts}"
        );
        assert!(
            ts.contains("})({ n: _ent?.score }));"),
            "the payload reads the tick's own frame:\n{ts}"
        );
        let dispatch = ts.find("dispatchReducer({ type: 'TICK'").expect("dispatch");
        let flush = ts
            .find("for (const _emit of _emits) _emit();")
            .expect("flush");
        assert!(flush > dispatch, "emits fire after the tick commits:\n{ts}");
    }

    /// std-brick-breaker's `(if @hitBrick (emit BURST …) null)`: the `null` else is "no
    /// effect", so the tick must not compile it to a throw every frame.
    #[test]
    fn tick_null_branch_is_a_no_op_not_a_throw() {
        let conditional = OirExpr::if_then_else(
            bind("@entity.flag"),
            OirExpr::effect(OirEffect::set(
                OirBinding::parse("@entity.score").unwrap(),
                OirExpr::number(1.0),
            )),
            OirExpr::null(),
        );
        let mut tick = OirTick::new("clock", OirInterval::Frame);
        tick.effects.push(conditional);
        let mut tr = OirTrait::new("NullTick");
        tr.linked_entity = Some("Game".to_string());
        tr.ticks.push(tick);
        let mut module = OirModule::new("NullTick", "0.1.0");
        module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Game".to_string(),
            description: None,
            collection: "Game".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });

        let ts = TypeScriptBackend::new().generate_tick_effects(&tr, &module);

        assert!(
            !ts.contains("unlowered effect expression"),
            "a null branch must not throw:\n{ts}"
        );
        assert!(
            ts.contains("_ent['score'] = 1"),
            "the then-branch set must still be emitted:\n{ts}"
        );
    }

    #[test]
    fn cron_tick_emits_precomputed_match_sets_no_runtime_parsing() {
        let set_flag = OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.fired").unwrap(),
            OirExpr::bool(true),
        ));

        let mut tick = OirTick::new("dailyReport", OirInterval::Cron { expression: "0 9 * * *".to_string() });
        tick.effects.push(set_flag);

        let mut tr = OirTrait::new("ReportTrait");
        tr.linked_entity = Some("Report".to_string());
        tr.ticks.push(tick);

        let mut module = OirModule::new("Reports", "0.1.0");
        module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Report".to_string(),
            description: None,
            collection: "Report".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });

        let backend = TypeScriptBackend::new();
        let ts = backend.generate_tick_effects(&tr, &module);

        // "0 9 * * *" -> minute=[0], hour=[9], day/month/weekday=full range.
        // No parseCron/cronMatches call should appear — the match sets are
        // pre-resolved at codegen time, so the bundle only does includes().
        assert!(ts.contains("const _cronMinute = [0];"), "minute set:\n{ts}");
        assert!(ts.contains("const _cronHour = [9];"), "hour set:\n{ts}");
        assert!(
            ts.contains("const _cronDay = [1, 2, 3"),
            "day set should be the full 1-31 range:\n{ts}"
        );
        assert!(
            ts.contains("const _cronWeekday = [0, 1, 2, 3, 4, 5, 6];"),
            "weekday set should be the full 0-6 range:\n{ts}"
        );
        assert!(
            ts.contains("_cronMinute.includes(cronAt.getMinutes())"),
            "no cron-match check emitted:\n{ts}"
        );
        assert!(
            !ts.contains("parseCron("),
            "must not emit a runtime cron parser:\n{ts}"
        );
        assert!(
            ts.contains("}, 1000);"),
            "cron tick must poll once a second:\n{ts}"
        );
    }

    // ------------------------------------------------------------------
    // `[shared]`-entity tick coalescing: two headless writer traits (each
    // co-mutating disjoint fields of one shared entity per frame) + one
    // render trait that paints the merged result.
    // ------------------------------------------------------------------

    /// Abstract shared-entity parity fixture (no domain vocabulary):
    /// `orbital Orb { entity SharedState [runtime, shared] { a, b, c } ;
    /// trait WriterA (ticks: set a, set b) ; trait WriterB (ticks: set c) ;
    /// trait Render (INIT -> render-ui) }` — binding order WriterA, WriterB,
    /// Render (module.traits declaration order). Every identifier the codegen
    /// emits is derived from these source names.
    fn shared_parity_module() -> OirModule {
        let mut writer_a_tick = OirTick::new("stepA", OirInterval::Milliseconds { value: 16 });
        writer_a_tick.effects.push(OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.a").unwrap(),
            OirExpr::add(bind("@entity.a"), OirExpr::number(1.0)),
        )));
        writer_a_tick.effects.push(OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.b").unwrap(),
            OirExpr::add(bind("@entity.b"), OirExpr::number(2.0)),
        )));
        let mut writer_a = OirTrait::new("WriterA");
        writer_a.orbital_name = "Orb".to_string();
        writer_a.linked_entity = Some("SharedState".to_string());
        writer_a.states.push(OirState::initial("s"));
        writer_a.ticks.push(writer_a_tick);

        let mut writer_b_tick = OirTick::new("stepB", OirInterval::Milliseconds { value: 16 });
        writer_b_tick.effects.push(OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.c").unwrap(),
            OirExpr::add(bind("@entity.c"), OirExpr::number(1.0)),
        )));
        let mut writer_b = OirTrait::new("WriterB");
        writer_b.orbital_name = "Orb".to_string();
        writer_b.linked_entity = Some("SharedState".to_string());
        writer_b.states.push(OirState::initial("s"));
        writer_b.ticks.push(writer_b_tick);

        let mut render = OirTrait::new("Render");
        render.orbital_name = "Orb".to_string();
        render.linked_entity = Some("SharedState".to_string());
        render.states.push(OirState::initial("s"));
        render
            .transitions
            .push(
                OirTransition::new("s", "s", "INIT").with_effects(vec![OirExpr::effect(
                    OirEffect::RenderUi {
                        slot: "main".to_string(),
                        pattern: OirPattern::new("typography"),
                    },
                )]),
            );

        let mut module = OirModule::new("SharedParity", "1.0.0");
        module.entities.push(OirEntity {
            shared: true,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "SharedState".to_string(),
            description: None,
            collection: "SharedState".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![
                OirField::new("id", OirType::String),
                OirField::new("a", OirType::Number),
                OirField::new("b", OirType::Number),
                OirField::new("c", OirType::Number),
            ],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });
        module.traits.push(writer_a);
        module.traits.push(writer_b);
        module.traits.push(render);
        module
    }

    /// G-ORB-144: std-behavior-tour binds two RENDERING traits (the tour and
    /// its transport) to one shared scene. Each hosted its own interval loop,
    /// so the clock ran at twice the authored speed. One host per entity: the
    /// first rendering trait in binding order; the others only read the store.
    #[test]
    fn two_rendering_traits_on_one_shared_entity_host_one_driver() {
        let backend = TypeScriptBackend::new();
        let mut module = shared_parity_module();
        let mut second = module.find_trait("Render").unwrap().clone();
        second.name = "Render2".to_string();
        module.traits.push(second);
        let entity = module.find_entity("SharedState").unwrap().clone();
        let hooks: Vec<String> = ["Render", "Render2"]
            .iter()
            .map(|n| {
                backend
                    .generate_shared_trait_logic_hook(
                        module.find_trait(n).unwrap(),
                        &module,
                        &entity,
                    )
                    .content
            })
            .collect();
        let drivers: usize = hooks
            .iter()
            .map(|h| h.matches("runTickFrame(_sharedEntityId").count())
            .sum();
        assert_eq!(drivers, 1, "{hooks:#?}");
        assert!(
            hooks[0].contains("runTickFrame(_sharedEntityId"),
            "the first renderer hosts it"
        );
        for h in &hooks {
            assert!(
                h.contains("const _sharedStore = useSharedEntityStoreContext();"),
                "{h}"
            );
            assert!(
                h.contains("useSharedEntitySnapshot(_sharedStore, _sharedEntityId)"),
                "{h}"
            );
        }
        assert!(
            !hooks[1].contains("runTickFrame"),
            "no unused import in the reader:\n{}",
            hooks[1]
        );
    }

    #[test]
    fn shared_linked_entity_resolves_only_for_shared_entities() {
        let backend = TypeScriptBackend::new();
        let module = shared_parity_module();
        let writer_a = module.find_trait("WriterA").unwrap();
        assert!(
            backend.shared_linked_entity(writer_a, &module).is_some(),
            "WriterA is linked to the [shared] SharedState entity"
        );

        // A non-shared entity must NOT resolve — `shared` defaults to false,
        // so a plain runtime trait stays on the unaffected per-trait tick path.
        let mut plain_module = OirModule::new("Plain", "0.1.0");
        plain_module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Plain".to_string(),
            description: None,
            collection: "Plain".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });
        let mut plain_trait = OirTrait::new("PlainTrait");
        plain_trait.linked_entity = Some("Plain".to_string());
        plain_module.traits.push(plain_trait.clone());
        assert!(backend
            .shared_linked_entity(&plain_trait, &plain_module)
            .is_none());
    }

    #[test]
    fn trait_tick_writes_entity_classifies_writers_not_render_trait() {
        let backend = TypeScriptBackend::new();
        let module = shared_parity_module();
        assert!(backend.trait_tick_writes_entity(module.find_trait("WriterA").unwrap()));
        assert!(backend.trait_tick_writes_entity(module.find_trait("WriterB").unwrap()));
        assert!(
            !backend.trait_tick_writes_entity(module.find_trait("Render").unwrap()),
            "Render has no ticks — it must not be classified as a writer"
        );
    }

    #[test]
    fn shared_entity_writer_trait_emits_no_local_tick_loop() {
        // (a) "decouple mutation from repaint": a writer trait linked to a
        // [shared] entity must NOT get the ordinary per-trait rAF/dispatchReducer
        // loop — that would double-run its ticks alongside the coalesced
        // driver and silently mutate a per-trait reducer nobody reads.
        let backend = TypeScriptBackend::new();
        let module = shared_parity_module();
        let writer_a = module.find_trait("WriterA").unwrap();
        let ts = backend.generate_tick_effects(writer_a, &module);
        assert!(
            ts.is_empty(),
            "a [shared]-linked writer trait must not emit its own tick loop, got:\n{ts}"
        );
    }

    #[test]
    fn non_shared_tick_effects_unaffected_by_shared_gate() {
        // (d) byte-identical proof: a plain runtime (non-shared) trait must
        // still get its full per-trait rAF + dispatchReducer TICK loop.
        let mut tr = OirTrait::new("RuntimeTrait");
        tr.linked_entity = Some("RuntimeState".to_string());
        let mut tick = OirTick::new("advance", OirInterval::Frame);
        tick.effects.push(OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.a").unwrap(),
            OirExpr::add(bind("@entity.a"), OirExpr::number(1.0)),
        )));
        tr.ticks.push(tick);

        let mut module = OirModule::new("RuntimeApp", "0.1.0");
        module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "RuntimeState".to_string(),
            description: None,
            collection: "RuntimeState".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });
        module.traits.push(tr.clone());

        let backend = TypeScriptBackend::new();
        let ts = backend.generate_tick_effects(&tr, &module);
        assert!(
            ts.contains("requestAnimationFrame(tick)"),
            "non-shared rAF loop missing:\n{ts}"
        );
        assert!(
            ts.contains("dispatchReducer({ type: 'TICK'"),
            "non-shared dispatchReducer TICK missing:\n{ts}"
        );
    }

    #[test]
    fn shared_tick_driver_coalesces_writers_in_binding_order_with_one_driver() {
        // (b) "coalesce": ONE driver for the whole shared orbital, writers
        // folded in module.traits declaration order (WriterA before WriterB).
        let backend = TypeScriptBackend::new();
        let module = shared_parity_module();
        let render = module.find_trait("Render").unwrap();
        let entity = module.find_entity("SharedState").unwrap();

        let ts = backend.generate_shared_tick_driver(&module, render, entity, true);

        // Entity id (derived from source) + store wiring.
        assert!(
            ts.contains("const _sharedEntityId = 'SharedState';"),
            "{ts}"
        );
        assert!(
            ts.contains("const _sharedStore = useSharedEntityStoreContext();"),
            "{ts}"
        );

        // Binding order: WriterA's closure appears before WriterB's.
        let writer_a_idx = ts
            .find("writer WriterA.stepA")
            .expect("WriterA closure present");
        let writer_b_idx = ts
            .find("writer WriterB.stepB")
            .expect("WriterB closure present");
        assert!(
            writer_a_idx < writer_b_idx,
            "writers must be in binding (declaration) order, WriterA before WriterB:\n{ts}"
        );

        // `@entity.X` reads go through the writer's `frame` view of `scratch`, never `_ent`
        // (there is no per-trait local copy in the coalesced driver); each write is
        // converted back to the frame's `FieldValue` at the boundary.
        assert!(
            ts.contains("writes.push({ field: 'a', value: ((__v) => (isFieldValue(__v) ? __v : undefined))((+(frame?.a ?? 0) + 1)) });"),
            "WriterA a-write not read through frame:\n{ts}"
        );
        assert!(
            ts.contains("writes.push({ field: 'b', value: ((__v) => (isFieldValue(__v) ? __v : undefined))((+(frame?.b ?? 0) + 2)) });"),
            "WriterA b-write not read through frame:\n{ts}"
        );
        assert!(
            ts.contains("writes.push({ field: 'c', value: ((__v) => (isFieldValue(__v) ? __v : undefined))((+(frame?.c ?? 0) + 1)) });"),
            "WriterB c-write not read through frame:\n{ts}"
        );
        assert!(
            !ts.contains("_ent"),
            "coalesced driver must never reference _ent:\n{ts}"
        );

        // Exactly ONE driver (one setInterval loop — both writers author the
        // same cadence, so the coalesced driver takes it verbatim — one
        // runTickFrame call) for the whole shared orbital, not one per writer.
        assert_eq!(
            ts.matches("setInterval(").count(),
            1,
            "expected exactly one coalesced interval driver:\n{ts}"
        );
        assert!(
            ts.contains("}, 16);"),
            "expected the writers' shared cadence:\n{ts}"
        );
        assert_eq!(
            ts.matches("runTickFrame(").count(),
            1,
            "expected exactly one runTickFrame call per shared orbital:\n{ts}"
        );
        assert!(
            ts.contains("runTickFrame(_sharedEntityId, _sharedWritersRef.current, _sharedStore);"),
            "runTickFrame wiring missing:\n{ts}"
        );

        // Never re-emit the merge — no local reimplementation of
        // mergeEntityFrame's field-fold logic anywhere in the driver.
        assert!(
            !ts.contains("mergeEntityFrame"),
            "driver must not call mergeEntityFrame directly — runTickFrame owns it:\n{ts}"
        );
        assert!(
            !ts.contains("useReducer"),
            "coalesced driver must not use useReducer:\n{ts}"
        );
    }

    // ------------------------------------------------------------------
    // C-TICK-CONDITIONAL-EFFECTS-DROPPED: statement-level `if`/`when` tick
    // effects must emit real `if` blocks (and a driver), never vanish.
    // ------------------------------------------------------------------

    #[test]
    fn conditional_tick_effects_emit_if_blocks_and_a_driver() {
        // (if @entity.over (set @entity.hp 0) (set @entity.hp (+ @entity.hp 1)))
        let cond = bind("@entity.over");
        let then_set = OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.hp").unwrap(),
            OirExpr::number(0.0),
        ));
        let else_set = OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.hp").unwrap(),
            OirExpr::add(bind("@entity.hp"), OirExpr::number(1.0)),
        ));
        let if_expr = OirExpr::call("if", vec![cond, then_set, else_set]);

        let mut tick = OirTick::new("step", OirInterval::Milliseconds { value: 150 });
        tick.effects.push(if_expr);

        let mut tr = OirTrait::new("Board");
        tr.linked_entity = Some("Game".to_string());
        tr.ticks.push(tick);

        let mut module = OirModule::new("Cond", "0.1.0");
        module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Game".to_string(),
            description: None,
            collection: "Game".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });

        let backend = TypeScriptBackend::new();
        let ts = backend.generate_tick_effects(&tr, &module);

        assert!(
            ts.contains("setInterval("),
            "conditional tick must still emit a driver:\n{ts}"
        );
        assert!(
            ts.contains("if ("),
            "the `if` must survive as a statement, not be dropped:\n{ts}"
        );
        assert!(
            ts.contains("} else {"),
            "the else branch must be emitted:\n{ts}"
        );
        assert_eq!(
            ts.matches("_ent['hp'] =").count(),
            2,
            "both branches' writes must be emitted:\n{ts}"
        );
        // The batched dispatch lists the field once (de-duplicated).
        assert!(
            ts.contains("updates: { 'hp': _ent['hp'] }"),
            "batched dispatch missing:\n{ts}"
        );
    }

    #[test]
    fn when_tick_effect_emits_guardless_if_block() {
        // (when @entity.alive (set @entity.seen true))
        let when_expr = OirExpr::call(
            "when",
            vec![
                bind("@entity.alive"),
                OirExpr::effect(OirEffect::set(
                    OirBinding::parse("@entity.seen").unwrap(),
                    OirExpr::bool(true),
                )),
            ],
        );

        let mut tick = OirTick::new("step", OirInterval::Milliseconds { value: 100 });
        tick.effects.push(when_expr);

        let mut tr = OirTrait::new("Board");
        tr.linked_entity = Some("Game".to_string());
        tr.ticks.push(tick);

        let mut module = OirModule::new("When", "0.1.0");
        module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Game".to_string(),
            description: None,
            collection: "Game".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });

        let backend = TypeScriptBackend::new();
        let ts = backend.generate_tick_effects(&tr, &module);

        assert!(ts.contains("setInterval("), "driver missing:\n{ts}");
        assert!(ts.contains("_ent['seen'] = true;"), "write missing:\n{ts}");
        assert!(
            !ts.contains("} else {"),
            "`when` must not gain an else branch:\n{ts}"
        );
    }

    // ------------------------------------------------------------------
    // C-TICK-RUNTIME-ENTITY-MIRROR: a [runtime] entity's row is the
    // `fields` mirror — refs seed from it, the guard reads it live.
    // ------------------------------------------------------------------

    fn runtime_board(applies_to: &[&str]) -> (OirTrait, OirModule) {
        let mut tick = OirTick::new("step", OirInterval::Milliseconds { value: 150 });
        tick.applies_to = applies_to.iter().map(|s| s.to_string()).collect();
        tick.effects.push(OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.a").unwrap(),
            OirExpr::add(bind("@entity.a"), OirExpr::number(1.0)),
        )));
        let mut tr = OirTrait::new("Board");
        tr.linked_entity = Some("Game".to_string());
        tr.ticks.push(tick);
        let mut module = OirModule::new("AppliesTo", "0.1.0");
        module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Game".to_string(),
            description: None,
            collection: "Game".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });
        (tr, module)
    }

    #[test]
    fn a_tick_runs_only_in_the_states_it_applies_to() {
        let (tr, module) = runtime_board(&["running", "paused"]);
        let ts = TypeScriptBackend::new().generate_tick_effects(&tr, &module);
        assert!(
            ts.contains(r#"["running", "paused"].includes(_tickStateRef.current)"#),
            "the tick must check the live state against appliesTo:\n{ts}"
        );
    }

    #[test]
    fn control_a_tick_without_applies_to_runs_in_every_state() {
        let (tr, module) = runtime_board(&[]);
        let ts = TypeScriptBackend::new().generate_tick_effects(&tr, &module);
        assert!(
            !ts.contains(".includes(_tickStateRef.current)"),
            "no state gate without appliesTo:\n{ts}"
        );
    }

    #[test]
    fn runtime_tick_reads_the_fields_mirror_not_the_data_collection() {
        let mut tick = OirTick::new("step", OirInterval::Milliseconds { value: 150 });
        tick.guard = Some(OirExpr::not(bind("@entity.over")));
        tick.effects.push(OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.a").unwrap(),
            OirExpr::add(bind("@entity.a"), OirExpr::number(1.0)),
        )));

        let mut tr = OirTrait::new("Board");
        tr.linked_entity = Some("Game".to_string());
        tr.ticks.push(tick);

        let mut module = OirModule::new("Mirror", "0.1.0");
        module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Game".to_string(),
            description: None,
            collection: "Game".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });

        let backend = TypeScriptBackend::new();
        let ts = backend.generate_tick_effects(&tr, &module);

        assert!(
            ts.contains("useRef<EntityRow>({ ...fields })"),
            "tick ref must seed from the fields mirror:\n{ts}"
        );
        assert!(
            !ts.contains("data['Game']"),
            "tick must never read the (unseeded) data collection:\n{ts}"
        );
        assert!(
            ts.contains("_tickEntityRef.current?.over"),
            "guard must read the live ref, not the mount-time fields closure:\n{ts}"
        );
        assert!(
            !ts.contains("if (!fields?.over)"),
            "stale mount-time guard closure must be gone:\n{ts}"
        );
    }

    // ------------------------------------------------------------------
    // Wave C1: the resolver lowers a 3-arg `(if c a b)` to
    // `OirExpr::Conditional` — `emit_tick_effect_block`/`collect_tick_effect`
    // must treat it exactly like the `Call{"if"}` form they already handle.
    // ------------------------------------------------------------------

    #[test]
    fn resolved_conditional_tick_effect_emits_if_else_in_ent_mode() {
        // (if @entity.over (set @entity.hp 0) (set @entity.armor 0))
        let cond = bind("@entity.over");
        let then_set = OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.hp").unwrap(),
            OirExpr::number(0.0),
        ));
        let else_set = OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.armor").unwrap(),
            OirExpr::number(0.0),
        ));
        let conditional = OirExpr::if_then_else(cond, then_set, else_set);

        let mut tick = OirTick::new("step", OirInterval::Milliseconds { value: 150 });
        tick.effects.push(conditional);

        let mut tr = OirTrait::new("Board");
        tr.linked_entity = Some("Game".to_string());
        tr.ticks.push(tick);

        let mut module = OirModule::new("Cond", "0.1.0");
        module.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "Game".to_string(),
            description: None,
            collection: "Game".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });

        let backend = TypeScriptBackend::new();
        let ts = backend.generate_tick_effects(&tr, &module);

        assert!(
            ts.contains("if ("),
            "a resolved Conditional must survive as a statement, not be dropped:\n{ts}"
        );
        assert!(
            ts.contains("} else {"),
            "the else branch must be emitted:\n{ts}"
        );
        assert!(
            ts.contains("_ent['hp'] = 0;"),
            "then-branch write missing:\n{ts}"
        );
        assert!(
            ts.contains("_ent['armor'] = 0;"),
            "else-branch write missing:\n{ts}"
        );
        assert!(
            ts.contains("updates: { 'hp': _ent['hp'], 'armor': _ent['armor'] }"),
            "both branches' fields must land in the batched dispatch:\n{ts}"
        );
    }

    #[test]
    fn resolved_conditional_tick_effect_emits_if_else_in_writes_mode() {
        // Same shape as the Ent-mode test above, but through the [shared]
        // coalesced driver (`TickWrite::Writes`) via `generate_shared_tick_driver`.
        let cond = bind("@entity.over");
        let then_set = OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.a").unwrap(),
            OirExpr::number(1.0),
        ));
        let else_set = OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.b").unwrap(),
            OirExpr::number(2.0),
        ));
        let conditional = OirExpr::if_then_else(cond, then_set, else_set);

        let mut writer_tick = OirTick::new("step", OirInterval::Milliseconds { value: 16 });
        writer_tick.effects.push(conditional);
        let mut writer = OirTrait::new("Writer");
        writer.orbital_name = "Orb".to_string();
        writer.linked_entity = Some("SharedState".to_string());
        writer.states.push(OirState::initial("s"));
        writer.ticks.push(writer_tick);

        let mut render = OirTrait::new("Render");
        render.orbital_name = "Orb".to_string();
        render.linked_entity = Some("SharedState".to_string());
        render.states.push(OirState::initial("s"));
        render
            .transitions
            .push(
                OirTransition::new("s", "s", "INIT").with_effects(vec![OirExpr::effect(
                    OirEffect::RenderUi {
                        slot: "main".to_string(),
                        pattern: OirPattern::new("typography"),
                    },
                )]),
            );

        let mut module = OirModule::new("SharedCond", "1.0.0");
        module.entities.push(OirEntity {
            shared: true,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: "SharedState".to_string(),
            description: None,
            collection: "SharedState".to_string(),
            persistence: OirPersistence::Runtime,
            fields: vec![
                OirField::new("id", OirType::String),
                OirField::new("a", OirType::Number),
                OirField::new("b", OirType::Number),
            ],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });
        module.traits.push(writer);
        module.traits.push(render);

        let backend = TypeScriptBackend::new();
        let render_trait = module.find_trait("Render").unwrap();
        let entity = module.find_entity("SharedState").unwrap();
        let ts = backend.generate_shared_tick_driver(&module, render_trait, entity, true);

        assert!(
            ts.contains("if ("),
            "Writes-mode Conditional must still emit an if:\n{ts}"
        );
        assert!(
            ts.contains("} else {"),
            "else branch must be emitted:\n{ts}"
        );
        assert!(
            ts.contains("writes.push({ field: 'a', value: ((__v) => (isFieldValue(__v) ? __v : undefined))(1) });"),
            "then-branch write missing from the coalesced driver:\n{ts}"
        );
        assert!(
            ts.contains("writes.push({ field: 'b', value: ((__v) => (isFieldValue(__v) ? __v : undefined))(2) });"),
            "else-branch write missing from the coalesced driver:\n{ts}"
        );
    }

    #[test]
    fn collect_tick_effect_detects_a_writer_whose_only_set_is_inside_a_conditional_then_branch() {
        let conditional = OirExpr::if_then_else(
            bind("@entity.over"),
            OirExpr::effect(OirEffect::set(
                OirBinding::parse("@entity.hp").unwrap(),
                OirExpr::number(0.0),
            )),
            OirExpr::null(),
        );

        let mut tick = OirTick::new("step", OirInterval::Milliseconds { value: 150 });
        tick.effects.push(conditional);

        let mut tr = OirTrait::new("Writer");
        tr.orbital_name = "Orb".to_string();
        tr.linked_entity = Some("SharedState".to_string());
        tr.ticks.push(tick);

        let backend = TypeScriptBackend::new();
        assert!(
            backend.trait_tick_writes_entity(&tr),
            "a set reachable only through a Conditional then-branch must still classify the trait as a writer"
        );
    }
}
