/**
 * useCircuitKernel — W5b (docs/Almadar_Runtime_Stateless_Stateful_PLAN.md §5.1).
 *
 * The ONE per-page store + trait index + client kernel. Everything else in
 * `hooks/circuit/` is a thin React concern layered on top of the three
 * values this hook returns; the actual event evaluation, dispatch-mode
 * routing, server-leg posting and response fold all live in
 * the Rust client-role kernel (`@almadar/kernel`, through `lib/kernel-client.ts`).
 *
 * Rebuilt when `traitBindings` changes (page nav).
 *
 * Offline preview (no server, no explicit transport — plan G7): when the
 * caller supplies a `persistence` adapter and no `transport`, this hook
 * builds an in-process `EventTransport` whose evaluator runs
 * `evaluateOrbitalEvent` with a SERVER-role effect runner
 * (`createIndexStageRunner`) against that adapter — the same composition
 * every other host runs, just with a local `PersistenceAdapter` standing in
 * for a real server. With neither `transport` nor `persistence`, the kernel
 * has no transport at all: every dispatch runs Client-env locally and
 * nothing is ever posted (`ClientKernelOpts.transport` omitted).
 *
 * Server-pushed cascade events (`EventTransport.subscribe`, e.g. another
 * client's persist envelope) fan out through the SAME `collectListenerTargets`
 * the composition's own in-band fan-out and `applyOrbitalEventResponse`'s
 * response fold use — one matching implementation, three entry points.
 *
 * @packageDocumentation
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type {
  EventPayload,
  OrbitalDefinition,
  ResolvedTraitBinding,
  ServiceParams,
  UserContext,
} from '@almadar/core';
import { createMemoryCircuitStore, type CircuitStore } from '@almadar/shell-runtime/client/circuit-store';
import type { ClientKernel, ClientKernelOutcome } from '@almadar/shell-runtime/client/client-kernel';
import type { EventTransport } from '@almadar/shell-runtime/client/EventTransport';
import type { TransitionObserver } from '@almadar/shell-runtime/client/trait-types';
import { buildTraitIndex, collectListenerTargets, createLocalStoreTransport, createResidenceTransport, localStorePersistence, nativeMemoryPersistence, openLocalKernel } from '../../runtime';
import type { IndexedTrait, TraitIndex, SchemaMetadata } from '@almadar/core';
import { UNMOUNT_EVENT, type OrbitalSchema, type PersistenceAdapter } from '@almadar/core';
import { createLogger } from '@almadar/logger';
import { recordingTransport, verifierAttached } from '../../lib/verificationRegistry';
import { createLazyKernelClient } from '../../lib/kernel-client-lazy';
import type { KernelClient } from '../../lib/kernel-client';
import type { KernelInstance } from '../../lib/kernel-wire';
import { kernelOrbitals } from '../../lib/kernel-schema';
import { KernelLoaderMissingError, LanguageLoaderMissingError, type KernelEngineValue } from '../../providers/KernelEngineContext';
import { useTranslate, useRenderI18n } from '../../core';

export interface UseCircuitKernelOptions {
  /** The resolved schema's full orbital set (`OrbitalSchema.orbitals`) —
   *  the one input `buildTraitIndex` needs; the trait index is then
   *  restricted to the traits `traitBindings` actually mounts. */
  orbitals: readonly OrbitalDefinition[];
  /** The program's `_metadata`: a compiled client program carries its operator sites and dispatch facts there, which a
   *  browser kernel (no operator table) needs to register the program. */
  metadata?: SchemaMetadata;
  /** Caller-owned transport (server bridge, or a custom in-process one). */
  transport?: EventTransport;
  /** From the transport's `register()` result — `true` = the stateless
   *  topology (a posted leg must carry `traits`/`entityByTrait`). */
  carriesCircuitState?: boolean;
  /** `true` while the transport's topology is still unknown (its `register()`
   *  is pending): dispatches are held, then released in order onto the
   *  kernel built for the confirmed topology — a post made on the guess
   *  goes out in the wrong shape. */
  awaitTopology?: boolean;
  /** Offline-preview persistence layer (plan G7). */
  persistence?: PersistenceAdapter;
  /** The browser store for `[persistent: x, browser]` entities: legs over their
   *  data run in-process against it, every other leg goes to `transport`. */
  browserStore?: PersistenceAdapter;
  /** Consumer `call-service` hook for the offline in-process evaluator. */
  callService?: (service: string, action: string, params?: ServiceParams) => Promise<EventPayload>;
  user?: UserContext;
  /** Verification/perf recording of each transition and rollback. */
  observer?: TransitionObserver;
  /** The kernel the circuit runs on: `useKernelEngine()` under a `KernelEngineProvider`; `null` throws `KernelLoaderMissingError`. */
  engine: KernelEngineValue | null;
}

export interface CircuitKernelHandle {
  kernel: ClientKernel;
  store: CircuitStore;
  traitIndex: TraitIndex;
  /** Every trait of the app (all pages); `traitIndex` is the current page's. */
  appTraitNames: ReadonlySet<string>;
  /** The server the kernel posts to; its pushes are settled by the caller. */
  transport: EventTransport | undefined;
  /** The WebAssembly-backed client the circuit runs on. */
  engine: KernelClient;
}

/**
 * Per-TAB identity (Almadar_Live_Push.md) — module-scoped, NOT per hook
 * instance. A page mounting several circuit kernels is still ONE origin:
 * the server's broadcast exclusion keys on this id, and per-kernel ids
 * would let one kernel's persist echo back into a sibling kernel on the
 * same tab. Moved from the old `providers/ServerBridge.tsx`'s
 * `getTabClientId`, now the client role's own concern since dispatching
 * and subscribing both moved here.
 */
let tabClientId: string | undefined;
export function getTabClientId(): string {
  if (tabClientId === undefined) tabClientId = crypto.randomUUID();
  return tabClientId;
}

const log = createLogger('almadar:ui:circuit-kernel');

function postUnmounts(transport: EventTransport, traits: ReadonlyArray<readonly [string, string]>, locale: string): void {
  for (const [traitName, orbitalName] of traits) {
    transport
      .send(orbitalName, { event: UNMOUNT_EVENT, targetTrait: traitName, clientId: getTabClientId(), locale })
      .catch((err) => log.warn('unmount-post-failed', { trait: traitName, orbital: orbitalName, error: String(err) }));
  }
}

/** Restrict a full-schema `TraitIndex` down to the traits this page mounts —
 *  the client's browser store only ever holds the current page's circuit,
 *  never an off-page trait it has nothing rendered for. */
function restrictTraitIndex(full: TraitIndex, activeNames: ReadonlySet<string>): TraitIndex {
  const byName = new Map<string, IndexedTrait>();
  for (const [name, entry] of full.byName) {
    if (activeNames.has(name)) byName.set(name, entry);
  }
  return { byName, allEntities: full.allEntities, orbitals: full.orbitals };
}

/** The previous orbital set while a new array carries the same content: a host that rebuilds the array each render must not rebuild the circuit. */
function useContentStable(orbitals: readonly OrbitalDefinition[]): readonly OrbitalDefinition[] {
  const held = useRef<{ value: readonly OrbitalDefinition[]; key: string } | null>(null);
  if (held.current === null) {
    held.current = { value: orbitals, key: JSON.stringify(orbitals) };
  } else if (held.current.value !== orbitals) {
    const key = JSON.stringify(orbitals);
    if (key !== held.current.key) held.current = { value: orbitals, key };
  }
  return held.current.value;
}

export function useCircuitKernel(
  traitBindings: readonly ResolvedTraitBinding[],
  options: UseCircuitKernelOptions,
): CircuitKernelHandle {
  const orbitals = useContentStable(options.orbitals);
  const fullTraitIndex = useMemo(
    () => buildTraitIndex(orbitals),
    [orbitals],
  );
  const appTraitNames = useMemo(() => new Set(fullTraitIndex.byName.keys()), [fullTraitIndex]);
  // Keyed on the active trait SET, not the bindings array identity: a same-traits re-render must not rebuild the store.
  const activeTraitKey = traitBindings
    .map((b) => b.trait.name)
    .filter((n): n is string => !!n)
    .sort()
    .join('\u0000');
  const traitIndex = useMemo(
    () => restrictTraitIndex(fullTraitIndex, new Set(activeTraitKey === '' ? [] : activeTraitKey.split('\u0000'))),
    [activeTraitKey, fullTraitIndex],
  );

  // Runtime Spec Clause 8.3: a trait leaving the page (or the page tearing down) is unmounted on
  // the server, pausing its mount-scoped ticks. Held with dispatch until the topology registers.
  const mountedRef = useRef(new Map<string, string>());
  const { locale } = useTranslate();
  const i18n = useRenderI18n();
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const transport = options.transport;
  const topologyPending = options.awaitTopology === true;
  useEffect(() => {
    if (transport === undefined || topologyPending) return;
    const mounted = mountedRef.current;
    const dropped = [...mounted].filter(([name]) => !traitIndex.byName.has(name));
    mounted.clear();
    for (const [name, entry] of traitIndex.byName) mounted.set(name, entry.orbitalName);
    postUnmounts(transport, dropped, localeRef.current);
  }, [traitIndex, transport, topologyPending]);
  useEffect(() => {
    if (transport === undefined) return;
    const mounted = mountedRef.current;
    return () => postUnmounts(transport, [...mounted], localeRef.current);
  }, [transport]);

  const store = useMemo(
    () => createMemoryCircuitStore(Array.from(traitIndex.byName.values(), (entry: IndexedTrait) => entry.traitDef), options.observer),
    [traitIndex, options.observer],
  );

  if (options.engine === null) throw new KernelLoaderMissingError();
  const loadModule = options.engine.loadModule;
  const loadLanguage = options.engine.loadLanguage;
  const orbitalName = orbitals[0]?.name ?? '';
  const metadata = options.metadata;
  // A local leg runs on a kernel of its own over its store, with the viewer's catalog for `i18n/t`.
  const localTransport = useCallback(
    (store: PersistenceAdapter): EventTransport => {
      const schema: OrbitalSchema = { name: orbitalName, orbitals: [...orbitals], ...(metadata !== undefined ? { _metadata: metadata } : {}) };
      const language = loadLanguage !== undefined ? loadLanguage() : Promise.reject(new LanguageLoaderMissingError());
      const kernelEngine = Promise.all([loadModule(), language]).then(([kernel, bundle]) => openLocalKernel({
          kernel,
          language: bundle,
          schema,
          persistence: localStorePersistence(schema, store, nativeMemoryPersistence(kernel)),
          ...(options.callService !== undefined ? { callService: options.callService } : {}),
          ...(i18n !== undefined ? { messages: { [i18n.locale]: i18n.messages } } : {}),
        }));
      // The failure reaches the first request through the transport; a store nothing dispatches to stays quiet.
      kernelEngine.catch(() => undefined);
      return createLocalStoreTransport({
        kernelEngine,
        schema,
        ...(options.user !== undefined ? { user: options.user } : {}),
      });
    },
    [loadModule, loadLanguage, orbitalName, orbitals, metadata, options.callService, options.user, i18n],
  );
  const offlineTransport = useMemo(
    () => (options.transport !== undefined || options.persistence === undefined ? undefined : localTransport(options.persistence)),
    [options.transport, options.persistence, localTransport],
  );
  const routedTransport = useMemo(() => {
    if (options.browserStore === undefined) return undefined;
    const local = localTransport(options.browserStore);
    const remote = options.transport ?? offlineTransport;
    return createResidenceTransport({ local, ...(remote !== undefined ? { remote } : {}), traitIndex: fullTraitIndex });
  }, [options.browserStore, options.transport, offlineTransport, fullTraitIndex, localTransport]);

  const baseTransport = routedTransport ?? options.transport ?? offlineTransport;
  const effectiveTransport = useMemo(
    () => (baseTransport === undefined ? undefined : recordingTransport(baseTransport)),
    [baseTransport],
  );

  // The transport's topology, confirmed once its register() settles: the
  // kernel paints every local arm at once and holds only its posts on this.
  const topology = useMemo(() => {
    let resolve: (t: { carriesCircuitState: boolean }) => void = () => undefined;
    const promise = new Promise<{ carriesCircuitState: boolean }>((r) => { resolve = r; });
    return { promise, resolve };
  }, [effectiveTransport]);
  const awaitTopology = options.awaitTopology === true;
  const confirmedCarries = options.carriesCircuitState ?? false;
  useEffect(() => {
    if (!awaitTopology) topology.resolve({ carriesCircuitState: confirmedCarries });
  }, [awaitTopology, confirmedCarries, topology]);

  const kernelInstance = useMemo<Promise<KernelInstance>>(() => {
    const instance = loadModule().then((mod) => {
      const kernel = new mod.Kernel(JSON.stringify({ name: orbitalName, orbitals: kernelOrbitals(orbitals), ...(metadata !== undefined ? { _metadata: metadata } : {}) }), getTabClientId());
      // Every host this view posts to runs the whole worklist, listeners of a dispatched emit included.
      kernel.setHostFansOut(true);
      // A verifier judges each hop's `@ensures` on the entity before and after it; the kernel records them only then.
      if (verifierAttached()) kernel.setRecordEntityAfter(true);
      return kernel;
    });
    // A failure surfaces on the first dispatch that awaits it; a circuit with nothing to run never does.
    instance.catch((err) => log.error('kernel-load-failed', { error: String(err) }));
    return instance;
  }, [loadModule, orbitalName, orbitals, metadata]);
  // A transition the client paints locally resolves `i18n/t` against the viewer's catalog, as the server leg does.
  useEffect(() => {
    if (i18n === undefined) return;
    void kernelInstance.then((k) => k.setMessages(JSON.stringify([i18n.locale]), JSON.stringify({ [i18n.locale]: i18n.messages })));
  }, [kernelInstance, i18n]);
  const kernelClient = useMemo<KernelClient>(() => createLazyKernelClient({
    instance: kernelInstance,
    store,
    traitIndex,
    topology: topology.promise,
    ...(options.observer !== undefined ? { observer: options.observer } : {}),
    ...(effectiveTransport !== undefined ? { transport: effectiveTransport } : {}),
  }), [kernelInstance, store, traitIndex, topology, effectiveTransport, options.observer]);
  const rawKernel: ClientKernel = kernelClient;
  useEffect(() => {
    if (options.user === undefined) return;
    void kernelClient.setViewer(options.user);
  }, [kernelClient, options.user]);

  // Stamp the per-tab clientId and the viewer's locale onto every dispatch
  // that doesn't already carry them, so callers (`useBusIngress`, the composer) never have to
  // know about tab identity — same posted-leg field the old
  // `ServerBridge.tsx`'s `buildEventRequest` stamped by hand.
  const kernel = useMemo<ClientKernel>(() => {
    const stamp = <R extends { clientId?: string; locale?: string }>(request: R): R => ({
      ...request,
      clientId: request.clientId ?? getTabClientId(),
      locale: request.locale ?? locale,
    });
    return {
      store: rawKernel.store,
      dispatch: (request, hooks) => rawKernel.dispatch(stamp(request), hooks),
      dispatchMount: (seeds, hooks, base = {}) => rawKernel.dispatchMount(seeds, hooks, stamp(base)),
      dispatchProgress: (request: import('@almadar/core').OrbitalEventRequest) => rawKernel.dispatchProgress(stamp(request)),
      foldHostDispatch: (request, response) => rawKernel.foldHostDispatch(request, response),
    };
  }, [rawKernel, locale]);

  return { kernel, store, traitIndex, appTraitNames, transport: effectiveTransport, engine: kernelClient };
}
