/**
 * OrbitalServerRuntime: the Node host that runs a registered program on the kernel. It answers the kernel's asks
 * (rows, services, `http`, `os` through the given os host, live streams), drives its ticks and mounts; it serves no
 * HTTP routes (a served program composes std-http-server for that).
 *
 * @packageDocumentation
 */

// Type-only: the VALUE is loaded lazily inside `withRegistrationMutation`
// via dynamic import — same keep-it-out-of-the-browser-bundle idiom as
// `@almadar/server` below.
import type { AsyncLocalStorage as BracketAsyncLocalStorage } from "node:async_hooks";
import { EventBus } from "@almadar/shell-runtime";
import { eventRouteKey } from "@almadar/shell-runtime";
import { stampEmitSource } from "@almadar/shell-runtime";
import { evaluateOnKernel } from "@almadar/shell-runtime";
import { createTickScheduler, type TickHandle, type TickScheduler } from "@almadar/shell-runtime";
import { isValidCronExpression } from "@almadar/shell-runtime";
import { parseDurationString } from "@almadar/shell-runtime";
import { LIFECYCLE_EVENTS, UNMOUNT_EVENT, tickEventKey } from "@almadar/core";
import { parseOrbitalTraits } from "@almadar/shell-runtime";
import { createLogger } from '@almadar/logger';
import type { createProgramHandlers as CreateProgramHandlersFn } from "../program/createProgramHandlers.js";


const effectLog = createLogger("almadar:runtime:effects");
const busLog = createLogger("almadar:runtime:bus");
// Render-ui-side observability for the runtime path. Lit up via
// `ALMADAR_DEBUG=almadar:runtime:render-ui` (or `localStorage.ALMADAR_DEBUG`
// in the browser). Tracks every render-ui clientEffect push so we can tell
// when the runtime re-fires `render-ui` for the modal slot during a typing
// session — the suspected reason form fields snap back to pre-fill on the
// runtime path while the compiled path holds them stable.
const renderLog = createLogger("almadar:runtime:render-ui");
// Gap #11 (Almadar_Std_Verification.md): cross-orbital cascade tracing.
// Logs per processOrbitalEvent entry and per emit so the runtime-verify
// console capture shows which orbital's traits actually fired during a
// dispatch. Pairs with the UI-side `almadar:runtime:cross-orbital` channel
// in OrbPreview / ServerBridge / SlotsContext.
const xOrbitalLog = createLogger("almadar:runtime:cross-orbital");
const persistLog = createLogger("almadar:runtime:persist");

const registerLog = createLogger("almadar:runtime:register");

import type { TraitState, TransitionObserver } from "@almadar/shell-runtime";
import type {
  EffectHandlers,
  EntityRow,
  EventPayload,
  EvaluationContextExtensions,
} from "@almadar/shell-runtime";
import type {
  OrbitalSchema,
  MessageCatalogs,
  OrbitalDefinition,
  Entity,
  Trait,
  TraitTick,
  TraitConfig,
  BusEventSource,
  UserContext,
  ServiceHostPorts,
  DispatchRequestOutcome,
  EventStreamItem,
} from "@almadar/core";
import { entityAccessPolicies } from "@almadar/core/mock";
import { entityOwnerOrbital, RowSetRefSchema, type RowQueryPage } from "@almadar/core";
import type { EventRequest } from "@almadar/core/kernel-wire";

// Single upstream owner (`@almadar/core`'s `types/bus.ts`) — both execution
// paths (this runtime and orbital-shell-typescript's generated handlers,
// mirrored 1:1 in orbital-core) carry the same wire shapes, so they cannot
// drift. Re-exported here so every existing importer of these names from
// `@almadar/runtime` keeps working unchanged.
export type {
  OrbitalEventRequest,
  OrbitalEventResponse,
  ClientEffectTuple,
  ClientRenderUITuple,
  ClientNavigateTuple,
  ClientNavigateBackTuple,
  TransitionRejection,
} from "@almadar/core";
import { applyRowAccess, inlineTraitRefs, installKernelEvaluator } from "@almadar/core";
import type {
  OrbitalEventRequest,
  OrbitalEventResponse,
  ClientEffectTuple,
  ExternalInput,
  ExternalInputRequest,
  InboundAnswer,
  InboundDelivery,
} from "@almadar/core";
import type { MountSeed } from "@almadar/core";
import { externalInputsOf, inboundOnlyMessage, inboundOnlyTrait, readableEntitiesOf } from "@almadar/core";
import { dispatchDeclaredInput } from "@almadar/shell-runtime";
import { dispatchInbound } from "@almadar/shell-runtime";
import { isEntityCall, normalizeUserContext, personaFromIdentityRow, ANONYMOUS_USER
} from "@almadar/core";
import { identityEntityName } from "@almadar/core/mock";
import { defaultCallService } from "@almadar/shell-runtime";
import { KernelEngine, type KernelHostPorts } from "@almadar/shell-runtime";
import { kernelEventRequestParser, kernelOsCompletions, kernelOsGrants, type OsGrantPort, type OsHostPort } from "@almadar/shell-runtime";
import { createHttpPorts, createHttpSecrets, InFlightCalls, type HttpPorts, type HttpPortsOptions, type KernelModule } from "@almadar/shell-runtime";
import { installNodeHostPorts } from "../host-ports.js";
import { nativeMemoryOf } from "../kernel-loader.js";
import { bindDeclaredCollections } from "@almadar/shell-runtime";
// Node-detection helper. Used to guard call sites of express, fs/path/net,
// and child_process — those modules are stubbed by the package.json `browser`
// field in browser bundles, so calling them would crash. Browser consumers
// (e.g. `<BrowserPlayground>` from @almadar/ui) skip these
// paths entirely.
function isNodeEnv(): boolean {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}

// ============================================================================
// Types
// ============================================================================

// Uses OrbitalSchema, OrbitalDefinition, Trait, TraitTick from @almadar/core directly.
// No redundant runtime-specific types.

/** @deprecated Use OrbitalSchema from @almadar/core */
export type RuntimeOrbitalSchema = OrbitalSchema;
/** @deprecated Use OrbitalDefinition from @almadar/core */
export type RuntimeOrbital = OrbitalDefinition;
/** @deprecated Use Trait from @almadar/core */
export type RuntimeTrait = Trait;
/** @deprecated Use TraitTick from @almadar/core */
export type RuntimeTraitTick = TraitTick;


/**
 * Incremental-push item streamed to an SSE client mid-dispatch (an emitted
 * event or a client effect), before the response resolves.
 */
export type PushItem =
  | { type: 'event'; data: { event: string; payload?: EventPayload; source?: BusEventSource }; timestamp?: number }
  | { type: 'effect'; data: ClientEffectTuple; timestamp?: number };

/**
 * Registered orbital with runtime state
 */
/** One registered orbital as the API lists it. */
export interface OrbitalSummary {
  name: string;
  entityName: string | undefined;
  traits: string[];
}

/** One registered orbital as the API describes it: its entity and each trait's current state, states and events. */
export interface OrbitalInfo {
  name: string;
  entity: Entity;
  traits: { name: string; currentState: string | undefined; states: string[]; events: string[] }[];
}

export interface RegisteredOrbital {
  schema: OrbitalDefinition;
  /** Resolved entity (never a string ref at runtime) */
  entity: Entity;
  /** Resolved inline traits (string refs filtered out) */
  traits: Trait[];
  /**
   * Call-site `config: { ... }` attached to each trait ref, keyed by trait
   * name. Used to populate the `@config.X` binding when running that trait's
   * effects. Preserved from the preprocessed schema's trait-ref wrapper
   * (`{ ref, config, linkedEntity, _resolved }`) before the wrapper is
   * unwrapped to its inline form.
   */
  configByTrait: Map<string, TraitConfig>;
}

// `OrbitalEventRequest` — event sent from client to server — is owned by
// `@almadar/core` (re-exported above).

/**
 * One persist-envelope success emit, handed to the live-broadcast sink
 * (`setLiveBroadcastSink`). Fired only from the `persist` effect's
 * `emit:{success}` envelope (batch and single-op) — never from the generic
 * emit funnel — so transport layers can fan it out to every OTHER
 * connected client without matching on event names.
 */
export interface LiveBroadcastItem {
  event: string;
  payload?: EventPayload;
  source: BusEventSource;
  /** `clientId` of the request that produced this emit. */
  originClientId?: string;
  /**
   * `peers`: every OTHER client (persist envelopes, tick relay). `origin`:
   * only the requesting client, while its request is still running (a
   * `call-service`'s live `emit.onMessage`).
   */
  target: 'peers' | 'origin';
}

/**
 * The result of a dispatch the host ran on its own — a follow-on step's `call-service`
 * outcome, run after the request that started the call had answered — for the tab that
 * asked (`originClientId`). Handed to the host-dispatch sink (`setHostDispatchSink`).
 */
export interface HostDispatchItem {
  orbitalName: string;
  request: OrbitalEventRequest;
  response: OrbitalEventResponse;
  originClientId?: string;
}

// `OrbitalEventResponse` — response from event processing — is owned by
// `@almadar/core` (re-exported above).

/**
 * Loader configuration for resolving `uses` imports
 */
export interface LoaderConfig {
  /** Where `orb` resolves a registered program's imports from, when no `programHost` names it. */
  basePath: string;
}

/**
 * Runtime configuration
 */
export interface OrbitalServerRuntimeConfig {
  /** Enable debug logging */
  debug?: boolean;
  /**
   * Snapshot cadence (ms) for relaying tick-stamped broadcasts to other
   * clients — newest-per-(client, orbital, event) wins between flushes
   * (T6, docs/Almadar_Tick_Loop.md §3a). Default 50 (≈20Hz).
   */
  tickRelayIntervalMs?: number;
  /** Custom effect handlers (for integrating with your data layer) */
  effectHandlers?: Partial<EffectHandlers>;
  /** Persistence adapter for entity data */
  persistence?: PersistenceAdapter;
  /** Where a registered program with imports is resolved from (`orb resolve`). */
  loaderConfig?: LoaderConfig;
  /**
   * Additional fields to spread onto every EvaluationContext.
   * Use this to inject module contexts (e.g., { agent: AgentContext }).
   * The evaluator dispatches agent/* operators to ctx.agent.
   */
  contextExtensions?: EvaluationContextExtensions;
  /**
   * The program host behind behavior/catalog|describe|source and
   * program/read|print|eval: the project root `orb` runs from. Absent means
   * those effects fail explicitly ("no program host configured").
   */
  programHost?: { cwd: string; orbBin?: string };
  /**
   * The persona a preview or verification run is looking at the app AS.
   *
   * `@user.id` / `@user.role` are what an app's ownership scoping and role
   * gates resolve against, so with no user every predicate takes its negative
   * branch and every owner filter matches nothing. A dev host (playground,
   * runtime-verify) sets it to make both branches reachable.
   *
   * Never an HTTP request's identity: `router()` resolves every request from
   * its verified token (or anonymous). It is the viewer for in-process calls,
   * and ticks.
   */
  defaultUser?: UserContext;
  /**
   * The initialised `@almadar/kernel` module that decides execution and whose I/O this runtime answers with its
   * persistence, service and program-host adapters. Absent, the runtime loads the installed `@almadar/kernel` itself
   * (`loadInstalledKernel`) when a program is first registered.
   */
  kernel?: KernelModule;
  /**
   * What the `http` effect runs on: the kernel's request driver (`loadHttpKernel`), and optionally the secret store,
   * pinned fetch and resolver. The program's `egress` is read from the registered schema. Absent, an `http` effect
   * fails with `HTTP_KERNEL_UNAVAILABLE`.
   */
  http?: Omit<HttpPortsOptions, 'egress'>;
  /**
   * Builds the `os` host of the kernel engine from the grant port backed by the kernel (`createNodeOsHost` from
   * `@almadar/shell-node`). Absent, every `os` ask is denied, as the native host does with none.
   */
  osHost?: (grants: OsGrantPort) => OsHostPort;
  /** The clock the kernel's `clock` ask is answered from, in epoch milliseconds; absent, the system clock. */
  clock?: () => number;
}

/**
 * Adapter for persisting entity data
 */
import type { PersistenceAdapter, RowSetRef } from '@almadar/core';

// ============================================================================
// OrbitalServerRuntime
// ============================================================================

/**
 * Check whether a schema needs preprocessing (has `uses` declarations or
 * un-inlined cross-orbital trait references).
 *
 * Cross-orbital refs are trait entries like
 * `{ ref: "Modal.traits.ModalRecordModal", ... }` with no inline
 * `stateMachine`. If these aren't resolved before `register()` runs, the
 * trait binder produces an empty state machine and all interactions
 * targeting the trait are silently dropped.
 */
/**
 * Walk a trait's DECLARED config schema (`{ icon: { type, default }, ... }`)
 * and collect a flat `{ icon: <default>, ... }` map of just the default
 * values. Used to seed the `@config.X` binding context with the atom's
 * own declared defaults before any call-site override is applied. Mirrors
 * the compiled path's `DEFAULT_<TRAIT>_CONFIG` constant emitted by
 * backend.rs's Solution-1 plumbing.
 *
 * Returns `undefined` when the trait has no config schema or none of its
 * fields declare a default — keeps the caller's existing fast-path.
 */
/**
 * Structural shape that both `@almadar/core`'s `Trait` and
 * `ResolvedTrait` satisfy: a `config?` map keyed by field name whose
 * values either carry a `default` (the declared-schema form loaded
 * from `.orb`) or are bare values (the runtime-resolved form).
 *
 * Widening to a structural parameter lets callers from the resolved
 * side (e.g., `@almadar/ui`'s `useTraitStateMachine`) pass their own
 * `ResolvedTrait` without an `as unknown as` cast.
 */
/**
 * Read the `default` from each field of a trait's declared
 * `config { }` schema and return the flat `{ key: default, ... }`
 * map. Used to seed `@config.X` binding context with the atom's
 * own declared defaults before any call-site override is applied.
 *
 * Mirrors the compiled path's `DEFAULT_<TRAIT>_CONFIG` constant
 * emitted by `backend.rs` Solution-1.
 */
/** A program with imports registered where `orb` cannot run (a browser): resolve it first (`orb resolve`). */
export class UnresolvedProgramError extends Error {
  constructor(schemaName: string) {
    super(`program "${schemaName}" has unresolved imports and this host cannot run orb: register its resolved form (orb resolve)`);
    this.name = 'UnresolvedProgramError';
  }
}

/** A resolved program keeps its `uses` declarations; only a trait still carried as a bare reference is unresolved. */
function needsResolving(schema: OrbitalSchema): boolean {
  for (const orbital of schema.orbitals) {
    for (const t of orbital.traits ?? []) {
      if (typeof t === 'object' && 'ref' in t && t.ref.includes('.') && t._resolved === undefined) {
        return true;
      }
    }
  }
  return false;
}


/**
 * Internal tick binding for tracking active ticks
 */
interface TickBinding {
  orbitalName: string;
  traitName: string;
  tick: RuntimeTraitTick;
  handle: TickHandle;
}

/** What `register` takes beside the schema: the program's catalogs and the `uses lazy` behaviors the server runs alongside it. */
export interface RegisterOptions {
  messages?: MessageCatalogs;
  lazy?: readonly OrbitalSchema[];
}

/** `orb resolve` writes each declared locale's merged catalog beside a `.orb` as `<stem>.<locale>.json`. */
async function readSidecarCatalogs(
  readFile: (path: string, encoding: 'utf-8') => Promise<string>,
  orbPath: string,
  locales: readonly string[],
): Promise<MessageCatalogs> {
  const messages: MessageCatalogs = {};
  const stem = orbPath.replace(/\.orb$/, '');
  for (const locale of locales) {
    const catalogPath = `${stem}.${locale}.json`;
    let catalogRaw: string;
    try {
      catalogRaw = await readFile(catalogPath, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`registerFromFile: ${orbPath} declares locale "${locale}" but its catalog ${catalogPath} could not be read: ${msg}`);
    }
    messages[locale] = JSON.parse(catalogRaw) as Record<string, string>;
  }
  return messages;
}

export class OrbitalServerRuntime {
  protected orbitals = new Map<string, RegisteredOrbital>();
  private eventBus: EventBus;
  private config: OrbitalServerRuntimeConfig;
  /** The row store a host-supplied `persistence` replaces: the kernel's own `MemoryStore`, opened by the first `register()`. */
  private ownedStore: ReturnType<typeof nativeMemoryOf> | undefined;
  /**
   * The bound persistence adapter (host-supplied, else the kernel's own memory store). Public so a test can
   * inspect committed rows honestly. A runtime that owns its store has one from the first `register()`.
   */
  get persistence(): PersistenceAdapter {
    const store = this.config.persistence ?? this.ownedStore;
    if (store === undefined) throw new Error('OrbitalServerRuntime: the runtime opens its store when a program is registered; none is registered yet');
    return store;
  }

  private tickBindings: TickBinding[] = [];
  /** The kernel running the registered program; null before a program is registered. */
  private kernelEngine: KernelEngine | null = null;
  /** The `os` handles of the program the kernel runs; closed when that program is replaced, reset or dropped. */
  private kernelOs: OsHostPort | undefined;
  /** `orbital::trait` → the clients that have it mounted (Runtime Spec Clause 8.3). */
  private readonly mountedBy = new Map<string, Set<string>>();
  // One coalesced clock for every tick this runtime registers — replaces
  // "one setInterval per tick" with a single accumulator loop so ticks due
  // in the same pass fire together instead of on independent timers.
  private readonly tickScheduler: TickScheduler = createTickScheduler();
  private readonly transitionObservers = new Set<TransitionObserver>();
  private readonly transitionFanout: TransitionObserver = {
    onTransition: (trace) => { for (const o of this.transitionObservers) o.onTransition(trace); },
    onRollback: (trace) => { for (const o of this.transitionObservers) o.onRollback?.(trace); },
  };
  private programHandlersPromise: Promise<void> | null = null;
  private resolvedSchema: OrbitalSchema | null = null;

  /** The program's declared `locales`, in declared order; the first is the default. */
  private appLocales: readonly string[] = [];
  /** Merged message catalogs of every registered program (keys are behavior-qualified). */
  private messages: MessageCatalogs = {};
  /** Wired by the hosting server (e.g. the playground SSE endpoint) via `setLiveBroadcastSink`. */
  private readonly liveSubscribers = new Set<(item: LiveBroadcastItem) => void>();
  private liveBroadcastSink: ((item: LiveBroadcastItem) => void) | null = null;
  private hostDispatchSink: ((item: HostDispatchItem) => void) | null = null;
  /**
   * Tick-broadcast relay (T6): newest pending item per
   * (originClientId, orbital, event), flushed to the live-broadcast sink on
   * the `tickRelayIntervalMs` cadence — other tabs get the latest position
   * at snapshot rate, never 1:1 with emissions.
   */
  private readonly tickRelayPending = new Map<string, LiveBroadcastItem>();
  private tickRelayTimer: ReturnType<typeof setInterval> | null = null;
  constructor(config: OrbitalServerRuntimeConfig) {
    installNodeHostPorts();
    this.config = {
      ...config,
      // `@user` is never Null: a host that named no viewer and has no sign-in serves the unauthenticated viewer.
      defaultUser: config.defaultUser ?? ANONYMOUS_USER,
    };
    this.eventBus = new EventBus();


  }

  /**
   * Lazily wire the program host handlers (behavior/* and program/* effects),
   * merging them UNDER any user-provided handlers. Only when `programHost`
   * is configured; otherwise the effects fail explicitly.
   */
  private async ensureProgramHandlers(): Promise<void> {
    if (!isNodeEnv()) return;
    const host = this.config.programHost;
    if (host === undefined) return;
    if (!this.programHandlersPromise) {
      this.programHandlersPromise = (async () => {
        const { createProgramHandlers } = (await import('../program/createProgramHandlers.js')) as {
          createProgramHandlers: typeof CreateProgramHandlersFn;
        };
        this.config.effectHandlers = {
          ...createProgramHandlers(host),
          ...this.config.effectHandlers,
        };
      })();
    }
    return this.programHandlersPromise;
  }

  // ==========================================================================
  // Schema Registration
  // ==========================================================================

  /**
   * Register an OrbitalSchema for execution.
   *
   * Auto-preprocesses the schema when it contains `uses` declarations or
   * unresolved cross-orbital trait references (e.g. a trait with
   * `ref: "Modal.traits.ModalRecordModal"` and no inline `stateMachine`).
   * Without preprocessing, those refs arrive empty at the state machine and
   * button clicks silently do nothing — see Phase 9.5.H.
   *
   * Preprocessing needs a loader. If `loaderConfig` is set, that loader is
   * used. Otherwise, a default loader is constructed that points at
   * `<cwd>` (for `basePath`) and the nearest `node_modules/@almadar/std` (for
   * `stdLibPath`), which matches how every caller in this monorepo has the
   * std registry on disk.
   */
  /**
   * The in-flight (or last-completed) app mutation — `register()` chains its
   * body onto this, and `unregisterAll()` stamps a marker after clearing.
   * `processOrbitalEvent` consults it when the requested orbital is missing:
   * during a catalog-style app swap the new schema's registration is already
   * in flight while a client's first events arrive, and answering those with
   * an immediate `Orbital not found` 404 (the pre-fix behavior) races the
   * swap — big multi-orbital organisms lost their mount INITs intermittently
   * while single-orbital ones almost always won. Awaiting the epoch and
   * re-reading the map turns the race into a brief wait. `BrowserPlayground`
   * gated dispatches on registration ad hoc for the same race; the epoch is
   * the canonical, host-wide fix.
   */
  private registrationEpoch: Promise<unknown> | null = null;

  /**
   * Reentrancy guard for `withRegistrationMutation`. While a bracket is
   * open, `register()`/`unregisterAll()` must NOT chain/stamp the epoch:
   * the callback's sequential awaits already order them, and chaining a
   * `register()` awaited by the callback onto the bracket's gate would
   * deadlock (callback → register → epoch → gate → callback's finally).
   */
  private registrationMutationDepth = 0;

  async register(schema: OrbitalSchema, options: RegisterOptions = {}): Promise<void> {
    if (this.registrationMutationDepth > 0) {
      // Inside a withRegistrationMutation bracket — ordering is guaranteed
      // by the callback's awaits; chaining onto the bracket epoch would
      // deadlock. See registrationMutationDepth.
      await this.doRegister(schema, options);
      return;
    }
    const previous = this.registrationEpoch ?? Promise.resolve();
    // Chain on BOTH fulfillment and rejection: a failed previous mutation
    // must not wedge the queue for the next schema.
    const epoch = previous.then(
      () => this.doRegister(schema, options),
      () => this.doRegister(schema, options),
    );
    this.registrationEpoch = epoch;
    await epoch;
  }

  private async doRegister(schema: OrbitalSchema, options: RegisterOptions): Promise<void> {
    const kernel = await this.kernelModule();
    installKernelEvaluator(kernel);
    this.openOwnedStore(kernel);
    if (this.config.debug) {
      registerLog.debug('register:schema', { name: schema.name });
    }
    this.appLocales = schema.locales ?? [];
    for (const [locale, catalog] of Object.entries(options.messages ?? {})) {
      this.messages[locale] = { ...this.messages[locale], ...catalog };
    }

    // A program with imports is resolved by `orb`, the one resolver, from the configured base path; a host with
    // no `orb` to run (a browser) registers only resolved programs.
    if (needsResolving(schema)) schema = await this.resolveWithOrb(schema);

    // Register all orbitals (await to ensure instance seeding completes)
    // Lazy pages' orbitals run here too; only the served schema keeps them lazy for the client.
    const lazyOrbitals = (options.lazy ?? []).flatMap((lazy) => lazy.orbitals);
    const executed: OrbitalSchema = lazyOrbitals.length > 0 ? { ...schema, orbitals: [...schema.orbitals, ...lazyOrbitals] } : schema;
    for (const orbital of executed.orbitals) {
      await this.registerOrbitalAsync(orbital);
    }

    // Set up scheduled ticks
    this.setupTicks();
    await this.openKernel(executed);

    // Stash the post-preprocessing schema so HTTP layers (e.g. a playground
    // server's /api/schema handler) can serve the fully-resolved copy instead
    // of re-reading the raw .orb from disk. See getResolvedSchema().
    this.resolvedSchema = schema;
  }

  /** The kernel's own row store, opened once in the register phase when the host supplied none. */
  private openOwnedStore(kernel: KernelModule): void {
    if (this.config.persistence !== undefined || this.ownedStore !== undefined) return;
    this.ownedStore = nativeMemoryOf(kernel);
  }

  /**
   * Returns the schema that this runtime is currently executing, post-
   * preprocessing. Safe to expose from an HTTP `/api/schema` endpoint — every
   * cross-orbital trait ref will have an inline `stateMachine` already, which
   * is what the browser's `schema-to-ir` resolver needs to wire button clicks
   * back to state transitions.
   *
   * Returns `null` if `register()` hasn't run yet.
   */
  /** The registered program's name, or null when nothing is registered (none yet, or after `unregisterAll`). */
  registeredSchemaName(): string | null {
    return this.orbitals.size > 0 ? (this.resolvedSchema?.name ?? null) : null;
  }

  getResolvedSchema(): OrbitalSchema | null {
    return this.resolvedSchema;
  }

  /** The registered program's message catalogs (locale → qualified key → message), for a host's client. */
  getMessages(): MessageCatalogs {
    return this.messages;
  }

  /**
   * One-call entry point: read an `.orb` file from disk, parse it, preprocess
   * cross-orbital imports, and register the result. Callers never touch raw
   * `.orb` bytes — `register()` handles preprocessing internally.
   *
   * Node only. Browsers must receive already-resolved schemas from their
   * server (see `getResolvedSchema()`).
   */
  async registerFromFile(path: string): Promise<void> {
    if (typeof process === 'undefined' || !process.versions?.node) {
      throw new Error(
        'registerFromFile is Node-only. Browsers should receive resolved schemas from their server.',
      );
    }
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(path, 'utf-8');
    let schema: OrbitalSchema;
    try {
      schema = JSON.parse(raw) as OrbitalSchema;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`registerFromFile: ${path} is not valid JSON: ${msg}`);
    }
    const locales = schema.locales ?? [];
    const messages = await readSidecarCatalogs(readFile, path, locales);
    // `orb resolve` writes each `uses lazy` behavior (and its catalogs) at the page's `orbRef`, relative to the program.
    const { dirname, join } = await import('node:path');
    const lazy: OrbitalSchema[] = [];
    for (const page of schema.lazyPages ?? []) {
      const lazyPath = join(dirname(path), page.orbRef);
      let lazyRaw: string;
      try {
        lazyRaw = await readFile(lazyPath, 'utf-8');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`registerFromFile: ${path} declares lazy page ${page.path} but its behavior ${page.orbRef} could not be read: ${msg}`);
      }
      const lazySchema = JSON.parse(lazyRaw) as OrbitalSchema;
      if (!lazySchema.orbitals.some((o) => o.name === page.orbital)) {
        throw new Error(`registerFromFile: lazy page ${page.path} expects orbital "${page.orbital}" in ${page.orbRef}, found: ${lazySchema.orbitals.map((o) => o.name).join(', ')}`);
      }
      lazy.push(lazySchema);
      for (const [locale, catalog] of Object.entries(await readSidecarCatalogs(readFile, lazyPath, locales))) {
        messages[locale] = { ...messages[locale], ...catalog };
      }
    }
    await this.register(schema, { messages, lazy });
  }

  /** A program with imports resolved by `orb` from the configured base path (Node only: the one resolver is the compiler). */
  private async resolveWithOrb(schema: OrbitalSchema): Promise<OrbitalSchema> {
    if (!isNodeEnv()) throw new UnresolvedProgramError(schema.name);
    const { programResolveSchema } = await import('../program/index.js');
    const cwd = this.programRoot();
    if (this.config.debug) registerLog.debug('register:resolve-with-orb', { name: schema.name, cwd });
    return programResolveSchema(schema, { cwd, ...(this.config.programHost?.orbBin !== undefined ? { orbBin: this.config.programHost.orbBin } : {}) });
  }

  /**
   * Register a single orbital
   */
  private async registerOrbitalAsync(orbital: OrbitalDefinition): Promise<void> {
    // Trait unwrap + config-by-trait + entity resolution — shared with the
    // stateless per-request transition path, see OrbitalTraitParsing.ts.
    const { inlineTraits, configByTrait, entity } = parseOrbitalTraits(orbital);

    this.orbitals.set(orbital.name, {
      schema: orbital,
      entity,
      traits: inlineTraits,
      configByTrait,
    });

    const auxiliary = (orbital.auxiliaryEntities ?? []).filter((ref): ref is Entity => typeof ref !== 'string' && !isEntityCall(ref));
    bindDeclaredCollections(this.persistence, [entity, ...auxiliary]);

    if (this.config.debug) {
      registerLog.debug('register:orbital', {
        name: orbital.name,
        traitCount: (orbital.traits || []).length,
      });
    }
  }

  /** The adapters the kernel's I/O is answered with: this runtime's persistence, services and program host. */
  private httpPorts(egress: readonly string[] = this.resolvedSchema?.egress ?? []): HttpPorts | undefined {
    const options = this.config.http;
    return options === undefined ? undefined : createHttpPorts({ ...options, egress });
  }

  private kernelPorts(egress: readonly string[]): KernelHostPorts {
    const http = this.httpPorts(egress);
    return {
      ...(http !== undefined ? { http } : {}),
      ...(this.config.clock !== undefined ? { now: this.config.clock } : {}),
      ...(this.kernelOs !== undefined ? { os: this.kernelOs } : {}),
      ...(this.kernelOs !== undefined && this.config.kernel !== undefined ? { osCompletions: kernelOsCompletions(this.config.kernel) } : {}),
      ...(this.config.kernel !== undefined ? { parseEventRequest: kernelEventRequestParser(this.config.kernel) } : {}),
      persistence: this.persistence,
      inFlightCalls: this.inFlightCalls,
      callService: (service, action, params, context) => {
        const provider = this.config.effectHandlers?.callService;
        if (provider !== undefined) return provider(service, action, params, context);
        return defaultCallService(service, action, params, context);
      },
      programEffect: () => this.config.effectHandlers?.programEffect,
      substrateStream: (op, args) => {
        if (op !== 'program/live') return undefined;
        const first = args[0];
        const options = first !== null && typeof first === 'object' && !Array.isArray(first) ? first : {};
        const rawViewer = options['viewer'];
        const viewer = rawViewer !== null && typeof rawViewer === 'object' && !Array.isArray(rawViewer) ? rawViewer : null;
        const clientId = typeof options['clientId'] === 'string' ? options['clientId'] : undefined;
        return {
          subscribe: (message) => {
            const engine = this.requireKernelEngine();
            const stream = clientId !== undefined ? engine.openSessionStream(clientId) : undefined;
            const receive = (item: LiveBroadcastItem): void => {
              if (engine.liveItemDelivered(item, viewer, clientId)) message(JSON.parse(JSON.stringify({ event: item.event, ...(item.payload !== undefined ? { payload: item.payload } : {}), source: item.source })));
            };
            this.liveSubscribers.add(receive);
            return () => {
              this.liveSubscribers.delete(receive);
              if (stream !== undefined) engine.closeSessionStream(stream);
            };
          },
        };
      },
      servicePorts: (caller, user, message, assertReentry) => this.servicePorts(caller, user, message, assertReentry),
      deliverLive: (site, payload, originClientId) => this.deliverLiveMessage(site, payload, originClientId),
      deferCallOutcome: () => this.hostDispatchSink === null ? undefined : (call) => this.runDeferredOutcome(call.orbital, {
        event: call.event,
        ...(call.payload !== undefined ? { payload: call.payload } : {}),
        targetTrait: call.traitName,
        ...(call.entityId !== undefined ? { entityId: call.entityId } : {}),
        ...(call.originClientId !== undefined ? { clientId: call.originClientId } : {}),
        ...(call.user !== undefined ? { user: call.user } : {}),
        ...(call.locale !== undefined ? { locale: call.locale } : {}),
      }),
    };
  }

  /** One live message of a running `call-service`, stamped as its calling trait, to the requesting tab only. */
  private deliverLiveMessage(site: { orbital: string; trait: string; event: string }, payload: EventPayload, originClientId: string | undefined): void {
    const registered = this.orbitals.get(site.orbital);
    const callingTrait = registered?.traits.find((t) => t.name === site.trait);
    const stamp = stampEmitSource(undefined, {
      orbitalName: site.orbital,
      traitName: site.trait,
      orbitalId: registered?.schema.id,
      traitId: callingTrait?.id,
      emitContractEventId: callingTrait?.emits?.find((e) => e.event === site.event)?.eventId,
      originClientId,
    });
    this.eventBus.emit(site.event, payload, stamp, eventRouteKey(site.event, stamp.eventId));
    this.publishLiveItem({ event: site.event, payload, source: stamp, originClientId, target: 'origin' });
  }

  /** The project root this runtime hands `orb` and the kernel's language data: the program host's cwd, else the loader base path. */
  private programRoot(): string {
    return this.config.programHost?.cwd ?? this.config.loaderConfig?.basePath ?? process.cwd();
  }

  /** The kernel module this runtime runs on: the one the host handed in, else the installed `@almadar/kernel`. */
  private async kernelModule(): Promise<KernelModule> {
    if (this.config.kernel !== undefined) return this.config.kernel;
    const { loadInstalledKernel } = await import('../kernel-loader.js');
    this.config.kernel = await loadInstalledKernel(this.programRoot());
    return this.config.kernel;
  }

  /** (Re)open the kernel on the program just registered. */
  private async openKernel(registered: OrbitalSchema): Promise<void> {
    const kernel = await this.kernelModule();
    const schema: OrbitalSchema = { ...registered, orbitals: inlineTraitRefs(registered.orbitals) };
    for (const orbital of schema.orbitals) {
      for (const trait of orbital.traits ?? []) {
        if (typeof trait === 'object' && 'ref' in trait && !('stateMachine' in trait)) {
          throw new Error(`OrbitalServerRuntime: the kernel takes an orb-resolved program, but trait "${trait.ref}" of orbital "${orbital.name}" is still a reference`);
        }
      }
    }
    this.inFlightCalls.cancelAll();
    this.kernelEngine?.dispose();
    this.kernelOs?.close();
    this.kernelOs = this.config.osHost?.(kernelOsGrants(kernel, () => this.requireKernelEngine()));
    this.kernelEngine = KernelEngine.open(kernel, schema, this.kernelPorts(registered.egress ?? []));
    this.kernelEngine.setMessages(this.appLocales, this.messages);
    if (this.managedProgram !== undefined) this.kernelEngine.setManagedProgram(this.managedProgram);
    this.syncTickMount();
    await this.mountBootEndpoints();
  }

  /** Run the kernel's boot mounts for the server side (EXEC-ENDPOINT-3): the host sends what the kernel lists and chooses nothing. */
  private async mountBootEndpoints(): Promise<void> {
    const owners = new Map<string, RegisteredOrbital>();
    for (const registered of this.orbitals.values()) {
      for (const trait of registered.traits) owners.set(trait.name, registered);
    }
    const batches = new Map<RegisteredOrbital, MountSeed[]>();
    for (const seed of this.requireKernelEngine().bootMounts('server')) {
      const owner = owners.get(seed.trait);
      if (owner === undefined) continue;
      batches.set(owner, [...(batches.get(owner) ?? []), seed]);
    }
    for (const [registered, mount] of batches) {
      const first = mount[0];
      if (first === undefined) continue;
      const response = await this.evaluateForOrbital(registered, { event: first.event, mount, payload: {} });
      if (!response.success) {
        throw new Error(`OrbitalServerRuntime: the boot mount of orbital "${registered.schema.name}" failed: ${response.error ?? 'the kernel refused it'}`);
      }
    }
  }

  private managedProgram: OrbitalSchema | undefined;

  /**
   * Name the program whose declared credentials this runtime's credential effects manage beside its own: an
   * integrations console serving the app a host shows saves and tests that app's keys. Naming another replaces it.
   */
  manageCredentialsOf(program: OrbitalSchema): void {
    this.managedProgram = program;
    this.kernelEngine?.setManagedProgram(program);
  }

  private requireKernelEngine(): KernelEngine {
    if (this.kernelEngine === null) throw new Error('OrbitalServerRuntime: an os ask arrived with no kernel program registered');
    return this.kernelEngine;
  }

  /**
   * Set up scheduled ticks for all traits
   */
  private setupTicks(): void {
    // Clean up existing ticks
    this.cleanupTicks();

    // For each orbital's traits with `ticks`
    for (const [orbitalName, registered] of this.orbitals) {
      for (const trait of registered.traits || []) {
        if (!trait.ticks || trait.ticks.length === 0) continue;

        for (const tick of trait.ticks) {
          this.registerTick(orbitalName, trait.name, tick);
        }
      }
    }

    if (this.config.debug && this.tickBindings.length > 0) {
      registerLog.debug('register:ticks', { count: this.tickBindings.length });
    }
  }

  /**
   * Register a single tick
   */
  private registerTick(
    orbitalName: string,
    traitName: string,
    tick: RuntimeTraitTick,
  ): void {
    // A cron-shaped string ("0 9 * * *") schedules on calendar matches, not
    // a fixed millisecond delay — route it to the scheduler's cron mode
    // instead of forcing it through parseIntervalString (which used to
    // silently default a cron string to 1000ms).
    if (typeof tick.interval === "string" && isValidCronExpression(tick.interval)) {
      if (this.config.debug) {
        registerLog.debug('register:tick-cron', {
          orbital: orbitalName,
          trait: traitName,
          tick: tick.name,
          expression: tick.interval,
        });
      }
      const handle = this.tickScheduler.addCron(tick.interval, () => {
        void this.executeTick(orbitalName, traitName, tick);
      });
      this.tickBindings.push({ orbitalName, traitName, tick, handle });
      return;
    }

    // Determine interval in milliseconds
    let intervalMs: number;
    if (typeof tick.interval === "number") {
      intervalMs = tick.interval;
    } else if (typeof tick.interval === "string") {
      // Parse a duration string (e.g., '5s', '1m', '1h'). A string that's
      // neither this shape nor a valid cron expression (already checked
      // above) is an authoring mistake — this throws rather than silently
      // defaulting to some fallback ms, so it surfaces loudly instead of
      // ticking at a value the author never wrote.
      intervalMs = parseDurationString(tick.interval);
    } else {
      intervalMs = 1000; // Default to 1 second
    }

    if (this.config.debug) {
      registerLog.debug('register:tick', {
        orbital: orbitalName,
        trait: traitName,
        tick: tick.name,
        intervalMs,
      });
    }

    const handle = this.tickScheduler.add(intervalMs, () => {
      void this.executeTick(orbitalName, traitName, tick);
    });

    this.tickBindings.push({
      orbitalName,
      traitName,
      tick,
      handle,
    });
  }

  /** A tick: the host owns the timer, the kernel decides whether and over which rows it fires. */
  private async executeTick(orbitalName: string, traitName: string, tick: RuntimeTraitTick): Promise<void> {
    const response = await this.processOrbitalEvent(orbitalName, {
      event: tickEventKey(tick.name),
      runTick: { trait: traitName, tick: tick.name },
      targetTrait: traitName,
    });
    if (!response.success) {
      effectLog.error('tick:execute-error', { tick: tick.name, error: response.error ?? 'the kernel refused the tick' });
    }
  }

  /** Tell the kernel which traits some client has mounted, so it can pause the other traits' ticks. */
  private syncTickMount(): void {
    if (this.kernelEngine === null) return;
    const traits = new Set<string>();
    for (const key of this.mountedBy.keys()) traits.add(key.split('::')[1] ?? '');
    this.kernelEngine.setTickMount([...traits]);
  }

  /**
   * Clean up all active ticks
   */
  private cleanupTicks(): void {
    for (const binding of this.tickBindings) {
      binding.handle.stop();
    }
    this.tickBindings = [];
  }

  /**
   * Unregister all orbitals and clean up
   */
  /** A client mounts a trait by dispatching its lifecycle event and releases it with `$UNMOUNT`. */
  private recordMount(orbitalName: string, request: OrbitalEventRequest, mounted: boolean): void {
    // A mount that names no client (the host's own boot mount) is no client's: browser-run ticks fire only while a client has the trait mounted (EXEC-TICK-4).
    const client = request.clientId;
    if (client === undefined) return;
    const traits = request.mount !== undefined
      ? request.mount.map((m) => m.trait)
      : request.targetTrait !== undefined ? [request.targetTrait] : (request.traits ?? []).map((t) => t.trait);
    for (const traitName of traits) {
      const key = `${orbitalName}::${traitName}`;
      const clients = this.mountedBy.get(key) ?? new Set<string>();
      if (mounted) clients.add(client);
      else clients.delete(client);
      if (clients.size > 0) this.mountedBy.set(key, clients);
      else this.mountedBy.delete(key);
    }
    this.syncTickMount();
  }

  /** Drop every mount a disconnected client held, so its traits' mount-scoped ticks pause. */
  releaseClient(clientId: string): void {
    for (const [key, clients] of this.mountedBy) {
      clients.delete(clientId);
      if (clients.size === 0) this.mountedBy.delete(key);
    }
    this.syncTickMount();
  }

  /** True while at least one client has `traitName` mounted. */
  isTraitMounted(orbitalName: string, traitName: string): boolean {
    return (this.mountedBy.get(`${orbitalName}::${traitName}`)?.size ?? 0) > 0;
  }

  unregisterAll(): void {
    // Clean up ticks
    this.cleanupTicks();
    this.mountedBy.clear();

    this.orbitals.clear();
    this.inFlightCalls.cancelAll();
    this.kernelEngine?.dispose();
    this.kernelEngine = null;
    this.kernelOs?.close();
    this.kernelOs = undefined;
    this.eventBus.clear();
    this.messages = {};
    this.appLocales = [];

    this.programHandlersPromise = null;

    // Stamp the mutation epoch AFTER the clear completes: a concurrent
    // processOrbitalEvent that finds an orbital missing consults
    // `registrationEpoch`, and a marker here (rather than nothing) keeps a
    // just-cleared runtime from answering stale lookups while the matching
    // register() is still chaining behind it. NOTE: this marker only covers
    // the clear itself — hosts that unregister → resolve → register as a swap
    // must bracket the WHOLE sequence in `withRegistrationMutation`, or the
    // resolve window between this marker and the upcoming register() answers
    // dispatches with a premature 404 (G-RUNTIME-039). Inside such a bracket
    // the stamp is skipped (the bracket's own epoch covers the swap, and
    // stamping here would deadlock it — see registrationMutationDepth).
    if (this.registrationMutationDepth === 0) {
      this.registrationEpoch = (this.registrationEpoch ?? Promise.resolve())
        .then(() => undefined, () => undefined);
    }
  }

  /**
   * Bracket a multi-step app mutation (the classic swap is
   * `unregisterAll()` → resolve next schema → `register()`) as ONE
   * registration epoch. `register()` alone chains only its own body onto
   * the epoch, so between `unregisterAll()` and the `register()` call the
   * runtime's map is empty while the epoch marker has already resolved —
   * any `processOrbitalEvent` that lands in that gap (the resolve of a big
   * organism takes real time) 404s `Orbital not found` even though the
   * requested orbital is milliseconds away from landing. Inside this
   * bracket the epoch stays pending for the WHOLE callback, so mid-swap
   * dispatches await the completed swap and then resolve against the new
   * app. A failed callback still releases the epoch (chained on both
   * branches), so a failed swap falls through to the honest 404 instead of
   * wedging the queue. Callbacks SERIALIZE: each bracket awaits the previous
   * epoch before running `fn`, so two hosts swapping at once (a catalog
   * select racing a preview remount's `/register`) cannot interleave their
   * unregister/register sequences into a mixed registry. A bracket opened
   * from INSIDE another bracket's callback runs `fn` directly — detected
   * via the AsyncLocalStorage context below (a depth counter alone can't
   * tell a true nest from a concurrent caller) — because the outer
   * callback's awaits already serialize it and queueing on the outer gate
   * would deadlock. Deadlock-free otherwise: `doRegister` never dispatches
   * events, so awaiting dispatches never block registration progress.
   */
  /**
   * Reentrancy context for `withRegistrationMutation`. A depth counter alone
   * cannot distinguish "called from inside a bracket callback" (must run
   * directly — queueing on the outer gate would deadlock) from "called
   * concurrently while another bracket is in flight" (must queue — running
   * directly would interleave two swaps). The ALS marks the callback's async
   * context, which separates the two exactly.
   */
  private bracketAls: Promise<BracketAsyncLocalStorage<symbol>> | null = null;
  private ensureBracketAls(): Promise<BracketAsyncLocalStorage<symbol>> {
    this.bracketAls ??= import('node:async_hooks').then(
      ({ AsyncLocalStorage }) => new AsyncLocalStorage<symbol>(),
    );
    return this.bracketAls;
  }

  async withRegistrationMutation<T>(fn: () => Promise<T>): Promise<T> {
    // Publish the gate SYNCHRONOUSLY: a dispatch arriving in the same tick
    // as the bracket call must see a pending epoch, not a resolved one —
    // any await (including the ALS load below) before this publication
    // would reopen the 404 window the bracket exists to close.
    const previous = this.registrationEpoch ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.registrationEpoch = previous.then(() => gate, () => gate);
    this.registrationMutationDepth++;
    try {
      const als = await this.ensureBracketAls();
      if (als.getStore() !== undefined) {
        // Called from inside an open bracket's callback — the outer
        // callback's awaits already serialize us; queueing on the epoch
        // would deadlock. Our transient gate released here is harmless.
        release();
        return await fn();
      }
      await previous.catch(() => undefined);
      const nestingToken = Symbol('withRegistrationMutation');
      return await als.run(nestingToken, fn);
    } finally {
      this.registrationMutationDepth--;
      release();
    }
  }

  /**
   * Return every registered orbital's circuit to boot: trait states to their
   * initial states, frames and row cache emptied, and a fresh mount (no trait
   * awaiting INIT, nothing held).
   */
  resetCircuitState(): void {
    this.inFlightCalls.cancelAll();
    this.kernelEngine?.reset();
    this.kernelOs?.close();
  }

  /**
   * Wire a live-broadcast sink. Called only from a `persist` effect's
   * `emit:{success}` envelope firing site (batch and single-op) — see
   * `docs/Almadar_Live_Push.md`. The hosting server (e.g. the playground's
   * `/api/events` SSE endpoint) uses this to fan persist mutations out to
   * every OTHER connected client; a fresh call replaces the previous sink.
   */
  setLiveBroadcastSink(sink: (item: LiveBroadcastItem) => void): void {
    this.liveBroadcastSink = sink;
  }

  private publishLiveItem(item: LiveBroadcastItem): void {
    this.liveBroadcastSink?.(item);
    for (const receive of this.liveSubscribers) receive(item);
  }

  /** Wire where a host-run dispatch's result goes (see `HostDispatchItem`); a fresh call replaces the previous sink. */
  setHostDispatchSink(sink: (item: HostDispatchItem) => void): void {
    this.hostDispatchSink = sink;
  }

  /** Run a follow-on step's call outcome as its own dispatch, and hand its result to the host-dispatch sink. */
  private runDeferredOutcome(orbitalName: string, request: OrbitalEventRequest): void {
    void this.processOrbitalEvent(orbitalName, request).then(
      (response) => this.hostDispatchSink?.({ orbitalName, request, response, ...(request.clientId !== undefined ? { originClientId: request.clientId } : {}) }),
      (error: Error) => effectLog.error('deferred-outcome:failed', { orbitalName, event: request.event, trait: request.targetTrait, error: error.message }),
    );
  }

  /**
   * Switch the viewer a dev host presents the app as — see
   * `OrbitalServerRuntimeConfig.defaultUser`. Pass `undefined` for an
   * unauthenticated viewer. Takes effect on the next event; an authenticated
   * request still overrides it.
   */
  setDefaultUser(user: UserContext | undefined): void {
    this.config.defaultUser = user;
  }

  /** The viewer a dev host is currently presenting the app as. */
  getDefaultUser(): UserContext | undefined {
    return this.config.defaultUser;
  }

  /**
   * Queue a tick-stamped dispatch for coalesced snapshot relay (T6). Newest
   * per (originClientId, orbital, event) wins between flushes — the standard
   * netcode position-broadcast discipline.
   */
  private queueTickRelay(orbitalName: string, request: OrbitalEventRequest): void {
    const key = `${request.clientId ?? ''}:${orbitalName}:${request.event}`;
    this.tickRelayPending.set(key, {
      event: request.event,
      payload: request.payload,
      source: { orbital: orbitalName, trait: request.sourceTrait, tick: request.tick },
      originClientId: request.clientId,
      target: 'peers',
    });
    if (this.tickRelayTimer === null) {
      const timer = setInterval(() => this.flushTickRelay(), this.config.tickRelayIntervalMs ?? 50);
      // Never hold a Node process open for the relay.
      if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
      this.tickRelayTimer = timer;
    }
  }

  private flushTickRelay(): void {
    if (this.tickRelayPending.size === 0) {
      if (this.tickRelayTimer !== null) {
        clearInterval(this.tickRelayTimer);
        this.tickRelayTimer = null;
      }
      return;
    }
    const items = Array.from(this.tickRelayPending.values());
    this.tickRelayPending.clear();
    for (const item of items) this.publishLiveItem(item);
  }

  /**
   * The registered app's declared persona roster: the live rows of its
   * `[identity]` entity, mapped onto viewers (`Almadar_LOLO_Identity.md` §4.3).
   * Live-store rows rather than a re-derivation, so the roster carries the ids
   * ownership scoping actually compares `@user.id` against. Empty when no
   * schema is registered or the app declares no `[identity]` entity — there is
   * no global fallback roster by design.
   */
  /**
   * `reference` resolved for `user` against the store as it is now: the rows that still match its query and the
   * viewer's `@read`, in the reference's order, `total` re-counted. The kernel resolves through its server
   * resolve flight. A client reaches it with
   * `POST /:orbital/../resolve-rows` as the signed-in viewer.
   */
  async resolveRows(reference: RowSetRef, user: UserContext): Promise<RowQueryPage> {
    const schema = this.resolvedSchema;
    const owner = schema === null ? undefined : entityOwnerOrbital(schema, reference.entityType);
    if (schema === null || owner === undefined) throw new Error(`${reference.entityType}: no registered orbital declares this entity`);
    return this.requireKernelEngine().resolveRows(reference, { orbital: owner.name, user });
  }

  async getIdentityRoster(): Promise<UserContext[]> {
    const schema = this.resolvedSchema;
    if (!schema) return [];
    const entityName = identityEntityName(schema);
    if (!entityName) return [];
    const rows = await this.persistence.list(entityName);
    return rows
      .map((row) => personaFromIdentityRow(row))
      .filter((p): p is UserContext => p !== undefined);
  }

  // ==========================================================================
  // Event Processing
  // ==========================================================================

  /**
   * Process an event for an orbital — the stateful host's thin shell over
   * the unified `evaluateOrbitalEvent` composition (design:
   * docs/Almadar_Runtime_Stateless_Stateful_PLAN.md §4.1). This method owns
   * ONLY session concerns: orbital lookup, viewer normalization, the lazy
   * OS/substrate handler wiring, the per-request relay mask
   * (G-RUNTIME-031 — the client's mounted set as DATA, replacing the
   * deleted blanket `originClientId` skip), the tick snapshot relay, and
   * the cross-orbital listens relay (a listener registered under a
   * DIFFERENT orbital than the emitter — the per-orbital composition's
   * in-band fan-out covers the rest). Target resolution, payload
   * validation, the cascade, the fan-out, structured rejections, and
   * response assembly are the composition's, identical to the stateless
   * path.
   *
   * Serialization: the whole evaluation runs on ONE runtime-wide async
   * queue. The composition commits manager state directly (no per-trait
   * actor queue), so concurrent requests against the long-lived session
   * manager would otherwise both evaluate from the same held state and
   * lose a transition. Coarser than the old per-(trait, entityId) actor
   * queues — a deliberate W4 tradeoff, recorded in the plan doc.
   *
   * @param onPush - Optional incremental-push callback. Called immediately
   * when an event is emitted or a client effect fires, before the promise
   * resolves. Used by the SSE streaming path to write items to the
   * response as they arrive rather than buffering and flushing at the end.
   */
  /**
   * Read an orbital by name, awaiting an in-flight registration mutation
   * first when the lookup misses (G-RUNTIME-038): mid-swap lookups 404ed
   * against the emptied map even though the requested orbital was
   * milliseconds from landing. A failed mutation falls through to the miss.
   */
  private async resolveRegisteredOrbital(orbitalName: string): Promise<RegisteredOrbital | undefined> {
    let registered = this.orbitals.get(orbitalName);
    if (!registered && this.registrationEpoch !== null) {
      await this.registrationEpoch.catch(() => undefined);
      registered = this.orbitals.get(orbitalName);
    }
    return registered;
  }

  /** The registered orbitals as `GET /` lists them. */
  listOrbitalSummaries(): OrbitalSummary[] {
    return Array.from(this.orbitals.entries()).map(([name, reg]) => ({
      name,
      entityName: reg.entity?.name,
      traits: (reg.traits || []).map((t) => t.name),
    }));
  }

  /** One orbital as `GET /:orbital` describes it, awaiting an in-flight swap first (G-RUNTIME-038); `undefined` when it is not registered. */
  async describeOrbital(orbitalName: string): Promise<OrbitalInfo | undefined> {
    const registered = await this.resolveRegisteredOrbital(orbitalName);
    if (!registered) return undefined;
    const states: Record<string, string> = {};
    for (const trait of registered.traits) {
      const currentState = this.kernelEngine?.stateOf(trait.name) ?? '';
      if (currentState !== '') states[trait.name] = currentState;
    }
    return {
      name: orbitalName,
      entity: registered.entity,
      traits: registered.traits.map((t) => ({
        name: t.name,
        currentState: states[t.name],
        states: (t.stateMachine?.states || []).map((s) => s.name),
        events: [...new Set((t.stateMachine?.transitions || []).map((tr) => tr.event))],
      })),
    };
  }

  /** An entity's full row set as `GET /:orbital/entities/:entityType` answers it (verification and tooling only); `undefined` when the orbital is not registered. */
  async entityRows(orbitalName: string, entityType: string): Promise<EntityRow[] | undefined> {
    const registered = await this.resolveRegisteredOrbital(orbitalName);
    if (!registered) return undefined;
    return this.persistence.list(entityType);
  }

  /** The program's declared external inputs: what an outside client may send which trait. */
  listExternalInputs(): ExternalInput[] {
    return this.resolvedSchema ? externalInputsOf(this.resolvedSchema) : [];
  }

  /**
   * The outside-client input channel: an API caller, an agent acting as the
   * user, an MCP client. Only a declared external input of the target trait is
   * dispatched — through `processOrbitalEvent`, so guards, entity policies and
   * cascades apply exactly as for a click. Anything else is refused with
   * `not-an-external-input`. The app's own UI keeps using `processOrbitalEvent`.
   */
  /**
   * The running app lent to one `call-service` provider as the caller: the
   * declared inputs, the input channel as `user`, and the rows `user` may read
   * (the entity's `@read` policy, the same rule a `fetch` effect applies).
   */
  servicePorts(
    caller: { orbital: string; trait: string },
    user: UserContext | undefined,
    message: (payload: EventPayload) => void = () => {},
    assertReentry?: () => void,
  ): ServiceHostPorts {
    return {
      caller,
      message,
      inputs: () => this.listExternalInputs(),
      readableEntities: () => (this.resolvedSchema ? readableEntitiesOf(this.resolvedSchema) : []),
      dispatchInput: (orbital, request) => {
        assertReentry?.();
        return this.dispatchExternalInput(orbital, { ...request, ...(user !== undefined ? { user } : {}) });
      },
      read: async (entity) => {
        const readPolicy = this.resolvedSchema ? entityAccessPolicies(this.resolvedSchema, entity)?.read : undefined;
        return applyRowAccess(await this.persistence.list(entity), readPolicy, undefined, { user });
      },
      supportsDispatchStream: true,
      dispatchRequest: (orbital, request, input, stream) => {
        assertReentry?.();
        return this.dispatchEventRequest(orbital, request, input, user, stream);
      },
      deliverInbound: (name, delivery) => this.deliverInbound(name, delivery),
    };
  }

  /**
   * A `program/dispatch` event request, as the events route (or with `input`, the inputs route) runs it: the
   * request's own `user` is its viewer, else the caller's. An unknown orbital is `ORBITAL_NOT_FOUND`, an undeclared
   * locale `LOCALE_NOT_DECLARED`; an inbound-only event and an undeclared input are the routes' refusals.
   */
  async dispatchEventRequest(
    orbital: string,
    parsed: EventRequest,
    input: boolean,
    caller: UserContext | undefined,
    stream = false,
  ): Promise<DispatchRequestOutcome> {
    const request: OrbitalEventRequest = parsed;
    const streamItems: EventStreamItem[] = [];
    const onPush = stream ? (item: PushItem): void => { streamItems.push({ ...item, timestamp: item.timestamp ?? Date.now() }); } : undefined;
    const answer = (response: OrbitalEventResponse): DispatchRequestOutcome => ({
      ok: true, response,
      ...(stream ? { streamItems: [...streamItems, { type: 'complete', data: response, timestamp: Date.now() }] } : {}),
    });
    if ((await this.describeOrbital(orbital)) === undefined) {
      return { ok: false, error: `Orbital not found: ${orbital}`, code: 'ORBITAL_NOT_FOUND', status: 404 };
    }
    const user = request.user ?? caller;
    if (input) {
      if (request.targetTrait === undefined) {
        return { ok: false, error: 'program/dispatch: an input request names its trait', code: 'NO_TRAIT', status: 400 };
      }
      const response = await this.dispatchExternalInput(orbital, {
        targetTrait: request.targetTrait,
        event: request.event,
        ...(request.payload !== undefined ? { payload: request.payload } : {}),
        ...(request.entityId !== undefined ? { entityId: request.entityId } : {}),
        ...(user !== undefined ? { user } : {}),
      }, onPush);
      return answer(response);
    }
    const refusal = this.refuseInboundOnly(orbital, request);
    if (refusal !== undefined) return answer(refusal);
    if (request.locale !== undefined && this.appLocales.length > 0 && !this.appLocales.includes(request.locale)) {
      const error = `locale "${request.locale}" is not one of the program's declared locales [${this.appLocales.join(', ')}]`;
      return { ok: false, error, code: 'LOCALE_NOT_DECLARED', status: 400 };
    }
    return answer(await this.processOrbitalEvent(orbital, user !== undefined ? { ...request, user } : request, onPush));
  }

  async dispatchExternalInput(
    orbitalName: string,
    request: ExternalInputRequest,
    onPush?: (item: PushItem) => void,
  ): Promise<OrbitalEventResponse> {
    return dispatchDeclaredInput(this.resolvedSchema, orbitalName, request, (orbital, req) => this.processOrbitalEvent(orbital, req, onPush));
  }

  /**
   * An inbound delivery (`/api/hooks/<name>`): the runtime decides whether the name is served, runs
   * the handler through `processOrbitalEvent` and answers; the host only carries the bytes.
   */
  /**
   * An event that is an inbound hook's is delivered only by `deliverInbound`: the app's own event
   * route refuses it, as the input channel refuses an event that is no declared input.
   */
  refuseInboundOnly(orbitalName: string, request: Pick<OrbitalEventRequest, 'event' | 'targetTrait'>): OrbitalEventResponse | undefined {
    const trait = this.resolvedSchema ? inboundOnlyTrait(this.resolvedSchema, orbitalName, request.targetTrait, request.event) : undefined;
    if (trait === undefined) return undefined;
    return {
      success: false,
      transitioned: false,
      states: {},
      emittedEvents: [],
      error: inboundOnlyMessage(trait, request.event),
      rejections: [{ code: 'inbound-only-event', trait, event: request.event }],
    };
  }

  async deliverInbound(name: string, delivery: InboundDelivery, onPush?: (item: PushItem) => void): Promise<InboundAnswer> {
    return dispatchInbound(this.resolvedSchema, name, delivery, (orbital, req) => this.processOrbitalEvent(orbital, req, onPush), (credential) => (this.httpPorts()?.secrets ?? createHttpSecrets()).get(credential, undefined));
  }

  async processOrbitalEvent(
    orbitalName: string,
    request: OrbitalEventRequest,
    onPush?: (item: PushItem) => void,
  ): Promise<OrbitalEventResponse> {
    // Gap 4 (Almadar_Rabit_V3_Deepseek_Gaps.md #4): this whole body used to
    // have no top-level error boundary, so a throw deep in an effect
    // handler (e.g. an LLM abort inside emitLoloBody) escaped as an
    // unhandled rejection instead of a normal failure response. Wrap it
    // and reuse the same failure shape already returned above for
    // "orbital not found" / payload-validation failures.
    try {
    // Wire substrate effect handlers before any effect runs.
    await this.ensureProgramHandlers();

    const registered = await this.resolveRegisteredOrbital(orbitalName);
    if (!registered) {
      return {
        success: false,
        transitioned: false,
        states: {},
        emittedEvents: [],
        error: `Orbital not found: ${orbitalName}`,
      };
    }

    if (request.event === UNMOUNT_EVENT) {
      this.recordMount(orbitalName, request, false);
      return { success: true, transitioned: false, states: {}, emittedEvents: [] };
    }
    if (request.mount !== undefined || (LIFECYCLE_EVENTS as readonly string[]).includes(request.event)) {
      this.recordMount(orbitalName, request, true);
    }

    const response = await this.evaluateForOrbital(registered, request, onPush);

    // T6: a tick-stamped dispatch is a latest-state broadcast — queue it for
    // coalesced snapshot relay to other tabs. Local processing above is
    // unchanged (guards/persists still run); only the cross-tab fan-out is
    // lossy.
    if (request.tick !== undefined && this.liveBroadcastSink !== null) {
      this.queueTickRelay(orbitalName, request);
    }

    return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      xOrbitalLog.error('processOrbitalEvent:error', {
        orbital: orbitalName,
        event: request.event,
        entityId: request.entityId,
        error: message,
      });
      return {
        success: false,
        transitioned: false,
        states: {},
        emittedEvents: [],
        error: message,
      };
    }
  }

  /**
   * One request evaluated on the kernel, which orders it among every other (EXEC-CONC-2), then its emits relayed
   * to the host sinks.
   */
  private async evaluateForOrbital(
    registered: RegisteredOrbital,
    request: OrbitalEventRequest,
    onPush?: (item: PushItem) => void,
  ): Promise<OrbitalEventResponse> {
    const orbitalName = registered.schema.name;
    // Trace every server-side event entry. If the runtime path is
    // re-firing render-ui during a typing session, the smoking gun
    // appears here: a `processOrbitalEvent:enter` line per keystroke
    // means something upstream (bus replay, snapshot poll, cascade
    // listener) is triggering a transition cycle the user didn't
    // intend. EventPayload values are typed as `EventPayloadValue`
    // (a recursive union including nested EventPayload) — narrow with
    // typeof checks instead of an unknown cast.
    const payloadRow = request.payload?.['row'];
    const payloadRowAsPayload =
      payloadRow !== null && typeof payloadRow === 'object' && !Array.isArray(payloadRow)
        ? (payloadRow as EventPayload)
        : undefined;
    const payloadRowId = payloadRowAsPayload?.['id'];
    renderLog.debug('processOrbitalEvent:enter', {
      orbital: orbitalName,
      event: request.event,
      hasPayloadRow: payloadRowAsPayload !== undefined,
      payloadRowId: typeof payloadRowId === 'string' || typeof payloadRowId === 'number' ? payloadRowId : undefined,
      entityId: request.entityId,
    });
    busLog.debug('bus:incoming', () => ({
      orbital: orbitalName,
      event: request.event,
      payload: JSON.stringify(request.payload ?? null),
      entityId: request.entityId,
      traitStates: JSON.stringify(registered.traits.map((trait) => ({ traitName: trait.name, currentState: this.kernelEngine?.stateOf(trait.name) ?? '' }))),
    }));
    xOrbitalLog.debug('processOrbitalEvent:enter', () => ({
      orbital: orbitalName,
      event: request.event,
      traitsInOrbital: registered.traits.map((t) => t.name).join(','),
      payloadActiveTraits: JSON.stringify(
        (request.payload as EventPayload | undefined)?.['_activeTraits'] ?? null,
      ),
    }));

    // The viewer this event is executed as. A request's own authenticated
    // user always wins; `defaultUser` only fills the gap for a dev host
    // that has no auth (see the config field's doc).
    const viewer = normalizeUserContext(request.user) ?? this.config.defaultUser;
    if (request.locale !== undefined && this.appLocales.length > 0 && !this.appLocales.includes(request.locale)) {
      throw new Error(`locale "${request.locale}" is not one of the program's declared locales [${this.appLocales.join(', ')}]`);
    }

    // A TARGETED request carrying circuit state is the client role's
    // delegated server leg — the composition's own delegated-leg semantics
    // apply (empty relay mask: the server runs the whole circuit,
    // G-RUNTIME-029). Anything else is server-authoritative: strip
    // client-carried circuit state so a non-targeted request can't inject
    // client-held states into the session manager. The legacy client's
    // `_targetTrait` payload sidecar is PROMOTED to the canonical
    // first-class field here: the composition's sidecar fallback only
    // guesses an initial state for single-state traits (a stateless-server
    // protection), which would silently drop the multi-state scoped
    // deliveries the old stateful path served from its held states.
    const isDelegatedLeg = (request.targetTrait !== undefined || request.mount !== undefined) &&
      (request.traits !== undefined || request.entityByTrait !== undefined);
    let serverRequest = request;
    if (!isDelegatedLeg && request.targetTrait === undefined) {
      const sidecarTarget = (request.payload as EventPayload | undefined)?.['_targetTrait'] as string | undefined;
      if (sidecarTarget !== undefined || request.traits !== undefined || request.entityByTrait !== undefined) {
        serverRequest = { ...request, ...(sidecarTarget !== undefined ? { targetTrait: sidecarTarget } : {}) };
        delete serverRequest.traits;
        delete serverRequest.entityByTrait;
      }
    }

    // This host HOLDS every trait's state, so it runs every listener itself
    // (G-RUNTIME-031's off-page listeners included); the client's mounted
    // set only scopes which renders come back (`_activeTraits`, read by the
    // composition). Leaving on-page listeners to the client left this
    // host's held state stale (G-RUNTIME-042).
    const response = await evaluateOnKernel(
      { engine: this.requireKernelEngine(), orbital: registered.schema.name, ...(onPush !== undefined ? { onStream: (item: EventStreamItem): void => { if (item.type === 'event' || item.type === 'effect') onPush(item); } } : {}) },
      serverRequest,
      viewer,
      request.locale,
    );

    // The kernel's cascade already crosses orbitals: there is nothing for the host to relay.
    this.publishKernelResponse(response, undefined, request.clientId);
    return response;
  }

  /**
   * Feed the host sinks from a kernel response: the kernel answers a dispatch whole, so each emit reaches the
   * event bus (the public firehose) and `onPush` once the dispatch is done, in the order the response carries them.
   */
  private publishKernelResponse(response: OrbitalEventResponse, onPush: ((item: PushItem) => void) | undefined, originClientId?: string): void {
    for (const hop of response.transitions ?? []) {
      this.transitionFanout.onTransition({ traitName: hop.trait, from: hop.from, to: hop.to, event: hop.event, ...(hop.firedArm !== undefined ? { firedArm: hop.firedArm } : {}), ...(hop.guardResult !== undefined ? { guardResult: hop.guardResult } : {}), effects: hop.effects });
    }
    for (const emitted of response.emittedEvents) {
      this.eventBus.emit(emitted.event, emitted.payload, emitted.source, eventRouteKey(emitted.event, emitted.source?.eventId));
      if (emitted.source?.persistSuccess === true) {
        const { persistSuccess: _mark, ...source } = emitted.source;
        this.publishLiveItem({ event: emitted.event, ...(emitted.payload !== undefined ? { payload: emitted.payload } : {}), source, ...(originClientId !== undefined ? { originClientId } : {}), target: 'peers' });
      }
      onPush?.({ type: 'event', data: emitted });
    }
    for (const { effect } of response.clientEffectsByTrait ?? []) onPush?.({ type: 'effect', data: effect });
  }

  /** This app's in-flight keyed `call-service`s, shared by every transition it runs (`cancel-call`). */
  private readonly inFlightCalls = new InFlightCalls();

  // ==========================================================================
  // Direct API (for programmatic use)
  // ==========================================================================

  /**
   * Get the event bus for manual event emission
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /** Observe every executed hop (listener deliveries included) on every orbital; returns the unsubscribe. */
  observeTransitions(observer: TransitionObserver): () => void {
    this.transitionObservers.add(observer);
    return () => { this.transitionObservers.delete(observer); };
  }

  /**
   * Get state for a specific orbital/trait
   */
  getState(
    orbitalName: string,
    traitName?: string,
  ): TraitState | Record<string, TraitState> | undefined {
    const registered = this.orbitals.get(orbitalName);
    if (!registered) return undefined;

    const kernel = this.kernelEngine;
    if (kernel === null) return undefined;
    const stateOf = (name: string): TraitState | undefined => {
      const currentState = kernel.stateOf(name);
      return currentState === '' ? undefined : { traitName: name, currentState, previousState: null, lastEvent: null, context: {} };
    };
    if (traitName) return stateOf(traitName);
    const states: Record<string, TraitState> = {};
    for (const trait of registered.traits) {
      const state = stateOf(trait.name);
      if (state !== undefined) states[trait.name] = state;
    }
    return states;
  }

  /**
   * List registered orbitals
   */
  listOrbitals(): string[] {
    return Array.from(this.orbitals.keys());
  }

  /**
   * Check if an orbital is registered
   */
  hasOrbital(name: string): boolean {
    return this.orbitals.has(name);
  }

  /**
   * Get information about active ticks
   */
  getActiveTicks(): Array<{
    orbital: string;
    trait: string;
    tick: string;
    interval: number | string;
    hasGuard: boolean;
  }> {
    return this.tickBindings.map((binding) => ({
      orbital: binding.orbitalName,
      trait: binding.traitName,
      tick: binding.tick.name,
      interval: binding.tick.interval,
      hasGuard: !!binding.tick.guard,
    }));
  }

  /** Halt every registered tick's shared clock. Delegates to `TickScheduler.pause`. */
  pauseTicks(): void {
    this.tickScheduler.pause();
  }

  /** Resume ticks halted by `pauseTicks()`. Delegates to `TickScheduler.resume`. */
  resumeTicks(): void {
    this.tickScheduler.resume();
  }

  /** True while ticks are paused. Delegates to `TickScheduler.isPaused`. */
  areTicksPaused(): boolean {
    return this.tickScheduler.isPaused;
  }
}

/**
 * Factory function to create a runtime instance
 */
export function createOrbitalServerRuntime(
  config: OrbitalServerRuntimeConfig,
): OrbitalServerRuntime {
  return new OrbitalServerRuntime(config);
}

// ============================================================================
// Source-scoped listen support
// ============================================================================
//
// `parseListenSource` moved to `../events/identity/routing.js` (2026-09-18) so the
// stateless `@almadar-io/playground-runtime` path can reuse the exact same
// `listens {}` matching predicate for its own cross-orbital cascade instead
// of a second, divergent copy — see that module's doc comment.

