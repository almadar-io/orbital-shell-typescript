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
import { PatternConfigSchema, type PatternConfig } from "./effect.js";
import { RawUserClaimsSchema, type RawUserClaims } from "./user.js";
import { ServerEffectResultSchema, type ServerEffectResult } from "./effect-result.js";
import type { ExternalInput } from "../access/externalInputs.js";
import type { JsonValue } from "./json.js";
import type { HopObservation, RepaintReason } from "../generated/kernel-wire.js";

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
export interface BusEventSource {
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
   * event (from `OrbitalEventRequest.clientId`); absent for headless
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
}

// The third type param is `object` on schemas nesting a branded-id
// `.refine(<type predicate>)` field: the refine's parsed INPUT is a plain
// `string`, not the branded output type, so the input/output-equal default
// `z.ZodType<T>` mis-typechecks. `object` is what the wire actually carries
// (a JSON body) — never `unknown`.

/** The delivery a transition is processing: `@event`, and one element of `@prevEvents` (Runtime Spec Clause 5.5). */
export interface DeliveryRecord {
  event: string;
  payload?: EventPayload;
  source: BusEventSource;
}

/** A trait's log so far in a dispatch that began elsewhere (`@prevEvents` / `@prevStates`), carried on the request. */
export interface DispatchLog {
  prevEvents: DeliveryRecord[];
  prevStates: string[];
}

/** The evaluator value of a delivery record: `source` carries exactly the ten `BusEventSource` fields that are set. */
export function deliveryRecordValue(record: DeliveryRecord): EventPayload {
  const s = record.source;
  const source: EventPayload = {
    ...(s.orbital !== undefined ? { orbital: s.orbital } : {}),
    ...(s.orbitalId !== undefined ? { orbitalId: s.orbitalId } : {}),
    ...(s.trait !== undefined ? { trait: s.trait } : {}),
    ...(s.traitId !== undefined ? { traitId: s.traitId } : {}),
    ...(s.eventId !== undefined ? { eventId: s.eventId } : {}),
    ...(s.transition !== undefined ? { transition: s.transition } : {}),
    ...(s.tick !== undefined ? { tick: s.tick } : {}),
    ...(s.fromBridge !== undefined ? { fromBridge: s.fromBridge } : {}),
    ...(s.dispatched !== undefined ? { dispatched: s.dispatched } : {}),
    ...(s.originClientId !== undefined ? { originClientId: s.originClientId } : {}),
  };
  return { event: record.event, payload: record.payload ?? null, source };
}

/** Zod twin of `BusEventSource`. */
export const BusEventSourceSchema: z.ZodType<BusEventSource, z.ZodTypeDef, object> = z.object({
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
});

/** Zod twin of `DeliveryRecord`. */
export const DeliveryRecordSchema: z.ZodType<DeliveryRecord, z.ZodTypeDef, object> = z.object({
  event: z.string(),
  payload: EventPayloadSchema.optional(),
  source: BusEventSourceSchema,
});

/** Zod twin of `DispatchLog`. */
export const DispatchLogSchema: z.ZodType<DispatchLog, z.ZodTypeDef, object> = z.object({
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
export interface BusEvent {
  /** Event type identifier (e.g., 'CartItemLoaded', 'TASK_COMPLETED') */
  type: EventKey;
  /** Optional structured payload */
  payload?: EventPayload;
  /** Timestamp when the event was emitted */
  timestamp: number;
  /** Optional origin info for filtering */
  source?: BusEventSource;
}

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
export interface EmittedEvent {
  event: string;
  payload?: EventPayload;
  source?: BusEventSource;
}

/** Zod twin of `EmittedEvent`. Third type param `object`, see `BusEventSourceSchema`. */
export const EmittedEventSchema: z.ZodType<EmittedEvent, z.ZodTypeDef, object> = z.object({
  event: z.string(),
  payload: EventPayloadSchema.optional(),
  source: BusEventSourceSchema.optional(),
});

// ============================================================================
// Client-effect wire grammar
// ============================================================================

/**
 * Client-side effect tuple shipped in `OrbitalEventResponse.clientEffects`.
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
export type ClientRenderUITuple = ['render-ui', string, PatternConfig | null];

export type ClientNavigateTuple =
  | ['navigate', string]
  | ['navigate', string, Record<string, string> | null]
  | ['navigate', string, Record<string, string> | null, { crumb?: string }];

export type ClientNavigateBackTuple = ['navigate-back'];

export type ClientEffectTuple =
  | ClientRenderUITuple
  | ClientNavigateTuple
  | ClientNavigateBackTuple;

/** Zod twin of `ClientRenderUITuple`. */
export const ClientRenderUITupleSchema = z.tuple([z.literal('render-ui'), z.string(), PatternConfigSchema]);

/** Zod twin of `ClientNavigateTuple` — one variant per fixed arity (2/3/4), unioned. */
export const ClientNavigateTupleSchema = z.union([
  z.tuple([z.literal('navigate'), z.string()]),
  z.tuple([z.literal('navigate'), z.string(), z.record(z.string()).nullable()]),
  z.tuple([
    z.literal('navigate'),
    z.string(),
    z.record(z.string()).nullable(),
    z.object({ crumb: z.string().optional() }),
  ]),
]);

/** Zod twin of `ClientNavigateBackTuple`. */
export const ClientNavigateBackTupleSchema = z.tuple([z.literal('navigate-back')]);

/** Zod twin of `ClientEffectTuple`. */
export const ClientEffectTupleSchema: z.ZodType<ClientEffectTuple> = z.union([
  ClientRenderUITupleSchema,
  ClientNavigateTupleSchema,
  ClientNavigateBackTupleSchema,
]);

// ============================================================================
// Event dispatch wire (single owner — canonical = the TS runtime)
// ============================================================================

/**
 * Client → server event dispatch request. The single upstream owner of
 * this shape — both the JS interpreter (`@almadar/runtime`'s
 * `OrbitalEventRequest`) and the compiled path's generated `EventRequest`
 * (orbital-shell-typescript's `shared/types.ts`, mirrored 1:1 in
 * `orbital-core`) carry the same fields, so the two execution paths cannot
 * drift.
 */
export interface OrbitalEventRequest {
  event: string;
  /**
   * V4 dual-carry id sibling of `event` — the fired event's id, when known
   * (e.g. threaded from a `listens[].triggersId`). Optional; absent means
   * the state machine dispatches by name only (legacy).
   */
  eventId?: EventId;
  payload?: EventPayload;
  entityId?: string;
  /**
   * Scoped-listen delivery: dispatch to THIS trait only. A listens-matched
   * trigger is addressed to the listening trait; without this, a trigger
   * renamed to INIT broadcast orbital-wide and re-ran every trait's
   * initializer (R-SCOPED-LISTEN-INIT-RENAME-FREEZE re-fire cascade).
   */
  targetTrait?: string;
  /** Provider claims for `@user` bindings, normalized by `normalizeUserContext`. */
  user?: RawUserClaims;
  /** Per-tab client identity (UUID) — excludes this request's origin from live-broadcast delivery. */
  clientId?: string;
  /**
   * The viewer's locale (one of the program's declared `locales`): servers
   * evaluate `i18n/t` and `@locale` with it. Absent means the program's first
   * declared locale.
   */
  locale?: string;
  /**
   * Broadcast-class marker (T6, docs/Almadar_Tick_Loop.md §3a): the name of
   * the tick that emitted this event. Tick-stamped dispatches are
   * latest-state broadcasts — the client fires them without awaiting the
   * response, and the server relays them to OTHER tabs coalesced
   * (newest-per-key) at a snapshot rate instead of 1:1.
   */
  tick?: string;
  /** Emitting trait for a tick-stamped dispatch — builds the relay's BusEventSource (sourceless emits are dropped client-side). */
  sourceTrait?: string;
  /**
   * Run one firing of a tick at the data authority: the trait's tick named `tick` runs its
   * effects there, as `event` + `targetTrait` runs a transition. A browser-run tick sends one
   * for its data effects on browser-stored entities (a tick has no event to replay under);
   * `event` is the tick's synthetic key `$TICK_<tick>`. Owner ruling 2026-10-12 (drift D-1).
   */
  runTick?: { trait: string; tick: string };
  /**
   * Stateless addressing: the traits this dispatch runs against, each with
   * the scope it dispatches `from` (a single-element array is the common
   * case; a listens fan-out that crosses traits carries more than one). The
   * compiled server is stateless-per-trait too (`handlers.rs:510-532` seeds
   * state from `currentState`) — this generalizes that mechanism instead of
   * the retired single `currentState`/`fields` pair. `event` is the event
   * that trait fired on in a cascade (the seed's own is `event` above); where
   * the leg runs follows it.
   */
  traits?: Array<{ trait: string; from: string; event?: string }>;
  /**
   * The dispatching traits' current `@entity` frames (declared defaults <
   * fetched row < `[shared]` frame), keyed by trait name. The server layers
   * each row over the one it resolves via `resolveEntityView` so guards and
   * effects read the same values the client does.
   */
  entityByTrait?: Record<string, EntityRow>;
  /** The orbital/behavior name this dispatch targets, for stateless multi-orbital addressing. */
  behavior?: string;
  /** `@event` for the target when this request continues a dispatch that began on the client; absent = a direct dispatch. */
  delivery?: DeliveryRecord;
  /** The target trait's log so far in that dispatch; absent = empty. */
  dispatchLog?: DispatchLog;
  /**
   * A mount batch: one request mounts several traits of the orbital, each
   * running its OWN lifecycle event, in list order, with the shared
   * `payload`. `traits`/`entityByTrait` keep their stateless-addressing
   * meaning; `event` carries the first seed's event.
   */
  mount?: MountSeed[];
}

/** The lifecycle events a trait runs when it enters a page (the first it handles). */
/**
 * Host-level UI events: handled by the app host, never by a trait, so a
 * component inside a trait scope emits them bare (`UI:NAVIGATE`), not
 * qualified to its trait. `NAVIGATE` moves the router; `SIGN_OUT` ends the
 * viewer's session.
 */
export const SYSTEM_UI_EVENTS = ["NAVIGATE", "SIGN_OUT"] as const;
export type SystemUiEvent = (typeof SYSTEM_UI_EVENTS)[number];

export function isSystemUiEvent(event: string): event is SystemUiEvent {
  return (SYSTEM_UI_EVENTS as readonly string[]).includes(event);
}

export const LIFECYCLE_EVENTS = ["INIT", "LOAD", "$MOUNT"] as const;

/** Wire-only event a client sends when a trait leaves the page; the server stops counting it as mounted. */
export const UNMOUNT_EVENT = '$UNMOUNT';

/** An event key without its `UI:` bus prefix. */
export function normalizeEventKey(eventKey: string): string {
  if (!eventKey) return '';
  return eventKey.startsWith('UI:') ? eventKey.slice(3) : eventKey;
}

/** The event a tick firing carries on the wire (`OrbitalEventRequest.event` of a `runTick` leg). */
export function tickEventKey(tickName: string): string {
  return `$TICK_${tickName}`;
}
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

/** One trait of a mount batch and the lifecycle event it runs. */
export interface MountSeed {
  trait: string;
  event: LifecycleEvent;
}

export const MountSeedSchema = z.object({ trait: z.string(), event: z.enum(LIFECYCLE_EVENTS) });

/** Structured reason one trait (or the whole dispatch) did not transition. */
export type TransitionRejectionCode =
  | 'no-matching-transition'
  | 'guard-rejected'
  | 'no-dispatchable-traits'
  | 'not-an-external-input'
  | 'inbound-only-event'
  /** An effect of the trait's transition threw; its later effects did not run. */
  | 'effect-failed';

/**
 * A request on the outside-client input channel (`POST /:orbital/inputs`): an
 * API caller, an agent acting as the user, an MCP client. Only an event the
 * target trait declares as an external input (`listens { EVENT -> external { … } }`)
 * is dispatched; anything else is refused with `not-an-external-input`.
 */
export interface ExternalInputRequest {
  targetTrait: string;
  event: string;
  payload?: EventPayload;
  user?: RawUserClaims;
  entityId?: string;
}

export type EventStreamItem =
  | { type: 'event'; data: EmittedEvent; timestamp: number }
  | { type: 'effect'; data: ClientEffectTuple; timestamp: number }
  | { type: 'complete'; data: OrbitalEventResponse; timestamp: number }
  | { type: 'error'; data: { message: string }; timestamp: number };

export const EventStreamItemSchema = z.union([
  z.object({ type: z.literal('event'), data: EmittedEventSchema, timestamp: z.number() }),
  z.object({ type: z.literal('effect'), data: ClientEffectTupleSchema, timestamp: z.number() }),
  z.object({ type: z.literal('complete'), data: z.lazy(() => OrbitalEventResponseSchema), timestamp: z.number() }),
  z.object({ type: z.literal('error'), data: z.object({ message: z.string() }), timestamp: z.number() }),
]);

/** How a host answered a `program/dispatch` event request: the response, or the route's failure code and status. */
export type DispatchRequestOutcome =
  | { ok: true; response: OrbitalEventResponse; streamItems?: EventStreamItem[] }
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
  dispatchInput(orbital: string, request: Omit<ExternalInputRequest, 'user'>): Promise<OrbitalEventResponse>;
  read(entity: string): Promise<EntityRow[]>;
  /**
   * A `program/dispatch` event request (owner, 2026-10-21): dispatch `request` on `orbital` as the HTTP events
   * route does (`input: true` admits only a declared external input, as the inputs route). `request.user` is the
   * dispatch's viewer when the call names one. A host that does not serve event requests leaves it out.
   */
  supportsDispatchStream?: true;
  dispatchRequest?(orbital: string, request: OrbitalEventRequest, input: boolean, stream?: boolean): Promise<DispatchRequestOutcome>;
  /** A `program/dispatch { inbound }` delivery through the inbound route, credential check and answer path. */
  deliverInbound?(name: string, delivery: { headers: Readonly<Record<string, string>>; rawBody: string }): Promise<{ status: number; body: string }>;
  /** The host's last `steps` traced dispatch steps, oldest first; a host that keeps no trace leaves it out. */
  trace?(steps: number): JsonValue[];
  /**
   * Deliver one message of the running call to the caller's tab, live, as the
   * call site's `emit.onMessage` event source-stamped to the caller. A no-op
   * when the call site declares no `onMessage`.
   */
  message(payload: EventPayload): void;
}

/**
 * Why a dispatched trait (or the whole request) did not transition —
 * G-RUNTIME-023. `statesDeclaringEvent` lists the states whose transition
 * table DOES declare the event, which makes a stale client-supplied `from`
 * self-explanatory in a stateless response.
 */
export interface TransitionRejection {
  code: TransitionRejectionCode;
  trait?: string;
  from?: string;
  event?: string;
  statesDeclaringEvent?: string[];
  transition?: string;
  guard?: unknown;
  /** `effect-failed`: the thrown error's message. */
  error?: string;
}

/** How one authored effect of an executed hop ran. */
export type HopEffectStatus = 'executed' | 'failed' | 'skipped';

/** One authored effect of a hop: its operator head, its arguments as authored, and how it ran. */
export interface HopEffect {
  type: string;
  args: SExpr[];
  status: HopEffectStatus;
  error?: string;
}

/**
 * One executed hop of a dispatch (the seed's, a same-trait cascade step's, a listener delivery's), in
 * dispatch order: what a `TransitionObserver` hears. `guardResult` is `true` when the fired arm's guard
 * held and absent for an unguarded arm.
 */
export interface TransitionHop {
  trait: string;
  from: string;
  to: string;
  event: string;
  /** The arm that fired, by its position among the state's arms for the event. */
  firedArm?: number;
  guardResult?: boolean;
  effects: HopEffect[];
  /** The payload and `@entity` before and after the hop, when a verifier asked the kernel to record them. */
  observed?: HopObservation;
}

/**
 * One client effect paired with the trait that produced it and, when the
 * producer knows it, the transition that fired: that transition's own event
 * key (for a listens delivery, the triggered event, not the source emit) and
 * the state it fired from. A client stamps render provenance from these.
 */
export interface ClientEffectByTrait {
  traitName: string;
  effect: ClientEffectTuple;
  event?: string;
  fromState?: string;
  /** The payload an embedded `@callsitePayload` child was composed with — sticky, so a later repaint of the child resolves its captures the same way. */
  callsitePayload?: EventPayload;
  /** Set when the paint is a repaint a renderer must act on beyond the content: the rows a reference in it points at changed (EXEC-RENDER-3). */
  repaint?: RepaintReason;
}

/**
 * Server → client event dispatch response. Mirrors the compiled path's
 * generated `EventResponse` (orbital-shell-typescript's `shared/types.ts`,
 * mirrored 1:1 in `orbital-core`'s `effects/response.rs`) — canonical = the
 * TS runtime's `OrbitalEventResponse` (`@almadar/runtime`'s
 * `OrbitalServerRuntime.ts`).
 */
export interface OrbitalEventResponse {
  success: boolean;
  transitioned: boolean;
  /** Whole-orbital state snapshot, keyed by trait name. */
  states: Record<string, string>;
  /**
   * Events emitted during processing, in declaration order. ALWAYS present
   * (`[]` when none) — the compiled Hono path used to omit this field on a
   * no-cascade response, which forced every consumer to optional-chain a
   * field that is really always there.
   *
   * Each entry carries a `source: BusEventSource` so the client-side
   * ServerBridge can re-broadcast on the qualified `UI:Orbital.Trait.EVENT`
   * bus key. Without source the re-broadcast skips the entry and downstream
   * listeners (e.g. ContactBrowse waiting for ContactLoaded after a fetch)
   * never fire — the dashboard-layout that ContactLoaded renders disappears.
   */
  emittedEvents: EmittedEvent[];
  /** Fetched/queried entity collections this response carries, keyed by entity name. */
  data?: Record<string, EntityRow[]>;
  /** Fetched pages delivered by reference (`deliver: ids`), keyed by entity name. */
  dataRefs?: Record<string, RowSetRef>;
  /**
   * `@entity` fields this transition's server-side `set` effects wrote,
   * post-effect, keyed by trait name — the response-side twin of the
   * request's `entityByTrait`. The client merges them over its own effect
   * results (server wins).
   */
  entityByTrait?: Record<string, EntityRow>;
  /** Client-side effects to execute (render-ui, navigate). */
  clientEffects?: ClientEffectTuple[];
  /**
   * Same effects as `clientEffects`, paired with the producing trait name.
   * Consumers that need per-trait attribution (e.g. `<TraitFrame>` resolving
   * `@trait.X` bindings) read from this field; legacy consumers ignore it
   * and continue with the flat `clientEffects` array unchanged.
   *
   * Same length and ordering as `clientEffects`; entries are 1:1 by index.
   */
  clientEffectsByTrait?: ClientEffectByTrait[];
  /** Results from server-side effects (persist, call-service, set). */
  effectResults?: ServerEffectResult[];
  /** Guard that failed, addressed as `"<Trait>.<event>"`, for debugging. */
  guardFailed?: string;
  /**
   * Structured per-trait / per-request rejection reasons (G-RUNTIME-023) —
   * present only when nothing transitioned. Supersedes the `guardFailed`
   * string (kept for backcompat) with a machine-readable shape.
   */
  rejections?: TransitionRejection[];
  /**
   * Names of traits DROPPED from a stateless cascade because the cross-trait
   * worklist hit its safety-valve cap (G-RUNTIME-027) — the response's
   * states/effects/entity rows are INCOMPLETE for these traits. Absent when
   * the whole worklist ran. Surfaced so the truncation is observable
   * (previously the tail of any page over ~20 traits silently never
   * executed).
   */
  cascadeTruncated?: string[];
  /** Every executed hop of the dispatch, in order (the server role's trace); absent when none ran. */
  transitions?: TransitionHop[];
  error?: string;
}

/** Zod twin of `OrbitalEventRequest`. Third type param `object`, see `BusEventSourceSchema`. */
export const OrbitalEventRequestSchema: z.ZodType<OrbitalEventRequest, z.ZodTypeDef, object> = z.object({
  event: z.string(),
  eventId: EventIdSchema.optional(),
  payload: EventPayloadSchema.optional(),
  entityId: z.string().optional(),
  targetTrait: z.string().optional(),
  user: RawUserClaimsSchema.optional(),
  clientId: z.string().optional(),
  locale: z.string().optional(),
  tick: z.string().optional(),
  sourceTrait: z.string().optional(),
  runTick: z.object({ trait: z.string(), tick: z.string() }).optional(),
  traits: z.array(z.object({ trait: z.string(), from: z.string() })).optional(),
  entityByTrait: z.record(EntityRowSchema).optional(),
  behavior: z.string().optional(),
  delivery: DeliveryRecordSchema.optional(),
  dispatchLog: DispatchLogSchema.optional(),
  mount: z.array(MountSeedSchema).optional(),
});

/** Zod twin of `OrbitalEventResponse`. Third type param `object`, see `BusEventSourceSchema`. */
export const OrbitalEventResponseSchema: z.ZodType<OrbitalEventResponse, z.ZodTypeDef, object> = z.object({
  success: z.boolean(),
  transitioned: z.boolean(),
  states: z.record(z.string()),
  emittedEvents: z.array(EmittedEventSchema),
  data: z.record(z.array(EntityRowSchema)).optional(),
  dataRefs: z.record(RowSetRefSchema).optional(),
  entityByTrait: z.record(EntityRowSchema).optional(),
  clientEffects: z.array(ClientEffectTupleSchema).optional(),
  clientEffectsByTrait: z
    .array(z.object({
      traitName: z.string(),
      effect: ClientEffectTupleSchema,
      event: z.string().optional(),
      fromState: z.string().optional(),
      callsitePayload: EventPayloadSchema.optional(),
      repaint: z.literal("rows-changed").optional(),
    }))
    .optional(),
  effectResults: z.array(ServerEffectResultSchema).optional(),
  guardFailed: z.string().optional(),
  rejections: z
    .array(
      z.object({
        code: z.enum(['no-matching-transition', 'guard-rejected', 'no-dispatchable-traits', 'not-an-external-input', 'inbound-only-event', 'effect-failed']),
        trait: z.string().optional(),
        from: z.string().optional(),
        event: z.string().optional(),
        statesDeclaringEvent: z.array(z.string()).optional(),
        transition: z.string().optional(),
        guard: z.unknown().optional(),
        error: z.string().optional(),
      }),
    )
    .optional(),
  cascadeTruncated: z.array(z.string()).optional(),
  transitions: z
    .array(
      z.object({
        trait: z.string(),
        from: z.string(),
        to: z.string(),
        event: z.string(),
        guardResult: z.boolean().optional(),
        effects: z.array(
          z.object({
            type: z.string(),
            args: z.array(SExprDataSchema),
            status: z.enum(['executed', 'failed', 'skipped']),
            error: z.string().optional(),
          }),
        ),
      }),
    )
    .optional(),
  error: z.string().optional(),
});

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

export const OrbitalRegisterResponseSchema: z.ZodType<OrbitalRegisterResponse, z.ZodTypeDef, object> = z.object({
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
export const LiveBroadcastItemSchema: z.ZodType<LiveBroadcastItem, z.ZodTypeDef, object> = z.object({
  event: z.string(),
  payload: EventPayloadSchema.optional(),
  source: BusEventSourceSchema,
  originClientId: z.string().optional(),
});

/** @deprecated use {@link OrbitalEventRequest}. Kept until every referrer migrates (Program A wave A8). */
export type EventDispatchRequest = OrbitalEventRequest;

/** @deprecated use {@link OrbitalEventRequestSchema}. */
export const EventDispatchRequestSchema = OrbitalEventRequestSchema;

/** @deprecated use {@link OrbitalEventResponse}. Kept until every referrer migrates (Program A wave A8). */
export type EventDispatchResponse = OrbitalEventResponse;

/** @deprecated use {@link OrbitalEventResponseSchema}. */
export const EventDispatchResponseSchema = OrbitalEventResponseSchema;
