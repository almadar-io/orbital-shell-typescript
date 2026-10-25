/**
 * The kernel-backed client role: a `ClientKernel` (the surface `useCircuitKernel` hands every hook)
 * whose decisions are the Rust client-role kernel's, run as WebAssembly. A dispatch, a fold, a rollback
 * and a tick frame are `Kernel` calls; this module only moves their results: server legs go out over the
 * provider's transport and come back through `applyServerResponse`, and each response is mirrored into the
 * `CircuitStore` so the hooks that read it (`useEntityBindingSource`, the awaiting registry, the trait
 * machine's `canHandleEvent`) see the kernel's states and rows.
 *
 * @packageDocumentation
 */
import type { EventPayload, MountSeed, OrbitalEventRequest, OrbitalEventResponse, TraitConfig, TransitionRejection, UserContext } from '@almadar/core';
import {
  createLocalFold,
  DispatchLane,
  mirrorResponse,
  traceResponse,
  type CircuitStore,
  type ClientDispatchHooks,
  type ClientKernel,
  type ClientKernelOutcome,
  type EventTransport,
  type FramePostPort,
  type TransitionObserver,
} from '@almadar/shell-runtime';
import {
  createTickDriver,
  runTickFrame,
  type TickDriver,
  type TickFramePorts,
  type VisibilityPort,
} from '../kernel/tick-driver';
import type { TraitIndex } from '@almadar/core';
import { TraitMountError } from '@almadar/shell-runtime/client/trait-mount-error';
import { createLogger } from '@almadar/logger';
import type { FrameScheduler } from './kernel-frames';
import { getTraitPresence, presenceGroup } from '../core';
import type { AppliedWire, AwaitingTrait, DispatchMode, DispatchWire, MountWire, TraitSnapshot } from '@almadar/core/kernel-wire';
import type { KernelInstance } from './kernel-wire';

const log = createLogger('almadar:ui:kernel-client');

type MountOutcome = Awaited<ReturnType<ClientKernel['dispatchMount']>>;
type MountHooks = Parameters<ClientKernel['dispatchMount']>[1];
type MountBase = Parameters<ClientKernel['dispatchMount']>[2];
type ServerEffects = NonNullable<ClientKernelOutcome['serverEffects']>;

export interface KernelClient extends ClientKernel {
  /** One host frame of the kernel's tick clock; each tick's cascade is an outcome. Never waits on the dispatch queue. */
  frame(nowMs: number): Promise<ClientKernelOutcome[]>;
  framePause(): void;
  frameResume(): void;
  /**
   * Drive the tick clock: one host frame per scheduled frame (`requestAnimationFrame` unless the host gives its own
   * clock), paused while the document is hidden. The kernel decides which ticks are due; `onFrame` paints the outcomes.
   * Returns the stop.
   */
  startFrames(onFrame: (outcomes: ClientKernelOutcome[]) => void, schedule?: FrameScheduler): () => void;
  /** Declare a new mount (a page switch): the tick clock runs the ticks of `traits` only. Applied before the next frame. */
  remount(traits: readonly string[]): Promise<void>;
  /** The kernel's mounts for a client opening `routePath`: the traits to mount and the lifecycle event each runs. */
  routeMounts(routePath: string): Promise<MountSeed[]>;
  /** Add traits to the current mount; the first mount declared scopes the tick clock to it. */
  mount(traits: readonly string[]): Promise<void>;
  /** Traits leaving the mount: their ticks stop. */
  unmount(traits: readonly string[]): Promise<void>;
  /** The kernel's current state of a trait; `undefined` until the WebAssembly is loaded. */
  traitState(traitName: string): string | undefined;
  /** The config the kernel binds as `@config` for a trait (render markers resolve against it); `undefined` until the WebAssembly is loaded. */
  traitConfig(traitName: string): TraitConfig | undefined;
  /** The viewer the kernel binds as `@user`; the trait configs' `@user` forwards are read again after it. */
  setViewer(user: UserContext): Promise<void>;
}

export interface KernelClientOptions {
  instance: Promise<KernelInstance>;
  store: CircuitStore;
  traitIndex: TraitIndex;
  transport?: EventTransport;
  /** The transport's confirmed topology: a stateful host is posted legs without the circuit state they carry. */
  topology: Promise<{ carriesCircuitState: boolean }>;
  /** Hears every executed hop of every response the kernel produces (the verification timeline). */
  observer?: TransitionObserver;
}

const defaultFrameScheduler: FrameScheduler = (callback) => {
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(handle);
  }
  const timer = setTimeout(() => callback(performance.now()), 16);
  return () => clearTimeout(timer);
};

function parse<T>(text: string): T {
  return JSON.parse(text);
}

function payloadJson(payload: EventPayload | undefined): string | undefined {
  return payload === undefined ? undefined : JSON.stringify(payload);
}

export function createKernelClient(opts: KernelClientOptions): KernelClient {
  const { store, traitIndex, transport } = opts;
  let loaded: KernelInstance | undefined;
  const configs = new Map<string, TraitConfig>();
  const ready = opts.instance.then((k) => {
    loaded = k;
    return k;
  });
  // The load failure reaches every call that awaits `ready`; a client nothing dispatches through stays quiet.
  ready.catch(() => undefined);

  // A `[visible]` tick's trait with the traits whose output it follows.
  const visibleGroups: Array<[string, string[]]> = [...traitIndex.byName]
    .filter(([, entry]) => (entry.irTrait.ticks ?? []).some((tick) => tick.whileVisible === true))
    .map(([name]) => [name, presenceGroup(traitIndex, name)]);

  let queueTail: Promise<void> = Promise.resolve();
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queueTail.then(run);
    queueTail = result.then(() => undefined, () => undefined);
    return result;
  };
  let progressTail: Promise<void> = Promise.resolve();
  // Mount declarations apply in call order and before any frame that follows them.
  let scopeTail: Promise<void> = Promise.resolve();
  const declareScope = (apply: (k: KernelInstance) => void): Promise<void> => {
    const applied = scopeTail.then(() => ready).then(apply);
    scopeTail = applied.then(() => undefined, () => undefined);
    return applied;
  };

  const frameKeyOf = (trait: string): string | undefined => traitIndex.byName.get(trait)?.frameKey;
  const mirror = (response: OrbitalEventResponse): void => mirrorResponse(store, frameKeyOf, response);
  const trace = (response: OrbitalEventResponse): void => traceResponse(opts.observer, response);
  const localFold = createLocalFold({ store, frameKeyOf, ...(opts.observer !== undefined ? { observer: opts.observer } : {}) });
  const lane = new DispatchLane();

  const syncStates = (k: KernelInstance, traits: readonly string[]): void => {
    for (const trait of traits) {
      const state = k.getState(trait);
      if (state !== '' && store.states.getState(trait)?.currentState !== state) store.states.seedState(trait, state);
    }
  };

  const restore = (k: KernelInstance, wire: DispatchWire, entityId: string | undefined): ServerEffects => {
    const snapshot: TraitSnapshot | null = wire.snapshot;
    if (snapshot === null) return { clientEffects: [], clientEffectsByTrait: [] };
    const trait = wire.seed.trait;
    const repaint = parse<OrbitalEventResponse>(k.restore(trait, entityId, JSON.stringify(snapshot)));
    const frameKey = traitIndex.byName.get(trait)?.frameKey ?? trait;
    if (snapshot.state !== '') store.states.rollbackState(trait, snapshot.state, entityId, 'server-rejected');
    const entity = snapshot.entity;
    if (entity !== null && typeof entity === 'object' && !Array.isArray(entity)) store.frames.set(frameKey, { ...entity });
    else store.frames.delete(frameKey);
    mirror(repaint);
    store.notify();
    return { clientEffects: repaint.clientEffects ?? [], clientEffectsByTrait: repaint.clientEffectsByTrait ?? [] };
  };

  interface Posted {
    response: OrbitalEventResponse;
    serverEffects: ServerEffects;
    success: boolean;
    error?: string;
    rejections: TransitionRejection[];
    foldedEmits: OrbitalEventResponse['emittedEvents'];
    rolledBack?: ServerEffects;
  }

  /** One request to post and what folding its answer needs. */
  interface PlannedLeg {
    orbital: string;
    leg: OrbitalEventRequest;
    /** The leg keeps the circuit state it carries (a stateless host, or a seed no host holds). */
    keepsState: boolean;
    alreadyDelivered: Array<[string, string]>;
    foldSeeded: string[];
    /** The dispatches this leg answers for: rolled back when it fails. */
    wires: DispatchWire[];
  }

  const planDispatch = (wire: DispatchWire, carriesCircuitState: boolean): { legs: PlannedLeg[]; awaiting: AwaitingTrait[] } => {
    if (wire.serverLegs.length > 0) {
      return {
        awaiting: wire.awaiting,
        legs: wire.serverLegs.map(({ orbital, leg }) => ({
          orbital,
          leg,
          keepsState: carriesCircuitState || wire.mode === 'hybridClientOnly',
          alreadyDelivered: wire.alreadyDelivered,
          foldSeeded: wire.foldSeeded,
          wires: [wire],
        })),
      };
    }
    // A host that holds the circuit state is posted the event itself, so it advances its copy.
    if (!carriesCircuitState && wire.statefulLeg !== null) {
      return {
        awaiting: wire.statefulLeg.awaiting,
        legs: [{ orbital: wire.statefulLeg.orbital, leg: wire.statefulLeg.leg, keepsState: true, alreadyDelivered: wire.alreadyDelivered, foldSeeded: [], wires: [wire] }],
      };
    }
    return { legs: [], awaiting: [] };
  };

  /** Send each planned leg and fold each answer through the kernel. */
  const sendLegs = async (
    k: KernelInstance,
    legs: readonly PlannedLeg[],
    request: Pick<OrbitalEventRequest, 'locale' | 'entityId'>,
    flags: { rollback: boolean; mount: boolean },
    initial: OrbitalEventResponse,
  ): Promise<Posted> => {
    const out: Posted = {
      response: initial,
      serverEffects: { clientEffects: [], clientEffectsByTrait: [] },
      success: true,
      rejections: [],
      foldedEmits: [],
    };
    if (transport === undefined) return out;
    // A fold can owe the host more (a refetch after a browser-stored write): those legs follow, in order.
    const queue = [...legs];
    for (let planned = queue.shift(); planned !== undefined; planned = queue.shift()) {
      const shaped: OrbitalEventRequest = planned.keepsState ? planned.leg : JSON.parse(k.statefulLeg(JSON.stringify(planned.leg)));
      const sent: OrbitalEventRequest = request.locale !== undefined ? { ...shaped, locale: request.locale } : shaped;
      const base = k.foldBase(sent.entityByTrait !== undefined ? JSON.stringify(sent.entityByTrait) : undefined, JSON.stringify(planned.foldSeeded), sent.entityId);
      let posted: OrbitalEventResponse;
      try {
        posted = await transport.send(planned.orbital, sent);
      } catch (err) {
        if (flags.rollback || flags.mount) for (const wire of planned.wires) restore(k, wire, request.entityId);
        throw err instanceof Error ? err : new Error(String(err));
      }
      if (!posted.success) {
        const optimistic = planned.wires.filter((wire) => wire.mode === 'runtimeOptimistic');
        if (flags.rollback && optimistic.length > 0) {
          return { ...out, response: posted, success: false, rolledBack: restore(k, optimistic[0]!, request.entityId) };
        }
        if (flags.mount) for (const wire of optimistic) restore(k, wire, request.entityId);
      }
      const applied = parse<AppliedWire>(k.applyServerResponse(JSON.stringify(posted), JSON.stringify(planned.alreadyDelivered), base));
      // The kernel reconciles the server's states and rows but hands back only the cascade it ran: the
      // server's own renders and emits are the host's to carry, and the states are read back from the kernel.
      log.debug('fold', { orbital: planned.orbital, event: sent.event, posted: { success: posted.success, states: posted.states, emitted: posted.emittedEvents.map((e) => e.event) }, applied: applied.applied, cascadeEmitted: applied.response.emittedEvents.map((e) => e.event) });
      trace(applied.response);
      for (const routed of applied.serverLegs) {
        queue.push({ orbital: routed.orbital, leg: routed.leg, keepsState: true, alreadyDelivered: [], foldSeeded: [], wires: [] });
      }
      mirror(posted);
      mirror(applied.response);
      syncStates(k, [...Object.keys(posted.states), ...applied.applied.map(([trait]) => trait)]);
      store.notify();
      const fold = applied.response;
      const delivered = new Set(planned.alreadyDelivered.map(([trait, event]) => `${trait}\u0000${event}`));
      const serverEmits = posted.emittedEvents.filter((e) => !delivered.has(`${e.source?.trait ?? ''}\u0000${e.event}`));
      const effects = [...(posted.clientEffects ?? []), ...(fold.clientEffects ?? [])];
      const byTrait = [...(posted.clientEffectsByTrait ?? []), ...(fold.clientEffectsByTrait ?? [])];
      out.serverEffects.clientEffects?.push(...effects);
      out.serverEffects.clientEffectsByTrait?.push(...byTrait);
      out.foldedEmits.push(...serverEmits, ...fold.emittedEvents);
      out.response = {
        ...out.response,
        emittedEvents: [...out.response.emittedEvents, ...serverEmits, ...fold.emittedEvents],
        clientEffects: [...(out.response.clientEffects ?? []), ...effects],
        clientEffectsByTrait: [...(out.response.clientEffectsByTrait ?? []), ...byTrait],
        effectResults: [...(out.response.effectResults ?? []), ...(fold.effectResults ?? [])],
      };
      out.success = out.success && posted.success;
      if (posted.error !== undefined) out.error = posted.error;
      out.rejections.push(...(fold.rejections ?? []).filter((r) => r.code === 'effect-failed'));
    }
    return out;
  };

  /** Post every leg of one dispatch (the awaiting window spans the sends). */
  const post = async (
    k: KernelInstance,
    wire: DispatchWire,
    request: Pick<OrbitalEventRequest, 'locale' | 'entityId'>,
    flags: { rollback: boolean; awaiting: boolean },
  ): Promise<Posted> => {
    const topology = await opts.topology;
    const plan = planDispatch(wire, topology.carriesCircuitState);
    const awaiting = flags.awaiting ? plan.awaiting : [];
    store.awaiting.begin(awaiting);
    try {
      return await sendLegs(k, plan.legs, request, { rollback: flags.rollback, mount: false }, wire.response);
    } finally {
      store.awaiting.end(awaiting.map((a) => a.trait));
    }
  };

  /** The frame's post port: each owed post is performed through the same send/fold path a command takes. */
  const framePost = (k: KernelInstance): FramePostPort | undefined => {
    if (transport === undefined) return undefined;
    return {
      postDispatch: async (wire) => (await post(k, wire, {}, { rollback: false, awaiting: false })).serverEffects,
      sendBrowserLeg: async (routed, frameResponse) => {
        const planned: PlannedLeg = { orbital: routed.orbital, leg: routed.leg, keepsState: true, alreadyDelivered: [], foldSeeded: [], wires: [] };
        return (await sendLegs(k, [planned], {}, { rollback: false, mount: false }, frameResponse)).serverEffects;
      },
    };
  };

  const tickPorts = (k: KernelInstance): TickFramePorts => ({
    kernel: {
      frame: (nowMs) => {
        const presence = getTraitPresence();
        for (const [traitName, group] of visibleGroups) k.setTraitOnScreen(traitName, presence.state(group) !== 'off-screen');
        return k.frame(nowMs);
      },
      framePause: () => k.framePause(),
      frameResume: () => k.frameResume(),
      tickCount: () => k.tickCount(),
    },
    lane,
    client: localFold,
    post: framePost(k),
  });

  const dispatchOne = async (request: OrbitalEventRequest, hooks: ClientDispatchHooks[], progress: boolean): Promise<ClientKernelOutcome> => {
    const traitName = request.targetTrait;
    if (traitName === undefined) throw new Error('dispatch requires request.targetTrait (the seed trait)');
    const k = await ready;
    if (request.runTick !== undefined) {
      const response = parse<OrbitalEventResponse>(k.tick(request.runTick.trait, request.runTick.tick, request.entityId));
      mirror(response);
      store.notify();
      return { response, mode: parse<DispatchMode>(k.dispatchMode(request.runTick.trait)) };
    }
    const wire = parse<DispatchWire>(k.dispatch(traitName, request.entityId, request.event, payloadJson(request.payload)));
    log.debug('dispatch', { trait: traitName, event: request.event, mode: wire.mode, legs: wire.serverLegs.length, success: wire.response.success, states: wire.response.states, effects: (wire.response.clientEffectsByTrait ?? []).map((e) => `${e.traitName}:${e.effect[0]}:${e.effect[1] ?? ''}`), emitted: wire.response.emittedEvents.map((e) => e.event) });
    trace(wire.response);
    mirror(wire.response);
    store.notify();
    if (transport === undefined || (wire.serverLegs.length === 0 && wire.statefulLeg === null)) return { response: wire.response, mode: wire.mode };
    const painters = hooks.filter((h) => h.onLocal !== undefined);
    for (const h of painters) h.onLocal?.(wire.response);
    const posted = await post(k, wire, request, { rollback: true, awaiting: !progress });
    const localPainted = painters.length > 0;
    if (posted.rolledBack !== undefined) {
      return { response: posted.response, mode: wire.mode, ...(localPainted ? { localPainted, serverEffects: posted.rolledBack } : {}) };
    }
    return localPainted
      ? { response: posted.response, mode: wire.mode, localPainted, serverEffects: posted.serverEffects }
      : { response: posted.response, mode: wire.mode };
  };

  const client: KernelClient = {
    store,
    dispatch: (request, hooks) => enqueue(() => dispatchOne(request, hooks !== undefined ? [hooks] : [], false)),
    dispatchProgress: (request) => {
      const outcome = progressTail.then(() => dispatchOne(request, [], true));
      progressTail = outcome.then(() => undefined, () => undefined);
      return outcome;
    },
    foldHostDispatch: (request, response) => enqueue(async () => {
      const k = await ready;
      if (request.targetTrait === undefined) throw new Error('foldHostDispatch requires request.targetTrait (the seed trait)');
      const mode = parse<DispatchMode>(k.dispatchMode(request.targetTrait));
      if (!response.success) return { response: { ...response, clientEffects: [], clientEffectsByTrait: [] }, mode };
      const applied = parse<AppliedWire>(k.applyServerResponse(JSON.stringify(response), '[]'));
      trace(applied.response);
      mirror(response);
      mirror(applied.response);
      syncStates(k, [...Object.keys(response.states), ...applied.applied.map(([trait]) => trait)]);
      store.notify();
      return {
        response: {
          ...response,
          clientEffects: [...(response.clientEffects ?? []), ...(applied.response.clientEffects ?? [])],
          clientEffectsByTrait: [...(response.clientEffectsByTrait ?? []), ...(applied.response.clientEffectsByTrait ?? [])],
        },
        mode,
      };
    }),
    dispatchMount: (seeds, hooks?: MountHooks, base?: MountBase) => enqueue(async (): Promise<MountOutcome> => {
      const k = await ready;
      await scopeTail;
      const baseRequest = base ?? {};
      k.mount(JSON.stringify(seeds.map((s) => s.trait)));
      const mount = parse<MountWire>(k.dispatchMount(JSON.stringify(seeds), baseRequest.entityId, payloadJson(baseRequest.payload)));
      if (mount.failed !== null) {
        const failed = mount.failed;
        throw new TraitMountError(failed.trait, failed.event, new Error(failed.message));
      }
      const wires = mount.seeds;
      for (const wire of wires) {
        log.debug('mount', { trait: wire.seed.trait, event: wire.seed.event, mode: wire.mode, legs: wire.serverLegs.length, success: wire.response.success });
        trace(wire.response);
        mirror(wire.response);
      }
      store.notify();
      for (const wire of wires) hooks?.onLocal?.(wire.seed.trait, wire.response);
      const outcome: MountOutcome = {
        seeds: wires.map((w) => ({ trait: w.seed.trait, event: w.seed.event, mode: w.mode, local: w.response })),
        posted: false,
        success: true,
        rejections: [],
        serverEffects: { clientEffects: [], clientEffectsByTrait: [] },
        emittedEvents: [],
      };
      if (transport === undefined) return outcome;
      const topology = await opts.topology;
      for (const group of topology.carriesCircuitState ? mount.legs : mount.statefulLegs) {
        const answered = wires.filter((w) => group.seeds.some((s) => s.trait === w.seed.trait && s.event === w.seed.event));
        const planned: PlannedLeg = { orbital: group.orbital, leg: group.leg, keepsState: true, alreadyDelivered: group.alreadyDelivered, foldSeeded: group.foldSeeded, wires: answered };
        store.awaiting.begin(group.awaiting);
        let posted: Posted;
        try {
          posted = await sendLegs(k, [planned], baseRequest, { rollback: false, mount: true }, answered[0]?.response ?? outcome.seeds[0]!.local);
        } finally {
          store.awaiting.end(group.awaiting.map((a) => a.trait));
        }
        outcome.posted = true;
        outcome.success = outcome.success && posted.success;
        if (posted.error !== undefined) outcome.error = posted.error;
        outcome.rejections.push(...posted.rejections);
        outcome.serverEffects.clientEffects?.push(...(posted.serverEffects.clientEffects ?? []));
        outcome.serverEffects.clientEffectsByTrait?.push(...(posted.serverEffects.clientEffectsByTrait ?? []));
        outcome.emittedEvents.push(...posted.foldedEmits);
      }
      return outcome;
    }),
    routeMounts: async (routePath) => parse<MountSeed[]>((await ready).routeMounts(routePath)),
    remount: (traits) => declareScope((k) => k.remount(JSON.stringify(traits))),
    mount: (traits) => declareScope((k) => k.mount(JSON.stringify(traits))),
    unmount: (traits) => declareScope((k) => k.unmount(JSON.stringify(traits))),
    frame: async (nowMs) => {
      const k = await ready;
      await scopeTail;
      return (await runTickFrame(tickPorts(k), () => nowMs)).outcomes;
    },
    framePause: () => loaded?.framePause(),
    frameResume: () => loaded?.frameResume(),
    startFrames: (onFrame, schedule = defaultFrameScheduler) => {
      const presence = getTraitPresence();
      const releases = visibleGroups.map(([, group]) => presence.watch(group));
      let stopped = false;
      let latestMs = 0;
      let nextHandle = 0;
      const cancels = new Map<number, () => void>();
      const visibility: VisibilityPort = {
        hidden: () => document.visibilityState === 'hidden',
        onChange: (listener) => {
          document.addEventListener('visibilitychange', listener);
          return () => document.removeEventListener('visibilitychange', listener);
        },
      };
      let driver: TickDriver | undefined;
      ready.then(async (k) => {
        await scopeTail;
        if (stopped) return;
        driver = createTickDriver({
          ...tickPorts(k),
          now: () => latestMs,
          requestFrame: (callback) => {
            nextHandle += 1;
            const handle = nextHandle;
            cancels.set(handle, schedule((nowMs) => {
              cancels.delete(handle);
              latestMs = nowMs;
              callback(nowMs);
            }));
            return handle;
          },
          cancelFrame: (handle) => {
            cancels.get(handle)?.();
            cancels.delete(handle);
          },
          visibility,
          onApplied: (applied) => { if (!stopped && applied.outcomes.length > 0) onFrame(applied.outcomes); },
          onError: (error) => log.error('kernel-frame-failed', { error: error.message }),
        });
        driver.start();
      }).catch((error: Error) => log.error('kernel-frame-failed', { error: error.message }));
      return () => {
        stopped = true;
        driver?.stop();
        releases.forEach((release) => release());
      };
    },
    traitState: (traitName) => loaded?.getState(traitName),
    traitConfig: (traitName) => {
      if (loaded === undefined) return undefined;
      const held = configs.get(traitName);
      if (held !== undefined) return held;
      const config = parse<TraitConfig>(loaded.traitConfig(traitName));
      configs.set(traitName, config);
      return config;
    },
    setViewer: async (user) => {
      const k = await ready;
      k.setCurrentUser(JSON.stringify(user));
      configs.clear();
    },
  };
  return client;
}
