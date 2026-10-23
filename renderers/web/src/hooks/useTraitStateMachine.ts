/**
 * useTraitStateMachine — W5b thin React adapter (docs/Almadar_Runtime_Stateless_Stateful_PLAN.md §5.1).
 *
 * The client's copy of "play this event against this orbital" no longer
 * lives here. It is the Rust client-role kernel (`@almadar/kernel`, through
 * `lib/kernel-client.ts`). This hook is a composer over the single-purpose
 * adapters in `hooks/circuit/`:
 *
 * - `useCircuitKernel`  — the store + trait index + client kernel
 * - `useBusIngress`     — bus key → `dispatchAndSettle`
 * - `useSlotFlush`      — kernel outcome client effects → UI slots
 * - `useClientTicks`    — ticks while the client holds state
 * - `useEntityBindingSource` — the render-time binding surface
 *
 * `commitServerEntity`/`applyServerStates` are GONE from the public return:
 * they existed only to patch around the old two-bus-hop echo problem
 * (G-RUNTIME-022/026 fixes) — `postServerLeg`/`applyOrbitalEventResponse`
 * fold the server's response in-process, with no bus round-trip to patch
 * around. `OrbPreview` (their only caller) no longer needs them.
 *
 * @packageDocumentation
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type {
  EntityRow,
  EventPayload,
  MountSeed,
  OrbitalDefinition,
  ResolvedTraitBinding,
  ServiceParams,
  UserContext,
} from '@almadar/core';
import { TraitMountError } from '@almadar/shell-runtime/client/trait-mount-error';
import { type EventTransport } from '../index';
import { collectListenerTargets } from '../runtime';
import type { ClientKernelOutcome, TraitState } from '../index';
import { createLogger } from '@almadar/logger';
import { useEventBus } from '../core';
import { useUser } from '../providers/UserContext';
import { useTranslate } from '../core';
import { useKernelEngine } from '../providers/KernelEngineContext';
import type { EntityBindingSource } from '../providers/EntityBindingContext';
import type { AwaitingSkeletonSource } from '../providers/AwaitingSkeletonContext';
import { ALL_SLOTS } from './useUISlots';
import { registerTrait, unregisterTrait, type TraitDebugInfo } from '../lib/traitRegistry';
import { bindTraitStateGetter, registerTraitSnapshot } from '../lib/verificationRegistry';
import { createCircuitVerificationObserver, recordDispatchVerdict } from '../lib/circuitVerificationObserver';
import { hostDispatchInView } from '../lib/hostDispatchInView';
import { LIFECYCLE_EVENTS, normalizeEventKey, TRAIT_MOUNT_ERROR_TESTID, configReferencesCallsitePayload, traitReferencesCallsitePayload, type TraitStateSnapshot, type PersistenceAdapter, type TransitionRejection } from '@almadar/core';
import type { useUISlots } from '../providers/UISlotContext';
import { getTabClientId, useCircuitKernel } from './circuit/useCircuitKernel';
import { useBusIngress } from './circuit/useBusIngress';
import { useSlotFlush, type SlotCheckpoint } from './circuit/useSlotFlush';
import { useClientTicks } from './circuit/useClientTicks';
import { useEntityBindingSource } from './circuit/useEntityBindingSource';
import { useAwaitingSkeletonSource } from './circuit/useAwaitingSkeletonSource';

/** The slot source a failed lifecycle step's error renders under, cleared on the next mount. */
const MOUNT_ERROR_SOURCE = '$mount';

const stateLog = createLogger('almadar:ui:state-transitions');

/** Trait names present in `prev` but absent from `next` — used to clear a
 *  dropped trait's stale slot content on page nav (unchanged pure helper,
 *  see `trait-binding-slot-cleanup.test.ts`). */
export function diffDroppedTraitNames(
  prev: ReadonlySet<string>,
  next: ReadonlySet<string>,
): string[] {
  const dropped: string[] = [];
  for (const name of prev) {
    if (!next.has(name)) dropped.push(name);
  }
  return dropped;
}

export interface TraitStateMachineResult {
  /** Current state for each trait. */
  traitStates: Map<string, TraitState>;
  /** Send an event — broadcasts to every currently-mounted trait that can
   *  handle it, decomposed into one targeted `kernel.dispatch` per trait
   *  (the client role requires exactly one seed trait per call). */
  sendEvent: (eventKey: string, payload?: EventPayload) => void;
  getTraitState: (traitName: string) => TraitState | undefined;
  canHandleEvent: (traitName: string, eventKey: string) => boolean;
  /** Live per-trait binding surface for `EntityBindingContext`. */
  entityBindingSource: EntityBindingSource;
  /** Awaiting-server skeletons for `AwaitingSkeletonContext`. */
  awaitingSkeletonSource: AwaitingSkeletonSource;
}

export interface UseTraitStateMachineOptions {
  onEventProcessed?: (eventKey: string, payload?: EventPayload) => void;
  navigate?: (path: string, params?: Record<string, string>, crumb?: string) => void;
  navigateBack?: () => void;
  initPayload?: EventPayload;
  /** The mounted page's identity; with `initPayload` it keys the once-per-mount lifecycle guard (Runtime Spec Clause 4.1). */
  mountKey?: string;
  /** The resolved schema's full orbital set — `buildTraitIndex`'s one input. */
  orbitals: readonly OrbitalDefinition[];
  /** Caller-owned transport (server bridge). Omitted + `persistence` set =
   *  offline preview (plan G7); omitted + no `persistence` = fully local,
   *  nothing ever posts. */
  transport?: EventTransport;
  carriesCircuitState?: boolean;
  /** Hold every dispatch until the transport's topology is known. */
  awaitTopology?: boolean;
  persistence?: PersistenceAdapter;
  /** The browser store for `[persistent: x, local]` entities (see `useCircuitKernel`). */
  browserStore?: PersistenceAdapter;
  callService?: (service: string, action: string, params?: ServiceParams) => Promise<EventPayload>;
  embeddedTraits?: ReadonlySet<string>;
  callsiteCaptureChildrenByTrait?: ReadonlyMap<string, ReadonlySet<string>>;
  debug?: boolean;
  logContext?: { behavior?: string; orbitalName?: string };
  /** Explicit viewer override (e.g. a persona switcher's picked identity
   *  threaded down as a prop rather than through `UserContext`). Wins over
   *  `useUser()`'s context value when supplied. */
  user?: UserContext;
}

export function useTraitStateMachine(
  traitBindings: ResolvedTraitBinding[],
  uiSlots: ReturnType<typeof useUISlots>,
  options: UseTraitStateMachineOptions,
): TraitStateMachineResult {
  const eventBus = useEventBus();
  const { user: contextViewer } = useUser();
  const { t } = useTranslate();
  const userContext = (options.user ?? contextViewer ?? undefined) as UserContext | undefined;

  const observer = useMemo(() => createCircuitVerificationObserver(), []);

  const engine = useKernelEngine();
  const { kernel, store, traitIndex, appTraitNames, transport, engine: kernelClient } = useCircuitKernel(traitBindings, {
    orbitals: options.orbitals,
    engine,
    ...(options.transport !== undefined ? { transport: options.transport } : {}),
    ...(options.carriesCircuitState !== undefined ? { carriesCircuitState: options.carriesCircuitState } : {}),
    ...(options.awaitTopology !== undefined ? { awaitTopology: options.awaitTopology } : {}),
    ...(options.persistence !== undefined ? { persistence: options.persistence } : {}),
    ...(options.browserStore !== undefined ? { browserStore: options.browserStore } : {}),
    ...(options.callService !== undefined ? { callService: options.callService } : {}),
    ...(userContext !== undefined ? { user: userContext } : {}),
    ...(options.debug !== undefined ? { debug: options.debug } : {}),
    ...(options.logContext !== undefined ? { logContext: options.logContext } : {}),
    observer,
  });

  const slotFlush = useSlotFlush(uiSlots, options.embeddedTraits);


  const entityBindingSource = useEntityBindingSource(store, traitIndex, kernelClient);
  const awaitingSkeletonSource = useAwaitingSkeletonSource(store, traitIndex, options.embeddedTraits);

  // Traits mounted on THIS page (`useSlotFlush.applyClientEffects`'s
  // off-page filter, Gap #11). Ref-backed so a late-settling dispatch is
  // judged against whichever page is ACTUALLY active when its response
  // lands (same reasoning `OrbPreview`'s own `activeTraitNamesRef` used to
  // apply, now generalized here since the composer owns every dispatch).
  const activeTraitNamesRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    activeTraitNamesRef.current = new Set(traitIndex.byName.keys());
  }, [traitIndex]);

  // Register/unregister the per-trait debug registry + verification
  // snapshot getters on every bindings change (page nav) — unchanged in
  // intent from the pre-adapter hook, now reading `store.states` instead
  // of a hook-local manager ref.
  useEffect(() => {
    const ids: string[] = [];
    for (const binding of traitBindings) {
      const trait = binding.trait;
      const state = store.states.getState(trait.name);
      const info: TraitDebugInfo = {
        id: trait.name,
        name: trait.name,
        currentState: state?.currentState ?? trait.states[0]?.name ?? 'unknown',
        states: trait.states.map((s: { name: string }) => s.name),
        transitions: trait.transitions.flatMap((t) => {
          const froms = Array.isArray(t.from) ? t.from : [t.from];
          return froms.map((f) => ({ from: f, to: t.to, event: t.event, guard: t.guard ? String(t.guard) : undefined }));
        }),
        guards: trait.transitions.filter((t) => t.guard).map((t) => ({ name: String(t.guard) })),
        transitionCount: 0,
      };
      registerTrait(info);
      ids.push(trait.name);
    }
    bindTraitStateGetter((traitName) => store.states.getState(traitName)?.currentState);
    // The trait's live frame under its entity's name — what a verifier reads to
    // see the entity the trait holds (riya: the body's seeded skateCurve).
    const snapshotData = (traitName: string): Record<string, EntityRow[]> => {
      const entry = traitIndex.byName.get(traitName);
      const frame = entry !== undefined ? store.frames.get(entry.frameKey) : undefined;
      const entityName = entry?.entity.name;
      return frame !== undefined && entityName !== undefined ? { [entityName]: [{ ...frame }] } : {};
    };
    const snapshotUnregs = traitBindings.map((binding) => registerTraitSnapshot(binding.trait.name, (): TraitStateSnapshot => {
      const currentState = store.states.getState(binding.trait.name)?.currentState ?? binding.trait.states[0]?.name ?? 'unknown';
      return {
        traitName: binding.trait.name,
        currentState,
        states: binding.trait.states.map((s) => s.name),
        events: binding.trait.events.map((e) => e.key),
        data: snapshotData(binding.trait.name),
        cascadeReceived: [],
      };
    }));
    return () => {
      for (const id of ids) unregisterTrait(id);
      for (const unreg of snapshotUnregs) unreg();
    };
  }, [traitBindings, store, traitIndex]);

  // The kernel's response already carries a composing transition's callsite-capture repaints (EXEC-RENDER-8).
  const afterSettle = useCallback(async (eventKey: string, payload: EventPayload | undefined): Promise<void> => {
    options.onEventProcessed?.(eventKey, payload);
  }, [options.onEventProcessed]);

  // Paint a kernel outcome's settled effects and republish its emits — every dispatch lane ends here.
  const settleOutcome = useCallback(async (
    traitName: string,
    eventKey: string,
    payload: EventPayload | undefined,
    outcome: ClientKernelOutcome,
  ): Promise<void> => {
    recordDispatchVerdict(traitIndex.byName.get(traitName)?.orbitalName ?? traitName, eventKey, { response: outcome.response });
    const settledEffects = outcome.localPainted && outcome.serverEffects !== undefined ? outcome.serverEffects : outcome.response;
    slotFlush.applyClientEffects(
      settledEffects.clientEffects ?? [],
      settledEffects.clientEffectsByTrait,
      options.navigate,
      options.navigateBack,
      activeTraitNamesRef.current,
    );
    // A tick lane posts without blocking the drain; what its fold adds (a
    // refetch's render) paints when the post lands.
    void outcome.tickSettled?.then((later) => {
      if (later === undefined) return;
      slotFlush.applyClientEffects(later.clientEffects ?? [], later.clientEffectsByTrait, options.navigate, options.navigateBack, activeTraitNamesRef.current);
    });
    // The kernel already delivered these to its own listeners; republish for
    // bus subscribers outside it (providers, components, other hook instances).
    for (const emitted of outcome.response.emittedEvents) {
      eventBus.emit(`UI:${emitted.event}`, emitted.payload, { ...(emitted.source ?? {}), dispatched: true });
    }
    stateLog.debug('dispatch:settled', { traitName, eventKey, mode: outcome.mode, transitioned: outcome.response.transitioned });
    await afterSettle(eventKey, payload);
  }, [slotFlush, traitIndex, eventBus, options.navigate, options.navigateBack, afterSettle]);

  const dispatchAndSettle = useCallback(async (traitName: string, eventKey: string, payload: EventPayload | undefined): Promise<void> => {
    const entityId = typeof payload?.entityId === 'string' ? payload.entityId : undefined;
    const orbitalName = traitIndex.byName.get(traitName)?.orbitalName ?? traitName;
    let outcome: Awaited<ReturnType<typeof kernel.dispatch>>;
    // Paint local first: the transition's own render-ui (its loading
    // skeleton) paints the moment the local arm runs, not after the server
    // round trip; a failed leg rolls the slots back with the state.
    let beforeLocalPaint: SlotCheckpoint | undefined;
    try {
      outcome = await kernel.dispatch({
        event: eventKey,
        ...(payload !== undefined ? { payload } : {}),
        ...(entityId !== undefined ? { entityId } : {}),
        targetTrait: traitName,
      }, {
        onLocal: (local) => {
          beforeLocalPaint = slotFlush.checkpoint();
          slotFlush.applyClientEffects(
            local.clientEffects ?? [],
            local.clientEffectsByTrait,
            options.navigate,
            options.navigateBack,
            activeTraitNamesRef.current,
          );
        },
      });
    } catch (err: unknown) {
      if (beforeLocalPaint !== undefined) slotFlush.rollback(beforeLocalPaint);
      recordDispatchVerdict(orbitalName, eventKey, { error: err instanceof Error ? err : String(err) });
      throw err;
    }
    if (outcome.localPainted && !outcome.response.success && beforeLocalPaint !== undefined) {
      slotFlush.rollback(beforeLocalPaint);
    }
    await settleOutcome(traitName, eventKey, payload, outcome);
  }, [kernel, slotFlush, traitIndex, store, options.navigate, options.navigateBack, settleOutcome]);

  // One kernel frame's outcomes: the head is the frame's merged response, each following one a tick's
  // listener cascade (its server legs settle on their own and paint when they land).
  const settleFrame = useCallback((outcomes: ClientKernelOutcome[]): void => {
    for (const outcome of outcomes) {
      slotFlush.applyClientEffects(outcome.response.clientEffects ?? [], outcome.response.clientEffectsByTrait, options.navigate, options.navigateBack, activeTraitNamesRef.current);
      for (const emitted of outcome.response.emittedEvents) {
        eventBus.emit(`UI:${emitted.event}`, emitted.payload, { ...(emitted.source ?? {}), dispatched: true });
      }
      void outcome.tickSettled?.then((later) => {
        if (later === undefined) return;
        slotFlush.applyClientEffects(later.clientEffects ?? [], later.clientEffectsByTrait, options.navigate, options.navigateBack, activeTraitNamesRef.current);
      });
    }
  }, [slotFlush, eventBus, options.navigate, options.navigateBack]);

  useClientTicks({
    kernelClient,
    onKernelFrame: settleFrame,
    ...(engine?.scheduleFrame !== undefined ? { scheduleFrame: engine.scheduleFrame } : {}),
    hostRunsProgram: transport?.hostsBrowserStore === true,
  });

  // A live message of this tab's own running call: the progress lane, outside
  // the FIFO that is still waiting on that call.
  const progressAndSettle = useCallback(async (traitName: string, eventKey: string, payload: EventPayload | undefined): Promise<void> => {
    const entityId = typeof payload?.entityId === 'string' ? payload.entityId : undefined;
    const outcome = await kernel.dispatchProgress({
      event: eventKey,
      ...(payload !== undefined ? { payload } : {}),
      ...(entityId !== undefined ? { entityId } : {}),
      targetTrait: traitName,
    });
    await settleOutcome(traitName, eventKey, payload, outcome);
  }, [kernel, store, settleOutcome]);

  // Server-pushed events (Almadar_Live_Push.md) reach their listeners through
  // the same settle as a bus-entered dispatch, so they repaint.
  useEffect(() => {
    if (!transport?.subscribe) return;
    return transport.subscribe((emitted, target) => {
      const listeners = collectListenerTargets(traitIndex, emitted.source, emitted.event, emitted.payload);
      if (target !== 'origin') {
        for (const t of listeners) void dispatchAndSettle(t.listenerTrait, t.triggers, t.payload);
        return;
      }
      // A call-service `onMessage` event is the calling trait's own (like `success`): it runs
      // there, and on any trait that listens to it.
      const caller = emitted.source?.trait;
      if (caller !== undefined && traitIndex.byName.has(caller) && !listeners.some((t) => t.listenerTrait === caller && t.triggers === emitted.event)) {
        void progressAndSettle(caller, emitted.event, emitted.payload);
      }
      for (const t of listeners) void progressAndSettle(t.listenerTrait, t.triggers, t.payload);
    }, { clientId: getTabClientId() });
  }, [transport, traitIndex, progressAndSettle, dispatchAndSettle]);

  // A dispatch the host ran on its own (a declared input) shows here as the host's result; it never
  // runs again in this view.
  useEffect(() => {
    if (!transport?.subscribeHostDispatches) return;
    return transport.subscribeHostDispatches((_orbitalName, request, response) => {
      const traitName = request.targetTrait;
      if (traitName === undefined || !hostDispatchInView(request, response, (t) => traitIndex.byName.has(t))) return;
      void kernel.foldHostDispatch(request, response).then((outcome) =>
        settleOutcome(traitName, request.event, request.payload, outcome));
    }, { clientId: getTabClientId() });
  }, [transport, traitIndex, kernel, store, settleOutcome]);


  // Mount in one round trip: every entering trait's lifecycle arm runs and
  // paints at once, then one mount leg is posted and folded.
  // Resolves with the first seed whose lifecycle arm failed (a contained `effect-failed`), so the
  // mount site can name it on the card the same way as a thrown mount error.
  const mountAndSettle = useCallback(async (seeds: MountSeed[], payload: EventPayload): Promise<TransitionRejection | undefined> => {
    let beforeLocalPaint: SlotCheckpoint | undefined;
    let outcome: Awaited<ReturnType<typeof kernel.dispatchMount>>;
    try {
      outcome = await kernel.dispatchMount(seeds, {
        onLocal: (_trait, local) => {
          if (beforeLocalPaint === undefined) beforeLocalPaint = slotFlush.checkpoint();
          slotFlush.applyClientEffects(local.clientEffects ?? [], local.clientEffectsByTrait, options.navigate, options.navigateBack, activeTraitNamesRef.current);
        },
      }, { payload });
    } catch (err: unknown) {
      if (beforeLocalPaint !== undefined) slotFlush.rollback(beforeLocalPaint);
      for (const seed of seeds) {
        recordDispatchVerdict(traitIndex.byName.get(seed.trait)?.orbitalName ?? seed.trait, seed.event, { error: err instanceof Error ? err : String(err) });
      }
      throw err;
    }
    if (!outcome.success && beforeLocalPaint !== undefined) slotFlush.rollback(beforeLocalPaint);
    slotFlush.applyClientEffects(outcome.serverEffects.clientEffects ?? [], outcome.serverEffects.clientEffectsByTrait, options.navigate, options.navigateBack, activeTraitNamesRef.current);
    const emitted = [...outcome.seeds.flatMap((seed) => seed.local.emittedEvents), ...outcome.emittedEvents];
    for (const e of emitted) {
      eventBus.emit(`UI:${e.event}`, e.payload, { ...(e.source ?? {}), dispatched: true });
    }
    for (const seed of outcome.seeds) {
      recordDispatchVerdict(traitIndex.byName.get(seed.trait)?.orbitalName ?? seed.trait, seed.event, {
        response: {
          ...seed.local,
          success: outcome.success,
          ...(outcome.error !== undefined ? { error: outcome.error } : {}),
          rejections: [...(seed.local.rejections ?? []), ...outcome.rejections.filter((r) => r.trait === seed.trait)],
        },
      });
      stateLog.debug('mount:settled', { traitName: seed.trait, eventKey: seed.event, mode: seed.mode, transitioned: seed.local.transitioned });
      await afterSettle(seed.event, payload);
    }
    return [...outcome.seeds.flatMap((seed) => seed.local.rejections ?? []), ...outcome.rejections].find((r) => r.code === 'effect-failed');
  }, [kernel, slotFlush, traitIndex, store, eventBus, options.navigate, options.navigateBack, afterSettle]);

  useBusIngress(traitBindings, traitIndex, dispatchAndSettle, eventBus, appTraitNames);

  const sendEvent = useCallback((eventKey: string, payload?: EventPayload): void => {
    const normalized = normalizeEventKey(eventKey);
    for (const [traitName] of traitIndex.byName) {
      if (!store.states.canHandleEvent(traitName, normalized)) continue;
      void dispatchAndSettle(traitName, normalized, payload);
    }
  }, [traitIndex, store, dispatchAndSettle]);

  const getTraitState = useCallback((traitName: string) => store.states.getState(traitName), [store]);

  const canHandleEvent = useCallback((traitName: string, eventKey: string): boolean =>
    store.states.canHandleEvent(traitName, normalizeEventKey(eventKey)), [store]);

  // Page nav: a trait that drops out of `traitBindings` never emits an
  // empty render of its own, so its last paint would stack with the new
  // page's writes into the same slot. Clear dropped traits from every slot
  // before the mount-lifecycle effect below re-initializes.
  const prevActiveTraitNamesRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const nextActiveTraitNames = new Set(
      traitBindings.map((b) => b.trait.name).filter((n): n is string => !!n),
    );
    const dropped = diffDroppedTraitNames(prevActiveTraitNamesRef.current, nextActiveTraitNames);
    if (dropped.length > 0) {
      for (const traitName of dropped) {
        for (const slot of ALL_SLOTS) {
          uiSlots.clearBySource(slot, traitName);
        }
      }
    }
    prevActiveTraitNamesRef.current = nextActiveTraitNames;
  }, [traitBindings, uiSlots]);

  // Mount-time lifecycle (INIT/LOAD/$MOUNT): each trait's own matching
  // lifecycle event dispatches ONCE, targeted — naturally O(traits), no
  // broadcast-then-filter N² shape (the old hook's own concern) since a
  // targeted `kernel.dispatch` never touches an unrelated trait.
  // Once per mount: a new page, new route params or a new circuit store is a remount; identity churn is not.
  const mountedRef = useRef<{ key: string; store: typeof store; initialized: Set<string> } | null>(null);
  // A mount still settling when the host unmounts must not render into the torn-down tree.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);
  // The kernel's tick clock runs mounted traits only: a page leaving takes its ticks with it.
  const kernelClientRef = useRef(kernelClient);
  kernelClientRef.current = kernelClient;
  const declaredOnRef = useRef<typeof kernelClient | undefined>(undefined);
  useEffect(() => () => {
    const client = kernelClientRef.current;
    const mounted = mountedRef.current;
    if (mounted === null) return;
    void client.unmount([...mounted.initialized]).catch((err: Error) => stateLog.warn('unmount:failed', { error: err.message }));
  }, []);
  const mountKey = `${options.mountKey ?? ''}\u0000${JSON.stringify(Object.entries(options.initPayload ?? {}).sort(([a], [b]) => a.localeCompare(b)))}`;
  useEffect(() => {
    const prev = mountedRef.current;
    const continuing = prev !== null && prev.key === mountKey && prev.store === store;
    const mount = continuing
      ? prev
      : { key: mountKey, store, initialized: new Set<string>() };
    const active = new Set(traitBindings.map((b) => b.trait.name));
    // Declared before the first frame: the kernel's tick clock must not tick traits this page never mounted.
    const fresh = !continuing || declaredOnRef.current !== kernelClient;
    const declared = fresh ? [...active] : [...active].filter((name) => !mount.initialized.has(name));
    declaredOnRef.current = kernelClient;
    if (fresh || declared.length > 0) void (fresh ? kernelClient.remount(declared) : kernelClient.mount(declared)).catch((err: Error) => stateLog.warn('mount:declare-failed', { error: err.message }));
    const left = [...mount.initialized].filter((traitName) => !active.has(traitName));
    for (const traitName of left) mount.initialized.delete(traitName);
    if (left.length > 0) void kernelClient.unmount(left).catch((err: Error) => stateLog.warn('unmount:failed', { error: err.message }));
    // Every entering trait awaits its own lifecycle event BEFORE any of them
    // dispatches: a sibling's INIT cascade must not reach it first.
    const entering: MountSeed[] = [];
    const embeddedChildren = new Set([...(options.callsiteCaptureChildrenByTrait?.values() ?? [])].flatMap((c) => [...c]));
    for (const binding of traitBindings) {
      const traitName = binding.trait.name;
      if (mount.initialized.has(traitName)) continue;
      mount.initialized.add(traitName);
      // An embedded child that reads its composer's payload and only repaints on mount waits
      // for that composer (the capture pass paints it), as the compiled path renders it inline.
      const indexed = traitIndex.byName.get(traitName);
      if (
        embeddedChildren.has(traitName) &&
        indexed !== undefined &&
        (traitReferencesCallsitePayload(indexed.irTrait) || configReferencesCallsitePayload(kernelClient.traitConfig(traitName))) &&
        store.states.repaintLifecycleEvent(traitName) !== undefined &&
        !store.callsitePayloads.has(traitName)
      ) {
        continue;
      }
      const lifecycleEvent = LIFECYCLE_EVENTS.find((evt) => store.states.canHandleEvent(traitName, evt));
      if (lifecycleEvent !== undefined) entering.push({ trait: traitName, event: lifecycleEvent });
    }
    if (entering.length > 0) {
      uiSlots.clearBySource('main', MOUNT_ERROR_SOURCE);
      void mountAndSettle(entering, { ...(options.initPayload ?? {}) }).then((failure) => {
        if (failure === undefined || !aliveRef.current) return;
        const failed = failure.trait ?? entering.map((e) => e.trait).join(', ');
        const message = failure.error ?? failure.code;
        stateLog.warn('mount:effect-failed', { failed, event: failure.event, error: message });
        uiSlots.render({
          target: 'main',
          pattern: 'error-state',
          props: { title: t('error.traitMountFailed', { trait: failed }), message, 'data-testid': TRAIT_MOUNT_ERROR_TESTID },
          sourceTrait: MOUNT_ERROR_SOURCE,
        });
      }, (err) => {
        const traits = entering.map((e) => e.trait);
        const message = err instanceof Error ? err.message : String(err);
        const failed = err instanceof TraitMountError ? err.trait : traits.join(', ');
        const cause = err instanceof TraitMountError ? err.original : err;
        stateLog.warn('mount:failed', { traits, failed, error: message, stack: cause instanceof Error ? cause.stack : undefined });
        if (!aliveRef.current) return;
        uiSlots.render({
          target: 'main',
          pattern: 'error-state',
          props: { title: t('error.traitMountFailed', { trait: failed }), message, 'data-testid': TRAIT_MOUNT_ERROR_TESTID },
          sourceTrait: MOUNT_ERROR_SOURCE,
        });
      });
    }
    mountedRef.current = mount;
  }, [traitBindings, store, mountAndSettle, mountKey, uiSlots, traitIndex, options.callsiteCaptureChildrenByTrait, t, kernelClient]);

  // Re-render on every committed circuit change (mirrors the old hook's own
  // `setTraitStates(manager.getAllStates())` after each dispatch) — the
  // store's `notify()` is the ONE place `dispatchWithServerLeg`/
  // `applyOrbitalEventResponse` signal "state changed" (plan §4.2 P2).
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const traitStates = useMemo(() => store.states.getAllStates(), [store, store.getVersion()]);

  return { traitStates, sendEvent, getTraitState, canHandleEvent, entityBindingSource, awaitingSkeletonSource };
}
