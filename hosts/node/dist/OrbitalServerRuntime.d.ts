import { EventPayload, EffectHandlers, EvaluationContextExtensions, KernelModule, HttpPortsOptions, OsGrantPort, OsHostPort, EntityRow, EventBus, TransitionObserver, TraitState } from '@almadar/shell-runtime';
import { OrbitalEventRequest, OrbitalEventResponse, BusEventSource, Entity, OrbitalDefinition, Trait, TraitConfig, PersistenceAdapter, UserContext, OrbitalSchema, MessageCatalogs, RowSetRef, RowQueryPage, ExternalInput, ServiceHostPorts, DispatchRequestOutcome, ExternalInputRequest, ClientEffectTuple, InboundDelivery, InboundAnswer, TraitTick } from '@almadar/core';
export { ClientEffectTuple, ClientNavigateBackTuple, ClientNavigateTuple, ClientRenderUITuple, OrbitalEventRequest, OrbitalEventResponse, TransitionRejection } from '@almadar/core';

/**
 * OrbitalServerRuntime: the Node host that runs a registered program on the kernel. It answers the kernel's asks
 * (rows, services, `http`, `os` through the given os host, live streams), drives its ticks and mounts; it serves no
 * HTTP routes (a served program composes std-http-server for that).
 *
 * @packageDocumentation
 */

/** @deprecated Use OrbitalSchema from @almadar/core */
type RuntimeOrbitalSchema = OrbitalSchema;
/** @deprecated Use OrbitalDefinition from @almadar/core */
type RuntimeOrbital = OrbitalDefinition;
/** @deprecated Use Trait from @almadar/core */
type RuntimeTrait = Trait;
/** @deprecated Use TraitTick from @almadar/core */
type RuntimeTraitTick = TraitTick;
/**
 * Incremental-push item streamed to an SSE client mid-dispatch (an emitted
 * event or a client effect), before the response resolves.
 */
type PushItem = {
    type: 'event';
    data: {
        event: string;
        payload?: EventPayload;
        source?: BusEventSource;
    };
    timestamp?: number;
} | {
    type: 'effect';
    data: ClientEffectTuple;
    timestamp?: number;
};
/**
 * Registered orbital with runtime state
 */
/** One registered orbital as the API lists it. */
interface OrbitalSummary {
    name: string;
    entity: string | undefined;
    traits: string[];
}
/** One registered orbital as the API describes it: its entity and each trait's current state, states and events. */
interface OrbitalInfo {
    name: string;
    entity: Entity;
    traits: {
        name: string;
        currentState: string | undefined;
        states: string[];
        events: string[];
    }[];
}
interface RegisteredOrbital {
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
/**
 * One persist-envelope success emit, handed to the live-broadcast sink
 * (`setLiveBroadcastSink`). Fired only from the `persist` effect's
 * `emit:{success}` envelope (batch and single-op) — never from the generic
 * emit funnel — so transport layers can fan it out to every OTHER
 * connected client without matching on event names.
 */
interface LiveBroadcastItem {
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
interface HostDispatchItem {
    orbitalName: string;
    request: OrbitalEventRequest;
    response: OrbitalEventResponse;
    originClientId?: string;
}
/**
 * Loader configuration for resolving `uses` imports
 */
interface LoaderConfig {
    /** Where `orb` resolves a registered program's imports from, when no `programHost` names it. */
    basePath: string;
}
/**
 * Runtime configuration
 */
interface OrbitalServerRuntimeConfig {
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
    /**
     * Data mode:
     * - 'mock': mock service answers and the std mock-seed dataset
     * - 'real': the actual persistence layer and services
     * Required: whoever starts the runtime states it; there is no default (EXEC-BOUND-2).
     */
    mode: 'mock' | 'real';
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
    programHost?: {
        cwd: string;
        orbBin?: string;
    };
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
     * ticks and the mock seeder's owner stamps.
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
declare class UnresolvedProgramError extends Error {
    constructor(schemaName: string);
}
/** What `register` takes beside the schema: the program's catalogs and the `uses lazy` behaviors the server runs alongside it. */
interface RegisterOptions {
    messages?: MessageCatalogs;
    lazy?: readonly OrbitalSchema[];
}
declare class OrbitalServerRuntime {
    protected orbitals: Map<string, RegisteredOrbital>;
    private eventBus;
    private config;
    /** The row store a host-supplied `persistence` replaces: the kernel's own `MemoryStore`, opened by the first `register()`. */
    private ownedStore;
    /** The owner cells the mock seed stamped, kept for a persona restamp. */
    private mockJournal;
    /** The std seed program resolved from the installed packages, once per runtime. */
    private seedProgram;
    /** Store writes (seed, reseed, restamp) run one after another. */
    private storeOps;
    /**
     * The bound persistence adapter (host-supplied, else the kernel's own memory store). Public so a test can
     * inspect committed rows honestly. A runtime that owns its store has one from the first `register()`.
     */
    get persistence(): PersistenceAdapter;
    /** Whether this runtime seeds generated mock rows: mock mode over the store it owns. */
    private seedsMock;
    private tickBindings;
    /** The kernel running the registered program; null before a program is registered. */
    private kernelEngine;
    /** The `os` handles of the program the kernel runs; closed when that program is replaced, reset or dropped. */
    private kernelOs;
    /** `orbital::trait` → the clients that have it mounted (Runtime Spec Clause 8.3). */
    private readonly mountedBy;
    private readonly tickScheduler;
    private readonly transitionObservers;
    private readonly transitionFanout;
    private programHandlersPromise;
    private resolvedSchema;
    /** The program's declared `locales`, in declared order; the first is the default. */
    private appLocales;
    /** Merged message catalogs of every registered program (keys are behavior-qualified). */
    private messages;
    /** Wired by the hosting server (e.g. the playground SSE endpoint) via `setLiveBroadcastSink`. */
    private readonly liveSubscribers;
    private liveBroadcastSink;
    private hostDispatchSink;
    /**
     * Tick-broadcast relay (T6): newest pending item per
     * (originClientId, orbital, event), flushed to the live-broadcast sink on
     * the `tickRelayIntervalMs` cadence — other tabs get the latest position
     * at snapshot rate, never 1:1 with emissions.
     */
    private readonly tickRelayPending;
    private tickRelayTimer;
    constructor(config: OrbitalServerRuntimeConfig);
    /**
     * Lazily wire the program host handlers (behavior/* and program/* effects),
     * merging them UNDER any user-provided handlers. Only when `programHost`
     * is configured; otherwise the effects fail explicitly.
     */
    private ensureProgramHandlers;
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
    private registrationEpoch;
    /**
     * Reentrancy guard for `withRegistrationMutation`. While a bracket is
     * open, `register()`/`unregisterAll()` must NOT chain/stamp the epoch:
     * the callback's sequential awaits already order them, and chaining a
     * `register()` awaited by the callback onto the bracket's gate would
     * deadlock (callback → register → epoch → gate → callback's finally).
     */
    private registrationMutationDepth;
    register(schema: OrbitalSchema, options?: RegisterOptions): Promise<void>;
    private doRegister;
    /** The kernel's own row store, opened once in the register phase when the host supplied none. */
    private openOwnedStore;
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
    registeredSchemaName(): string | null;
    getResolvedSchema(): OrbitalSchema | null;
    /** The registered program's message catalogs (locale → qualified key → message), for a host's client. */
    getMessages(): MessageCatalogs;
    /**
     * One-call entry point: read an `.orb` file from disk, parse it, preprocess
     * cross-orbital imports, and register the result. Callers never touch raw
     * `.orb` bytes — `register()` handles preprocessing internally.
     *
     * Node only. Browsers must receive already-resolved schemas from their
     * server (see `getResolvedSchema()`).
     */
    registerFromFile(path: string): Promise<void>;
    /** A program with imports resolved by `orb` from the configured base path (Node only: the one resolver is the compiler). */
    private resolveWithOrb;
    /**
     * Register a single orbital
     */
    private registerOrbitalAsync;
    /** The adapters the kernel's I/O is answered with: this runtime's persistence, services and program host. */
    private httpPorts;
    private kernelPorts;
    /** One live message of a running `call-service`, stamped as its calling trait, to the requesting tab only. */
    private deliverLiveMessage;
    /** The project root this runtime hands `orb` and the kernel's language data: the program host's cwd, else the loader base path. */
    private programRoot;
    /** The kernel module this runtime runs on: the one the host handed in, else the installed `@almadar/kernel`. */
    private kernelModule;
    /** (Re)open the kernel on the program just registered. */
    private openKernel;
    /** The program whose rows the store holds, once seeded; absent before the first seed and after `unregisterAll`. */
    private seededProgram;
    /** The std mock-seed program, resolved by `orb` from the installed packages. */
    private resolveSeedProgram;
    /** Run `use` with the seed program forked off the kernel just opened; the fork is released after. */
    private withSeeder;
    /** Store writes (seed, reseed, restamp) run one after another, so a persona switch never interleaves a reseed. */
    private enqueueStoreOp;
    /**
     * Fill the store from the program, in the register phase: a mock runtime seeds every entity for the viewer, any
     * other runtime seeds the rows the program writes out and its browser-stored entities.
     */
    private seedStores;
    private managedProgram;
    /**
     * Name the program whose declared credentials this runtime's credential effects manage beside its own: an
     * integrations console serving the app a host shows saves and tests that app's keys. Naming another replaces it.
     */
    manageCredentialsOf(program: OrbitalSchema): void;
    /** A mock store seeds every entity; the `[runtime]` rows the kernel holds itself are seeded in the kernel. */
    private seedKernelRuntimeMock;
    private requireKernelEngine;
    /**
     * Set up scheduled ticks for all traits
     */
    private setupTicks;
    /**
     * Register a single tick
     */
    private registerTick;
    /** A tick: the host owns the timer, the kernel decides whether and over which rows it fires. */
    private executeTick;
    /** Tell the kernel which traits some client has mounted, so it can pause the other traits' ticks. */
    private syncTickMount;
    /**
     * Clean up all active ticks
     */
    private cleanupTicks;
    /**
     * Unregister all orbitals and clean up
     */
    /** A client mounts a trait by dispatching its lifecycle event and releases it with `$UNMOUNT`. */
    private recordMount;
    /** Drop every mount a disconnected client held, so its traits' mount-scoped ticks pause. */
    releaseClient(clientId: string): void;
    /** True while at least one client has `traitName` mounted. */
    isTraitMounted(orbitalName: string, traitName: string): boolean;
    unregisterAll(): void;
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
    private bracketAls;
    private ensureBracketAls;
    withRegistrationMutation<T>(fn: () => Promise<T>): Promise<T>;
    /**
     * Reset the mock persistence store to a clean-slate re-seed without
     * unregistering orbitals. Exposed for verifier tools that want to
     * start each test with deterministic seeded rows, not the residue of
     * the previous walk's persist-creates. No-op when the runtime does not
     * seed a mock store of its own.
     */
    resetMockPersistence(): Promise<void>;
    /**
     * Return every registered orbital's circuit to boot: trait states to their
     * initial states, frames and row cache emptied, and a fresh mount (no trait
     * awaiting INIT, nothing held). The hermetic-reset twin of
     * `resetMockPersistence`: a reset walk must not inherit the previous walk's
     * circuit any more than its rows.
     */
    resetCircuitState(): void;
    /**
     * Wire a live-broadcast sink. Called only from a `persist` effect's
     * `emit:{success}` envelope firing site (batch and single-op) — see
     * `docs/Almadar_Live_Push.md`. The hosting server (e.g. the playground's
     * `/api/events` SSE endpoint) uses this to fan persist mutations out to
     * every OTHER connected client; a fresh call replaces the previous sink.
     */
    setLiveBroadcastSink(sink: (item: LiveBroadcastItem) => void): void;
    private publishLiveItem;
    /** Wire where a host-run dispatch's result goes (see `HostDispatchItem`); a fresh call replaces the previous sink. */
    setHostDispatchSink(sink: (item: HostDispatchItem) => void): void;
    /** Run a follow-on step's call outcome as its own dispatch, and hand its result to the host-dispatch sink. */
    private runDeferredOutcome;
    /**
     * Switch the viewer a dev host presents the app as — see
     * `OrbitalServerRuntimeConfig.defaultUser`. Pass `undefined` for an
     * unauthenticated viewer. Takes effect on the next event; an authenticated
     * request still overrides it.
     *
     * Mock mode stamps the seeded owner columns for whichever id was `defaultUser`
     * at register time. Switching to a different id re-points those cells with
     * `restampMockOwner` instead of re-seeding, so an ownership-scoped view for
     * the new viewer has rows. The returned promise settles when the restamp has
     * landed (immediately when there is nothing seeded yet; register flushes it).
     */
    setDefaultUser(user: UserContext | undefined): Promise<void>;
    /** Whether the host named the viewer (constructor or `setDefaultUser`). If not, the viewer is
     *  the app's first declared persona, resolved as soon as its roster is seeded. */
    private viewerNamedByHost;
    /** setDefaultUser can land before register() finishes resolving the schema
     *  (a dev host pins a persona right after boot). An ungated restamp there
     *  would hand a read-only persona authorship of drafts, so the restamp is
     *  DEFERRED until the schema exists — register()/registerSync() flush it. */
    private pendingOwnerRestamp;
    /**
     * Re-point the seeded owner cells at `user` (a persona switch never reseeds). The seed program's policy gates decide
     * per row whether the persona could have created it. Deferred when the program is not seeded yet.
     */
    private restampOwnerGated;
    /** Flush a persona switch that arrived before the schema was resolved. */
    private flushPendingOwnerRestamp;
    /** The viewer a dev host is currently presenting the app as. */
    getDefaultUser(): UserContext | undefined;
    /**
     * Queue a tick-stamped dispatch for coalesced snapshot relay (T6). Newest
     * per (originClientId, orbital, event) wins between flushes — the standard
     * netcode position-broadcast discipline.
     */
    private queueTickRelay;
    private flushTickRelay;
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
    resolveRows(reference: RowSetRef, user: UserContext): Promise<RowQueryPage>;
    getIdentityRoster(): Promise<UserContext[]>;
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
    private resolveRegisteredOrbital;
    /** The registered orbitals as `GET /` lists them. */
    listOrbitalSummaries(): OrbitalSummary[];
    /** One orbital as `GET /:orbital` describes it, awaiting an in-flight swap first (G-RUNTIME-038); `undefined` when it is not registered. */
    describeOrbital(orbitalName: string): Promise<OrbitalInfo | undefined>;
    /** An entity's full row set as `GET /:orbital/entities/:entityType` answers it (verification and tooling only); `undefined` when the orbital is not registered. */
    entityRows(orbitalName: string, entityType: string): Promise<EntityRow[] | undefined>;
    /** The program's declared external inputs: what an outside client may send which trait. */
    listExternalInputs(): ExternalInput[];
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
    servicePorts(caller: {
        orbital: string;
        trait: string;
    }, user: UserContext | undefined, message?: (payload: EventPayload) => void, assertReentry?: () => void): ServiceHostPorts;
    /**
     * A `program/dispatch` event request, as the events route (or with `input`, the inputs route) runs it: the
     * request's own `user` is its viewer, else the caller's. An unknown orbital is `ORBITAL_NOT_FOUND`, an undeclared
     * locale `LOCALE_NOT_DECLARED`; an inbound-only event and an undeclared input are the routes' refusals.
     */
    dispatchEventRequest(orbital: string, request: OrbitalEventRequest, input: boolean, caller: UserContext | undefined, stream?: boolean): Promise<DispatchRequestOutcome>;
    dispatchExternalInput(orbitalName: string, request: ExternalInputRequest, onPush?: (item: PushItem) => void): Promise<OrbitalEventResponse>;
    /**
     * An inbound delivery (`/api/hooks/<name>`): the runtime decides whether the name is served, runs
     * the handler through `processOrbitalEvent` and answers; the host only carries the bytes.
     */
    /**
     * An event that is an inbound hook's is delivered only by `deliverInbound`: the app's own event
     * route refuses it, as the input channel refuses an event that is no declared input.
     */
    refuseInboundOnly(orbitalName: string, request: Pick<OrbitalEventRequest, 'event' | 'targetTrait'>): OrbitalEventResponse | undefined;
    deliverInbound(name: string, delivery: InboundDelivery, onPush?: (item: PushItem) => void): Promise<InboundAnswer>;
    processOrbitalEvent(orbitalName: string, request: OrbitalEventRequest, onPush?: (item: PushItem) => void): Promise<OrbitalEventResponse>;
    /**
     * The enqueued critical section behind `processOrbitalEvent`: evaluate
     * one request through the composition, then relay its emits to
     * cross-orbital listeners. MUST only run holding the event queue.
     */
    private evaluateForOrbital;
    /**
     * Feed the host sinks from a kernel response: the kernel answers a dispatch whole, so each emit reaches the
     * event bus (the public firehose) and `onPush` once the dispatch is done, in the order the response carries them.
     */
    private publishKernelResponse;
    /**
     * The runtime-wide event queue — ONE async serialization point for every
     * composition run (requests, cross-orbital relays, external emits, tick
     * relays). The composition commits manager state directly rather than
     * through the manager's per-(trait, entityId) actor queues, so without
     * this, two concurrent requests against the session manager could both
     * evaluate from the same held state and lose a transition. `run` sees
     * the caller's result (or throw); the queue itself never wedges on a
     * failure.
     */
    private eventQueue;
    /** This app's in-flight keyed `call-service`s, shared by every transition it runs (`cancel-call`). */
    private readonly inFlightCalls;
    /** Wait for the queue, then hold it until the returned release is called. FIFO. */
    private acquireEventQueue;
    /**
     * Hold the queue for `run`, handing it the hold so the work it reaches can
     * release it (`outsideEventQueue`). The hold is passed explicitly rather than
     * carried in async context: this runtime also runs in the browser (the orb
     * website), which has no AsyncLocalStorage.
     */
    private enqueueEvent;
    /**
     * Run `work` with this context's queue hold released, then re-acquire it (in
     * FIFO order behind whatever queued meanwhile). Dispatches that land while
     * released run as their own dispatches; their commits and the held run's
     * later commit follow server-arrival last-write-wins. Outside a hold, `work`
     * just runs.
     */
    private outsideEventQueue;
    /**
     * Get the event bus for manual event emission
     */
    getEventBus(): EventBus;
    /** Observe every executed hop (listener deliveries included) on every orbital; returns the unsubscribe. */
    observeTransitions(observer: TransitionObserver): () => void;
    /**
     * Get state for a specific orbital/trait
     */
    getState(orbitalName: string, traitName?: string): TraitState | Record<string, TraitState> | undefined;
    /**
     * List registered orbitals
     */
    listOrbitals(): string[];
    /**
     * Check if an orbital is registered
     */
    hasOrbital(name: string): boolean;
    /**
     * Get information about active ticks
     */
    getActiveTicks(): Array<{
        orbital: string;
        trait: string;
        tick: string;
        interval: number | string;
        hasGuard: boolean;
    }>;
    /** Halt every registered tick's shared clock. Delegates to `TickScheduler.pause`. */
    pauseTicks(): void;
    /** Resume ticks halted by `pauseTicks()`. Delegates to `TickScheduler.resume`. */
    resumeTicks(): void;
    /** True while ticks are paused. Delegates to `TickScheduler.isPaused`. */
    areTicksPaused(): boolean;
}
/**
 * Factory function to create a runtime instance
 */
declare function createOrbitalServerRuntime(config: OrbitalServerRuntimeConfig): OrbitalServerRuntime;

export { type HostDispatchItem, type LiveBroadcastItem, type LoaderConfig, type OrbitalInfo, OrbitalServerRuntime, type OrbitalServerRuntimeConfig, type OrbitalSummary, type PushItem, type RegisterOptions, type RegisteredOrbital, type RuntimeOrbital, type RuntimeOrbitalSchema, type RuntimeTrait, type RuntimeTraitTick, UnresolvedProgramError, createOrbitalServerRuntime };
