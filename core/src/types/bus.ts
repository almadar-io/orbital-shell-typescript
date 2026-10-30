/**
 * Bus Event Types (framework concept)
 *
 * Canonical event shape for Almadar's cross-package event bus. Hoisted into
 * `@almadar/core` so `@almadar/ui`, `@almadar/runtime`, and generated code
 * all agree on the same structure. Replaces the previously divergent
 * `KFlowEvent` (ui) and `RuntimeEvent` (runtime) definitions.
 *
 * @packageDocumentation
 */

import { z } from "zod";
import { EventPayloadSchema, SExprDataSchema, type EventPayload, type SExpr } from "./expression.js";
import { OrbitalIdSchema, TraitIdSchema, EventIdSchema, type OrbitalId, type TraitId, type EventId } from "./identity.js";
import { RowSetRefSchema, type RowSetRef } from "./row-set.js";
import { EntityRowSchema, type EntityRow } from "./entity.js";
import { RawUserClaimsSchema, type RawUserClaims, type UserContext } from "./user.js";
import type { RowQueryPage } from "../service-types.js";
import { ServerEffectResultSchema, type ServerEffectResult } from "./effect-result.js";
import type { ExternalInput } from "../access/contract.js";
import { JsonValueSchema, type JsonObject, type JsonValue } from "./json.js";
import { isEventResponse, type ClientEffectByTrait, type EventRequest, type EventResponse, type FrameDelta, type HopEffect, type HopEffectStatus, type TransitionHop, type TransitionRejection, type TransitionRejectionCode } from "../generated/kernel-wire.js";

export type { ClientEffectByTrait, HopEffect, HopEffectStatus, TransitionHop, TransitionRejection, TransitionRejectionCode };

/**
 * Declared event key. A trait's event names (INIT, SAVE, CLOSE,
 * CONFIRM_REMOVE, ...) flow through the orbital schema and the UI as
 * strings; this alias marks "this string is a declared event key, not
 * arbitrary text."
 *
 * Component props typed as `EventKey` are detected by the pattern-sync
 * tool (`tools/almadar-pattern-sync/parser.ts`) via a TS-type lookup and
 * marked as `kind: "event"` in the patterns registry
 * (`@almadar/patterns`). Consumers of the registry — the Rust compiler's
 * inline phase and the `@almadar/runtime` preprocess — read that marker
 * to apply call-site `events: { OLD: NEW }` renames to render-ui trees
 * without name-matching heuristics.
 *
 * Plain alias over `string`. Not branded because event keys originate
 * from user data at runtime (orb schema literals, bus emits), so cast
 * friction would buy nothing. The value of the alias is at the type
 * surface — it's a marker the pattern-sync tool can find via
 * `getSymbolAtLocation`.
 */
export type EventKey = string;

/**
 * Phantom-typed brand for declarative bus-emit props on UI components.
 *
 * Used by component authors to BOTH mark a prop as a bus-event reference
 * AND document the payload shape that the component will fire onto the
 * bus when that prop is bound. Authors write:
 *
 *     // Tabs.tsx
 *     export interface TabsProps {
 *       tabChangeEvent?: EventEmit<{ tabId: string }>;
 *     }
 *
 * Consumers see only the structural `string` (no UX impact: passing a
 * literal `"TAB_CHANGED"` keeps working). The phantom `P` parameter
 * carries the bus-payload schema at the type level for pattern-sync to
 * extract.
 *
 * Pattern-sync (`tools/almadar-pattern-sync/parser.ts`) detects this
 * brand via TS type-lookup (mirrors how it detects `EventKey`) and
 * writes two registry fields per prop:
 * - `kind: "event-ref"` — the discriminant rules read in lolo / orb
 *   validator to know "this prop's string value is a bus event name."
 * - `emitPayloadSchema` — the structural shape of `P`, serialized as
 *   the same JSON-Schema-shaped record Almadar uses for trait
 *   `payloadSchema`. Validator rules cross-check this against the
 *   trait's declared `emits { EVENT { ... } }` payload to catch mismatches
 *   at parse / validate time instead of runtime.
 *
 * Example payload bus emission inside the component (no wrapper —
 * `EventEmit<P>` erases to `string`):
 *
 *     if (tabChangeEvent) eventBus.emit(`UI:${tabChangeEvent}`, { tabId });
 *
 * The brand is structurally an unused optional readonly property; TS
 * never asks for it at construction, so authors and consumers never
 * see it.
 */
export type EventEmit<P> = string & { readonly __emitPayload?: P };

/**
 * Phantom-typed brand for declarative bus-listen props on UI components.
 *
 * Mirror of `EventEmit<P>`. Used by future patterns where a UI component
 * subscribes to a bus event and forwards its payload upward via prop
 * (e.g. an editor pattern that listens for `EXTERNAL_RESET` and exposes
 * the consumed payload to the parent). Pattern-sync detects this brand
 * the same way as `EventEmit<P>` and writes:
 * - `kind: "event-listen"` (or a sub-discriminant of `event-ref`)
 * - `listenPayloadSchema` with the structural shape of `P`
 *
 * Validator rules use this to verify the trait the prop is bound to
 * actually emits a payload of the expected shape.
 *
 * Reserved for symmetry; no @almadar/ui component uses it as of this
 * commit. Add usages incrementally as patterns require them.
 */
export type EventListen<P> = string & { readonly __listenPayload?: P };

// NOTE: The phantom entity-inlet brands `EntityInlet`/`EntityRecord`/
// `EntityCollection` were removed in the entity-row clean slate. There is now
// ONE entity type — `EntityRow` (`./entity`), used directly: a single record is
// `EntityRow`, a collection is `readonly EntityRow[]`. pattern-sync detects an
// entity prop by the `EntityRow` type identity and derives record-vs-collection
// from array-vs-not, so no brand is needed.

/**
 * Identifies the origin of a bus event. Used by cross-trait listeners to
 * filter emits from specific orbitals, traits, transitions, or ticks.
 *
 * `transition` and `tick` are optional runtime-internal details; most
 * consumers only care about `orbital` and `trait`.
 */
export type BusEventSource = {
  orbital?: string;
  /** V4 dual-carry id sibling of `orbital` — stable across an orbital rename. */
  orbitalId?: OrbitalId;
  trait?: string;
  /** V4 dual-carry id sibling of `trait` — stable across a trait rename. */
  traitId?: TraitId;
  /** V4 dual-carry id of the emitted event — stable across an event rename. */
  eventId?: EventId;
  transition?: string;
  tick?: string;
  /**
   * True when the orbital bridge re-broadcasts an event onto the bus
   * (any source — both echoes of the dispatched event and server-side
   * cascade emits via `(emit X)` / `fetch.emit.success`). Cross-trait
   * listeners filter on this flag so the click-time qualified emit
   * (which has no `fromBridge`) doesn't double-fire alongside the
   * post-server bridge confirmation. See `dispatched` for the narrower
   * "echo of the just-dispatched event" signal.
   */
  fromBridge?: boolean;
  /**
   * True ONLY for bridge echoes the receiving tab already processed, so
   * the originating trait's self-subscription skips them instead of
   * re-dispatching its own echo (infinite loop / double execution).
   * Set by path 1 of useOrbitalBridge (compiled shell — echo of the
   * just-dispatched event; server-side cascade emits there carry
   * `fromBridge: true` but NOT `dispatched`, so they still reach the
   * source trait's transition handler, e.g. `loading -> browsing` on a
   * fetch's `emit.success`) and by ServerBridge (runtime path — stamped
   * on exactly one response-cascade echo per event the dispatch delivered
   * locally on the bare key, `stampLocallyDeliveredEchoes`; server-only
   * results stay unstamped). Cross-trait `listens` never filter on this
   * flag, so their delivery is unaffected. Push-leg events from OTHER
   * tabs (multiplayer) are never stamped.
   */
  dispatched?: boolean;
  /**
   * The client that originated the dispatch whose effects emitted this
   * event (from `EventRequest.clientId`); absent for headless
   * dispatches (ticks, circuit-router probes, walkers). The server-side
   * listens fan-out skips client-originated cascade emits — under dual
   * execution the originating client relays every cascade hop through the
   * bridge itself, so the server dispatching the same hop double-ran it
   * (one Send persisted two rows). Headless topology keeps the fan-out:
   * there is no client to drive the circuit.
   */
  originClientId?: string;
  /**
   * Per-activation key a UI control stamps on the event it emits, so it can
   * show its own busy state for exactly as long as the dispatches that event
   * started are in flight (`@almadar/ui` lib/pendingDispatch). Never set by
   * the bridge or the server.
   */
  pendingKey?: string;
  /**
   * Set by a server-role kernel on a `persist` effect's `emit.success` envelope: the one emit a live-push
   * host (`setLiveBroadcastSink`) also fans out to every other connected client.
   */
  persistSuccess?: boolean;
  /**
   * The row of the emitting trait's entity that made the emit, when the trait's rows are addressed by a `per`
   * listener. A listener with a `per` clause evaluates its own key; one without ignores this.
   */
  instanceKey?: string;
};

// The third type param is `object` on schemas nesting a branded-id
// `.refine(<type predicate>)` field: the refine's parsed INPUT is a plain
// `string`, not the branded output type, so the input/output-equal default
// `z.ZodType<T>` mis-typechecks. `object` is what the wire actually carries
// (a JSON body) — never `unknown`.

/** The delivery a transition is processing: `@event`, and one element of `@prevEvents` (Runtime Spec Clause 5.5). */
export type DeliveryRecord = {
  event: string;
  payload?: EventPayload;
  source: BusEventSource;
};

/** A trait's log so far in a dispatch that began elsewhere (`@prevEvents` / `@prevStates`), carried on the request. */
export type DispatchLog = {
  prevEvents: DeliveryRecord[];
  prevStates: string[];
};

/** Zod twin of `BusEventSource`. */
export const BusEventSourceSchema: z.ZodType<BusEventSource, object> = z.object({
  orbital: z.string().optional(),
  orbitalId: OrbitalIdSchema.optional(),
  trait: z.string().optional(),
  traitId: TraitIdSchema.optional(),
  eventId: EventIdSchema.optional(),
  transition: z.string().optional(),
  tick: z.string().optional(),
  fromBridge: z.boolean().optional(),
  dispatched: z.boolean().optional(),
  originClientId: z.string().optional(),
  pendingKey: z.string().optional(),
  persistSuccess: z.boolean().optional(),
  instanceKey: z.string().optional(),
});

/** Zod twin of `DeliveryRecord`. */
export const DeliveryRecordSchema: z.ZodType<DeliveryRecord, object> = z.object({
  event: z.string(),
  payload: EventPayloadSchema.optional(),
  source: BusEventSourceSchema,
});

/** Zod twin of `DispatchLog`. */
export const DispatchLogSchema: z.ZodType<DispatchLog, object> = z.object({
  prevEvents: z.array(DeliveryRecordSchema),
  prevStates: z.array(z.string()),
});

/**
 * An event flowing on the bus.
 *
 * The `source` field is structured so cross-trait listeners can match
 * `event.source?.orbital === 'X' && event.source?.trait === 'Y'` without
 * parsing a delimiter.
 */
export type BusEvent = {
  /** Event type identifier (e.g., 'CartItemLoaded', 'TASK_COMPLETED') */
  type: EventKey;
  /** Optional structured payload */
  payload?: EventPayload;
  /** Timestamp when the event was emitted */
  timestamp: number;
  /** Optional origin info for filtering */
  source?: BusEventSource;
};

/** Bus event listener callback. */
export type BusEventListener = (event: BusEvent) => void;

/** Returned by `on()` / `once()` to detach a listener. */
export type Unsubscribe = () => void;

/**
 * One event a transition's effects emitted, carried back to the client to
 * re-dispatch (in order) so the state machine advances through the
 * cascade without server-side recursion. Named/shaped to match the
 * generated compiled-path `EmittedEvent` (orbital-shell-typescript's
 * `shared/types.ts`) so the two execution paths agree on one shape.
 */
export type EmittedEvent = {
  event: string;
  payload?: EventPayload;
  source?: BusEventSource;
};

/** Zod twin of `EmittedEvent`. Third type param `object`, see `BusEventSourceSchema`. */
export const EmittedEventSchema: z.ZodType<EmittedEvent, object> = z.object({
  event: z.string(),
  payload: EventPayloadSchema.optional(),
  source: BusEventSourceSchema.optional(),
});

// ============================================================================
// Client-effect wire grammar
// ============================================================================

/**
 * Client-side effect tuple shipped in `EventResponse.clientEffectsByTrait`.
 * Restricted to the effect kinds the client knows how to apply to the
 * UI: render-ui (slot mutation, including the `toast` slot that carries
 * what used to be the separate notify effect) and navigate (route change).
 * Server-only effects (persist, set, fetch, ...) execute on the server and
 * surface their results via `effectResults` and `emittedEvents`, not here.
 *
 * Shape note: `render-ui` takes a slot and a pattern (G-CROSS-257); `navigate`'s
 * optional argument may surface as `null` rather than absent (an empty slot is `null` on the wire: `JSON.stringify` and the Rust serializer both write it). The local union spells those
 * variants out explicitly so consumers (ServerBridge.tsx parser, debugger
 * inspector) get accurate completions instead of `unknown[]`.
 *
 * `slot` is a plain `string` in this wire shape (not `UISlot`'s literal
 * union) because the runtime forwards the raw string from the trait's
 * `(render-ui slot ...)` SExpr without re-validating against the registry —
 * registry validation lives in `orbital validate` / `lolo` parse, not here.
 */
export type ClientRenderUITuple = ['render-ui', string, JsonObject | null];

export type ClientNavigateTuple =
  | ['navigate', string]
  | ['navigate', string, Record<string, string> | null]
  | ['navigate', string, Record<string, string> | null, { crumb?: string }];

export type ClientNavigateBackTuple = ['navigate-back'];

/** A `runsOn: client` host-port effect (`auth/sign-out`, `audio/*`) the client host answers; its arguments are resolved. */
export type ClientHostAskTuple = ['host-ask', string, JsonValue[]] | ['host-ask', string, JsonValue[], HostAskCompletion];

/**
 * The return address of a `host-ask` that declared `emit` routes (EXEC-DIST-13): the host answers once by dispatching
 * the event of the outcome it reached to `trait` (on `entity` when the frame is a row); an absent route fires nothing.
 */
export type HostAskCompletion = {
  trait: string;
  entity?: string;
  key?: string;
  success?: string;
  failure?: string;
};

export type ClientEffectTuple =
  | ClientRenderUITuple
  | ClientNavigateTuple
  | ClientNavigateBackTuple
  | ClientHostAskTuple;

/** Zod twin of `ClientRenderUITuple`. */
export const ClientRenderUITupleSchema = z.tuple([z.literal('render-ui'), z.string(), z.record(z.string(), JsonValueSchema).nullable()]);

/** Zod twin of `ClientNavigateTuple` — one variant per fixed arity (2/3/4), unioned. */
export const ClientNavigateTupleSchema = z.union([
  z.tuple([z.literal('navigate'), z.string()]),
  z.tuple([z.literal('navigate'), z.string(), z.record(z.string(), z.string()).nullable()]),
  z.tuple([
    z.literal('navigate'),
    z.string(),
    z.record(z.string(), z.string()).nullable(),
    z.object({ crumb: z.string().optional() }),
  ]),
]);

/** Zod twin of `ClientNavigateBackTuple`. */
export const ClientNavigateBackTupleSchema = z.tuple([z.literal('navigate-back')]);

/** Zod twin of `ClientHostAskTuple`. */
export const HostAskCompletionSchema = z.object({
  trait: z.string(),
  entity: z.string().optional(),
  key: z.string().optional(),
  success: z.string().optional(),
  failure: z.string().optional(),
}).strict();

export const ClientHostAskTupleSchema = z.union([
  z.tuple([z.literal('host-ask'), z.string(), z.array(JsonValueSchema)]),
  z.tuple([z.literal('host-ask'), z.string(), z.array(JsonValueSchema), HostAskCompletionSchema]),
]);

/** Zod twin of `ClientEffectTuple`. */
export const ClientEffectTupleSchema: z.ZodType<ClientEffectTuple> = z.union([
  ClientRenderUITupleSchema,
  ClientNavigateTupleSchema,
  ClientNavigateBackTupleSchema,
  ClientHostAskTupleSchema,
]);

// ============================================================================
// Event dispatch wire (single owner — canonical = the TS runtime)
// ============================================================================

/** The lifecycle events a trait runs when it enters a page (the first it handles). */
export const LIFECYCLE_EVENTS = ["INIT", "LOAD", "$MOUNT"] as const;

/** Wire-only event a client sends when a trait leaves the page; the server stops counting it as mounted. */
export const UNMOUNT_EVENT = '$UNMOUNT';

/** An event key without its `UI:` bus prefix. */
export function normalizeEventKey(eventKey: string): string {
  if (!eventKey) return '';
  return eventKey.startsWith('UI:') ? eventKey.slice(3) : eventKey;
}

/** The event a tick firing carries on the wire (`EventRequest.event` of a `runTick` leg). */
export function tickEventKey(tickName: string): string {
  return `$TICK_${tickName}`;
}
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

/** One trait of a mount batch and the lifecycle event it runs. */
export type MountSeed = {
  trait: string;
  event: LifecycleEvent;
};

export const MountSeedSchema = z.object({ trait: z.string(), event: z.enum(LIFECYCLE_EVENTS) });

/**
 * A request on the outside-client input channel (`POST /:orbital/inputs`): an
 * API caller, an agent acting as the user, an MCP client. Only an event the
 * target trait declares as an external input (`listens { EVENT -> external { … } }`)
 * is dispatched; anything else is refused with `not-an-external-input`.
 */
export type ExternalInputRequest = {
  targetTrait: string;
  event: string;
  payload?: EventPayload;
  user?: RawUserClaims;
  entityId?: string;
};

export type EventStreamItem =
  | { type: 'event'; data: EmittedEvent; timestamp: number }
  | { type: 'effect'; data: ClientEffectTuple; timestamp: number }
  | { type: 'complete'; data: EventResponse; timestamp: number }
  | { type: 'error'; data: { message: string }; timestamp: number };

export const EventStreamItemSchema = z.union([
  z.object({ type: z.literal('event'), data: EmittedEventSchema, timestamp: z.number() }),
  z.object({ type: z.literal('effect'), data: ClientEffectTupleSchema, timestamp: z.number() }),
  z.object({ type: z.literal('complete'), data: z.custom<EventResponse>((v) => JsonValueSchema.safeParse(v).success && isEventResponse(JsonValueSchema.parse(v))), timestamp: z.number() }),
  z.object({ type: z.literal('error'), data: z.object({ message: z.string() }), timestamp: z.number() }),
]);

/** How a host answered a `program/dispatch` event request: the response, or the route's failure code and status. */
export type DispatchRequestOutcome =
  | { ok: true; response: EventResponse; streamItems?: EventStreamItem[] }
  | { ok: false; error: string; code: string; status: number };

/**
 * What a host lends one service call so the service can act in the running app
 * AS THE CALLER (an agent operating the app for the signed-in user): the
 * declared inputs, the outside-client input channel, and a read that applies the
 * entity's `@read` policy. Built per call, bound to the caller's identity and
 * position; every dispatch is a full, ordinary dispatch (guards, policies,
 * listens). The interpreter and the compiled server each supply one.
 */
export interface ServiceHostPorts {
  /** The orbital and trait whose `call-service` is running. */
  caller: { orbital: string; trait: string };
  inputs(): ExternalInput[];
  /** The entities `read` serves: every persisted entity of the program (`readableEntitiesOf`). */
  readableEntities(): string[];
  dispatchInput(orbital: string, request: Omit<ExternalInputRequest, 'user'>): Promise<EventResponse>;
  read(entity: string): Promise<EntityRow[]>;
  /**
   * A `program/dispatch` event request (owner, 2026-10-21): dispatch `request` on `orbital` as the HTTP events
   * route does (`input: true` admits only a declared external input, as the inputs route). `request` is what the kernel
   * parsed (`EventRequest::from_dispatch`); its `user` is the dispatch's viewer when the call names one.
   * A host that does not serve event requests leaves it out.
   */
  supportsDispatchStream?: true;
  dispatchRequest?(orbital: string, request: EventRequest, input: boolean, stream?: boolean): Promise<DispatchRequestOutcome>;
  /** A `program/dispatch { inbound }` delivery through the inbound route, credential check and answer path. */
  deliverInbound?(name: string, delivery: { headers: Readonly<Record<string, string>>; rawBody: string }): Promise<{ status: number; body: string }>;
  /** The host's last `steps` traced dispatch steps, oldest first; a host that keeps no trace leaves it out. */
  trace?(steps: number): JsonValue[];
  /** A `program/resolve-rows` ask: `reference` resolved for the viewer the call names (`null` is anonymous), `@read` applied by the kernel's one resolver. */
  resolveRows?(reference: RowSetRef, viewer: UserContext | null): Promise<RowQueryPage>;
  /**
   * Deliver one message of the running call to the caller's tab, live, as the
   * call site's `emit.onMessage` event source-stamped to the caller. A no-op
   * when the call site declares no `onMessage`.
   */
  message(payload: EventPayload): void;
}

// ============================================================================
// Register wire (client → server schema registration)
// ============================================================================

/**
 * Where circuit state lives between events (`docs/Almadar_Runtime_Stateless_Stateful_PLAN.md` §1a):
 * `'stateless'` = the client carries it on every request, `'stateful'` = the server holds it.
 */
export type ServerTopology = 'stateless' | 'stateful';

export const ServerTopologySchema = z.enum(['stateless', 'stateful']);

/** `POST /register` response. `topology` absent = a server that predates the declaration. */
export interface OrbitalRegisterResponse {
  success: boolean;
  topology?: ServerTopology;
  message?: string;
  orbitals?: string[];
  error?: string;
}

export const OrbitalRegisterResponseSchema: z.ZodType<OrbitalRegisterResponse, object> = z.object({
  success: z.boolean(),
  topology: ServerTopologySchema.optional(),
  message: z.string().optional(),
  orbitals: z.array(z.string()).optional(),
  error: z.string().optional(),
});

// ============================================================================
// Live broadcast wire (server → other connected clients)
// ============================================================================

/**
 * One persist-envelope success emit, handed to the live-broadcast sink
 * (`OrbitalServerRuntime.setLiveBroadcastSink`) and relayed to every OTHER
 * connected client. Fired only from the `persist` effect's `emit:{success}`
 * envelope (batch and single-op) — never from the generic emit funnel — so
 * transport layers can fan it out without matching on event names. Promoted
 * from `@almadar/runtime`'s own `LiveBroadcastItem` (canonical per Program
 * A's "converge on the TS runtime" ruling) so `orbital-server`'s `GET
 * /api/events` broadcast mirrors the same shape.
 */
export interface LiveBroadcastItem {
  event: string;
  payload?: EventPayload;
  source: BusEventSource;
  /** `clientId` of the request that produced this emit; excluded from delivery by the transport. */
  originClientId?: string;
}

/** Zod twin of `LiveBroadcastItem`. Third type param `object`, see `BusEventSourceSchema`. */
export const LiveBroadcastItemSchema: z.ZodType<LiveBroadcastItem, object> = z.object({
  event: z.string(),
  payload: EventPayloadSchema.optional(),
  source: BusEventSourceSchema,
  originClientId: z.string().optional(),
});
