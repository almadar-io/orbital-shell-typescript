/**
 * The browser store of a program's `[persistent: x, browser]` entities, opened once, and the in-process transport its legs run through. The runtime
 * host (`useBrowserStore`) and compiled static clients both open it here.
 */
import type { BrowserTabPort, MessageCatalogs, MountSeed, OnDeviceModelPorts, OrbitalEntity, OrbitalDefinition, OrbitalEventRequest, OrbitalEventResponse, OrbitalSchema } from '@almadar/core';
import { applyRowAccess, externalInputsOf, orbitalInlineEntities, readableEntitiesOf, storesRowsInBrowser } from '@almadar/core';
import { entityAccessPolicies } from '@almadar/core/mock';
import type { KernelHostPorts } from '../../kernel/host.js';
import type { SecretPorts } from '../../kernel/secret-ports.js';
import type { KernelModule } from '../../lib/kernel-wire.js';
import { dispatchDeclaredInput } from '@almadar/shell-runtime/client/declared-input-dispatch';
import { IndexedDbPersistence } from '@almadar/shell-browser/storage';
import type { EffectHandlers } from '../types.js';
import type { DeferredCallOutcome } from '../../kernel/host.js';
import { nativeMemoryPersistence } from './native-memory.js';
import { persistedMemory } from './persisted-memory.js';
import type { EventTransport } from '@almadar/shell-runtime/client/EventTransport';
import { buildTraitIndex } from '../traits/trait-index.js';
import { createLocalStoreTransport, localStorePersistence, openLocalKernel } from './local-store-transport.js';
import { tickEventKey } from '@almadar/core';
import { createLogger } from '@almadar/logger';

/** One browser database per app and viewer locale, so a visitor's records stay in one language. */
export function browserStoreName(appName: string, locale: string | undefined): string {
  return locale !== undefined ? `almadar:${appName}:${locale}` : `almadar:${appName}`;
}

/** Open the store; `null` when no entity is browser-stored. */
export async function openBrowserStore(
  databaseName: string,
  orbitals: readonly OrbitalDefinition[],
  factory?: IDBFactory,
): Promise<IndexedDbPersistence | null> {
  const entities = orbitals.flatMap(orbitalInlineEntities).filter(storesRowsInBrowser);
  if (entities.length === 0) return null;
  return IndexedDbPersistence.open({
    databaseName,
    entityTypes: entities.map((e) => e.name),
    ...(factory !== undefined ? { factory } : {}),
  });
}

function browserEntities(orbitals: readonly OrbitalDefinition[]): OrbitalEntity[] {
  return orbitals.flatMap(orbitalInlineEntities).filter(storesRowsInBrowser);
}

export interface BrowserStoreTransportOptions {
  databaseName: string;
  schema: OrbitalSchema;
  /** The initialised `@almadar/kernel` module the store's legs run on. */
  kernel: KernelModule;
  /** The language bundle as JSON (`LanguageBundle`) the kernel is opened with: a browser has no `node_modules` to read it from. */
  language: string;
  factory?: IDBFactory;
  /** The viewer's locale: a first visit starts with the entity's `instances` written for it. */
  locale?: string;
  /** Answers the program's calls to browser-only services (the client's web-hosted integrations). */
  callService?: EffectHandlers['callService'];
  /** The secret, random and credential ports of a leg (`createBrowserSecretPorts`). */
  secretPorts?: SecretPorts;
  /** The program's message catalogs, so a leg's `i18n/t` resolves for the request's locale. */
  messages?: MessageCatalogs;
}

export async function openBrowserStoreTransport(options: BrowserStoreTransportOptions): Promise<EventTransport> {
  const stored = await openBrowserStore(options.databaseName, options.schema.orbitals, options.factory);
  if (stored === null && options.callService === undefined) {
    throw new Error(`openBrowserStoreTransport: schema "${options.schema.name}" declares no browser-stored entity`);
  }
  // Legs that only call browser-only services keep no rows of their own.
  const memory = nativeMemoryPersistence(options.kernel);
  const persistence = localStorePersistence(options.schema, stored === null ? memory : await persistedMemory(options.kernel, stored, browserEntities(options.schema.orbitals), options.locale), memory);
  return createLocalStoreTransport({
    kernelEngine: openLocalKernel({
      kernel: options.kernel,
      language: options.language,
      schema: options.schema,
      persistence,
      ...(options.callService !== undefined ? { callService: options.callService } : {}),
      ...(options.secretPorts !== undefined ? { secretPorts: options.secretPorts } : {}),
      ...(options.messages !== undefined ? { messages: options.messages } : {}),
    }),
  });
}

/**
 * A compiled client's bundled `browserSchema.json`, served on the kernel like any local host. The program is the
 * resolved `orb` output: the kernel validates it when it registers, so the host does not parse it again.
 */
export function openBundledBrowserStore(schema: OrbitalSchema, kernel: KernelModule, language: string, locale?: string, callService?: EffectHandlers['callService'], messages?: MessageCatalogs, secretPorts?: SecretPorts): Promise<EventTransport> {
  return openBrowserStoreTransport({
    databaseName: browserStoreName(schema.name, locale),
    schema,
    ...(locale !== undefined ? { locale } : {}),
    kernel,
    language,
    ...(callService !== undefined ? { callService } : {}),
    ...(secretPorts !== undefined ? { secretPorts } : {}),
    ...(messages !== undefined ? { messages } : {}),
  });
}

export interface BrowserHostOptions {
  databaseName: string;
  schema: OrbitalSchema;
  /** Answers every `call-service` of the program (the host's browser integrations). */
  callService: EffectHandlers['callService'];
  /** The secret, random and credential ports of the program (`createBrowserSecretPorts`). */
  secretPorts?: SecretPorts;
  /** The on-device model and embedder `browser/prompt` and `browser/embed` ask (the host plugs its Prompt API and embedder in here). */
  onDevice?: OnDeviceModelPorts;
  /** The initialised `@almadar/kernel` module the program runs on; this host answers its I/O. */
  kernel: KernelModule;
  /** The language bundle as JSON (`LanguageBundle`) the kernel is opened with: a browser has no `node_modules` to read it from. */
  language: string;
  /** The browser's tabs for the `browser/tab-*` effects; absent, a tab ask fails `unavailable`. */
  tabs?: BrowserTabPort;
  factory?: IDBFactory;
  /** The viewer's locale: a first visit starts with the entity's `instances` written for it. */
  locale?: string;
}

/** A declared input the host ran, with its result; no view asked for it. */
export type InputDispatchListener = (orbital: string, request: OrbitalEventRequest, response: OrbitalEventResponse) => void;

export interface BrowserHost extends EventTransport {
  /** Hear every declared input and tick firing the host runs (e.g. a watched page element), to show it in open views. */
  onInputDispatched(listener: InputDispatchListener): () => void;
  /** The kernel's mounts for a client opening `routePath` (EXEC-ENDPOINT-3). */
  routeMounts(routePath: string): MountSeed[];
  /** Stop the program's ticks. */
  close(): void;
}

/** The host runs the program's ticks (LOLO §11): each firing is one `runTick` request in the host's queue. */
const tickLog = createLogger('almadar:runtime:browser-host:ticks');
const queueLog = createLogger('almadar:runtime:browser-host:queue');

/** How often the host asks the kernel's tick clock which ticks are due. */
const TICK_PASS_MS = 16;

/**
 * Host a whole program in a browser context with no server (an extension's service worker): its
 * browser-stored entities in IndexedDB, any other rows in memory, and every `call-service` answered
 * by `callService`. The host holds the circuit state itself.
 */
export async function openBrowserHost(options: BrowserHostOptions): Promise<BrowserHost> {
  const browserStore = await openBrowserStore(options.databaseName, options.schema.orbitals, options.factory);
  const memory = nativeMemoryPersistence(options.kernel);
  const persistence = localStorePersistence(options.schema, browserStore === null ? memory : await persistedMemory(options.kernel, browserStore, browserEntities(options.schema.orbitals), options.locale), memory);
  const traitIndex = buildTraitIndex(options.schema.orbitals);
  const { schema } = options;
  let transport: EventTransport | undefined;
  const listeners = new Set<InputDispatchListener>();

  // The kernel orders every request (EXEC-CONC-2): this host sends each as it arrives and never holds a turn.
  const servicePorts: KernelHostPorts['servicePorts'] = (caller, user, message, assertReentry) => {
    return {
      caller,
      inputs: () => externalInputsOf(schema),
      readableEntities: () => readableEntitiesOf(schema),
      dispatchInput: (orbital, request) => {
        const host = transport;
        if (!host) return Promise.reject(new Error('openBrowserHost: the host is not open yet'));
        assertReentry?.();
        return dispatchDeclaredInput(schema, orbital, { ...request, ...(user !== undefined ? { user } : {}) }, async (o, r) => {
          const response = await host.send(o, r);
          for (const listener of listeners) listener(o, r, response);
          return response;
        });
      },
      read: async (entity) => applyRowAccess(await persistence.list(entity), entityAccessPolicies(schema, entity)?.read, undefined, { user }, entity),
      message,
    };
  };
  let deferred: ((call: DeferredCallOutcome) => void) | undefined;
  const kernelEngine = openLocalKernel({
    kernel: options.kernel,
    language: options.language,
    schema,
    persistence,
    callService: options.callService,
    servicePorts,
    deferCallOutcome: () => deferred,
    ...(options.secretPorts !== undefined ? { secretPorts: options.secretPorts } : {}),
    ...(options.onDevice !== undefined ? { onDevice: options.onDevice } : {}),
    ...(options.tabs !== undefined ? { tabs: options.tabs } : {}),
  });
  const local = createLocalStoreTransport({ kernelEngine });
  transport = local;
  // A follow-on call's outcome runs as a dispatch of its own, which the kernel queues behind the lane, and shows in open views.
  deferred = (call) => {
    const request: OrbitalEventRequest = {
      event: call.event,
      ...(call.payload !== undefined ? { payload: call.payload } : {}),
      targetTrait: call.traitName,
      ...(call.entityId !== undefined ? { entityId: call.entityId } : {}),
      ...(call.originClientId !== undefined ? { clientId: call.originClientId } : {}),
      ...(call.user !== undefined ? { user: call.user } : {}),
      ...(call.locale !== undefined ? { locale: call.locale } : {}),
    };
    void local.send(call.orbital, request).then((response) => {
      for (const listener of listeners) listener(call.orbital, request, response);
    }).catch((error: Error) => {
      queueLog.error('deferred-outcome:failed', { orbital: call.orbital, event: call.event, trait: call.traitName, error: error.message });
    });
  };

  const runnable = new Map<string, { orbitalName: string; traitName: string; tickName: string }>();
  for (const entry of traitIndex.byName.values()) {
    for (const tick of entry.irTrait.ticks ?? []) {
      runnable.set(`${entry.traitDef.name}::${tick.name}`, { orbitalName: entry.orbitalName, traitName: entry.traitDef.name, tickName: tick.name });
    }
  }
  // The kernel's one tick clock decides what is due; a firing waits its turn, and while one is queued or running the
  // next is skipped, not piled up.
  const firing = new Set<string>();
  const fire = (key: string, tick: { orbitalName: string; traitName: string; tickName: string }): void => {
    if (firing.has(key)) return;
    firing.add(key);
    // Fired as a `runTick` request, so the tick runs where every transition runs: the gate, its
    // effects, and its emits through the dispatch's own fan-out.
    const request: OrbitalEventRequest = {
      event: tickEventKey(tick.tickName),
      runTick: { trait: tick.traitName, tick: tick.tickName },
      targetTrait: tick.traitName,
      tick: tick.tickName,
    };
    void local.send(tick.orbitalName, request).then((response) => {
      if (response.transitioned) for (const listener of listeners) listener(tick.orbitalName, request, response);
    }).catch((error: Error) => {
      tickLog.error('tick:failed', { orbital: tick.orbitalName, trait: tick.traitName, tick: tick.tickName, error: error.message });
    }).finally(() => {
      firing.delete(key);
    });
  };
  const timer = runnable.size === 0 ? undefined : setInterval(() => {
    for (const due of kernelEngine.tickPass(performance.now())) {
      const key = `${due.trait}::${due.tick}`;
      const tick = runnable.get(key);
      if (tick !== undefined) fire(key, tick);
    }
  }, TICK_PASS_MS);

  return {
    ...local,
    onInputDispatched(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    routeMounts: (routePath) => kernelEngine.routeMounts(routePath),
    close() {
      if (timer !== undefined) clearInterval(timer);
    },
  };
}
