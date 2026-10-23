'use client';
/**
 * OrbitalPluginHost — runs an ordinary behavior headless against the
 * AMBIENT event bus + slot provider (Almadar Studio V4 §14 plan, Part F1).
 *
 * A "plugin" is not a new kind of artifact: it is a `.lolo` behavior a host
 * chooses to run on a kernel of its own, wired to the SAME bus and slots every
 * other UI component uses. `mode: 'mock'` runs each plugin as an offline
 * `OrbPreview` circuit does: a client-role kernel (which also runs the plugin's
 * `ticks {}` on the one browser tick driver) over a local kernel whose mock
 * store is seeded by `seedMockStore` (persona roster, owner columns stamped for
 * the dev viewer, the `@create` owner gate); `mode: 'server'` dispatches
 * through the host's transport. Default policy denies nothing — a plugin has the full
 * behavior power a preview has (in-memory persist, default services); `deny`
 * is an opt-in host policy, never a default sandbox.
 *
 * OUTBOUND = the dispatch response. The kernel runs a dispatch's whole
 * `listens {}` cascade before it answers (EXEC semantics), so
 * `response.emittedEvents` carries every emit of the run, direct or cascaded,
 * on both modes, and every trait's state is read back from the kernel after it.
 *
 * RELAY RULE: the plugin's `inbound[]` is its host→plugin vocabulary — one
 * `UI:<busEvent>` bus event per row, dispatching `trigger` at
 * `orbital`/`trait`. Anything a plugin emits under one of those SAME
 * busEvent names (or under an inbound `trigger` name) is a relay for its
 * own siblings' `listens {}` (the runtime's internal event bus already
 * carries that fan-out), never a fresh request back to the host, and must
 * NEVER be re-broadcast — doing so re-fires the very `UI:<busEvent>`
 * listener that produced it, a synchronous self-feeding loop (verified
 * 2026-09-04, see `docs/Almadar_UI_Gaps.md`).
 *
 * @packageDocumentation
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { EffectHandlers } from '../runtime';
import { buildTraitIndex, createLocalStoreTransport, nativeMemoryPersistence, openLocalKernel, seedMockStore, withForkedSeeder } from '../runtime';
import { createMemoryCircuitStore } from '@almadar/shell-runtime/client/circuit-store';
import type { ClientKernelOutcome } from '@almadar/shell-runtime/client/client-kernel';
import type { TraitState } from '@almadar/shell-runtime/client/trait-types';
import type { KernelEngine } from '../index';
import type {
  BusEventSource,
  ClientEffectTuple,
  EntityRow,
  EventPayload,
  OrbitalEventResponse,
  OrbitalSchema,
  PersistenceAdapter,
  Trait,
  TraitConfigValue,
  UISlot,
  UserContext,
} from '@almadar/core';
import { createLazyKernelClient } from '../lib/kernel-client-lazy';
import type { KernelClient } from '../lib/kernel-client';
import type { KernelInstance } from '../lib/kernel-wire';
import { kernelOrbitals } from '../lib/kernel-schema';
import { getTabClientId } from '../hooks/circuit/useCircuitKernel';
import { useClientTicks } from '../hooks/circuit/useClientTicks';
import { UI_SLOTS } from '@almadar/core';
import { createLogger } from '@almadar/logger';
import { useEventBus, useRootEventBus } from '../core';
import { useTraitScopeChain } from '../core';
import { useTranslate } from '../core';
import { useUISlots, type UISlotManager, type SlotProps } from '../providers/UISlotContext';
import type { EventTransport } from '../index';
import type { KeyCaptureEntry, KeyCaptureTable } from '../hooks/useKeyboardRouter';
import { KernelLoaderMissingError, LanguageLoaderMissingError, SeedProgramLoaderMissingError, useKernelEngine, type KernelEngineValue } from '../providers/KernelEngineContext';

const log = createLogger('almadar:ui:plugin-host');

const UI_SLOT_SET: ReadonlySet<string> = new Set(UI_SLOTS);
function isUISlot(value: string): value is UISlot {
  return UI_SLOT_SET.has(value);
}

/** Verbs a host may deny. Never includes `emit` — it drives the kernel's `listens` cascade. */
export type PluginHostDenyVerb = 'persist' | 'call-service' | 'navigate';

/** One bus-event → orbital-event wiring: `UI:<busEvent>` dispatches `trigger` at `orbital`/`trait`. */
export interface PluginHostInbound {
  busEvent: string;
  orbital: string;
  trait: string;
  trigger: string;
}

export interface PluginHostPlugin {
  id: string;
  schema: OrbitalSchema;
  inbound: PluginHostInbound[];
  /** When set, only these events reach the host bus; every other emit stays inside the plugin. */
  outbound?: readonly string[];
}

export interface OrbitalPluginHostProps {
  plugins: PluginHostPlugin[];
  /** 'mock' (default): a local kernel over in-memory mock rows — full behavior power, as any preview.
   *  'server': dispatch through `transport` instead of a local kernel, as `AlmadarApp`. */
  mode?: 'mock' | 'server';
  /** Required when `mode === 'server'`. */
  transport?: EventTransport;
  /** OPTIONAL policy: verbs listed here are denied with a logged warning, never a throw. Default: none denied. */
  deny?: PluginHostDenyVerb[];
  navigate?: (path: string) => void;
  onTransition?: (pluginId: string, orbital: string, trait: string, state: string) => void;
  children?: ReactNode;
}

interface OrbitalPluginHostContextValue {
  getState: (pluginId: string, orbital: string, trait: string) => TraitState | undefined;
  lastEvent: (pluginId: string) => string | undefined;
  errors: Readonly<Record<string, string>>;
  tick: number;
  getPluginSchema: (pluginId: string) => OrbitalSchema | undefined;
}

const OrbitalPluginHostContext = createContext<OrbitalPluginHostContextValue | null>(null);

function useOrbitalPluginHostContext(caller: string): OrbitalPluginHostContextValue {
  const ctx = useContext(OrbitalPluginHostContext);
  if (!ctx) {
    throw new Error(`${caller} must be used within an <OrbitalPluginHost>.`);
  }
  return ctx;
}

function toTraitState(trait: string, stateName: string, lastEvent: string | null): TraitState {
  return { traitName: trait, currentState: stateName, previousState: null, lastEvent, context: {} };
}

function isKeymapValue(value: TraitConfigValue | undefined): value is Readonly<Record<string, ReadonlyArray<string>>> {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => Array.isArray(entry) && entry.every((k) => typeof k === 'string'));
}

/** Finds the trait AS AUTHORED INLINE on the plugin's own schema (not a `{ref, ...}` call-site wrapper). */
function findInlineTrait(schema: OrbitalSchema, orbitalName: string, traitName: string): Trait | undefined {
  const orbital = schema.orbitals.find((o) => o.name === orbitalName);
  if (!orbital) return undefined;
  for (const ref of orbital.traits) {
    if (typeof ref === 'string') continue;
    if ('ref' in ref) continue;
    if (ref.name === traitName) return ref;
  }
  return undefined;
}

function readKeymapConfig(trait: Trait | undefined, knob: string): Readonly<Record<string, ReadonlyArray<string>>> {
  const declared = trait?.config?.[knob]?.default;
  return isKeymapValue(declared) ? declared : {};
}

/** Trait names declared on an orbital, across all three `TraitRef` shapes. A
 *  `{ref, ...}` wrapper with no call-site rename is skipped — its resolved
 *  name isn't knowable without a loader, and a compiled `.orb` plugin schema
 *  carries fully-inlined `Trait` objects for its own orbitals anyway. */
function traitNamesOf(orbital: OrbitalSchema['orbitals'][number]): string[] {
  const names: string[] = [];
  for (const ref of orbital.traits) {
    if (typeof ref === 'string') {
      names.push(ref);
    } else if ('ref' in ref) {
      if (ref.name) names.push(ref.name);
    } else {
      names.push(ref.name);
    }
  }
  return names;
}

/**
 * Reads the declared `keymap` config knob off the plugin's own trait and the
 * live `currentState`, so `useKeyboardRouter`'s capture table always follows
 * the trait's actual mode. Re-derives whenever the host records a new
 * transition (the context's `tick`).
 *
 * `target` accepts either one target string (default `'shell'`) or a list of
 * targets — the SAME derived entry (mode + keys) is repeated under every
 * target, for a caller keying its table by several editor ids at once (e.g.
 * one plugin's mode capturing keys for both `'schema'` and `'file:a.md'`).
 */
export function useDeclaredCaptureTable(opts: {
  pluginId: string;
  orbital: string;
  trait: string;
  keymapKnob?: string;
  target?: string | readonly string[];
}): KeyCaptureTable {
  const { pluginId, orbital, trait, keymapKnob = 'keymap', target = 'shell' } = opts;
  const ctx = useOrbitalPluginHostContext('useDeclaredCaptureTable');

  return useMemo(() => {
    const schema = ctx.getPluginSchema(pluginId);
    const inlineTrait = schema ? findInlineTrait(schema, orbital, trait) : undefined;
    const keymap = readKeymapConfig(inlineTrait, keymapKnob);
    const currentState = ctx.getState(pluginId, orbital, trait)?.currentState;
    const keys = currentState !== undefined ? (keymap[currentState] ?? []) : [];
    const entry: KeyCaptureEntry = { mode: currentState ?? 'unknown', keys: new Set(keys) };
    const targets = Array.isArray(target) ? target : [target as string];
    const table: Record<string, KeyCaptureEntry> = {};
    for (const t of targets) table[t] = entry;
    return table;
  }, [ctx, pluginId, orbital, trait, keymapKnob, target]);
}

export function useOrbitalPluginHost(): {
  getState: (pluginId: string, orbital: string, trait: string) => TraitState | undefined;
  lastEvent: (pluginId: string) => string | undefined;
  errors: Readonly<Record<string, string>>;
} {
  const ctx = useOrbitalPluginHostContext('useOrbitalPluginHost');
  return { getState: ctx.getState, lastEvent: ctx.lastEvent, errors: ctx.errors };
}

/** A dispatch's client effects, painted through the plugin's handlers in order. */
function paintClientEffects(id: string, effects: readonly ClientEffectTuple[], handlers: Partial<EffectHandlers>): void {
  for (const effect of effects) {
    switch (effect[0]) {
      case 'render-ui':
        void handlers.renderUI?.(effect[1], effect[2]);
        break;
      case 'navigate':
        handlers.navigate?.(effect[1], effect[2] ?? undefined, effect[3]?.crumb);
        break;
      case 'navigate-back':
        if (handlers.navigateBack !== undefined) handlers.navigateBack();
        else log.warn('navigate-back:unhandled', { pluginId: id });
        break;
    }
  }
}

function buildMockEffectHandlers(opts: {
  pluginId: string;
  denySet: ReadonlySet<PluginHostDenyVerb>;
  slotsRef: React.MutableRefObject<UISlotManager>;
  renderedSlotsRef: React.MutableRefObject<Set<UISlot>>;
  navigateRef: React.MutableRefObject<((path: string) => void) | undefined>;
}): Partial<EffectHandlers> {
  const { pluginId, denySet, slotsRef, renderedSlotsRef, navigateRef } = opts;

  // `renderUI` is never deny-gated: rendering into the ambient slots IS the
  // plugin's UI surface, not a policy-restricted capability. `slotsRef` keeps
  // the closure fresh without recreating the runtime (the in-process playground
  // precedent: the runtime is constructed once, effect handlers read refs).
  const handlers: Partial<EffectHandlers> = {
    renderUI: (slot, pattern) => {
      if (!isUISlot(slot)) {
        log.warn('renderUI:unknown-slot', { pluginId, slot });
        return;
      }
      if (pattern === null) {
        // Clear only THIS plugin's contribution — `slotsRef.current.clear`
        // wipes every source in the slot, including stock/other plugins'
        // content the host never asked this plugin to touch.
        slotsRef.current.clearBySource(slot, pluginId);
        return;
      }
      renderedSlotsRef.current.add(slot);
      const { type, ...inline } = pattern;
      slotsRef.current.render({
        target: slot,
        pattern: type,
        props: inline as SlotProps,
        sourceTrait: pluginId,
      });
    },
  };

  if (denySet.has('navigate')) {
    handlers.navigate = (path) => log.warn('navigate:denied', { pluginId, path });
  } else if (navigateRef.current) {
    handlers.navigate = (path) => navigateRef.current?.(path);
  }

  return handlers;
}

/** A store whose writes are denied: each one is logged and dropped, reads see the seeded rows. */
function writeDeniedStore(pluginId: string, store: PersistenceAdapter): PersistenceAdapter {
  return {
    create: async (entityType: string, _data: EntityRow) => {
      log.warn('persist:denied', { pluginId, action: 'create', entityType });
      return { id: '' };
    },
    update: async (entityType: string, id: string) => {
      log.warn('persist:denied', { pluginId, action: 'update', entityType, id });
    },
    delete: async (entityType: string, id: string) => {
      log.warn('persist:denied', { pluginId, action: 'delete', entityType, id });
    },
    getById: (entityType: string, id: string) => store.getById(entityType, id),
    list: (entityType: string) => store.list(entityType),
  };
}

/** One plugin's mock circuit: the local kernel over its seeded mock store, and the client kernel dispatching to it. */
interface PluginLocalKernel {
  /** The local kernel answering the client's posted legs. */
  kernelEngine: Promise<KernelEngine>;
  /** The client-role kernel every inbound dispatch and every tick frame runs on. */
  client: KernelClient;
  instance: Promise<KernelInstance>;
  transport: EventTransport;
}

/**
 * One plugin's local kernel: its schema over a mock store seeded for the dev viewer (`seedMockStore`), the denied
 * verbs answered by the host's ports, and a client-role kernel over it, as an offline `OrbPreview` circuit runs.
 */
function openPluginKernel(
  plugin: PluginHostPlugin,
  engine: KernelEngineValue | null,
  denySet: ReadonlySet<PluginHostDenyVerb>,
): PluginLocalKernel {
  if (engine === null) throw new KernelLoaderMissingError();
  const language = engine.loadLanguage !== undefined ? engine.loadLanguage() : Promise.reject(new LanguageLoaderMissingError());
  const loadSeedProgram = engine.loadSeedProgram;
  const schema = plugin.schema;
  const opened = Promise.all([engine.loadModule(), language]).then(async ([kernel, bundle]) => {
    const rows = nativeMemoryPersistence(kernel);
    const persistence = denySet.has('persist') ? writeDeniedStore(plugin.id, rows) : rows;
    const server = openLocalKernel({
      kernel,
      language: bundle,
      schema,
      persistence,
      ...(denySet.has('call-service')
        ? {
            callService: async (service: string, action: string) => {
              log.warn('call-service:denied', { pluginId: plugin.id, service, action });
              return null;
            },
          }
        : {}),
    });
    // The owner gates evaluate on the kernel, so the store seeds once its language is installed.
    if (loadSeedProgram === undefined) throw new SeedProgramLoaderMissingError();
    const { viewer } = await withForkedSeeder(server, schema, loadSeedProgram, rows, undefined, (host) =>
      seedMockStore(host, schema, { namedByHost: false, current: () => undefined, seedIdentity: true }),
    );
    server.seedRuntimeMock(viewer?.id);
    return { kernel, server, viewer };
  });
  // The failure reaches the first dispatch through the transport (and the registration below).
  opened.catch(() => undefined);
  const kernelEngine = opened.then((o) => o.server);
  kernelEngine.catch(() => undefined);
  const transport = createLocalStoreTransport({ kernelEngine, user: opened.then((o) => o.viewer) });
  const instance = opened.then(({ kernel, viewer }) => {
    const k = new kernel.Kernel(JSON.stringify({ name: schema.name, orbitals: kernelOrbitals(schema.orbitals) }), getTabClientId());
    // The local kernel runs the whole worklist of every leg it is posted, listeners of a dispatched emit included.
    k.setHostFansOut(true);
    if (viewer !== undefined) k.setCurrentUser(JSON.stringify(viewer));
    return k;
  });
  instance.catch(() => undefined);
  const traitIndex = buildTraitIndex(schema.orbitals);
  const client = createLazyKernelClient({
    instance,
    store: createMemoryCircuitStore(Array.from(traitIndex.byName.values(), (entry) => entry.traitDef)),
    traitIndex,
    transport,
    topology: Promise.resolve({ carriesCircuitState: false }),
  });
  return { kernelEngine, client, instance, transport };
}

/** A server-mode plugin's ticks run on its host: this view runs none. */
const HOST_TICKS: Pick<KernelClient, 'startFrames'> = { startFrames: () => () => undefined };

interface PluginRuntimeMountProps {
  plugin: PluginHostPlugin;
  mode: 'mock' | 'server';
  transport?: EventTransport;
  deny?: PluginHostDenyVerb[];
  navigate?: (path: string) => void;
  onTransition?: OrbitalPluginHostProps['onTransition'];
  /** `trigger === null` marks a post-registration initial-state snapshot — not an actual dispatch. */
  onDispatched: (
    pluginId: string,
    trigger: string | null,
    states: ReadonlyArray<readonly [string, string, TraitState]>,
  ) => void;
  onError: (pluginId: string, message: string) => void;
}

function PluginRuntimeMount({
  plugin,
  mode,
  transport,
  deny,
  navigate,
  onTransition,
  onDispatched,
  onError,
}: PluginRuntimeMountProps): null {
  const bus = useEventBus();
  const rootBus = useRootEventBus();
  const chain = useTraitScopeChain();
  // A plugin emit is one physical event: the bare key (what a pattern's event-listen prop hears)
  // plus each enclosing trait's qualified key, sharing one fresh source so a trait claims it once.
  const relay = useCallback(
    (type: string, payload: EventPayload | undefined, source: BusEventSource | undefined) => {
      const physical: BusEventSource = { ...source };
      for (const key of new Set([`UI:${type}`, ...chain.map((sc) => `UI:${sc.orbital}.${sc.trait}.${type}`)])) {
        rootBus.emit(key, payload, physical);
      }
    },
    [rootBus, chain],
  );
  const { locale } = useTranslate();
  const slots = useUISlots();
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  // Slots this plugin has itself rendered into (see `buildMockEffectHandlers`'
  // `renderUI` — added to on every `render()` call, never on a clear). Read
  // by the deferred teardown effect below to restore the host's stock/
  // fallback content for those regions when the plugin is disabled.
  const renderedSlotsRef = useRef<Set<UISlot>>(new Set());
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // One kernel per plugin, opened once (StrictMode-safe: held in state like the
  // in-process playground's runtime). `deny`'s SHAPE (which verbs are stubbed
  // at all) is fixed at this first render; the navigate function VALUE stays
  // live via the ref above.
  const kernelEngineValue = useKernelEngine();
  const [mockHandlers] = useState<Partial<EffectHandlers> | undefined>(() => (mode !== 'mock' ? undefined : buildMockEffectHandlers({
    pluginId: plugin.id,
    denySet: new Set(deny ?? []),
    slotsRef,
    renderedSlotsRef,
    navigateRef,
  })));
  const denyRef = useRef(deny);
  const local = useMemo(
    () => (mode !== 'mock' ? undefined : openPluginKernel(plugin, kernelEngineValue, new Set(denyRef.current ?? []))),
    // The kernel is the plugin's program: a new schema opens a new one.
    [mode, plugin.id, plugin.schema, kernelEngineValue],
  );
  const activeTransport = local?.transport ?? (mode === 'server' ? transport : undefined);
  const engineRef = useRef<KernelInstance | undefined>(undefined);

  const registrationReady = useMemo(async () => {
    if (activeTransport === undefined) return;
    await activeTransport.register(plugin.schema);
    if (local !== undefined) engineRef.current = await local.instance;
  }, [activeTransport, local, plugin.schema]);

  useEffect(() => {
    if (mode === 'server' && !transport) {
      onError(plugin.id, 'OrbitalPluginHost: mode "server" requires a transport');
    }
  }, [mode, transport, plugin.id, onError]);

  // Deferred unmount cleanup — in-process-playground precedent. React
  // StrictMode's dev double-mount runs setup → cleanup → setup; an immediate
  // teardown here would release the kernel the real mount still needs.
  const teardownRef = useRef<{ transport: EventTransport | undefined; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => {
    // A remount of the same transport (StrictMode) cancels its pending teardown; a replaced one is torn down.
    if (teardownRef.current !== null && teardownRef.current.transport === activeTransport) {
      clearTimeout(teardownRef.current.timer);
      teardownRef.current = null;
    }
    return () => {
      const timer = setTimeout(() => {
        if (teardownRef.current?.timer === timer) teardownRef.current = null;
        if (activeTransport !== undefined) void activeTransport.unregister();
        void local?.kernelEngine.then((engine) => engine.dispose(), () => undefined);
        void local?.instance.then((instance) => {
          if (engineRef.current === instance) engineRef.current = undefined;
          instance.free();
        }, () => undefined);
        // Restore whatever stock/fallback content the host had for every
        // slot this plugin rendered into — a disabled plugin must not leave
        // its content stranded in the slot forever.
        for (const slot of renderedSlotsRef.current) {
          slotsRef.current.clearBySource(slot, plugin.id);
        }
      }, 0);
      teardownRef.current = { transport: activeTransport, timer };
    };
  }, [activeTransport, local, plugin.id]);

  const ownOrbitals = useMemo(
    () => new Set(plugin.schema.orbitals.map((o) => o.name)),
    [plugin.schema],
  );

  // The plugin's own inbound vocabulary — see the file-header note on the
  // relay rule. Any event this plugin emits under one of these names (busEvent
  // or trigger, distinct whenever a row renames on the way in) is the host's
  // own trigger relayed to a sibling `listens {}`, never a fresh request back
  // to the host.
  const inboundVocabulary = useMemo(
    () => new Set(plugin.inbound.flatMap((row) => [row.busEvent, row.trigger])),
    [plugin.inbound],
  );

  // Every trait's state as the plugin's kernel holds it, across every orbital this plugin owns.
  const snapshotAllStates = useCallback((lastEvent: string | null): Array<readonly [string, string, TraitState]> => {
    const engine = engineRef.current;
    const states: Array<readonly [string, string, TraitState]> = [];
    if (engine === undefined) return states;
    for (const orbital of plugin.schema.orbitals) {
      for (const traitName of traitNamesOf(orbital)) {
        const current = engine.getState(traitName);
        if (current !== '') states.push([orbital.name, traitName, toTraitState(traitName, current, lastEvent)]);
      }
    }
    return states;
  }, [plugin.schema]);

  // Snapshot every trait's INITIAL state as soon as registration completes,
  // so `useOrbitalPluginHost().getState` / `useDeclaredCaptureTable` read the
  // real starting state instead of "no data yet" before the first dispatch.
  useEffect(() => {
    let cancelled = false;
    void registrationReady.then(() => {
      if (cancelled) return;
      const states = snapshotAllStates(null);
      if (states.length > 0) onDispatched(plugin.id, null, states);
    }).catch((err) => {
      if (!cancelled) onError(plugin.id, err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [registrationReady, plugin.id, onDispatched, onError, snapshotAllStates]);

  const orbitalOfTrait = useMemo(
    () => new Map(plugin.schema.orbitals.flatMap((orbital) => traitNamesOf(orbital).map((trait) => [trait, orbital.name] as const))),
    [plugin.schema],
  );

  // One run's outcome, an inbound dispatch (`trigger`) or a tick frame (`null`): its client effects paint, its emits
  // reach the host bus, and the traits it moved are reported.
  const settle = useCallback(
    (trigger: string | null, response: OrbitalEventResponse, orbital: string | undefined) => {
      if (!response.success) {
        onError(plugin.id, response.error ?? `${plugin.id}: ${trigger ?? 'tick'} failed`);
      }
      // The kernel answers a dispatch with its client effects; they paint through this plugin's own handlers.
      if (mockHandlers !== undefined) paintClientEffects(plugin.id, response.clientEffects ?? [], mockHandlers);

      // Outbound: every emit of the run reaches the host bus once, except the
      // plugin's own inbound vocabulary (RELAY RULE), anything outside a
      // declared `outbound` list, and emits sourced outside its own orbitals.
      for (const entry of response.emittedEvents ?? []) {
        if (inboundVocabulary.has(entry.event)) continue;
        if (plugin.outbound !== undefined && !plugin.outbound.includes(entry.event)) continue;
        const sourceOrbital = entry.source?.orbital;
        if (sourceOrbital === undefined || !ownOrbitals.has(sourceOrbital)) continue;
        relay(entry.event, entry.payload, entry.source);
      }

      // A cascade moves sibling traits the response does not name: a local kernel reports every trait it holds.
      const transitions = Object.entries(response.states).flatMap(([traitName, stateName]) => {
        const owner = orbital ?? orbitalOfTrait.get(traitName);
        return owner === undefined ? [] : [[owner, traitName, stateName] as const];
      });
      const states: Array<readonly [string, string, TraitState]> = local !== undefined
        ? snapshotAllStates(trigger)
        : transitions.map(([owner, traitName, stateName]) => [owner, traitName, toTraitState(traitName, stateName, trigger)] as const);
      for (const [owner, traitName, stateName] of transitions) onTransition?.(plugin.id, owner, traitName, stateName);
      onDispatched(plugin.id, trigger, states);
    },
    [local, mockHandlers, plugin, ownOrbitals, orbitalOfTrait, inboundVocabulary, relay, snapshotAllStates, onError, onTransition, onDispatched],
  );

  const dispatch = useCallback(
    async (row: PluginHostInbound, payload: EventPayload | undefined) => {
      await registrationReady;
      const request = { event: row.trigger, payload, targetTrait: row.trait, locale };
      if (local !== undefined) {
        settle(row.trigger, (await local.client.dispatch(request)).response, row.orbital);
        return;
      }
      if (activeTransport === undefined) return;
      settle(row.trigger, await activeTransport.send(row.orbital, request), row.orbital);
    },
    [registrationReady, activeTransport, local, locale, settle],
  );

  // The plugin's `ticks {}` run on its client kernel's tick clock (the one browser tick driver); a server-mode
  // plugin's ticks run on its host. Each frame's outcomes settle as a run, and what a tick's post added paints when it lands.
  const onKernelFrame = useCallback(
    (outcomes: ClientKernelOutcome[]) => {
      for (const outcome of outcomes) {
        settle(null, outcome.response, undefined);
        void outcome.tickSettled?.then((added) => {
          if (added !== undefined && mockHandlers !== undefined) paintClientEffects(plugin.id, added.clientEffects ?? [], mockHandlers);
        });
      }
    },
    [settle, mockHandlers, plugin.id],
  );
  useClientTicks({
    kernelClient: local?.client ?? HOST_TICKS,
    onKernelFrame,
    ...(kernelEngineValue?.scheduleFrame !== undefined ? { scheduleFrame: kernelEngineValue.scheduleFrame } : {}),
    hostRunsProgram: local === undefined,
  });

  // Inside a trait scope the bus fans a bare `UI:EVENT` out to one qualified
  // `UI:<orbital>.<trait>.EVENT` key per scope on the chain and drops the bare
  // key, so an inbound row listens on the bare key AND every qualified key of
  // the host's chain. One physical emit carries one source object across its
  // keys; a row dispatches it once.
  useEffect(() => {
    const unsubs = plugin.inbound.flatMap((row) => {
      const keys = new Set([`UI:${row.busEvent}`, ...chain.map((sc) => `UI:${sc.orbital}.${sc.trait}.${row.busEvent}`)]);
      const delivered = new WeakSet<object>();
      return Array.from(keys, (key) =>
        bus.on(key, (event) => {
          if (event.source) {
            if (delivered.has(event.source)) return;
            delivered.add(event.source);
          }
          void dispatch(row, event.payload).catch((err) => {
            onError(plugin.id, err instanceof Error ? err.message : String(err));
          });
        }),
      );
    });
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [bus, plugin, dispatch, onError, chain]);

  return null;
}

/**
 * Mounts one headless kernel per plugin against the ambient
 * event bus + slot provider. Renders nothing of its own besides an optional
 * `children` passthrough — MUST be mounted inside `EventBusProvider` +
 * `UISlotProvider`.
 */
export function OrbitalPluginHost({
  plugins,
  mode = 'mock',
  transport,
  deny,
  navigate,
  onTransition,
  children,
}: OrbitalPluginHostProps): React.ReactElement {
  const [tick, setTick] = useState(0);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const statesRef = useRef<Map<string, Map<string, TraitState>>>(new Map());
  const lastEventRef = useRef<Map<string, string>>(new Map());

  const pluginSchemas = useMemo(
    () => new Map(plugins.map((plugin) => [plugin.id, plugin.schema] as const)),
    [plugins],
  );

  const handleDispatched = useCallback(
    (pluginId: string, trigger: string | null, states: ReadonlyArray<readonly [string, string, TraitState]>) => {
      if (trigger !== null) {
        lastEventRef.current.set(pluginId, trigger);
      }
      let byKey = statesRef.current.get(pluginId);
      if (!byKey) {
        byKey = new Map();
        statesRef.current.set(pluginId, byKey);
      }
      for (const [orbital, trait, state] of states) {
        byKey.set(`${orbital}.${trait}`, state);
      }
      setTick((t) => t + 1);
    },
    [],
  );

  const handleError = useCallback((pluginId: string, message: string) => {
    setErrors((prev) => (prev[pluginId] === message ? prev : { ...prev, [pluginId]: message }));
  }, []);

  const contextValue = useMemo<OrbitalPluginHostContextValue>(
    () => ({
      getState: (pluginId, orbital, trait) => statesRef.current.get(pluginId)?.get(`${orbital}.${trait}`),
      lastEvent: (pluginId) => lastEventRef.current.get(pluginId),
      errors,
      tick,
      getPluginSchema: (pluginId) => pluginSchemas.get(pluginId),
    }),
    [errors, tick, pluginSchemas],
  );

  return (
    <OrbitalPluginHostContext.Provider value={contextValue}>
      {plugins.map((plugin) => (
        <PluginRuntimeMount
          key={plugin.id}
          plugin={plugin}
          mode={mode}
          transport={transport}
          deny={deny}
          navigate={navigate}
          onTransition={onTransition}
          onDispatched={handleDispatched}
          onError={handleError}
        />
      ))}
      {children ?? null}
    </OrbitalPluginHostContext.Provider>
  );
}

export default OrbitalPluginHost;
