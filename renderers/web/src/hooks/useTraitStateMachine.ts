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
  EmittedEvent,
  EntityRow,
  EventPayload,
  MountSeed,
  OrbitalDefinition,
  SchemaMetadata,
  ServiceParams,
  UserContext,
} from '@almadar/core';
import { TraitMountError } from '@almadar/shell-runtime/client/trait-mount-error';
import type { EventTransport } from '../index';
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
import { TRAIT_MOUNT_ERROR_TESTID, type TraitStateSnapshot, type PersistenceAdapter, type TransitionRejection } from '@almadar/core';
import type { useUISlots } from '../providers/UISlotContext';
import { getTabClientId, useCircuitKernel, type ProgramStamp } from './circuit/useCircuitKernel';
import type { CircuitState } from './circuit/useCircuitKernel';
import { useBusIngress } from './circuit/useBusIngress';
import { useSlotFlush, type SlotCheckpoint } from './circuit/useSlotFlush';
import type { HostAskDispatch } from '../lib/host-actions';
import { useClientTicks } from './circuit/useClientTicks';
import { useEntityBindingSource } from './circuit/useEntityBindingSource';
import { useAwaitingSkeletonSource } from './circuit/useAwaitingSkeletonSource';

/** The slot source a failed lifecycle step's error renders under, cleared on the next mount. */
const MOUNT_ERROR_SOURCE = '$mount';

const stateLog = createLogger('almadar:ui:state-transitions');

export interface TraitStateMachineResult {
  /** Current state for each trait. */
  traitStates: Map<string, TraitState>;
  getTraitState: (traitName: string) => TraitState | undefined;
  /** Live per-trait binding surface for `EntityBindingContext`. */
  entityBindingSource: EntityBindingSource;
  /** Awaiting-server skeletons for `AwaitingSkeletonContext`. */
  awaitingSkeletonSource: AwaitingSkeletonSource;
  /** The kernel's answer for the page: pending until it answers, failed when it cannot. Nothing mounts before it is ready. */
  circuit: CircuitState;
}

export interface UseTraitStateMachineOptions {
  /** The page the kernel answers the circuit of; absent: the initial page (or the page of `routePath`). */
  page?: string;
  onEventProcessed?: (eventKey: string, payload?: EventPayload) => void;
  navigate?: (path: string, params?: Record<string, string>, crumb?: string) => void;
  navigateBack?: () => void;
  initPayload?: EventPayload;
  /** The mounted page's identity; with `initPayload` it keys the once-per-mount lifecycle guard (Runtime Spec Clause 4.1). */
  mountKey?: string;
  /** The route the page is opened at; the kernel's mounts for it are what the hook runs (EXEC-ENDPOINT-3). */
  routePath?: string;
  /** The program's orbitals: the kernel is built from them. */
  orbitals: readonly OrbitalDefinition[];
  /** The program's `_metadata` (a compiled client program's operator sites and dispatch facts), handed to the kernel. */
  metadata?: SchemaMetadata;
  /** The program's type-contract stamp, carried into the browser kernel's registration. */
  stamp?: ProgramStamp;
  /** Caller-owned transport (server bridge). Omitted + `persistence` set =
   *  offline preview (plan G7); omitted + no `persistence` = fully local,
   *  nothing ever posts. */
  transport?: EventTransport;
  carriesCircuitState?: boolean;
  /** Hold every dispatch until the transport's topology is known. */
  awaitTopology?: boolean;
  persistence?: PersistenceAdapter;
  /** The browser store for `[persistent: x, browser]` entities (see `useCircuitKernel`). */
  browserStore?: PersistenceAdapter;
  callService?: (service: string, action: string, params?: ServiceParams) => Promise<EventPayload>;
  debug?: boolean;
  logContext?: { behavior?: string; orbitalName?: string };
  /** Explicit viewer override (e.g. a persona switcher's picked identity
   *  threaded down as a prop rather than through `UserContext`). Wins over
   *  `useUser()`'s context value when supplied. */
  user?: UserContext;
}

export function useTraitStateMachine(
  uiSlots: ReturnType<typeof useUISlots>,
  options: UseTraitStateMachineOptions,
): TraitStateMachineResult {
  const eventBus = useEventBus();
  const { user: contextViewer } = useUser();
  const { t } = useTranslate();
  const userContext = (options.user ?? contextViewer ?? undefined) as UserContext | undefined;

  const observer = useMemo(() => createCircuitVerificationObserver(), []);

  const engine = useKernelEngine();
  const { kernel, store, traitIndex, appTraitNames, transport, engine: kernelClient, circuit } = useCircuitKernel({
    orbitals: options.orbitals,
    ...(options.page !== undefined ? { page: options.page } : {}),
    ...(options.routePath !== undefined ? { route: options.routePath } : {}),
    ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    ...(options.stamp !== undefined ? { stamp: options.stamp } : {}),
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

  const hostAskDispatchRef = useRef<HostAskDispatch | undefined>(undefined);
  // Every trait some sibling embeds through `@trait.X` paints in its frame, never in a top-level slot: the kernel's list.
  const embeddedTraits = useMemo<ReadonlySet<string>>(() => new Set(circuit.status === 'ready' ? circuit.page.embeddedBy : []), [circuit]);
  const slotFlush = useSlotFlush(uiSlots, embeddedTraits, (trait, event, payload) => hostAskDispatchRef.current?.(trait, event, payload) ?? Promise.resolve());


  const entityBindingSource = useEntityBindingSource(store, traitIndex, kernelClient);
  const awaitingSkeletonSource = useAwaitingSkeletonSource(store, traitIndex, embeddedTraits);

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
    for (const [traitName, surface] of traitIndex.byName) {
      const state = store.states.getState(traitName);
      const info: TraitDebugInfo = {
        id: traitName,
        name: traitName,
        currentState: state?.currentState ?? surface.initial ?? 'unknown',
        states: [...surface.states],
        transitions: surface.transitions.map((t) => ({ from: t.from, to: t.to, event: t.event, ...(t.guard !== undefined ? { guard: JSON.stringify(t.guard) } : {}) })),
        guards: surface.transitions.flatMap((t) => (t.guard !== undefined ? [{ name: JSON.stringify(t.guard) }] : [])),
        transitionCount: 0,
      };
      registerTrait(info);
      ids.push(traitName);
    }
    bindTraitStateGetter((traitName) => store.states.getState(traitName)?.currentState);
    // The trait's live frame under its entity's name — what a verifier reads to
    // see the entity the trait holds (riya: the body's seeded skateCurve).
    const snapshotData = (traitName: string): Record<string, EntityRow[]> => {
      const entry = traitIndex.byName.get(traitName);
      const frame = entry !== undefined ? store.frames.get(entry.frameKey) : undefined;
      const entityName = entry?.entity;
      return frame !== undefined && entityName !== undefined ? { [entityName]: [{ ...frame }] } : {};
    };
    const snapshotUnregs = Array.from(traitIndex.byName, ([traitName, surface]) => registerTraitSnapshot(traitName, (): TraitStateSnapshot => {
      const currentState = store.states.getState(traitName)?.currentState ?? surface.initial ?? 'unknown';
      return {
        traitName,
        currentState,
        states: [...surface.states],
        events: [...surface.events],
        data: snapshotData(traitName),
        cascadeReceived: [],
      };
    }));
    return () => {
      for (const id of ids) unregisterTrait(id);
      for (const unreg of snapshotUnregs) unreg();
    };
  }, [store, traitIndex]);

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
    recordDispatchVerdict(traitIndex.byName.get(traitName)?.orbital ?? traitName, eventKey, { response: outcome.response });
    const settledEffects = outcome.localPainted && outcome.serverEffects !== undefined ? outcome.serverEffects : outcome.response;
    slotFlush.applyClientEffects(
      settledEffects.clientEffectsByTrait,
      options.navigate,
      options.navigateBack,
      activeTraitNamesRef.current,
    );
    // A tick lane posts without blocking the drain; what its fold adds (a
    // refetch's render) paints when the post lands.
    void outcome.tickSettled?.then((later) => {
      if (later === undefined) return;
      slotFlush.applyClientEffects(later.clientEffectsByTrait, options.navigate, options.navigateBack, activeTraitNamesRef.current);
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
    const orbitalName = traitIndex.byName.get(traitName)?.orbital ?? traitName;
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

  hostAskDispatchRef.current = dispatchAndSettle;

  // An emit that entered from outside the kernel: the kernel decides who hears it, the view paints its answer.
  // 'listeners' is another client's push: its declared listeners hear it here and nothing else. 'origin' is the live
  // message of this client's own running call, whose emitter already ran its own arm as the progress dispatch.
  const deliverAndSettle = useCallback(async (emitted: EmittedEvent, delivery: 'emit' | 'listeners' | 'origin' = 'emit'): Promise<void> => {
    const outcome = await (delivery === 'origin'
      ? kernel.deliverOriginEmit(emitted)
      : delivery === 'listeners' ? kernel.deliverToListeners(emitted) : kernel.deliverEmit(emitted));
    slotFlush.applyClientEffects(outcome.response.clientEffectsByTrait, options.navigate, options.navigateBack, activeTraitNamesRef.current);
    for (const echoed of outcome.response.emittedEvents) {
      eventBus.emit(`UI:${echoed.event}`, echoed.payload, { ...(echoed.source ?? {}), dispatched: true });
    }
    stateLog.debug('emit:settled', { event: emitted.event, emitted: outcome.response.emittedEvents.map((e) => e.event) });
    await afterSettle(emitted.event, emitted.payload);
  }, [kernel, slotFlush, eventBus, options.navigate, options.navigateBack, afterSettle]);

  // One kernel frame's outcomes: the head is the frame's merged response, each following one a tick's
  // listener cascade (its server legs settle on their own and paint when they land).
  const settleFrame = useCallback((outcomes: ClientKernelOutcome[]): void => {
    for (const outcome of outcomes) {
      slotFlush.applyClientEffects(outcome.response.clientEffectsByTrait, options.navigate, options.navigateBack, activeTraitNamesRef.current);
      for (const emitted of outcome.response.emittedEvents) {
        eventBus.emit(`UI:${emitted.event}`, emitted.payload, { ...(emitted.source ?? {}), dispatched: true });
      }
      void outcome.tickSettled?.then((later) => {
        if (later === undefined) return;
        slotFlush.applyClientEffects(later.clientEffectsByTrait, options.navigate, options.navigateBack, activeTraitNamesRef.current);
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
  // the same settle as a bus-entered dispatch, so they repaint. The kernel decides who hears a push.
  useEffect(() => {
    if (!transport?.subscribe) return;
    return transport.subscribe((emitted, target) => {
      if (target !== 'origin') {
        void deliverAndSettle(emitted, 'listeners');
        return;
      }
      // A call-service `onMessage` event is the calling trait's own (like `success`): it runs
      // there, and on any trait that listens to it.
      const caller = emitted.source?.trait;
      if (caller !== undefined && traitIndex.byName.has(caller)) {
        void progressAndSettle(caller, emitted.event, emitted.payload);
        void deliverAndSettle(emitted, 'origin');
        return;
      }
      void deliverAndSettle(emitted, 'listeners');
    }, { clientId: getTabClientId() });
  }, [transport, traitIndex, progressAndSettle, deliverAndSettle]);

  // A dispatch the host ran on its own (a declared input) shows here as the host's result; it never
  // runs again in this view.
  useEffect(() => {
    if (!transport?.subscribeHostDispatches) return;
    return transport.subscribeHostDispatches((_orbitalName, request, response) => {
      const traitName = request.targetTrait;
      const ownsFrame = (frame: string): boolean => [...traitIndex.byName.values()].some((entry) => entry.frameKey === frame);
      if (traitName === undefined || !hostDispatchInView(request, response, (t) => traitIndex.byName.has(t), ownsFrame)) return;
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
          slotFlush.applyClientEffects(local.clientEffectsByTrait, options.navigate, options.navigateBack, activeTraitNamesRef.current);
        },
      }, { payload });
    } catch (err: unknown) {
      if (beforeLocalPaint !== undefined) slotFlush.rollback(beforeLocalPaint);
      for (const seed of seeds) {
        recordDispatchVerdict(traitIndex.byName.get(seed.trait)?.orbital ?? seed.trait, seed.event, { error: err instanceof Error ? err : String(err) });
      }
      throw err;
    }
    if (!outcome.success && beforeLocalPaint !== undefined) slotFlush.rollback(beforeLocalPaint);
    slotFlush.applyClientEffects(outcome.serverEffects.clientEffectsByTrait, options.navigate, options.navigateBack, activeTraitNamesRef.current);
    const emitted = [...outcome.seeds.flatMap((seed) => seed.local.emittedEvents), ...outcome.emittedEvents];
    for (const e of emitted) {
      eventBus.emit(`UI:${e.event}`, e.payload, { ...(e.source ?? {}), dispatched: true });
    }
    for (const seed of outcome.seeds) {
      recordDispatchVerdict(traitIndex.byName.get(seed.trait)?.orbital ?? seed.trait, seed.event, {
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

  useBusIngress(traitIndex.byName, traitIndex, dispatchAndSettle, deliverAndSettle, eventBus, appTraitNames);

  const getTraitState = useCallback((traitName: string) => store.states.getState(traitName), [store]);

  // A page's traits are entered once per mount: the kernel answers the seeds of the traits not entered yet and the traits
  // that left, whose last paint is cleared from every slot before the entering traits paint (a dropped trait emits no
  // empty render of its own, so its content would stack with the new page's writes into the same slot).
  // A mount still settling when the host unmounts must not render into the torn-down tree.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);
  const kernelClientRef = useRef(kernelClient);
  kernelClientRef.current = kernelClient;
  useEffect(() => () => {
    void kernelClientRef.current.leave().catch((err: Error) => stateLog.warn('unmount:failed', { error: err.message }));
  }, []);
  // A new page, new route params or a new circuit store is a new mount; identity churn is not.
  const mountKey = `${options.mountKey ?? ''}\u0000${JSON.stringify(Object.entries(options.initPayload ?? {}).sort(([a], [b]) => a.localeCompare(b)))}`;
  useEffect(() => {
    function mountEntering(entering: MountSeed[]): void {
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
    if (circuit.status !== 'ready') return;
    void kernelClient.enter(circuit.page.route, mountKey, [...traitIndex.byName.keys()]).then(({ seeds, left }) => {
      for (const traitName of left) {
        for (const slot of ALL_SLOTS) uiSlots.clearBySource(slot, traitName);
      }
      if (seeds.length > 0) mountEntering(seeds);
    }, (err: Error) => stateLog.warn('mount:enter-failed', { error: err.message }));
  }, [circuit, traitIndex, mountAndSettle, mountKey, uiSlots, t, kernelClient]);

  // Re-render on every committed circuit change (mirrors the old hook's own
  // `setTraitStates(manager.getAllStates())` after each dispatch) — the
  // store's `notify()` is the ONE place `dispatchWithServerLeg`/
  // `applyOrbitalEventResponse` signal "state changed" (plan §4.2 P2).
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const traitStates = useMemo(() => store.states.getAllStates(), [store, store.getVersion()]);

  return { traitStates, getTraitState, entityBindingSource, awaitingSkeletonSource, circuit };
}
