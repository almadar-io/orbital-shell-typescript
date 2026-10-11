//! `[shared]`-entity trait hook codegen.
//!
//! `generate_trait_logic_hook` (trait_logic.rs) delegates here for any
//! trait linked to an entity with `OirEntity.shared == true`. Two axes:
//!
//! - **render vs writer** — a **render** trait (has a `render-ui` effect)
//!   additionally owns the shared store's tick driver
//!   (`generate_shared_tick_driver`, tick.rs) and reads the live merged
//!   entity via `useSharedEntitySnapshot`. A **writer** trait's ticks are
//!   coalesced straight into the render trait's driver instead (never
//!   dispatched through its own hook) — unchanged from before.
//! - **dispatch vs no-dispatch** — any trait (writer OR render) that
//!   declares `events`/`transitions` gets REAL dispatch: local
//!   `state`/`lastPayload`/`lastEvent` plus a `dispatch`/`actions` that
//!   resolves the matching transition, evaluates its guard, runs its
//!   effects, and commits the resulting field writes via `mergeEntityFrame`
//!   — always client-side first (the fields mirror IS the `[runtime]` row).
//!   This hook is the route for EVERY `[runtime, shared]` trait; what
//!   happens next follows the trait's `dispatch_mode` (`orbital-core`): a
//!   HybridClientOnly trait (`local`, or no server-bound effect) is client-only (no server round trip, ever — bare emits
//!   are relayed to siblings locally via `emitCascadeEvent`); every other
//!   trait is RuntimeOptimistic — the local commit above is the optimistic
//!   leg, followed by a background `commandPump`-ordered `sendEvent` POST
//!   (server-bound effects such as `call-service` only ever run there)
//!   that reconciles agreement or rolls back on disagreement, with no
//!   local self-relay (the server's `emittedEvents` echo delivers the
//!   cascade instead). A trait with zero transitions gets the original
//!   minimal stub (no reducer, no dispatch) — nothing to dispatch, nothing
//!   changes for that shape.
//!
//! `_sharedStore` is read from `SharedEntityStoreContext`
//! (`useSharedEntityStoreContext`, `@almadar/ui/hooks`) rather than each
//! trait creating its own via `useSharedEntityStore()` — the compiled path
//! generates one hook + component PER TRAIT (unlike the JS runtime path's
//! one-hook-per-orbital `useTraitStateMachine`), so several independent
//! trait hooks bound to the same `[shared]` entity need the SAME store
//! instance. The Provider is wired once per page (`generate_page_component`,
//! pages.rs) around every trait view on that page.
//!
//! Every hook shape keeps the same `{Name}LogicReturn` field surface as the
//! ordinary per-trait hook so `generate_trait_component` (untouched)
//! destructures it unchanged. Every emitted identifier is derived from the
//! .orb source.

use crate::backend::*;

impl TypeScriptBackend {
    /// A trait with transitions that is not HybridClientOnly dispatches to the server.
    pub(crate) fn trait_has_server_leg(
        trait_def: &OirTrait,
        entity: Option<&OirEntity>,
        module: &OirModule,
    ) -> bool {
        !trait_def.transitions.is_empty()
            && trait_def.dispatch_mode(entity, &orbital_core::effects::Residence::of_module(module))
                != OirDispatchMode::HybridClientOnly
    }

    pub(crate) fn compute_app_has_server_leg(&self, module: &OirModule) -> bool {
        module.traits.iter().any(|t| {
            let entity = t
                .linked_entity
                .as_ref()
                .and_then(|name| module.resolve_entity_ref(t.linked_entity_id.as_deref(), name));
            Self::trait_has_server_leg(t, entity, module)
        })
    }

    /// Generate `packages/client/src/hooks/traits/use{TraitName}Logic.tsx`
    /// for a trait linked to a `[shared]` entity. See the module doc for the
    /// render/writer × dispatch/no-dispatch split.
    pub(crate) fn generate_shared_trait_logic_hook(
        &self,
        trait_def: &OirTrait,
        module: &OirModule,
        entity: &OirEntity,
    ) -> InternalFile {
        let name = &trait_def.name;
        let hook_name = format!("use{}Logic", name);
        let file_name = hook_name.clone();

        self.current_linked_entity
            .set(trait_def.linked_entity.clone());
        self.current_linked_entity_id
            .set(trait_def.linked_entity_id.clone());
        self.current_entity_ref_ids
            .set(trait_def.entity_ref_ids.clone());
        self.current_trait_embed_names
            .set(Self::build_trait_embed_names(trait_def, module));
        // See `generate_trait_logic_hook`'s twin doc — needed for the same
        // `compile_callsite_payload_ref` (codegen/expr.rs) reason.
        self.current_trait_scope
            .set(Some(format!("{}.{}", trait_def.orbital_name, name)));
        self.current_event_scope_chain
            .set(Self::build_event_scope_chain(trait_def, module));

        let is_render = self.trait_has_render_ui_effect(trait_def);
        let has_dispatch = !trait_def.transitions.is_empty();
        // The render trait hosts the entity's coalesced tick driver; its writers' emits use the bus.
        let hosts_driver = is_render
            && self.shared_tick_driver_host(module, &trait_def.orbital_name, entity)
                == Some(name.as_str());
        let shared_driver = is_render
            .then(|| self.generate_shared_tick_driver(module, trait_def, entity, hosts_driver));
        let driver_uses_bus = shared_driver
            .as_deref()
            .is_some_and(|d| d.contains("eventBus"));
        // The one dispatch rule (`orbital-core` `dispatch_mode`): no server
        // leg for a HybridClientOnly trait (`local`, or `[runtime]` with no
        // server-bound effect of its own).
        let mode_leg = Self::trait_has_server_leg(trait_def, Some(entity), module);
        // A client-only trait still sends the legs of its browser-leg events.
        let leg_events =
            trait_def.browser_leg_events(&orbital_core::effects::Residence::of_module(module));
        let gated_leg = has_dispatch && !mode_leg && !leg_events.is_empty();
        let server_leg = mode_leg || gated_leg;
        let api_path = to_kebab_case(name);
        let entity_ty = crate::codegen::handler_header::entity_type_ref(&entity.name);

        let mut code = String::new();

        // Header
        code.push_str(&format!("/**\n * {}\n *\n", hook_name));
        if let Some(desc) = &trait_def.description {
            code.push_str(&format!(" * {}\n *\n", desc));
        }
        code.push_str(" * [shared]-entity logic hook.\n");
        code.push_str(" * Reads/writes the shared-entity store instead of a per-trait\n");
        code.push_str(" * reducer — see @almadar/ui/hooks/useSharedEntityStore.\n");
        if has_dispatch {
            if !mode_leg {
                code.push_str(" * Dispatch resolves transitions + effects fully client-side (no\n");
                code.push_str(" * server round trip).\n");
            } else {
                code.push_str(
                    " * Dispatch commits transitions + effects locally first (optimistic),\n",
                );
                code.push_str(" * then reconciles against the server on an ordered background\n");
                code.push_str(" * pump — see `Almadar_LOLO.md` §7 (`local`).\n");
            }
        }
        code.push_str(" *\n");
        code.push_str(" * @generated from schema\n");
        code.push_str(&format!(" * @trait {}\n */\n\n", name));

        // ------------------------------------------------------------
        // Imports
        // ------------------------------------------------------------
        let uses_navigate = has_dispatch && self.trait_has_navigate_effects(trait_def);
        let uses_navstack = has_dispatch && self.trait_has_navstack_effects(trait_def);
        let uses_user = has_dispatch
            && (self.trait_client_effects_use_root(trait_def, &OirBindingRoot::User)
                || self.trait_client_guards_use_root(trait_def, &OirBindingRoot::User));
        let uses_now = crate::codegen::effect::shared::trait_reads_now(trait_def);
        let dispatch_scope = self.dispatch_scope.snapshot();
        let dispatch_arg = if crate::codegen::effect::shared::trait_reads_dispatch_scope(trait_def)
        {
            ", __dispatch"
        } else {
            ""
        };

        let mut react_hooks: Vec<&str> = Vec::new();
        if has_dispatch {
            react_hooks.push("useState");
            react_hooks.push("useCallback");
        }
        if is_render || has_dispatch {
            react_hooks.push("useEffect");
            react_hooks.push("useRef");
        }
        if server_leg {
            // The server leg's ordered pump lane rides `useMemo`, same as
            // T9's `[runtime]` optimistic hook (`trait_logic.rs`).
            react_hooks.push("useMemo");
        }
        if !react_hooks.is_empty() {
            code.push_str(&format!(
                "import {{ {} }} from 'react';\n",
                react_hooks.join(", ")
            ));
        }
        if uses_navigate {
            code.push_str("import { useNavigate } from 'react-router-dom';\n");
        }

        let mut ui_hooks_imports: Vec<&str> = Vec::new();
        if is_render || has_dispatch {
            // Either the tick driver or dispatch (or both) need the
            // page-provided store instance.
            ui_hooks_imports.push("useSharedEntityStoreContext");
        }
        if is_render {
            ui_hooks_imports.push("useSharedEntitySnapshot");
        }
        if hosts_driver {
            ui_hooks_imports.push("runTickFrame");
        }
        if has_dispatch || driver_uses_bus {
            ui_hooks_imports.push("useEventBus");
        }
        if has_dispatch {
            ui_hooks_imports.push("useUIEvents");
        }
        if !trait_def.listeners.is_empty() {
            ui_hooks_imports.push("claimDelivery");
        }
        if uses_navstack {
            ui_hooks_imports.push("useNavStack");
        }
        if !ui_hooks_imports.is_empty() {
            code.push_str(&format!(
                "import {{ {} }} from '@almadar/ui/hooks';\n",
                ui_hooks_imports.join(", ")
            ));
        }
        if dispatch_scope {
            code.push_str("import { dispatchScopeOf, type DispatchScope } from '@almadar/core';\n");
            code.push_str("import { beginDispatch, currentDispatch, withinDispatch, type DispatchVia } from '../dispatchContext';\n");
        }
        if uses_user {
            code.push_str("import { useUser } from '@almadar/ui/context';\n");
        }
        if crate::codegen::effect::shared::trait_uses_messages(trait_def) {
            code.push_str("import { useTranslate } from '@almadar/ui/hooks';\n");
        }
        // §60 — a `[shared]`-entity trait embedded in the render its own
        // trigger produces needs the same hold-until-subscribed helper; a relay
        // target (G-ORB-055) marks itself mounted.
        let mut bridge_names: Vec<&str> = Vec::new();
        if server_leg {
            bridge_names.push("useOrbitalBridge");
        }
        if self.trait_has_racy_listener(trait_def) {
            bridge_names.push("__subscribeListens");
        }
        if self.trait_is_relay_target(trait_def) {
            bridge_names.push("__markTraitMounted");
        }
        if !bridge_names.is_empty() {
            code.push_str(&format!(
                "import {{ {} }} from '@/hooks/useOrbitalBridge';\n",
                bridge_names.join(", ")
            ));
        }

        let mut core_types: std::collections::BTreeSet<&str> = std::collections::BTreeSet::new();
        core_types.insert("EntityRow");
        // Always present (not gated on `has_dispatch`): `GET_NESTED_VALUE_DECL`
        // below — backing `object/get`/`str/template`'s dot-path codegen,
        // reachable from any guard/filter/tick expression regardless of
        // dispatch — needs all three in scope.
        core_types.insert("EventPayload");
        core_types.insert("EventPayloadValue");
        core_types.insert("FieldValue");
        if hosts_driver {
            core_types.insert("EntityFrameState");
            core_types.insert("EntityFieldWrite");
        }
        if has_dispatch {
            core_types.insert("EntityFieldWrite");
        }
        // Listen `with{}`/`when` codegen casts through EventPayload.
        if trait_def
            .listeners
            .iter()
            .any(|l| l.guard.is_some() || l.payload_mapping.is_some())
        {
            core_types.insert("EventPayload");
        }
        // contract/validate-* compiles to the shared @almadar/core helper —
        // the same implementation the JS runtime path calls.
        let uses_validate_contract = self
            .trait_calls_function(trait_def, "contract/validate-output")
            || self.trait_calls_function(trait_def, "contract/validate-input");
        if uses_validate_contract {
            core_types.insert("ContractSpec");
            code.push_str("import { validateContract } from '@almadar/core';\n");
        }
        code.push_str(&self.language_trio_core_import(trait_def));
        code.push_str(&crate::codegen::handler_header::core_imports_clause(
            &core_types,
        ));
        // `getNestedValue` backs `object/get` / `str/template`'s dot-path
        // codegen (`codegen/operator.rs`) — reachable from this hook's
        // guard/filter/tick expressions regardless of `has_dispatch`.
        // Inlined (not imported) per `GET_NESTED_VALUE_DECL`'s doc.
        code.push_str(crate::codegen::handler_header::GET_NESTED_VALUE_DECL);
        if has_dispatch {
            // `mergeEntityFrame` is a VALUE (not a type) — the field-level
            // merge primitive the JS runtime path's CL-FREEZE fix also uses
            // (`useTraitStateMachine.ts`), imported here so the compiled
            // path's commit closes the same async-suspension stale-replace
            // race at the codegen level rather than retrofitting it.
            code.push_str("import { mergeEntityFrame } from '@almadar/core';\n");
        }
        if server_leg {
            // Rides the same ordered-pump module T9's `[runtime]` optimistic
            // hook uses (`trait_logic.rs`) — one owner, no duplicated lane
            // logic.
            code.push_str("import { createCommandSendPump } from '@almadar/ui/lib';\n");
        }
        if !trait_def.listeners.is_empty() {
            code.push_str(&crate::codegen::handler_header::core_imports_clause(
                &["BusEvent"].into_iter().collect(),
            ));
        }
        {
            let mut shared_imports: Vec<String> = Vec::new();
            if has_dispatch {
                shared_imports.push("EventResponse".to_string());
            }
            let mut linked_set: std::collections::BTreeSet<String> =
                std::collections::BTreeSet::new();
            linked_set.insert(entity.name.clone());
            shared_imports
                .push(crate::codegen::handler_header::aliased_shared_imports_clause(&linked_set));
            if has_dispatch && !trait_def.events.is_empty() {
                shared_imports.push(format!("{}EventPayloadMap", name));
            }
            code.push_str(&format!(
                "import type {{ {} }} from '@app/shared';\n",
                shared_imports.join(", ")
            ));
        }
        code.push('\n');

        // ------------------------------------------------------------
        // Config surface — identical to the ordinary per-trait hook.
        // ------------------------------------------------------------
        code.push_str(&self.generate_trait_config_block(trait_def));
        let has_defaults = trait_def
            .declared_config_defaults
            .as_ref()
            .map(|d| !d.is_empty())
            .unwrap_or(false);

        // ------------------------------------------------------------
        // LogicReturn — same field surface as the ordinary hook's
        // `{Name}LogicReturn`. `state`/`lastPayload`/`lastEvent`/`dispatch`/
        // `actions` narrow to real types when `has_dispatch`; otherwise they
        // stay the original static/no-op shape (byte-identical to before).
        // ------------------------------------------------------------
        // §98 — slot vocabulary this trait's transitions ever render into
        // (only meaningful when `has_dispatch`; a no-transition trait can
        // never carry a render-ui effect).
        let slot_ty = format!("{}Slot", name);
        if has_dispatch {
            code.push_str(&self.slot_union_type_decl(trait_def, &slot_ty));
        }

        code.push_str(&format!("export interface {}LogicReturn {{\n", name));
        code.push_str("  state: string;\n");
        code.push_str("  data: Record<string, EntityRow[]>;\n");
        if has_dispatch {
            code.push_str("  lastPayload: EventPayload | undefined;\n");
            code.push_str("  lastEvent: string | null;\n");
            // §98 — per-slot writer the View gates each `<UISlotComponent>`
            // on; same contract as the ordinary per-trait hook's
            // `{Name}InternalState.slotWriter`.
            code.push_str(&format!(
                "  slotWriter: Partial<Record<{}, string | null>>;\n",
                slot_ty
            ));
        } else {
            code.push_str("  lastPayload: undefined;\n");
            code.push_str("  lastEvent: null;\n");
            code.push_str("  slotWriter: Record<string, never>;\n");
        }
        code.push_str("  loading: boolean;\n");
        code.push_str("  pendingEvent: string | null;\n");
        code.push_str("  pendingFrom: string | null;\n");
        code.push_str("  error: string | null;\n");
        code.push_str(&format!("  fields: Partial<{}>;\n", entity_ty));
        code.push_str(&format!(
            "  dispatch: (event: string, payload?: EventPayload) => Promise<{}>;\n",
            if has_dispatch {
                "EventResponse"
            } else {
                "{ success: boolean }"
            }
        ));
        let actions_type = if has_dispatch && !trait_def.events.is_empty() {
            format!(
                "{{ [K in keyof {name}EventPayloadMap]: (payload?: {name}EventPayloadMap[K]) => Promise<EventResponse> }}",
                name = name
            )
        } else {
            "Record<string, never>".to_string()
        };
        code.push_str(&format!("  actions: {};\n", actions_type));
        if uses_now {
            code.push_str("  now: number;\n");
        }
        if has_defaults {
            code.push_str(&format!("  config: {}Config;\n", name));
        } else {
            code.push_str(&format!("  config?: {}Config;\n", name));
        }
        code.push_str("}\n\n");

        let initial_state = trait_def
            .states
            .iter()
            .find(|s| s.is_initial)
            .or_else(|| trait_def.states.first())
            .map(|s| s.name.clone())
            .unwrap_or_default();

        // `Partial` for the same reason as the per-trait hook: every caller
        // passes a subset (pages: `{ entityId }`), and required ⟺ has-default
        // keeps the merge/fall-through complete (C-COMPILED-PATH-RED §25).
        if gated_leg {
            let events: Vec<String> = leg_events.iter().map(|e| format!("'{e}'")).collect();
            code.push_str(&format!(
                "const __LEG_EVENTS: ReadonlySet<string> = new Set([{}]);\n\n",
                events.join(", ")
            ));
        }
        if let Some(writer_fn) = self.render_writer_fn(trait_def) {
            code.push_str(&writer_fn);
        }
        code.push_str(&format!(
            "export function {}(config?: Partial<{}Config>): {}LogicReturn {{\n",
            hook_name, name, name
        ));
        if has_defaults {
            code.push_str(&format!(
                "  const mergedConfig: {}Config = {{ ...DEFAULT_{}_CONFIG, ...(config ?? {{}}) }};\n\n",
                name,
                to_screaming_snake_case(name)
            ));
        } else {
            code.push_str("  const mergedConfig = config;\n\n");
        }

        // ------------------------------------------------------------
        // Shared store + (render-only) tick driver
        // ------------------------------------------------------------
        if is_render {
            // Entity id + coalesced writer driver + the sole rAF/interval
            // loop for this shared orbital (tick.rs owns the wiring; it now
            // reads `_sharedStore` from context too, declared inside).
            if driver_uses_bus && !has_dispatch {
                code.push_str("  const eventBus = useEventBus();\n");
            }
            code.push_str(shared_driver.as_deref().unwrap_or_default());
            code.push_str(
                "  const _sharedSnapshot = useSharedEntitySnapshot(_sharedStore, _sharedEntityId);\n\n",
            );
            // `_sharedSnapshot` is `EntityFrameState` (= the canonical
            // `EntityRow`): directly an `EntityRow[]` element for `data`, and
            // single-`as`-comparable to `Partial<Entity>` for `fields` — the
            // same narrowing the ordinary per-trait hook uses. No `unknown`.
            code.push_str(&format!(
                "  const fields = _sharedSnapshot as Partial<{}>;\n",
                entity_ty
            ));
            code.push_str(&format!(
                "  const data: Record<string, EntityRow[]> = {{ '{}': [_sharedSnapshot] }};\n\n",
                entity.name
            ));
        } else {
            if has_dispatch {
                // Writer trait WITH dispatch: no live subscription (this
                // trait renders nothing, so no re-render is needed on entity
                // change) — dispatch reads a fresh snapshot itself, on
                // demand, at call time. Same store instance the render
                // trait's tick driver uses (via context).
                code.push_str("  const _sharedStore = useSharedEntityStoreContext();\n");
                code.push_str(&format!("  const _sharedEntityId = '{}';\n\n", entity.name));
            }
            // Writer-only trait: no view, no live read — its writes flow
            // through the render trait's tick driver (ticks) and/or its own
            // dispatch (events), never through a `fields`/`data` read here.
            code.push_str(&format!(
                "  const fields = {{}} as Partial<{}>;\n",
                entity_ty
            ));
            code.push_str("  const data: Record<string, EntityRow[]> = {};\n\n");
        }

        if !has_dispatch {
            // No transitions — nothing to dispatch. Original minimal stub,
            // unchanged from before this fix.
            code.push_str("  return {\n");
            code.push_str(&format!("    state: '{}',\n", initial_state));
            code.push_str("    data,\n");
            code.push_str("    lastPayload: undefined,\n");
            code.push_str("    lastEvent: null,\n");
            code.push_str("    slotWriter: {},\n");
            code.push_str("    loading: false,\n");
            code.push_str("    pendingEvent: null,\n");
            code.push_str("    pendingFrom: null,\n");
            code.push_str("    error: null,\n");
            code.push_str("    fields,\n");
            code.push_str("    dispatch: async () => ({ success: true }),\n");
            code.push_str("    actions: {},\n");
            if uses_now {
                code.push_str("    now: Date.now(),\n");
            }
            code.push_str("    config: mergedConfig,\n");
            code.push_str("  };\n");
            code.push_str("}\n");

            return InternalFile::new(
                format!("packages/client/src/hooks/traits/{}.tsx", file_name),
                with_cascade_import(code),
                GeneratedFileType::Hook,
            );
        }

        // ------------------------------------------------------------
        // Real client-only dispatch (has_dispatch = true from here on)
        // ------------------------------------------------------------
        let entity_name = &entity.name;

        code.push_str("  // Local per-trait machine state — NOT the shared entity's fields,\n");
        code.push_str("  // which always live in the shared store (read fresh on every\n");
        code.push_str("  // dispatch, never cached here).\n");
        code.push_str(&format!(
            "  const [machineState, setMachineState] = useState<string>('{}');\n",
            initial_state
        ));
        code.push_str(
            "  const [lastPayload, setLastPayload] = useState<EventPayload | undefined>(undefined);\n",
        );
        code.push_str("  const [lastEvent, setLastEvent] = useState<string | null>(null);\n");
        // §98 — per-slot writer, same contract as the ordinary per-trait
        // hook's `slotWriter`.
        code.push_str(&format!(
            "  const [slotWriter, setSlotWriter] = useState<Partial<Record<{}, string | null>>>({{}});\n",
            slot_ty
        ));
        code.push_str("  const [error, setError] = useState<string | null>(null);\n");
        // Mirrors the ordinary hook's staleness guard: the actor-model queue
        // below can iterate multiple dispatches within one render cycle:
        // reading `machineState` from the React state closure would replay
        // the pre-transition state into the next iteration's guard check.
        code.push_str("  const machineStateRef = useRef(machineState);\n");
        code.push_str("  machineStateRef.current = machineState;\n\n");

        code.push_str("  const eventBus = useEventBus();\n\n");

        if server_leg {
            code.push_str(&format!(
                "  const {{ sendEvent }} = useOrbitalBridge({{ basePath: '/api/{}', orbitalName: '{}', traitName: '{}' }});\n",
                api_path, trait_def.orbital_name, name
            ));
            // Server leg's ordered lane: FIFO, one POST in flight, a
            // rejection neither blocks nor drops later commands.
            code.push_str("  const commandPump = useMemo(() => createCommandSendPump(), []);\n\n");
        }

        code.push_str(
            "  // Actor model: sequential event queue (prevents cross-trait race conditions)\n",
        );
        code.push_str(
            if dispatch_scope {
                "  const eventQueueRef = useRef<Array<{ event: string; payload?: EventPayload; via?: DispatchVia; settle?: () => void }>>([]);\n"
            } else {
                "  const eventQueueRef = useRef<Array<{ event: string; payload?: EventPayload; settle?: () => void }>>([]);\n"
            },
        );
        code.push_str("  const processingRef = useRef(false);\n\n");

        if uses_navigate {
            code.push_str("  const navigate = useNavigate();\n");
        }
        if uses_navstack {
            code.push_str("  const navStack = useNavStack();\n");
        }
        if uses_user {
            code.push_str("  const { user } = useUser();\n");
        }
        if crate::codegen::effect::shared::trait_uses_messages(trait_def) {
            code.push_str("  const { t: __t, locale: __locale } = useTranslate();\n");
        }
        if uses_navigate || uses_navstack || uses_user {
            code.push('\n');
        }
        if uses_now {
            // Render reads the last dispatch's stamp; each dispatch/tick shadows it with its own.
            code.push_str("  const __lastNow = useRef<number>(Date.now());\n  const now = __lastNow.current;\n\n");
        }

        // Transpiled client effects, resolving `newState` client-side either
        // way (the fields mirror IS the `[runtime]` row, so guard + to-state
        // resolve against the same data the server would read) — see
        // `generate_transpiled_effect_handler_impl`'s `resolve_new_state`.
        // `emit_fanout` follows the server leg: a client-only trait has no
        // server echo ever, so bare emits are relayed to siblings' qualified
        // subscriptions locally; a server-leg trait relies on the server's
        // `emittedEvents` echo instead — fan-out here would double-fire
        // every sibling listener.
        code.push_str(
            &self.generate_transpiled_effect_handler_impl(trait_def, module, true, !mode_leg),
        );

        code.push_str("  // Per-transition render-ui presence map (codegen).\n");
        code.push_str(&self.generate_render_ui_lookup(trait_def));

        // Dispatch: resolves the transition + effects client-side (guard
        // context and commit both read/write a FRESH store snapshot at call
        // time, never a render-time closure — the direct codegen mirror of
        // CL-GUARD/CL-FREEZE's JS-runtime fix in `useTraitStateMachine.ts`).
        code.push_str("  /**\n");
        code.push_str("   * Dispatch an event against the shared entity, committing locally\n");
        code.push_str("   * first (the fields mirror IS the `[runtime]` row).\n");
        if server_leg {
            code.push_str("   * RuntimeOptimistic: reconciles against the server on an ordered\n");
            code.push_str("   * background pump — declared dispatch, not effect-derived (see\n");
            code.push_str("   * `Almadar_LOLO.md` §7).\n");
        } else {
            code.push_str("   * No server round trip — this trait declares `local`.\n");
        }
        code.push_str("   */\n");
        code.push_str(
            if dispatch_scope {
                "  const dispatch = useCallback(async (event: string, payload?: EventPayload, __viaIn?: DispatchVia): Promise<EventResponse> => {\n"
            } else {
                "  const dispatch = useCallback(async (event: string, payload?: EventPayload): Promise<EventResponse> => {\n"
            },
        );
        if uses_now {
            code.push_str("    const now = Date.now();\n    __lastNow.current = now;\n");
        }
        code.push_str("    const prevState = machineStateRef.current;\n");
        if dispatch_scope {
            code.push_str("    const __via: DispatchVia = __viaIn ?? { delivery: { event, ...(payload !== undefined ? { payload } : {}), source: {} }, ctx: currentDispatch() ?? beginDispatch() };\n");
            code.push_str(&format!(
                "    const __log = __via.ctx.memory.log('{name}');\n"
            ));
            code.push_str("    const __dispatch: DispatchScope = dispatchScopeOf(__via.delivery, __log, event, payload);\n");
            code.push_str("    if (__via.listenWhen !== undefined && !__via.listenWhen(prevState, __dispatch)) {\n");
            code.push_str("      return { success: true, transitioned: false, states: {}, emittedEvents: [] } as EventResponse;\n");
            code.push_str("    }\n");
            code.push_str(&format!(
                "    __via.ctx.memory.recordDelivery('{name}', __via.delivery);\n"
            ));
            code.push_str("    const __cont = { delivery: __via.delivery, dispatchLog: __log, ctx: __via.ctx };\n");
        }
        if server_leg {
            // Snapshot BEFORE the local commit — sent to the server leg
            // below so it evaluates against the same pre-dispatch frame,
            // and re-read (not reused) to compute the rollback on
            // disagreement.
            code.push_str("    const _snapshot = _sharedStore.getSnapshot(_sharedEntityId);\n");
        }
        code.push_str(&format!(
            "    const liveData: Record<string, EntityRow[]> = {{ '{}': [{}] }};\n",
            entity_name,
            if server_leg {
                "_snapshot"
            } else {
                "_sharedStore.getSnapshot(_sharedEntityId)"
            }
        ));
        let execute =
            format!("executeTransitionEffects(prevState, event, liveData, payload{dispatch_arg})");
        code.push_str(&format!(
            "    const result = {};\n",
            if dispatch_scope {
                format!("withinDispatch(__via.ctx, () => {execute})")
            } else {
                execute
            }
        ));
        code.push_str("    if (result.newState === undefined) {\n");
        code.push_str(
            "      const errorMsg = `No transition defined for ${event} from ${prevState}`;\n",
        );
        code.push_str("      setError(errorMsg);\n");
        code.push_str("      return { success: false, transitioned: false, states: {}, emittedEvents: [], error: errorMsg } as EventResponse;\n");
        code.push_str("    }\n");
        // `result.fields` is `Record<string, EventPayloadValue | undefined>`
        // (the same wide accumulator the ordinary hook's transpiled effects
        // use) — `undefined` entries are filtered before narrowing to
        // `FieldValue` (EntityFieldWrite's value type), since `undefined`
        // isn't a valid FieldValue and mergeEntityFrame's contract is a
        // definite value per write.
        code.push_str("    const writes: EntityFieldWrite[] = Object.entries(result.fields)\n");
        code.push_str("      .filter(([, value]) => value !== undefined)\n");
        code.push_str("      .map(([field, value]) => ({ field, value: value as FieldValue }));\n");
        code.push_str("    if (writes.length > 0) {\n");
        code.push_str(
            "      _sharedStore.commit(_sharedEntityId, mergeEntityFrame(_sharedStore.getSnapshot(_sharedEntityId), writes));\n",
        );
        code.push_str("    }\n");
        if dispatch_scope {
            code.push_str(&format!(
                "    __via.ctx.memory.recordTransition('{name}', prevState, result.newState);\n"
            ));
            code.push_str("    withinDispatch(__via.ctx, () => { for (const _emit of result.emits) _emit(); });\n");
        } else {
            code.push_str("    for (const _emit of result.emits) _emit();\n");
        }
        if server_leg {
            code.push_str(
                "    // Server leg: ordered by the pump, never blocking the drain. The\n",
            );
            code.push_str("    // local commit above is the optimistic leg; this reconciles\n");
            code.push_str(
                "    // agreement or rolls back on disagreement — server-bound effects\n",
            );
            if gated_leg {
                code.push_str("    if (__LEG_EVENTS.has(event)) {\n");
            }
            code.push_str("    // (e.g. call-service) only ever run on this leg.\n");
            code.push_str("    commandPump.enqueue(async () => {\n");
            code.push_str("      try {\n");
            code.push_str(if dispatch_scope {
                "        const response = await sendEvent(event, payload, prevState, _snapshot, __cont);\n"
            } else {
                "        const response = await sendEvent(event, payload, prevState, _snapshot);\n"
            });
            if gated_leg {
                // The browser store runs the leg's own success cascade in
                // process; its echoed emits drive this machine.
                code.push_str("        if (response.success) {\n");
            } else {
                code.push_str(&format!(
                    "        if (response.success && (!response.states?.['{name}'] || response.states?.['{name}'] === result.newState)) {{\n",
                    name = name
                ));
            }
            code.push_str(
                "          // Agreement — merge any fields the server leg's effects wrote\n",
            );
            code.push_str("          // that the local transpile couldn't supply.\n");
            code.push_str(&format!(
                "          if (response.entityByTrait?.['{name}'] && Object.keys(response.entityByTrait['{name}']).length > 0) {{\n",
                name = name
            ));
            code.push_str(&format!(
                "            const _serverWrites: EntityFieldWrite[] = Object.entries(response.entityByTrait['{name}'])\n",
                name = name
            ));
            code.push_str("              .filter(([, value]) => value !== undefined)\n");
            code.push_str(
                "              .map(([field, value]) => ({ field, value: value as FieldValue }));\n",
            );
            code.push_str(
                "            _sharedStore.commit(_sharedEntityId, mergeEntityFrame(_sharedStore.getSnapshot(_sharedEntityId), _serverWrites));\n",
            );
            code.push_str("          }\n");
            code.push_str("        } else {\n");
            code.push_str(
                "          // Rejection or state disagreement — roll back to the pre-dispatch\n",
            );
            code.push_str("          // snapshot; the server stays authoritative.\n");
            code.push_str(
                "          const _rollbackWrites: EntityFieldWrite[] = Object.entries(_snapshot)\n",
            );
            code.push_str("            .filter(([, value]) => value !== undefined)\n");
            code.push_str(
                "            .map(([field, value]) => ({ field, value: value as FieldValue }));\n",
            );
            code.push_str(
                "          _sharedStore.commit(_sharedEntityId, mergeEntityFrame(_sharedStore.getSnapshot(_sharedEntityId), _rollbackWrites));\n",
            );
            code.push_str("          machineStateRef.current = prevState;\n");
            code.push_str("          setMachineState(prevState);\n");
            code.push_str(&format!(
                "          setError(response.error ?? `server state mismatch: expected ${{result.newState}}, got ${{response.states?.['{name}'] ?? '(unchanged)'}}`);\n",
                name = name
            ));
            code.push_str("        }\n");
            code.push_str("      } catch (err) {\n");
            code.push_str(
                "        setError(err instanceof Error ? err.message : 'Network error');\n",
            );
            code.push_str("      }\n");
            code.push_str("    });\n");
            if gated_leg {
                code.push_str("    }\n");
            }
        }
        code.push_str("    machineStateRef.current = result.newState;\n");
        code.push_str("    setMachineState(result.newState);\n");
        code.push_str("    const _renderSlots = getRenderUiSlots(prevState, event);\n");
        code.push_str(
            "    if (_renderSlots.write.length > 0 || _renderSlots.clear.length > 0) {\n",
        );
        code.push_str("      setLastPayload(payload);\n");
        code.push_str("      setLastEvent(event);\n");
        // §98 — stamp each written slot with the firing event, each cleared
        // slot with `null`; slots untouched by this transition keep their
        // prior writer (functional update so this never races the queued
        // dispatches' machineState updates above).
        code.push_str("      setSlotWriter((prev) => ({\n");
        let writer = if self.render_writer_fn(trait_def).is_some() {
            format!("{}RenderWriter(event, result.newState)", trait_def.name)
        } else {
            "event".to_string()
        };
        code.push_str(&format!(
            "        ...prev,\n        ...Object.fromEntries(_renderSlots.write.map((s) => [s, {writer}] as const)),\n        ...Object.fromEntries(_renderSlots.clear.map((s) => [s, null] as const)),\n",
        ));
        code.push_str("      }));\n");
        code.push_str("    }\n");
        code.push_str("    setError(null);\n");
        code.push_str(&format!(
            "    return {{ success: true, transitioned: true, states: {{ '{name}': result.newState }}, emittedEvents: [] }} as EventResponse;\n",
            name = name
        ));
        if server_leg {
            code.push_str(
                "  }, [executeTransitionEffects, getRenderUiSlots, _sharedStore, _sharedEntityId, sendEvent, commandPump]);\n\n",
            );
        } else {
            code.push_str(
                "  }, [executeTransitionEffects, getRenderUiSlots, _sharedStore, _sharedEntityId]);\n\n",
            );
        }

        code.push_str("  // Actor model: drain event queue one at a time\n");
        code.push_str("  const drainQueue = useCallback(async () => {\n");
        code.push_str("    if (processingRef.current) return;\n");
        code.push_str("    processingRef.current = true;\n");
        code.push_str("    try {\n");
        code.push_str("      while (eventQueueRef.current.length > 0) {\n");
        code.push_str("        const entry = eventQueueRef.current.shift()!;\n");
        code.push_str(if dispatch_scope {
            "        try { await dispatch(entry.event, entry.payload, entry.via); } finally { entry.settle?.(); }\n"
        } else {
            "        try { await dispatch(entry.event, entry.payload); } finally { entry.settle?.(); }\n"
        });
        code.push_str("      }\n");
        code.push_str("    } finally {\n");
        code.push_str("      processingRef.current = false;\n");
        code.push_str("    }\n");
        code.push_str("  }, [dispatch]);\n\n");

        code.push_str("  // Actor model: enqueue event and start drain\n");
        code.push_str(if dispatch_scope {
            "  const enqueueEvent = useCallback((event: string, payload?: EventPayload, via?: DispatchVia) => {\n"
        } else {
            "  const enqueueEvent = useCallback((event: string, payload?: EventPayload) => {\n"
        });
        code.push_str(if dispatch_scope {
            "    return new Promise<void>((settle) => {\n    eventQueueRef.current.push({ event, payload, via, settle });\n"
        } else {
            "    return new Promise<void>((settle) => {\n    eventQueueRef.current.push({ event, payload, settle });\n"
        });
        code.push_str("    void drainQueue();\n");
        code.push_str("    });\n");
        code.push_str("  }, [drainQueue]);\n\n");

        // Action creators, event-bridge subscription, auto-init, cross-trait
        // listeners — shared verbatim with the ordinary hook (client.rs).
        code.push_str(&self.generate_actions_block(trait_def, &actions_type));
        code.push_str(&self.generate_ui_events_subscription(trait_def));
        code.push_str(&self.generate_auto_init_effect(trait_def));
        code.push_str(&self.generate_cross_trait_listeners(trait_def, module));

        // See trait_logic.rs::emit_sexpr_default_assignments — this is the
        // `has_dispatch` shared-hook return, where `fields`/`lastPayload`/
        // `data`/`config` are all real declared variables by this point.
        // The OTHER (no-dispatch) return above has no real `lastPayload`
        // (hardcoded `undefined` in its return literal), so it is
        // deliberately NOT covered here — a resolvable s-expr default on a
        // no-dispatch shared trait stays optional/`undefined` rather than
        // risk a reference to an undeclared identifier.
        if has_defaults {
            code.push_str(&self.emit_sexpr_default_assignments(trait_def));
        }

        code.push_str("  return {\n");
        code.push_str("    state: machineState,\n");
        code.push_str("    data,\n");
        code.push_str("    lastPayload,\n");
        code.push_str("    lastEvent,\n");
        code.push_str("    slotWriter,\n");
        code.push_str("    loading: false,\n");
        code.push_str("    pendingEvent: null,\n");
        code.push_str("    pendingFrom: null,\n");
        code.push_str("    error,\n");
        code.push_str("    fields,\n");
        code.push_str("    dispatch,\n");
        code.push_str("    actions,\n");
        if uses_now {
            code.push_str("    now,\n");
        }
        code.push_str("    config: mergedConfig,\n");
        code.push_str("  };\n");
        code.push_str("}\n");

        InternalFile::new(
            format!("packages/client/src/hooks/traits/{}.tsx", file_name),
            with_cascade_import(code),
            GeneratedFileType::Hook,
        )
    }
}

/// A `[shared]` tick writer converts each write with `@almadar/core`'s `isFieldValue`;
/// import it only when the hook body uses it.
fn with_field_value_guard_import(code: String) -> String {
    if !code.contains("isFieldValue(__v)") {
        return code;
    }
    let marker = "from '@almadar/ui/hooks';\n";
    match code.find(marker) {
        Some(pos) => {
            let at = pos + marker.len();
            format!(
                "{}import {{ isFieldValue }} from '@almadar/core';\n{}",
                &code[..at],
                &code[at..]
            )
        }
        None => code,
    }
}

/// A client-only emit publishes through the bridge's shared cascade; import
/// it only when the hook body actually calls it.
fn with_cascade_import(code: String) -> String {
    let code = with_field_value_guard_import(code);
    if !code.contains("emitCascadeEvent(eventBus,") {
        return code;
    }
    let marker = "from '@almadar/ui/hooks';\n";
    match code.find(marker) {
        Some(pos) => {
            let at = pos + marker.len();
            format!(
                "{}import {{ emitCascadeEvent }} from '@/hooks/useOrbitalBridge';\n{}",
                &code[..at],
                &code[at..]
            )
        }
        None => code,
    }
}

#[cfg(test)]
mod dispatch_tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{
        OirBinding, OirEffect, OirEntity, OirExpr, OirField, OirModule, OirPersistence, OirState,
        OirTick, OirTrait, OirTransition, OirType,
    };

    fn bind(s: &str) -> OirExpr {
        OirExpr::binding(OirBinding::parse(s).expect("binding"))
    }

    /// A writer trait (no render-ui) with one guarded transition — the shape
    /// (e.g. `PongMechanic` reacting to `PADDLE_MOVE`) that
    /// `C-SHARED-TRAIT-NO-EVENT-DISPATCH` found completely inert.
    fn module_with_guarded_writer_transition() -> OirModule {
        let transition = OirTransition::new("s", "s", "MOVE")
            .with_guard(OirExpr::eq(bind("@entity.result"), OirExpr::string("none")))
            .with_effects(vec![OirExpr::effect(OirEffect::set(
                OirBinding::parse("@entity.result").unwrap(),
                OirExpr::string("moved"),
            ))]);

        let mut writer = OirTrait::new("Mechanic");
        writer.orbital_name = "Orb".to_string();
        writer.linked_entity = Some("SharedState".to_string());
        writer.states.push(OirState::initial("s"));
        writer.transitions.push(transition);
        writer.events.push(orbital_core::ir::OirEvent::new("MOVE"));
        // Re-scoped to `local` (C2): these fixtures pin the client-only
        // dispatch shape. See `non_local_trait_with_only_set_and_emit_still_gets_server_leg`
        // for the same trait shape WITHOUT `local`.
        writer.local = true;

        let mut module = OirModule::new("Orb", "1.0.0");
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
                OirField::new("result", OirType::String),
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
        module
    }

    #[test]
    fn shared_runtime_hook_publishes_and_imports_the_source_keyed_cascade() {
        let backend = TypeScriptBackend::new();
        let mut module = module_with_guarded_writer_transition();
        let mut panel = OirTrait::new("Panel");
        panel.orbital_name = "Orb".to_string();
        panel.linked_entity = Some("SharedState".to_string());
        panel.states.push(OirState::initial("ready"));
        panel.transitions.push(
            OirTransition::new("ready", "ready", "SUBMIT").with_effects(vec![OirExpr::effect(
                OirEffect::emit_with_payload("SAVE_CREDENTIAL", OirExpr::string("x")),
            )]),
        );
        panel.events.push(orbital_core::ir::OirEvent::new("SUBMIT"));
        // Re-scoped to `local` (C2): pins the client-only shape (no server
        // leg, so this trait's own emit needs the local self-relay).
        panel.local = true;
        module.traits.push(panel.clone());

        let entity = module.entities[0].clone();
        let ts = &backend
            .generate_shared_trait_logic_hook(&panel, &module, &entity)
            .content;
        assert!(
            ts.contains("emitCascadeEvent(eventBus, 'Orb', 'Panel', { event: 'SAVE_CREDENTIAL', payload: "),
            "a [runtime, shared] emit has no server echo, so it must publish the source-qualified cascade itself:\n{ts}"
        );
        assert!(
            ts.contains("import { emitCascadeEvent } from '@/hooks/useOrbitalBridge';"),
            "the hook must import the cascade it calls:\n{ts}"
        );
        assert!(
            !ts.contains("sendEvent"),
            "a `local` trait must never gain the server leg:\n{ts}"
        );
        assert!(
            !ts.contains("commandPump"),
            "a `local` trait must never gain the server leg:\n{ts}"
        );
    }

    #[test]
    fn writer_trait_with_transition_gets_real_dispatch_not_the_old_stub() {
        let backend = TypeScriptBackend::new();
        let module = module_with_guarded_writer_transition();
        let writer = module.find_trait("Mechanic").unwrap().clone();
        let entity = module.find_entity("SharedState").unwrap();
        let file = backend.generate_shared_trait_logic_hook(&writer, &module, entity);
        let ts = &file.content;

        assert!(
            ts.contains("useSharedEntityStoreContext()"),
            "must read the page-provided store, not create its own:\n{ts}"
        );
        assert!(
            ts.contains("fields?.result"),
            "guard must be threaded into the dispatch condition:\n{ts}"
        );
        assert!(
            ts.contains("_newState = 's';"),
            "matched transition must stamp _newState client-side (no server to supply it):\n{ts}"
        );
        assert!(
            !ts.contains("dispatch: async () => ({ success: true }),"),
            "a trait with a real transition must not keep the old hardcoded no-op stub:\n{ts}"
        );
        assert!(
            ts.contains("state: machineState,"),
            "state must come from live local reducer state, not a hardcoded initial value:\n{ts}"
        );
        assert!(
            !ts.contains("sendEvent"),
            "a `local` trait must never gain the server leg:\n{ts}"
        );
        assert!(
            !ts.contains("commandPump"),
            "a `local` trait must never gain the server leg:\n{ts}"
        );
    }

    #[test]
    fn dispatch_commits_via_merge_over_a_freshly_read_snapshot() {
        // The direct codegen mirror of CL-GUARD/CL-FREEZE's JS-runtime fix:
        // both the guard-context read (`liveData`) and the commit re-read the
        // store immediately before use — never a render-time closure — so a
        // same-frame tick write can't be clobbered by a stale dispatch, and a
        // guard can't evaluate against stale entity state.
        let backend = TypeScriptBackend::new();
        let module = module_with_guarded_writer_transition();
        let writer = module.find_trait("Mechanic").unwrap().clone();
        let entity = module.find_entity("SharedState").unwrap();
        let file = backend.generate_shared_trait_logic_hook(&writer, &module, entity);
        let ts = &file.content;

        assert!(
            ts.contains(
                "const liveData: Record<string, EntityRow[]> = { 'SharedState': [_sharedStore.getSnapshot(_sharedEntityId)] };"
            ),
            "dispatch must read a FRESH snapshot for the guard/effect context, not a closure:\n{ts}"
        );
        assert!(
            ts.contains(
                "_sharedStore.commit(_sharedEntityId, mergeEntityFrame(_sharedStore.getSnapshot(_sharedEntityId), writes));"
            ),
            "commit must merge over a freshly-read snapshot, not the one used for guard evaluation:\n{ts}"
        );
        assert!(
            !ts.contains("sendEvent"),
            "a `local` trait must never gain the server leg:\n{ts}"
        );
        assert!(
            !ts.contains("commandPump"),
            "a `local` trait must never gain the server leg:\n{ts}"
        );
    }

    /// std-brick-breaker: a `[shared]` writer tick's `(emit BURST …)` must reach the
    /// `listens { Mechanic.BURST -> BURST }` route, as on the runtime path
    /// (`useClientTicks` emits a writer's emit on the bus). It is deferred until the frame
    /// commits — the same order a transition's emit follows — and its payload is read at
    /// the emit's own position, from the frame being computed.
    #[test]
    fn a_shared_writer_ticks_emit_fires_after_the_frame_commits() {
        let mut tick = OirTick::new("step", orbital_core::ir::OirInterval::Frame);
        tick.effects.push(OirExpr::call(
            "do",
            vec![
                OirExpr::effect(OirEffect::set(
                    OirBinding::parse("@entity.result").unwrap(),
                    OirExpr::string("won"),
                )),
                OirExpr::if_then_else(
                    OirExpr::eq(bind("@entity.result"), OirExpr::string("won")),
                    OirExpr::effect(OirEffect::emit_with_payload(
                        "GAME_END",
                        OirExpr::object(orbital_core::ir::OirFields::from([(
                            "result".to_string(),
                            bind("@entity.result"),
                        )])),
                    )),
                    OirExpr::null(),
                ),
            ],
        ));
        let mut writer = OirTrait::new("Mechanic");
        writer.orbital_name = "Orb".to_string();
        writer.linked_entity = Some("SharedState".to_string());
        writer.states.push(OirState::initial("s"));
        writer.ticks.push(tick);

        let mut module = module_with_guarded_writer_transition();
        module.traits.clear();
        module.traits.push(writer);
        let mut view = OirTrait::new("View");
        view.orbital_name = "Orb".to_string();
        view.linked_entity = Some("SharedState".to_string());
        view.states.push(OirState::initial("s"));
        view.transitions
            .push(
                OirTransition::new("s", "s", "INIT").with_effects(vec![OirExpr::effect(
                    OirEffect::RenderUi {
                        slot: "main".to_string(),
                        pattern: orbital_core::ir::OirPattern::new("typography"),
                    },
                )]),
            );
        view.events.push(orbital_core::ir::OirEvent::new("INIT"));
        view.local = true;
        module.traits.push(view.clone());

        let entity = module.entities[0].clone();
        let ts = &TypeScriptBackend::new()
            .generate_shared_trait_logic_hook(&view, &module, &entity)
            .content;

        assert!(
            !ts.contains("not yet"),
            "a writer's non-set effects must not be dropped:\n{ts}"
        );
        assert!(
            ts.contains(
                "emitCascadeEvent(eventBus, 'Orb', 'Mechanic', { event: 'GAME_END', payload: _p"
            ),
            "the emit must publish the source-qualified key a `listens` route subscribes to:\n{ts}"
        );
        assert!(
            ts.contains("})({ result: frame?.result }));"),
            "the payload reads the frame being computed:\n{ts}"
        );
        // The writer reads the frame as the per-trait tick does (an `EventPayloadValue` view)
        // and converts each write back to the frame's `FieldValue` at the boundary.
        assert!(
            ts.contains("const frame: Record<string, EventPayloadValue | undefined> = scratch;"),
            "{ts}"
        );
        assert!(ts.contains("writes.push({ field: 'result', value: ((__v) => (isFieldValue(__v) ? __v : undefined))(\"won\") });"), "{ts}");
        assert!(
            ts.contains("import { isFieldValue } from '@almadar/core';"),
            "{ts}"
        );
        let commit = ts.find("runTickFrame(_sharedEntityId").expect("driver");
        let flush = ts
            .find("for (const _emit of _sharedTickEmitsRef.current.splice(0)) _emit();")
            .expect("flush");
        assert!(flush > commit, "emits fire after the frame commits:\n{ts}");
        assert!(
            ts.contains("import { emitCascadeEvent } from '@/hooks/useOrbitalBridge';"),
            "{ts}"
        );
    }

    /// Edge: a render trait that renders from its own tick has no dispatch, yet the driver
    /// it hosts now emits — the hook must still declare the bus the emit uses.
    #[test]
    fn a_tick_only_render_trait_hosting_an_emitting_writer_declares_the_bus() {
        let mut writer_tick = OirTick::new("step", orbital_core::ir::OirInterval::Frame);
        writer_tick.effects.push(OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.result").unwrap(),
            OirExpr::string("won"),
        )));
        writer_tick
            .effects
            .push(OirExpr::effect(OirEffect::emit("GAME_END")));
        let mut writer = OirTrait::new("Mechanic");
        writer.orbital_name = "Orb".to_string();
        writer.linked_entity = Some("SharedState".to_string());
        writer.states.push(OirState::initial("s"));
        writer.ticks.push(writer_tick);
        let mut render_tick = OirTick::new("paint", orbital_core::ir::OirInterval::Frame);
        render_tick
            .effects
            .push(OirExpr::effect(OirEffect::RenderUi {
                slot: "main".to_string(),
                pattern: orbital_core::ir::OirPattern::new("typography"),
            }));
        let mut view = OirTrait::new("View");
        view.orbital_name = "Orb".to_string();
        view.linked_entity = Some("SharedState".to_string());
        view.states.push(OirState::initial("s"));
        view.ticks.push(render_tick);

        let mut module = module_with_guarded_writer_transition();
        module.traits.clear();
        module.traits.push(writer);
        module.traits.push(view.clone());
        let entity = module.entities[0].clone();
        let ts = &TypeScriptBackend::new()
            .generate_shared_trait_logic_hook(&view, &module, &entity)
            .content;

        assert!(
            ts.contains("emitCascadeEvent(eventBus, 'Orb', 'Mechanic', { event: 'GAME_END'"),
            "{ts}"
        );
        assert!(
            ts.contains("  const eventBus = useEventBus();"),
            "the bus the emit uses must be declared:\n{ts}"
        );
        assert!(ts.contains("useEventBus"), "{ts}");
    }

    #[test]
    fn writer_trait_without_transitions_keeps_the_original_minimal_stub() {
        // A pure-tick writer (no events/transitions at all) has nothing to
        // dispatch — must stay byte-identical to before this fix: no store
        // access of its own, no dispatch machinery, the original no-op stub.
        let mut tick = OirTick::new(
            "step",
            orbital_core::ir::OirInterval::Milliseconds { value: 16 },
        );
        tick.effects.push(OirExpr::effect(OirEffect::set(
            OirBinding::parse("@entity.result").unwrap(),
            OirExpr::string("moved"),
        )));

        let mut writer = OirTrait::new("Mechanic");
        writer.orbital_name = "Orb".to_string();
        writer.linked_entity = Some("SharedState".to_string());
        writer.states.push(OirState::initial("s"));
        writer.ticks.push(tick);

        let mut module = OirModule::new("Orb", "1.0.0");
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
                OirField::new("result", OirType::String),
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
        module.traits.push(writer.clone());

        let backend = TypeScriptBackend::new();
        let entity = module.find_entity("SharedState").unwrap();
        let file = backend.generate_shared_trait_logic_hook(&writer, &module, entity);
        let ts = &file.content;

        assert!(
            ts.contains("dispatch: async () => ({ success: true }),"),
            "no-transition writer must keep the original no-op stub:\n{ts}"
        );
        assert!(
            !ts.contains("useSharedEntityStoreContext"),
            "no-transition writer must not touch the shared store at all:\n{ts}"
        );
        assert!(
            !ts.contains("useCallback"),
            "no-transition writer must emit no dispatch machinery:\n{ts}"
        );
        assert!(
            !ts.contains("sendEvent"),
            "no-transition writer has nothing to dispatch, let alone a server leg:\n{ts}"
        );
        assert!(
            !ts.contains("commandPump"),
            "no-transition writer has nothing to dispatch, let alone a server leg:\n{ts}"
        );
    }

    /// A non-`local` `[runtime, shared]` trait with a server-bound
    /// `call-service` effect: RuntimeOptimistic, so the server leg fires.
    fn caller_trait_with_call_service() -> (OirModule, OirTrait) {
        let transition = OirTransition::new("s", "s", "TRIGGER").with_effects(vec![
            OirExpr::effect(OirEffect::call_service(
                "billing",
                "charge",
                OirExpr::string("{}"),
            )),
            OirExpr::effect(OirEffect::emit_with_payload(
                "CHARGED",
                OirExpr::string("x"),
            )),
        ]);

        let mut caller = OirTrait::new("Caller");
        caller.orbital_name = "Orb".to_string();
        caller.linked_entity = Some("SharedState".to_string());
        caller.states.push(OirState::initial("s"));
        caller.transitions.push(transition);
        caller
            .events
            .push(orbital_core::ir::OirEvent::new("TRIGGER"));

        let mut module = OirModule::new("Orb", "1.0.0");
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
                OirField::new("result", OirType::String),
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
        module.traits.push(caller.clone());
        (module, caller)
    }

    #[test]
    fn non_local_shared_trait_with_call_service_gets_server_leg() {
        let backend = TypeScriptBackend::new();
        let (module, caller) = caller_trait_with_call_service();
        let entity = module.find_entity("SharedState").unwrap();
        let ts = &backend
            .generate_shared_trait_logic_hook(&caller, &module, entity)
            .content;

        for marker in [
            "import { createCommandSendPump } from '@almadar/ui/lib';",
            "import { useOrbitalBridge } from '@/hooks/useOrbitalBridge';",
            "const commandPump = useMemo(() => createCommandSendPump(), []);",
            "commandPump.enqueue(async () => {",
            "const response = await sendEvent(event, payload, prevState, _snapshot);",
        ] {
            assert!(
                ts.contains(marker),
                "missing server-leg marker {marker:?}:\n{ts}"
            );
        }
        assert!(
            ts.contains(
                "_sharedStore.commit(_sharedEntityId, mergeEntityFrame(_sharedStore.getSnapshot(_sharedEntityId), _rollbackWrites));"
            ),
            "disagreement must roll back the shared store to the pre-dispatch snapshot:\n{ts}"
        );
        assert!(
            !ts.contains("emitCascadeEvent(eventBus,"),
            "a server-leg trait relies on the server's emittedEvents echo, not a local self-relay for its own emits:\n{ts}"
        );
        assert!(
            ts.contains(
                "_sharedStore.commit(_sharedEntityId, mergeEntityFrame(_sharedStore.getSnapshot(_sharedEntityId), writes));"
            ),
            "the synchronous local commit must still run before the server leg is enqueued:\n{ts}"
        );
    }

    #[test]
    fn same_trait_marked_local_keeps_client_only_shape() {
        let backend = TypeScriptBackend::new();
        let (module, mut caller) = caller_trait_with_call_service();
        caller.local = true;
        let entity = module.find_entity("SharedState").unwrap();
        let ts = &backend
            .generate_shared_trait_logic_hook(&caller, &module, entity)
            .content;

        for absent in [
            "createCommandSendPump",
            "import { useOrbitalBridge }",
            "commandPump",
            "sendEvent(",
        ] {
            assert!(
                !ts.contains(absent),
                "a `local` trait keeps today's client-only shape regardless of its \
                 own effects — codegen never validates, that's ORB_T_LOCAL_TRAIT_TOUCHES_SERVER's \
                 job: {absent:?}\n{ts}"
            );
        }
        assert!(
            ts.contains(
                "_sharedStore.commit(_sharedEntityId, mergeEntityFrame(_sharedStore.getSnapshot(_sharedEntityId), writes));"
            ),
            "the local commit is unaffected by `local`:\n{ts}"
        );
    }

    #[test]
    fn runtime_trait_whose_effects_stay_in_the_client_gets_no_server_leg() {
        // Dispatch follows `dispatch_mode` (owner ruling 2026-09-24): a
        // `[runtime]` trait whose own effects never reach the server is
        // HybridClientOnly even without `local`. A POST here 404s on a static
        // host and rolls back every local commit. Control:
        // `non_local_shared_trait_with_call_service_gets_server_leg`.
        let backend = TypeScriptBackend::new();
        let module = module_with_guarded_writer_transition();
        let mut writer = module.find_trait("Mechanic").unwrap().clone();
        writer.local = false;
        let entity = module.find_entity("SharedState").unwrap();
        let ts = &backend
            .generate_shared_trait_logic_hook(&writer, &module, entity)
            .content;

        for absent in [
            "createCommandSendPump",
            "import { useOrbitalBridge }",
            "commandPump",
            "sendEvent(",
        ] {
            assert!(
                !ts.contains(absent),
                "unexpected server-leg marker {absent:?}:\n{ts}"
            );
        }
        assert!(
            ts.contains(
                "_sharedStore.commit(_sharedEntityId, mergeEntityFrame(_sharedStore.getSnapshot(_sharedEntityId), writes));"
            ),
            "the local commit still runs:\n{ts}"
        );
    }

    #[test]
    fn an_app_with_no_server_leg_opens_no_event_stream() {
        // SSE carries server broadcasts; an app whose every trait is
        // client-only has no server, so a static host 404s on the stream.
        let backend = TypeScriptBackend::new();
        let mut module = module_with_guarded_writer_transition();
        module.traits.iter_mut().for_each(|t| t.local = false);
        assert!(!backend.compute_app_has_server_leg(&module));
        backend
            .app_has_server_leg
            .set(backend.compute_app_has_server_leg(&module));
        let bridge = backend.generate_orbital_bridge_hook().content;
        for absent in [
            "new EventSource(",
            "_openSseOnce();",
            "_sseSubscribers += 1;",
        ] {
            assert!(
                !bridge.contains(absent),
                "unexpected SSE marker {absent:?}:\n{bridge}"
            );
        }
    }

    #[test]
    fn an_app_with_a_server_leg_keeps_its_event_stream() {
        let backend = TypeScriptBackend::new();
        let (module, _) = caller_trait_with_call_service();
        assert!(backend.compute_app_has_server_leg(&module));
        backend
            .app_has_server_leg
            .set(backend.compute_app_has_server_leg(&module));
        let bridge = backend.generate_orbital_bridge_hook().content;
        for marker in [
            "new EventSource(",
            "_openSseOnce();",
            "_sseSubscribers += 1;",
        ] {
            assert!(
                bridge.contains(marker),
                "missing SSE marker {marker:?}:\n{bridge}"
            );
        }
    }

    #[test]
    fn a_client_only_shared_trait_sends_legs_for_its_browser_events_only() {
        let backend = TypeScriptBackend::new();
        let mut module = module_with_guarded_writer_transition();
        let mut ledger = module.find_entity("SharedState").unwrap().clone();
        ledger.name = "Ledger".to_string();
        ledger.collection = "ledgers".to_string();
        ledger.shared = false;
        ledger.local = true;
        ledger.persistence = OirPersistence::Persistent;
        module.entities.push(ledger);
        let mut writer = module.find_trait("Mechanic").unwrap().clone();
        writer.local = false;
        writer
            .transitions
            .push(
                OirTransition::new("s", "s", "SAVE").with_effects(vec![OirExpr::effect(
                    OirEffect::create("Ledger", OirExpr::Null),
                )]),
            );
        let entity = module.find_entity("SharedState").unwrap();
        let ts = &backend
            .generate_shared_trait_logic_hook(&writer, &module, entity)
            .content;
        for marker in [
            "const __LEG_EVENTS: ReadonlySet<string> = new Set(['SAVE']);",
            "    if (__LEG_EVENTS.has(event)) {",
            "commandPump.enqueue(async () => {",
        ] {
            assert!(ts.contains(marker), "missing {marker:?}:\n{ts}");
        }
    }
}
