/**
 * Unified Runtime Types
 *
 * Platform-agnostic interfaces for trait execution on client or server.
 *
 * @packageDocumentation
 */

import type { CallServiceHandler } from '../service/default-call-service.js';
import type { ServiceCallContext } from '../service/service-provider.js';
import type {
    EntityRow,
    EventPayload,
    FetchResult,
    ServiceHostPorts,
    ServiceParams,
    ResolvedPatternProps,
    AgentContext,
    BusEvent,
    BusEventSource,
    BusEventListener,
    Unsubscribe as CoreUnsubscribe,
    PatternConfig,
    SExpr,
    FieldValue,
    LlmContext,
    WorkspaceContext,
    SessionContext,
    MemoryContext,
    TraceContext,
    JsonValue,
    OrbitalSchema,
    EventId,
    TraitId,
    OrbitalId,
    TraitEventListener,
    UserContext,
    NavItem,
    RuntimeValue,
    RowSetRef,
} from '@almadar/core';
import type { HopObservation } from '@almadar/core/kernel-wire';
import type { ProgramEffectName, ProgramEffectOutcome } from '../kernel/program-effects.js';

// ============================================================================
// Runtime Data Types (re-exported from @almadar/core)
// ============================================================================

export type { EntityRow, EventPayload, FetchResult, ServiceParams };

/** Alias for ResolvedPatternProps to avoid breaking internal consumers */
export type PatternProps = ResolvedPatternProps;

/**
 * Value a render-ui pattern prop can carry AFTER interpolation. Mirrors
 * `FieldValue` but extends with `RuntimeRenderPattern` so nested pattern
 * configs (children, slot props that are themselves render-ui nodes)
 * round-trip without an `unknown` escape hatch.
 */
type RuntimePatternValue =
    | string
    | number
    | boolean
    | null
    | undefined
    | EntityRow
    | EntityRow[]
    | readonly RuntimePatternValue[]
    | RuntimeRenderPattern;

/**
 * Shape of a render-ui pattern AFTER interpolation, as the runtime hands
 * it to `EffectHandlers.renderUI`. Different from `ResolvedPatternProps`
 * (`@almadar/core`) because the post-interpolation pattern carries
 * resolved EntityRow values (e.g. `{ entity: <row> }` from `@payload.row`)
 * not just primitives. Used by render-ui observability helpers to narrow
 * safely without `unknown` casts.
 */
interface RuntimeRenderPattern {
    readonly [prop: string]: RuntimePatternValue;
}

/**
 * Configuration context.
 *
 * Re-export of `TraitConfig` from `@almadar/core` for the runtime's binding
 * and state-machine layers. Supports scalar, array, and nested-object values
 * so `config.fields = ["name", "description"]` and similar authoring shapes
 * flow through the binding context without type widening.
 */
import type { BrowserPageFacts, PageFactField, TraitConfig } from '@almadar/core';
type ConfigContext = TraitConfig;

// ============================================================================
// Event Bus Types
// ============================================================================

/**
 * Event structure for cross-trait communication.
 * Re-export of `BusEvent` from `@almadar/core` so runtime + ui + codegen
 * all agree on the bus envelope shape. `RuntimeEvent` is kept as a type
 * alias for anyone importing by the old name.
 */
export type RuntimeEvent = BusEvent;
export type EventListener = BusEventListener;
export type Unsubscribe = CoreUnsubscribe;

/**
 * Event bus interface for pub/sub communication
 */
export interface IEventBus {
    /** Emit an event. `routingKey` (V4) keys delivery by event-id when the
     *  schema carries ids; absent → keyed by `type` (name, legacy). */
    emit(type: string, payload?: EventPayload, source?: BusEventSource, routingKey?: string): void;
    /** Subscribe to an event */
    on(type: string, listener: EventListener): Unsubscribe;
    /** Subscribe to ALL events (wildcard listener) */
    onAny(listener: EventListener): Unsubscribe;
    /** Check if there are listeners for an event */
    hasListeners(type: string): boolean;
    /** Get all registered event types */
    getRegisteredEvents(): string[];
    /** Clear all listeners */
    clear(): void;
}

// ============================================================================
// State Machine Types
// ============================================================================


// ============================================================================
// Effect Handler Types
// ============================================================================

/**
 * Effect handlers interface - platform-specific implementations
 *
 * Client: React hooks, DOM, router
 * Server: Express, database, integrators
 */

/** What one `http` effect came to: the `<METHOD> <origin><path>` it addressed and, on failure, the declared `emit.failure` event the program routed it to. */
interface HttpEffectReport {
    success: boolean;
    target: string;
    error?: string;
    routed?: string;
}

export interface EffectHandlers {
    /**
     * Emit an event to the event bus.
     *
     * `source` carries the emitter's identity (orbital + trait) so that
     * source-scoped listeners (`TraitName EVENT -> TRIGGER` and
     * `Orbital.TraitName EVENT -> TRIGGER` in .lolo) can filter incoming
     * events by their originating trait. Omitted when the emit is
     * synthesized by a non-trait context (e.g. test harness).
     *
     * `fromPersistSuccess` is set only by `EffectExecutor`'s `persist` case
     * (batch and single-op), never inferred from the event name — the
     * positional signal a server-side implementation uses to also fan this
     * emit out to other connected clients (live-broadcast). Absent/false
     * for every other emit source (plain `emit` effect, `set`/`call-service`/
     * `fetch` success envelopes, cascade re-emits).
     */
    emit: (event: string, payload?: EventPayload, source?: RuntimeEvent['source'], fromPersistSuccess?: boolean) => void;

    /**
     * Persist data (create/update/delete/batch).
     *
     * Returns the persisted ROW — for a create that is the submitted data
     * plus the store-minted `id`, which the caller's `emit:{success}`
     * envelope carries. Without it a `*_CREATED` listener sees no id (the
     * compiled path emits the created row), so anything routing on the new
     * row's identity — navigating to the page just created — worked in one
     * execution path only.
     *
     * `create`/`update`/`delete` (batch is separate — see `PersistBatchSummary`)
     * return `undefined` ONLY to signal the write was DENIED or otherwise
     * failed (a policy rejection, a missing row key, a no-op stub) — never
     * a genuine success with nothing to report, since every real success
     * branch sets a row. The caller (`EffectExecutor`'s `persist` case)
     * treats `undefined` as a failure: it skips the declared `success`
     * emit entirely rather than falling back to the submitted data, which
     * previously made a denied delete indistinguishable from a completed
     * one.
     */
    persist: (
        action: 'create' | 'upsert' | 'update' | 'delete' | 'batch',
        entityType: string,
        data?: EntityRow
    ) => Promise<EntityRow | undefined>;

    /**
     * Runs a run of consecutive plain persists as stop-mode requests (one when nothing is refused) when the store declares it. Answers the
     * per-op results in order (`undefined` = that persist failed, a handled outcome, and the ones after it still run).
     * Answers `null` when the run cannot be pushed, and the executor then runs the effects one by one.
     */
    persistRun?: (
        ops: Array<{ action: 'create' | 'upsert' | 'update' | 'delete'; entityType: string; data: EntityRow | string | undefined }>,
    ) => Promise<Array<EntityRow | undefined> | null>;

    /**
     * Bridge mode: the SERVER executes every persist of this dispatch and
     * returns the real outcome in its response (`effectResults`), so the
     * client's `persist` member is a placeholder that must never be read as
     * a denial. When `true`, `EffectExecutor` skips the persist locally —
     * no `persist:denied` error, no client-side `failure` emit (which fired
     * the declared failure event in the browser while the server had
     * succeeded), no `success` emit either (the server's cascade carries it).
     * Set by `@almadar/ui`'s `createClientEffectHandlers` when no live
     * client entity is supplied; absent everywhere a handler really writes.
     */
    persistDelegated?: true;

    /**
     * Bridge mode: the SERVER runs every `call-service` of this dispatch and
     * its cascade carries the success/failure emits, so the client's mock
     * `callService` must not also run one. Set by `@almadar/ui`'s
     * `createClientEffectHandlers` when no consumer `callService` is wired.
     */
    callServiceDelegated?: true;

    /**
     * Set a field value on an entity. `void` for a client-side/in-memory
     * handler (synchronous mutation); `Promise<void>` for a server-side
     * handler backed by real persistence (e.g. `createServerEffectHandlers`,
     * Firestore) — callers MUST `await` this, not just call it, or the
     * write (and any telemetry it records) can still be in flight when the
     * caller moves on. Verified 2026-09-15: `EffectExecutor.dispatch`'s
     * 'set' case called this without `await`, invisible against every
     * existing (synchronous, in-memory) test but a real dropped-write race
     * the instant a real async persistence backend (Firestore) was wired in.
     */
    set: (entityId: string, field: string, value: FieldValue) => void | Promise<void>;

    /** Report the outcome of an `http` effect to the host's effect trace. */
    httpResult?: (report: HttpEffectReport) => void;

    /** Call an external service. `context` carries the caller's identity
     * (the same viewer entity ACL enforces against) so role-gated services
     * can enforce server-side; hosts forward it to the integration factory. */
    callService: CallServiceHandler;

    /** Fetch entity data (server only) - returns data for client-side rendering.
     *
     * Always returns a `FetchResult` (`{rows, total}`) on success. `total`
     * is the count of rows matching the `filter` BEFORE `offset`/`limit`
     * are applied so a paginating caller can compute totalPages without
     * a second round-trip. Single-id fetches return `total: 1`. `null`
     * means "not found / failed".
     */
    fetch?: (
        entityType: string,
        options?: {
            id?: string;
            filter?: SExpr | Record<string, RuntimeValue>;
            limit?: number;
            offset?: number;
            /** `"field"` or `"field:asc|desc"` — ordered before offset/limit */
            orderBy?: string;
            /** `none`: the store need not count every match; the success payload carries no `totalCount`. */
            total?: 'exact' | 'none';
            /** Relation fields to include (populate) in the response */
            include?: string[];
        }
    ) => Promise<FetchResult | null>;

    /** A collection fetch delivered by reference (`fetch … { deliver: ids }`, server only): the window's ids, the
     * count of every match and the query that re-counts it at resolve time. Rejects when the fetch cannot be
     * expressed as a row query, which the executor routes to `emit.failure`. */
    fetchRowSet?: (
        entityType: string,
        options?: {
            filter?: SExpr | Record<string, RuntimeValue>;
            limit?: number;
            offset?: number;
            /** `"field"` or `"field:asc|desc"` — ordered before offset/limit */
            orderBy?: string;
            /** `none`: the store need not count every match; the success payload carries no `totalCount`. */
            total?: 'exact' | 'none';
        }
    ) => Promise<RowSetRef>;

    /** Stream an LLM or HTTP response (server only).
     *
     * Calls `onChunk` per incoming chunk; resolves with the final aggregated
     * result on completion. The executor fires `emit.on_message` per chunk and
     * `emit.success` on resolution. `null` means stream failed before any chunk.
     */
    fetchStream?: (
        entityType: string,
        options: {
            id?: string;
            filter?: SExpr | Record<string, RuntimeValue>;
        } | undefined,
        onChunk: (chunk: RuntimeValue) => void,
    ) => Promise<RuntimeValue>;

    /** Spawn a new entity instance */
    spawn?: (entityType: string, props?: EntityRow) => void;

    /** Despawn (delete) an entity instance */
    despawn?: (entityId: string) => void;

    /** Send an orbital event to the server over WebSocket (client-only).
     *
     * Produces the wire message `{ type: 'ORBITAL_EVENT', payload: { orbital, event, payload, entityId? } }`
     * which `setupEventBroadcast` decodes → server bus → `processOrbitalEvent`.
     */
    sendServer?: (event: string, payload?: EventPayload) => void;

    // Platform-specific handlers (optional)

    /** Render UI to a slot (client only). `pattern` is the post-interpolation
     * `PatternConfig` from the trait's `(render-ui slot pattern)` SExpr, or
     * `null` when the trait clears the slot (`render-ui slot null`).
     * May be async: the server runtime injects relation option data
     * (relationsData) read from the persistence adapter before pushing —
     * the interpreter's mirror of codegen's build-time relationsData. */
    renderUI?: (slot: string, pattern: PatternConfig | null) => void | Promise<void>;

    /** Navigate to a route (client only). `crumb` labels the navigation-stack
     * entry the client pushes for the target page (from the effect's
     * `{ crumb: … }` options). */
    navigate?: (path: string, params?: { [key: string]: string }, crumb?: string) => void;

    /** Pop the orbital-scoped navigation stack and return to the previous
     * entry (client only). */
    navigateBack?: () => void;

    /** Log a message */
    log?: (message: string, level?: 'log' | 'warn' | 'error', data?: RuntimeValue) => void;

    // === Browser device handlers (client-side only) ===
    //
    // User-initiated, async device APIs. The executor wraps each in
    // `runSubstrate`, so a resolved value fires `emit.success` with the
    // uniform `{ result }` payload and a rejection fires `emit.failure`
    // with `{ error }`. Absent on the server (→ unsupported warning).

    /** browser/open-file-picker — resolves with `{ files }` inside `result` */
    browserOpenFilePicker?: (options?: BrowserFilePickerOptions) => Promise<{ files: BrowserFileMeta[] }>;
    /** browser/clipboard-read — resolves with `{ text }` inside `result` */
    browserClipboardRead?: () => Promise<{ text: string }>;
    /** browser/clipboard-write — resolves with `{ text }` (echo) inside `result` */
    browserClipboardWrite?: (text: string) => Promise<{ text: string }>;
    /** browser/geolocation-current — resolves with the position inside `result` */
    browserGeolocationCurrent?: (options?: BrowserGeolocationOptions) => Promise<BrowserGeolocationPosition>;
    /**
     * browser/page-facts — reads the requested facts in the order given and resolves with the flat facts
     * (`PAGE_FACTS_SHAPE`). No page resolves `available: false`; a getter that throws rejects, which is not no-page.
     */
    browserPageFacts?: (fields: readonly PageFactField[]) => Promise<BrowserPageFacts>;
    /**
     * browser/prompt — the on-device model's raw reply text for `text` under the JSON Schema text; rejects with an
     * `OnDeviceModelFailure` (`unconfigured`, `unavailable` or `failed`), and stops on an aborted `signal`.
     */
    browserPrompt?: (text: string, schemaText: string, key: string | null, signal?: AbortSignal) => Promise<string>;
    /** browser/embed — one vector per text, in input order; rejects as `browserPrompt` does. */
    browserEmbed?: (texts: readonly string[], key: string | null, signal?: AbortSignal) => Promise<number[][]>;
    /** browser/push-subscribe — resolves with the flat Web Push subscription credentials inside `result` */
    browserPushSubscribe?: () => Promise<{ endpoint: string; p256dh: string; auth: string }>;

    // === Program host handler (server-side only) ===
    // Backs the language trio's effects (behavior/catalog|describe|source,
    // program/read|print|eval). The program host's
    // `runProgramEffect` (`host/program`) owns argument parsing and the `orb` call; an absent
    // handler makes the effect fail explicitly.
    // The caller is the dispatch's viewer (`principal`/`role`), bound per stage like `callService`'s.
    programEffect?: (op: ProgramEffectName, args: readonly JsonValue[], context?: Pick<ServiceCallContext, 'principal' | 'role'>) => Promise<ProgramEffectOutcome>;

    // === Agent ports (server-side only) ===
    // `program/inputs`, `program/dispatch` and `persist/read-named` run over the host ports lent to this
    // dispatch: the running app as the dispatch's viewer (declared inputs, the input channel, the rows the
    // viewer may read). Bound per stage, like `callService`'s. An absent handler fails the effect explicitly.
    agentPorts?: () => ServiceHostPorts | undefined;
}

// ============================================================================
// Browser Device Handler Types (client host path)
// ============================================================================
//
// Structural device shapes with no equivalent in @almadar/core (file metadata,
// geolocation). Primitives only — no `unknown` — so they flow into the
// uniform `{ result }` emit payload (EventPayload-compatible) without casts.

/** Options for `browser/open-file-picker`. */
interface BrowserFilePickerOptions {
    /** Allow selecting multiple files. */
    multiple?: boolean;
    /** MIME type filter (e.g. "image/*"). Best-effort; host may ignore. */
    accept?: string;
}

/** Metadata for a file chosen via `browser/open-file-picker`. */
interface BrowserFileMeta {
    name: string;
    size: number;
    type: string;
    lastModified: number;
}

/** Options for `browser/geolocation-current` (subset of PositionOptions). */
interface BrowserGeolocationOptions {
    enableHighAccuracy?: boolean;
    timeout?: number;
    maximumAge?: number;
}

/** Position returned by `browser/geolocation-current`. */
interface BrowserGeolocationPosition {
    latitude: number;
    longitude: number;
    accuracy: number;
}

// ============================================================================
// Binding Context Types
// ============================================================================

/**
 * Context for resolving bindings like @entity.field, @payload.value
 */
export interface BindingContext {
    /** Current entity data */
    entity?: EntityRow;
    /** Event payload data */
    payload?: EventPayload;
    /** Current state name */
    state?: string;
    /** Trait-level state/config */
    config?: ConfigContext;
    /** Authenticated viewer behind `@user.x` — ownership (`@user.id`) and role gates. */
    user?: UserContext;
    /** The dispatch's one `now` stamp (ms epoch) — every guard, effect and time operator in it reads this. */
    now?: number;
    /** `@locale`: the viewer's locale (`EventRequest.locale`, else the program's first declared locale). */
    locale?: string;
    /** That locale's catalog — `i18n/t` reads it. */
    messages?: Readonly<Record<string, string>>;
    /** `@event`: the delivery being processed (Runtime Spec Clause 5.5). */
    event?: EventPayload;
    /** `@prevEvents`: deliveries this trait already received this dispatch. */
    prevEvents?: EventPayload[];
    /** `@prevStates`: states this trait left this dispatch. */
    prevStates?: string[];
    /** `@fromState` / `@toState`: the transition's ends. */
    fromState?: string;
    toState?: string;
    /**
     * The host orbital's pages for the `@pages` render sigil (`href`/`label`
     * per inline page). Seeded onto the render binding context only — never
     * present on a guard/tick context. Mirrors the compiler's
     * `OirBindingRoot::Pages`.
     */
    pages?: NavItem[];
    /**
     * The `data-theme` key string for the `@currentTheme` render sigil,
     * derived from the host orbital's `Orbital.theme`. Render-context only.
     */
    currentTheme?: string;
    /**
     * Local variables introduced by a `let` form, keyed by bare name and
     * referenced via `@<name>` (the canonical evaluator convention — same as
     * `createChildContext` in `@almadar/evaluator`). Carried on the context so
     * a `let` body's effects resolve their value expressions against the
     * `let`-bound locals.
     */
    locals?: Map<string, RuntimeValue>;
    /**
     * The composing effect's triggering payload, for a trait embedded via
     * `@trait.X` inline into a parent's render-ui. Set when re-running an
     * embedded child's lifecycle transition under its embedder's payload
     * (see `OrbitalServerRuntime.executeEffects` / the client's
     * `useTraitStateMachine`), so `@callsitePayload.<field>` resolves on the
     * child's evaluation context — mirrors the compiled path's
     * `CALLSITE_PAYLOAD_PREFIX` capture.
     */
    callsitePayload?: EventPayload;
    /** Additional custom bindings */
    [key: string]: RuntimeValue | undefined;
}

// ============================================================================
// Effect Types
// ============================================================================

/**
 * Executable effect tuple: operator name plus already-resolved arguments.
 *
 * Runtime-local on purpose — NOT `@almadar/core`'s `Effect` (`TypedEffect`),
 * which is a CLOSED union of authoring-time tuples. The runtime's operator
 * set is extensible (custom handlers, `os/*`, substrate ops), so the executor
 * input is this open tuple. The wire-level type for effect lists stays
 * `SExpr[]` (`TransitionResult.effects`, `TraitDefinition.transitions[].effects`);
 * narrow it to `Effect[]` at the executor boundary with {@link isEffectTuple}.
 */
export type Effect = [string, ...RuntimeValue[]];

// ============================================================================
// Effect Result Types (RCG-04)
// ============================================================================

/**
 * Result of executing a single effect, with status tracking.
 */
export interface EffectResult {
    /** Effect operator (e.g., "persist", "render-ui") */
    type: string;
    /** Effect arguments */
    args: RuntimeValue[];
    /** Whether the effect executed successfully */
    status: "executed" | "failed" | "skipped";
    /** Error message if failed */
    error?: string;
    /** Execution duration in milliseconds */
    durationMs?: number;
    /** Refused before the effect's handler ran (e.g. a `persist create` missing a
     *  required field), so no handler recorded it — the host reports it. */
    refusedBeforeHandler?: boolean;
}

// ============================================================================
// Runtime Configuration (RCG-01, RCG-02, RCG-05)
// ============================================================================

/**
 * Typed extensions that get spread onto every EvaluationContext.
 * Each field here corresponds to an optional field on EvaluationContext.
 */
export interface EvaluationContextExtensions {
    /** Agent context for agent/* operators (memory, LLM, tools, session) */
    agent?: AgentContext;
    /** Substrate contexts for the new operator namespaces */
    llm?: LlmContext;
    workspace?: WorkspaceContext;
    session?: SessionContext;
    memory?: MemoryContext;
    trace?: TraceContext;
}

// ============================================================================
// Transition Observer Types (Verification Registry Wiring)
// ============================================================================


