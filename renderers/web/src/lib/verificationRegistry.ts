/**
 * Verification Registry - Tracks runtime verification checks and transition traces
 *
 * Provides:
 * 1. A checklist of pass/fail checks (INIT has fetch, bridge connected, etc.)
 * 2. A full transition timeline with effect execution results
 * 3. ServerBridge health snapshot
 * 4. window.__orbitalVerification for Playwright/automation
 *
 * @packageDocumentation
 */

import { createLogger } from '@almadar/logger';
import type { DrawableNode } from './drawable/paintDispatch';
import type {
  AssetLoadStatus,
  BridgeHealth,
  BusEvent,
  CheckStatus,
  EffectTrace,
  EventLogEntry,
  EventPayload,
  OrbitalEventRequest,
  OrbitalEventResponse,
  OrbitalVerificationAPI,
  ServerEffectResult,
  ServerResponseTrace,
  TraitStateSnapshot,
  TransitionTrace,
  VerificationCheck,
  VerificationSnapshot,
  VerificationSummary,
} from '@almadar/core';
import type { EventTransport } from '../index';

const log = createLogger('almadar:bridge');

// Re-export the wire types so existing `@almadar/ui/lib` consumers
// (generated trait hooks, storybook fixtures) keep working without
// flipping their imports. New code should import straight from
// `@almadar/core`.
export type {
  AssetLoadStatus,
  BridgeHealth,
  CheckStatus,
  EffectTrace,
  EventLogEntry,
  OrbitalVerificationAPI,
  ServerResponseTrace,
  TraitStateSnapshot,
  TransitionTrace,
  VerificationCheck,
  VerificationSnapshot,
  VerificationSummary,
};

// ============================================================================
// State — stored on window to survive duplicate module instances (Vite dev)
// ============================================================================

const MAX_TRANSITIONS = 500;

type ChangeListener = () => void;

/**
 * Per-trait snapshot getter. Each generated trait logic hook (or
 * `useTraitStateMachine` trait binding) registers one on mount so the
 * verifier can read the live reducer state for that trait.
 */
export type TraitSnapshotGetter = () => TraitStateSnapshot;

interface RegistryState {
  checks: Map<string, VerificationCheck>;
  transitions: TransitionTrace[];
  bridgeHealth: BridgeHealth | null;
  listeners: Set<ChangeListener>;
  /**
   * Per-trait snapshot providers, keyed by trait name. Readers iterate
   * this map inside `getTraitSnapshots()`.
   */
  traitSnapshots: Map<string, TraitSnapshotGetter>;
}

function getState(): RegistryState {
  if (typeof window !== 'undefined') {
    const w = window as Window & { __verificationRegistryState?: RegistryState };
    if (!w.__verificationRegistryState) {
      w.__verificationRegistryState = {
        checks: new Map(),
        transitions: [],
        bridgeHealth: null,
        listeners: new Set(),
        traitSnapshots: new Map(),
      };
    }
    return w.__verificationRegistryState;
  }
  // SSR fallback
  return {
    checks: new Map(),
    transitions: [],
    bridgeHealth: null,
    listeners: new Set(),
    traitSnapshots: new Map(),
  };
}

// Direct accessors — no proxies, just use getState() in every function

function notifyListeners(): void {
  getState().listeners.forEach((l) => l());
  exposeOnWindow();
}

// ============================================================================
// Checks API
// ============================================================================

export function registerCheck(
  id: string,
  label: string,
  status: CheckStatus = "pending",
  details?: string,
): void {
  getState().checks.set(id, { id, label, status, details, updatedAt: Date.now() });
  notifyListeners();
}

export function updateCheck(
  id: string,
  status: CheckStatus,
  details?: string,
): void {
  const check = getState().checks.get(id);
  if (check) {
    check.status = status;
    if (details !== undefined) check.details = details;
    check.updatedAt = Date.now();
  } else {
    getState().checks.set(id, { id, label: id, status, details, updatedAt: Date.now() });
  }
  notifyListeners();
}

export function getAllChecks(): VerificationCheck[] {
  return Array.from(getState().checks.values());
}

// ============================================================================
// Transition Timeline API
// ============================================================================

export function recordTransition(trace: Omit<TransitionTrace, "id">): void {
  const entry: TransitionTrace = {
    ...trace,
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  };
  log.debug('transition:recorded', { trait: trace.traitName, from: trace.from, to: trace.to, event: trace.event, effectCount: trace.effects.length });
  getState().transitions.push(entry);

  if (getState().transitions.length > MAX_TRANSITIONS) {
    getState().transitions.shift();
  }

  // Auto-validate: check INIT transitions for fetch effects
  if (entry.event === "INIT") {
    const hasFetch = entry.effects.some((e) => e.type === "fetch");
    // A tick-driven or config-seeded entity is also validly populated by
    // `(set @entity.<field> ...)` on INIT, not just `fetch` — e.g. the
    // learning-* engine family seeds `bodies`/`units` from `@config`.
    const hasEntitySeed = entry.effects.some(
      (e) =>
        e.type === "set" &&
        typeof e.args[0] === "string" &&
        e.args[0].startsWith("@entity."),
    );
    const checkId = `init-fetch-${entry.traitName}`;
    if (hasFetch || hasEntitySeed) {
      registerCheck(
        checkId,
        `INIT transition for "${entry.traitName}" has fetch or entity-seed effect`,
        "pass",
      );
    } else {
      // Only warn if the trait renders entity-bound patterns: the render-ui
      // args must reference `@entity.` data. Presentational renders
      // (loading-state, empty-state, spinners) bind config only and never
      // need a fetch.
      const rendersEntityData = entry.effects.some(
        (e) => e.type === "render-ui" && JSON.stringify(e.args).includes("@entity."),
      );
      if (rendersEntityData) {
        // A `[runtime, shared]` entity is seeded by a SIBLING writer trait's
        // own INIT (`set @entity…` / `fetch`) — the render trait reads the
        // shared store, so its data is not empty despite having no fetch of
        // its own. Sibling seeds recorded before this INIT (the manager
        // processes bindings in order, writers first) satisfy the check.
        const siblingSeeds = getState().transitions.some(
          (t) =>
            t.event === "INIT" &&
            t.effects.some(
              (e) =>
                e.type === "fetch" ||
                (e.type === "set" &&
                  typeof e.args[0] === "string" &&
                  e.args[0].startsWith("@entity.")),
            ),
        );
        if (siblingSeeds) {
          registerCheck(
            checkId,
            `INIT transition for "${entry.traitName}" has sibling entity-seed (shared entity)`,
            "pass",
          );
        } else {
          registerCheck(
            checkId,
            `INIT transition for "${entry.traitName}" missing fetch effect`,
            "fail",
            "Entity-bound render-ui without a fetch effect will show empty data",
          );
        }
      }
    }
  }

  // Auto-validate: check effects executed successfully
  const failedEffects = entry.effects.filter((e) => e.status === "failed");
  if (failedEffects.length > 0) {
    registerCheck(
      `effects-${entry.id}`,
      `Effects failed in ${entry.traitName}: ${entry.from} -> ${entry.to}`,
      "fail",
      failedEffects.map((e) => `${e.type}: ${e.error}`).join("; "),
    );
  }

  notifyListeners();
}

export function getTransitions(): TransitionTrace[] {
  return [...getState().transitions];
}

export function getTransitionsForTrait(traitName: string): TransitionTrace[] {
  return getState().transitions.filter((t) => t.traitName === traitName);
}

/**
 * Record a server response as a timeline entry.
 * Creates a synthetic transition entry with type "server-response" to show
 * what the server returned (clientEffects, data counts, emitted events).
 *
 * `effectResults` — the server's persist/set/call-service outcomes, already
 * mapped to `EffectTrace` by the caller — populate `entry.effects` so a
 * denied or failed persist is visible on this synthetic entry too. Before
 * this it was always `[]`: the ONLY entry the driver's per-event
 * `server:<orbital>` lookup (`default-snapshot.ts`'s `lastEffectResultsFor`)
 * can find carried nothing.
 */
export function recordServerResponse(
  orbitalName: string,
  event: string,
  response: Omit<ServerResponseTrace, "orbitalName" | "timestamp"> & { effectResults?: EffectTrace[] },
): void {
  const { effectResults, ...responseFields } = response;
  const serverResponse: ServerResponseTrace = {
    ...responseFields,
    orbitalName,
    timestamp: Date.now(),
  };

  const entry: TransitionTrace = {
    id: `srv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    traitName: `server:${orbitalName}`,
    from: "server",
    to: "server",
    event,
    effects: effectResults ?? [],
    serverResponse,
    timestamp: Date.now(),
  };

  getState().transitions.push(entry);
  if (getState().transitions.length > MAX_TRANSITIONS) {
    getState().transitions.shift();
  }

  if (!response.success && response.error) {
    registerCheck(
      `server-error-${entry.id}`,
      `Server error for ${orbitalName}:${event}`,
      "fail",
      response.error,
    );
  }

  notifyListeners();
}

/** A server response's `effectResults` as timeline traces, carrying each persist's real outcome (entity, action, resulting id, denied). */
export function serverEffectTraces(results: readonly ServerEffectResult[] | undefined): EffectTrace[] {
  if (!results) return [];
  return results.map((r): EffectTrace => {
    const resultId =
      typeof r.data === 'object' && r.data !== null && !Array.isArray(r.data) && 'id' in r.data && typeof r.data.id === 'string'
        ? r.data.id
        : undefined;
    const outcome: EffectTrace['outcome'] = r.denied ? 'denied' : r.success ? 'success' : 'failed';
    return {
      type: r.effect,
      ...(r.entityType !== undefined ? { entityName: r.entityType } : {}),
      ...(r.action === 'create' || r.action === 'update' || r.action === 'delete' || r.action === 'batch' ? { action: r.action } : {}),
      ...(resultId !== undefined ? { resultId } : {}),
      outcome,
      args: [],
      status: outcome === 'success' ? 'executed' : 'failed',
      ...(r.error !== undefined ? { error: r.error } : {}),
      ...(r.target !== undefined ? { target: r.target } : {}),
      ...(r.routed !== undefined ? { routed: r.routed } : {}),
    };
  });
}

/** Record one answered server leg on the timeline as a `server:<orbital>` trace. */
export function recordOrbitalResponse(orbitalName: string, request: OrbitalEventRequest, response: OrbitalEventResponse): void {
  recordServerResponse(orbitalName, request.event, {
    success: response.success,
    transitioned: response.transitioned,
    emitted: response.emittedEvents.map((e) => ({ event: e.event, ...(e.payload !== undefined ? { payload: e.payload } : {}) })),
    emittedEvents: response.emittedEvents.map((e) => e.event),
    clientEffects: response.clientEffects?.length ?? 0,
    dataEntities: Object.fromEntries(Object.entries(response.data ?? {}).map(([name, rows]) => [name, rows.length])),
    ...(response.error !== undefined ? { error: response.error } : {}),
    effectResults: serverEffectTraces(response.effectResults),
  });
}

/** `transport` with every answered post recorded on the verification timeline; the one place the circuit client's server responses are captured. */
export function recordingTransport(transport: EventTransport): EventTransport {
  const subscribe = transport.subscribe?.bind(transport);
  const subscribeHostDispatches = transport.subscribeHostDispatches?.bind(transport);
  return {
    ...(transport.hostsBrowserStore !== undefined ? { hostsBrowserStore: transport.hostsBrowserStore } : {}),
    register: (schema) => transport.register(schema),
    unregister: () => transport.unregister(),
    send: async (orbitalName, request) => {
      const response = await transport.send(orbitalName, request);
      recordOrbitalResponse(orbitalName, request, response);
      return response;
    },
    ...(subscribe !== undefined ? { subscribe } : {}),
    ...(subscribeHostDispatches !== undefined ? { subscribeHostDispatches } : {}),
  };
}

// ============================================================================
// Bridge Health API
// ============================================================================

export function updateBridgeHealth(health: BridgeHealth): void {
  getState().bridgeHealth = { ...health };

  const checkId = "server-bridge";
  if (health.connected) {
    registerCheck(checkId, "Server bridge connected", "pass");
  } else {
    registerCheck(
      checkId,
      "Server bridge disconnected",
      "fail",
      health.lastError || "Bridge is not connected",
    );
  }

  notifyListeners();
}

export function getBridgeHealth(): BridgeHealth | null {
  const bh = getState().bridgeHealth;
  return bh ? { ...bh } : null;
}

// ============================================================================
// Summary
// ============================================================================

export function getSummary(): VerificationSummary {
  const allChecks = getAllChecks();
  return {
    totalChecks: allChecks.length,
    passed: allChecks.filter((c) => c.status === "pass").length,
    failed: allChecks.filter((c) => c.status === "fail").length,
    warnings: allChecks.filter((c) => c.status === "warn").length,
    pending: allChecks.filter((c) => c.status === "pending").length,
  };
}

// ============================================================================
// Snapshot (for automation)
// ============================================================================

export function getSnapshot(): VerificationSnapshot {
  return {
    checks: getAllChecks(),
    transitions: getTransitions(),
    bridge: getBridgeHealth(),
    summary: getSummary(),
    traits: getTraitSnapshots(),
  };
}

/**
 * Per-trait snapshot for the verifier.
 *
 * Iterates every registered trait getter and collects the live reducer
 * state. Empty until at least one trait hook calls `registerTraitSnapshot`.
 * A getter that throws is logged and skipped — one broken trait must not
 * poison the rest of the snapshot.
 */
export function getTraitSnapshots(): TraitStateSnapshot[] {
  const snapshots: TraitStateSnapshot[] = [];
  for (const [traitName, getter] of getState().traitSnapshots.entries()) {
    try {
      snapshots.push(getter());
    } catch (err) {
      log.error('traitSnapshot getter failed', { trait: traitName, err: String(err) });
    }
  }
  return snapshots;
}

// ============================================================================
// Subscriptions
// ============================================================================

export function subscribeToVerification(listener: ChangeListener): () => void {
  getState().listeners.add(listener);
  return () => getState().listeners.delete(listener);
}

// ============================================================================
// Window exposure for Playwright/automation
// ============================================================================

declare global {
  interface Window {
    __orbitalVerification?: OrbitalVerificationAPI;
  }
}

/**
 * Default `getTraitState` reader: derive a trait's current state from the
 * generated-hook-registered snapshot getter (same source as
 * `getTraitSnapshots`). Without this the bridge only exposed `getTraitState`
 * when a runtimeManager-backed `VerificationProvider` ran `bindTraitStateGetter`
 * — which the generated shell never wires — so the verifier's `getState` read
 * `undefined` after every dispatch.
 */
function defaultGetTraitState(traitName: string): string | undefined {
  const getter = getState().traitSnapshots.get(traitName);
  if (getter === undefined) return undefined;
  try {
    return getter().currentState;
  } catch {
    return undefined;
  }
}

/** Whether a verifier is driving this page: the `__ALMADAR_VERIFY__` window flag it sets before the bundle runs. */
export function verifierAttached(): boolean {
  return typeof window !== "undefined" && (window as Window & { __ALMADAR_VERIFY__?: boolean }).__ALMADAR_VERIFY__ === true;
}

function exposeOnWindow(): void {
  if (typeof window === "undefined") return;

  if (!window.__orbitalVerification) {
    window.__orbitalVerification = {
      getSnapshot,
      getChecks: getAllChecks,
      getTransitions: getTransitions,
      getBridge: getBridgeHealth,
      getSummary,
      waitForTransition,
      getTraitSnapshots,
      getTraitState: defaultGetTraitState,
    };
  } else {
    // Back-compat: attach readers that may have been added after an older
    // bundle exposed the API first. getTraitState defaults to reading the
    // generated-hook-registered trait snapshots (a `bindTraitStateGetter`
    // override from a runtimeManager-backed VerificationProvider still wins).
    if (!window.__orbitalVerification.getTraitSnapshots) {
      window.__orbitalVerification.getTraitSnapshots = getTraitSnapshots;
    }
    if (!window.__orbitalVerification.getTraitState) {
      window.__orbitalVerification.getTraitState = defaultGetTraitState;
    }
  }
}

/**
 * Wait for a transition matching the given event to appear.
 * Returns the trace or null on timeout.
 */
export function waitForTransition(
  event: string,
  timeoutMs = 10_000,
): Promise<TransitionTrace | null> {
  return new Promise((resolve) => {
    // Check if already recorded
    const existing = getState().transitions.find((t) => t.event === event);
    if (existing) {
      resolve(existing);
      return;
    }

    const timeout = setTimeout(() => {
      unsub();
      resolve(null);
    }, timeoutMs);

    const unsub = subscribeToVerification(() => {
      const found = getState().transitions.find((t) => t.event === event);
      if (found) {
        clearTimeout(timeout);
        unsub();
        resolve(found);
      }
    });
  });
}

/**
 * Bind the EventBus so automation can send events and log emissions.
 * Call this during app initialization.
 */
export function bindEventBus(eventBus: {
  emit: (type: string, payload?: EventPayload) => void;
  onAny?: (listener: (event: BusEvent) => void) => () => void;
}): void {
  if (typeof window === "undefined") return;

  log.info('bindEventBus', { hasOnAny: !!eventBus.onAny });

  exposeOnWindow();
  if (window.__orbitalVerification) {
    window.__orbitalVerification.sendEvent = (event, payload, traitScope) => {
      // Gap #13: dispatch via the qualified bus key
      // `UI:${traitScope}.${event}` so codegen-emitted subscriptions
      // (own `useUIEvents` and cross-trait `useTraitListens`) match.
      // Bare `UI:${event}` is retained only when no traitScope is
      // provided — the kernel passes the dispatching trait per step,
      // so absent scope means a legacy / system-scope dispatch.
      const prefixed = event.startsWith('UI:')
        ? event
        : traitScope
          ? `UI:${traitScope}.${event}`
          : `UI:${event}`;
      log.debug('sendEvent', { event: prefixed, traitScope, payloadKeys: payload ? Object.keys(payload) : [] });
      eventBus.emit(prefixed, payload);
    };

    // Initialize event log. Ring-buffered to the last MAX_EVENT_LOG
    // entries: on overflow the OLDEST entry is evicted (tracked in
    // eventLogDropped) so the recent — driven — tail is never silently
    // dropped. The prior hard cap `if (length < 200) push` stopped
    // recording once full, which made a late-run driven event (e.g. an
    // emit-sweep probe) vanish from the delta. eventLogEpoch is a
    // per-page-load nonce the verifier uses to detect resets across
    // hermetic reloads (array length is not a reliable reset sentinel —
    // a reload can refill to the same count).
    const MAX_EVENT_LOG = 5000;
    const eventLog: EventLogEntry[] = [];
    let eventLogDropped = 0;
    const bumpEpoch = () => {
      window.__orbitalVerification!.eventLogEpoch = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    };
    window.__orbitalVerification.eventLog = eventLog;
    window.__orbitalVerification.eventLogDropped = 0;
    bumpEpoch();
    window.__orbitalVerification.clearEventLog = () => {
      eventLog.length = 0;
      eventLogDropped = 0;
      window.__orbitalVerification!.eventLogDropped = 0;
      bumpEpoch();
    };

    // Instrument event bus to log all emissions
    if (eventBus.onAny) {
      const verificationRegistryEventLogger = (event: BusEvent) => {
        eventLog.push({
          type: event.type,
          payload: event.payload,
          ...(event.source === undefined ? {} : { source: event.source }),
          timestamp: Date.now(),
        });
        if (eventLog.length > MAX_EVENT_LOG) {
          eventLog.shift();
          eventLogDropped += 1;
          window.__orbitalVerification!.eventLogDropped = eventLogDropped;
        }
      };
      // See VerificationProvider for the same defineProperty pattern.
      // Vite/Rollup minify const-binding names; a runtime name
      // assignment is preserved through the bundle so the per-listener
      // log can identify this subscriber.
      Object.defineProperty(verificationRegistryEventLogger, 'name', {
        value: 'verificationRegistry:eventLog',
      });
      eventBus.onAny(verificationRegistryEventLogger);
    }
  }
}

export function bindConfigApplier(
  applyConfig: NonNullable<OrbitalVerificationAPI['applyConfig']>,
): () => void {
  if (typeof window === "undefined") return () => {};
  exposeOnWindow();
  const bridge = window.__orbitalVerification;
  if (!bridge) return () => {};
  bridge.applyConfig = applyConfig;
  return () => {
    if (bridge.applyConfig === applyConfig) delete bridge.applyConfig;
  };
}

/**
 * Bind a trait state getter so automation can query current states.
 */
export function bindTraitStateGetter(
  getter: (traitName: string) => string | undefined,
): void {
  if (typeof window === "undefined") return;

  exposeOnWindow();
  if (window.__orbitalVerification) {
    window.__orbitalVerification.getTraitState = getter;
  }
}

/**
 * Register a per-trait snapshot provider. The generated trait logic hook
 * (or `useTraitStateMachine`) calls this once on mount, passing a getter
 * that reads the current reducer state via a ref. Returns an unregister
 * function for cleanup on unmount.
 *
 * Calling this twice for the same `traitName` replaces the previous
 * getter (e.g. page navigation remounts the trait; the new registration
 * wins).
 */
export function registerTraitSnapshot(
  traitName: string,
  getter: TraitSnapshotGetter,
): () => void {
  if (typeof window === "undefined") return () => {};
  getState().traitSnapshots.set(traitName, getter);
  exposeOnWindow();
  notifyListeners();
  return () => {
    const s = getState();
    if (s.traitSnapshots.get(traitName) === getter) {
      s.traitSnapshots.delete(traitName);
      notifyListeners();
    }
  };
}

// ============================================================================
// Canvas Frame Capture API (for game verification)
// ============================================================================

/**
 * Register a canvas frame capture function.
 * Called by game organisms (IsometricCanvas, PlatformerCanvas)
 * so the verifier can snapshot canvas content at checkpoints.
 */
export function bindCanvasCapture(
  captureFn: () => string | null,
): void {
  if (typeof window === "undefined") return;

  exposeOnWindow();
  if (window.__orbitalVerification) {
    window.__orbitalVerification.captureFrame = captureFn;
  }
}

/**
 * Bind a reader for the last drawables list received by a canvas host.
 * Lets verification scripts inspect exactly which neutral descriptors reached
 * the painter without re-deriving them from state.
 */
export function bindLastDrawables(
  getDrawables: () => DrawableNode[] | null,
): void {
  if (typeof window === "undefined") return;

  exposeOnWindow();
  if (window.__orbitalVerification) {
    window.__orbitalVerification.getLastDrawables = getDrawables;
  }
}

/**
 * Update asset load status for canvas verification.
 * Game organisms call this when images load or fail.
 */
export function updateAssetStatus(
  url: string,
  status: AssetLoadStatus,
): void {
  if (typeof window === "undefined") return;

  exposeOnWindow();
  if (window.__orbitalVerification) {
    if (!window.__orbitalVerification.assetStatus) {
      window.__orbitalVerification.assetStatus = {};
    }
    window.__orbitalVerification.assetStatus[url] = status;
  }
}

// ============================================================================
// Clear (for testing)
// ============================================================================

export function clearVerification(): void {
  getState().checks.clear();
  getState().transitions.length = 0;
  getState().bridgeHealth = null;
  notifyListeners();
}

// Auto-initialize on import
exposeOnWindow();
