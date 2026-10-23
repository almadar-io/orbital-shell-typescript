import { OrbitalSchema, OrbitalEventRequest, OrbitalEventResponse, RowSetRef, RowQueryPage, EmittedEvent, ServerTopology } from '@almadar/core';

/**
 * EventTransport — the client → orbital event transport port (plan P5,
 * `docs/Almadar_Runtime_Stateless_Stateful_PLAN.md` §4.2).
 *
 * Promotes `@almadar/ui`'s `ServerBridgeTransport` interface +
 * `createHttpTransport` into `@almadar/runtime` so there is ONE owner of
 * the HTTP request/response leg instead of two (this package's own
 * `ServerBridge` class and the ui provider). `@almadar/ui`'s provider will
 * be switched onto this port at the W5b build checkpoint (see the plan);
 * until then this file has no consumers outside this package.
 *
 * The wire shapes are `@almadar/core`'s existing `OrbitalEventRequest` /
 * `OrbitalEventResponse` — no shadow types.
 *
 * @packageDocumentation
 */

/**
 * `true` = stateless topology: the server holds no circuit state between
 * requests, so every `send()` request must carry `traits`/`entityByTrait`.
 * `false` = the server (or an in-process evaluator) holds the state itself.
 *
 * Derivation mirrors `@almadar/ui`'s `ServerBridgeProvider` EXACTLY
 * (`providers/ServerBridge.tsx`, both the initial-state fallback and the
 * post-register `.then` callback — the same mapping was duplicated at two
 * call sites there, which is the `stateSource` string-branching this port
 * retires): `'stateful'` → false, `'stateless'` OR an absent/undeclared
 * topology (older servers) → true. An absent topology defaulting to
 * "stateless" is the ui's existing assumption, carried over unchanged, not
 * a new judgment call made here.
 */
declare function deriveCarriesCircuitState(topology: ServerTopology | undefined): boolean;
interface EventTransportRegisterResult {
    success: boolean;
    /** See `deriveCarriesCircuitState`. Computed once here, not re-derived by callers. */
    carriesCircuitState: boolean;
}
/**
 * Who a server push was addressed to: `peers` — another client's change
 * (live push); `origin` — this client's own running request, live (a
 * call-service's `emit.onMessage`).
 */
type PushTarget = 'peers' | 'origin';
interface EventTransport {
    /** Register a schema with the transport's target (server, or an in-process evaluator). */
    register(schema: OrbitalSchema): Promise<EventTransportRegisterResult>;
    unregister(): Promise<void>;
    /** Play one event through the orbital named `orbitalName`. */
    send(orbitalName: string, request: OrbitalEventRequest): Promise<OrbitalEventResponse>;
    /**
     * A row-set reference resolved by the host that holds the rows, for the viewer the transport is signed in as (the
     * host applies `@read`): the rows that still match, in the reference's order. Absent when the transport has no
     * such route (an in-process evaluator resolves against its own store).
     */
    resolveRows?(reference: RowSetRef): Promise<RowQueryPage>;
    /**
     * Subscribe to server-pushed cascade events (e.g. another client's
     * persist-envelope emits, Almadar_Live_Push.md). Absent when the
     * transport has no server to push from (in-process). `params` augments
     * the push channel's query string (e.g. a caller-supplied per-tab
     * `clientId` for the server's origin-exclusion) — the transport itself
     * carries no notion of "tab identity", that is a client-role concern
     * (plan P4).
     */
    subscribe?(onPush: (emitted: EmittedEvent, target: PushTarget) => void, params?: Record<string, string>): () => void;
    /**
     * The host runs the whole program, browser-stored entities included (an extension's worker): a
     * view of it keeps no browser store of its own and sends every leg to the host.
     */
    readonly hostsBrowserStore?: boolean;
    /**
     * Hear the results of dispatches the host ran without any view asking (a declared input, a
     * follow-on call's outcome), so an open view shows them. The view applies the result; it never
     * runs the dispatch again. `params` addresses this view on a push channel, as for `subscribe`.
     */
    subscribeHostDispatches?(onDispatch: HostDispatchListener, params?: Record<string, string>): () => void;
}
/** A dispatch the host ran on its own, with its result. */
type HostDispatchListener = (orbitalName: string, request: OrbitalEventRequest, response: OrbitalEventResponse) => void;
/**
 * Supplies the bearer token the hosting server authenticates with. Resolved
 * per request (tokens expire); `undefined` sends the request unauthenticated
 * (dev servers with an auth bypass, standalone playground). Moved verbatim
 * from `@almadar/ui`'s `providers/ServerBridge.tsx`.
 */
type AccessTokenProvider = () => Promise<string | undefined>;
interface HttpTransportOptions {
    serverUrl: string;
    getAccessToken?: AccessTokenProvider;
    /** Custom fetch function (for testing or custom auth). */
    fetch?: typeof fetch;
    /**
     * Gzip JSON request bodies of at least `COMPRESSED_BODY_MIN_BYTES` (`Content-Encoding: gzip`).
     * Browsers never compress request bodies, so a registered schema otherwise goes up raw. Only
     * for servers that inflate request bodies (Express's JSON parser does).
     */
    compressRequests?: boolean;
}
/** Bodies below this stay plain: compressing them costs more than it saves. */
declare const COMPRESSED_BODY_MIN_BYTES: number;
/** A JSON request body, gzipped (`encoding: 'gzip'`) when `compress` is set and it is large enough to be worth it. */
declare function encodeJsonBody(value: object, compress: boolean): Promise<{
    body: string | Uint8Array<ArrayBuffer>;
    encoding?: 'gzip';
}>;
/** HTTP transport — POSTs to a server speaking the canonical playground-runtime contract. */
declare function createHttpTransport(options: HttpTransportOptions): EventTransport;
/** Evaluates one event against an orbital with no wire in between — the unified `evaluateOrbitalEvent` (a separate, in-progress unit) is a valid `OrbitalEvaluator`. */
type OrbitalEvaluator = (orbitalName: string, request: OrbitalEventRequest) => Promise<OrbitalEventResponse>;
interface InProcessTransportOptions {
    onRegister?: (schema: OrbitalSchema) => Promise<void> | void;
    onUnregister?: () => Promise<void> | void;
    /**
     * In-process evaluation never crosses a wire, so nothing about circuit
     * state is "carried" in the stateless-topology sense — `false` by
     * default, mirroring `@almadar/ui`'s `BrowserPlayground` today: its
     * in-process `register` never declares a `topology`, and the provider's
     * fallback for a custom transport is `'in-process'` (not
     * `'stateless-http'`).
     */
    carriesCircuitState?: boolean;
    /** Resolves a row-set reference on the in-process kernel (`KernelEngine.resolveRows`), `@read` applied there. */
    resolveRows?: (reference: RowSetRef) => Promise<RowQueryPage>;
}
/** In-process transport — the evaluator is INJECTED (e.g. the unified `evaluateOrbitalEvent`, owned elsewhere). */
declare function createInProcessTransport(evaluate: OrbitalEvaluator, options?: InProcessTransportOptions): EventTransport;

export { type AccessTokenProvider, COMPRESSED_BODY_MIN_BYTES, type EventTransport, type EventTransportRegisterResult, type HostDispatchListener, type HttpTransportOptions, type InProcessTransportOptions, type OrbitalEvaluator, type PushTarget, createHttpTransport, createInProcessTransport, deriveCarriesCircuitState, encodeJsonBody };
