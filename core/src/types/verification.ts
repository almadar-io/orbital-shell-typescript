/**
 * Verification Types (framework concept)
 *
 * The `window.__orbitalVerification` bridge is the single observation
 * point Playwright-based verifiers (`orbital-verify`, `runtime-verify`,
 * `@almadar-io/verify`) use to read runtime state out of a live app.
 * Its shape was previously duplicated between `@almadar/ui`'s
 * `verificationRegistry.ts` (producer) and `@almadar-io/verify`'s
 * `state-bridge.ts` (consumer). Every added field had to be mirrored
 * by hand; one side drifting silently broke the other.
 *
 * Hoisting the wire types into `@almadar/core` closes that gap the same
 * way {@link BusEvent} closed the UI/runtime event-shape drift. The
 * registry still owns the state machine, the schedule, and the window
 * exposure — this module owns only the shapes both sides agree on.
 *
 * @packageDocumentation
 */

import type { TraitConfig } from "./trait.js";
import type { EntityRow } from "./entity.js";
import type { EvalTrace, EventPayload, SExpr } from "./expression.js";
import type { BusEventSource } from "./bus.js";
import type { HopObservation } from "../generated/kernel-wire.js";
import verificationIds from "./verification-ids.json";

// ── Checks ────────────────────────────────────────────────────────────

/**
 * Outcome of a single verification check. `warn` is non-fatal in the
 * overall pass/fail tally; `pending` means the check has been registered
 * but not yet resolved.
 */
export type CheckStatus = "pass" | "fail" | "pending" | "warn";

export interface VerificationCheck {
  id: string;
  label: string;
  status: CheckStatus;
  details?: string;
  /** Timestamp (ms since epoch) when the status last changed. */
  updatedAt: number;
}

// ── Transition timeline ──────────────────────────────────────────────

/**
 * Trace of a single effect as it ran on a transition. `args` are the
 * effect tuple's trailing S-expressions; consumers narrow via `type`
 * before inspecting.
 */
export interface EffectTrace {
  type: string;
  /** For fetch/persist effects: the entity the effect addresses. */
  entityName?: string;
  /** For persist effects: the mutation performed. */
  action?: "create" | "upsert" | "update" | "delete" | "batch";
  /** For a persist that wrote a row: its id. */
  resultId?: string;
  /**
   * The effect's real outcome, distinct from `status`. `denied` means the
   * write was rejected by an access policy or resolved no row key —
   * `status` reports `"failed"` for it too (kept for back-compat with
   * consumers that only branch on `status`); `outcome` is the one field
   * that tells a denial apart from any other kind of failure.
   */
  outcome?: "success" | "denied" | "failed";
  args: SExpr[];
  status: "executed" | "failed" | "skipped";
  error?: string;
  /** What the effect addressed: an `http` effect's `<METHOD> <origin><path>`, an `emit` entry's event name. */
  target?: string;
  /** The declared `emit.failure` event the program routed this effect's failure to; absent when it declares none. */
  routed?: string;
  durationMs?: number;
  /** The effect expression's evaluation, node by node, when the producer traced it. */
  evalTrace?: EvalTrace;
}

/** What the server returned for a forwarded event. */
export interface ServerResponseTrace {
  orbitalName: string;
  success: boolean;
  /**
   * The runtime's own verdict on whether ANY arm accepted this dispatch
   * (`EventResponse.transitioned`). `false` = the event was
   * delivered but no transition fired — guard false, or no arm in the
   * current state — which a self-loop's unchanged state cannot reveal on
   * its own. Undefined only where the producing path does not report it
   * yet (the compiled client bridge's lifecycle payload).
   */
  transitioned?: boolean;
  /**
   * Server-side emits with their EVALUATED payloads (`EventResponse.
   * emittedEvents[].payload`). `emittedEvents` keeps the names for existing
   * consumers; observers that judge what an emit CARRIES read this — a
   * server-side `(emit SAVE {…})` never reaches the client bus log, and the
   * effect trace holds the declared args, not the values.
   */
  emitted?: ReadonlyArray<{ event: string; payload?: EventPayload }>;
  clientEffects: number;
  dataEntities: Record<string, number>;
  emittedEvents: string[];
  error?: string;
  timestamp: number;
}

export interface TransitionTrace {
  id: string;
  traitName: string;
  from: string;
  to: string;
  event: string;
  /** The arm that fired, by its position among the state's arms for the event (the kernel's hop). */
  firedArm?: number;
  guardExpression?: string;
  guardResult?: boolean;
  effects: EffectTrace[];
  /** Populated when the event round-tripped to the server. */
  serverResponse?: ServerResponseTrace;
  /** The hop's payload and the trait's `@entity` before and after it, when a verifier asked the kernel
   *  to record them (`setRecordEntityAfter`): what the hop's `@ensures` is judged on. */
  observed?: HopObservation;
  timestamp: number;
}

// ── Bridge health / summary ───────────────────────────────────────────

export interface BridgeHealth {
  connected: boolean;
  eventsForwarded: number;
  eventsReceived: number;
  lastError?: string;
  lastHeartbeat: number;
}

export interface VerificationSummary {
  totalChecks: number;
  passed: number;
  failed: number;
  warnings: number;
  pending: number;
}

// ── Trait reducer snapshot ────────────────────────────────────────────

/**
 * Per-trait state snapshot exposed to the verifier so it can assert
 * that reducer data (populated by fetch/persist transitions) and the
 * last dispatched payload land in the DOM correctly (VG4/VG6/VG11a/b/c).
 *
 * Mirrors what `useTraitStateMachine` / generated trait logic hooks
 * keep internally, without the verifier having to parse rendered text.
 */
export interface TraitStateSnapshot {
  /** Trait name as declared in the schema. */
  traitName: string;
  /** Current state machine state. */
  currentState: string;
  /** Declared state names for this trait (non-empty for healthy refs). */
  states: string[];
  /** Declared event keys for this trait (non-empty for healthy refs). */
  events: string[];
  /**
   * Entity data keyed by entity name. Uses {@link EntityRow} — the
   * canonical persisted-entity shape the server returns and the trait
   * reducer stores. Consumers that need full field-level types can cast
   * down to the generated entity (e.g. `data['CartItem'] as CartItem[]`).
   * Snapshot-on-read; mutating the returned arrays does not affect the
   * live reducer.
   */
  data: Record<string, EntityRow[]>;
  /** Payload of the last event the state machine processed, if any. */
  lastPayload?: EventPayload;
  /**
   * Last event the walker (or a UI click) dispatched into this trait.
   * Used by VG11a to resolve `@payload.X` expected values.
   */
  lastEventDispatched?: {
    event: string;
    payload?: EventPayload;
    source?: BusEventSource;
    timestamp: number;
  };
  /**
   * Bus events received from the server's `emittedEvents` cascade
   * since the last user dispatch. VG4 compares the length against the
   * number of `emit: { success/failure: ... }` entries on the
   * triggering transition.
   */
  cascadeReceived: Array<{
    event: string;
    payload?: EventPayload;
    timestamp: number;
  }>;
}

// ── Top-level snapshot ────────────────────────────────────────────────

export interface VerificationSnapshot {
  checks: VerificationCheck[];
  transitions: TransitionTrace[];
  bridge: BridgeHealth | null;
  summary: VerificationSummary;
  /**
   * Per-trait reducer snapshots. Empty on older runtimes that predate
   * the Foundation 1 expansion; non-empty once any trait hook has
   * registered a snapshot getter.
   */
  traits: TraitStateSnapshot[];
}

// ── Side-channel observation surfaces ────────────────────────────────

/** Asset load status exposed for canvas-based game verification. */
export type AssetLoadStatus = "loaded" | "failed" | "pending";

/**
 * Entry recorded on the verification event log. The registry ring-buffers
 * the log to the last `MAX_EVENT_LOG` entries (evicting the oldest, never
 * the recent tail) so long runs don't grow unbounded — see
 * `verificationRegistry` and `eventLogDropped`.
 */
export interface EventLogEntry {
  type: string;
  payload?: EventPayload;
  source?: BusEventSource;
  timestamp: number;
}

/** One guarded arm evaluated while choosing which `from --event-->` arm fires. */
export interface GuardEvaluation {
  /** Position of the arm among the trait's `from --event-->` arms, in declaration order. */
  arm: number;
  guard: SExpr;
  passed: boolean;
  trace: EvalTrace;
  error?: string;
}

/** One played circuit step: Event → Guard → Transition → Effects. */
export interface CircuitStepResult {
  trait: string;
  event: string;
  /** A guard-fail always means no transition, even for a self-loop. */
  transitionFired: boolean;
  guard: "pass" | "fail" | "none";
  /** Position of the chosen arm among the trait's `from --event-->` arms; absent when every guard failed. */
  firedArm?: number;
  state: { before: string | null; after: string | null };
  effects: ReadonlyArray<EffectTrace>;
  emitted: ReadonlyArray<EventLogEntry>;
  /** Guarded arms evaluated during arm selection, in order, when the guard hook traced them. */
  guards?: ReadonlyArray<GuardEvaluation>;
}

// ── Window bridge contract ───────────────────────────────────────────

/**
 * A drawable descriptor as exposed over the verification bridge. The
 * concrete `DrawableNode` union lives downstream in `@almadar/ui`
 * (`lib/drawable/paintDispatch.ts`) and cannot be imported here without
 * inverting the dependency axis; the bridge contract carries the `type`
 * discriminant (`draw-sprite`, `draw-shape`, …) that verifiers narrow on.
 */
export interface DrawableDescriptor {
  type: string;
}

/**
 * The object attached to `window.__orbitalVerification`. Every optional
 * member is wired up by a corresponding `bind*` / `register*` call on
 * the registry (e.g. `bindEventBus` populates `sendEvent`). Consumers
 * should null-check before calling — an older bundle might expose only
 * the core readers.
 */
export interface OrbitalVerificationAPI {
  applyConfig?: (traitName: string, config: TraitConfig) => void | Promise<void>;
  getSnapshot: () => VerificationSnapshot;
  getChecks: () => VerificationCheck[];
  getTransitions: () => TransitionTrace[];
  getBridge: () => BridgeHealth | null;
  getSummary: () => VerificationSummary;
  /** Wait for a specific event to be processed. Resolves to null on timeout. */
  waitForTransition: (
    event: string,
    timeoutMs?: number,
  ) => Promise<TransitionTrace | null>;
  /**
   * Send an event into the runtime. Requires {@link bindEventBus} (in
   * `@almadar/ui`) to have run at least once. Payload typed as
   * {@link EventPayload} so callers can't slip non-bus-shaped data in.
   *
   * `traitScope` is the qualified `Orbital.Trait` (or `App.Trait`)
   * scope that bus listeners subscribe under. The bridge constructs
   * `UI:${traitScope}.${event}` and emits that on the bus, matching
   * the codegen-emitted subscription keys (gap #13). When omitted,
   * the legacy bare-prefix form `UI:${event}` is used — kept only
   * for system-scope events like `UI:NAVIGATE`; trait-driven dispatch
   * MUST pass a `traitScope`.
   */
  sendEvent?: (
    event: string,
    payload?: EventPayload,
    traitScope?: string,
  ) => void;
  /** Current state name for a given trait, if known. */
  getTraitState?: (traitName: string) => string | undefined;
  /** Per-trait reducer snapshots (VG4/VG6/VG11a/b/c). */
  getTraitSnapshots?: () => TraitStateSnapshot[];
  /** Canvas frame capture. Populated by game organisms on mount. */
  captureFrame?: () => string | null;
  /** Last neutral drawables list received by the active canvas host. */
  getLastDrawables?: () => DrawableDescriptor[] | null;
  /** Asset-url → load-status map. Populated by game organisms. */
  assetStatus?: Record<string, AssetLoadStatus>;
  /** Rolling event bus log. Populated by `bindEventBus`. */
  eventLog?: EventLogEntry[];
  /**
   * Per-page-load nonce, set once when `bindEventBus` creates the log
   * (and bumped by `clearEventLog`). A verifier reading the log across
   * hermetic page reloads uses this — not the array length — to detect a
   * reset: the length can coincidentally refill to the same count after a
   * reload, which silently drops the post-reload delta. The epoch changing
   * is the only reliable reset signal.
   */
  eventLogEpoch?: string;
  /**
   * Count of entries evicted from the FRONT of the ring-buffered log this
   * page (see `MAX_EVENT_LOG`). The absolute index of `eventLog[i]` is
   * `eventLogDropped + i`, so a verifier can cursor by absolute position
   * even after eviction — the recent (driven) tail is never silently lost.
   */
  eventLogDropped?: number;
  /** Clear the event log in place (also bumps `eventLogEpoch`). */
  clearEventLog?: () => void;
}

/** `data-testid` of the box UISlotRenderer draws when a pattern prop's value
 *  has a shape no declared type accepts; verifiers count each as a failure. */
export const PATTERN_PROP_TYPE_ERROR_TESTID = "pattern-prop-type-error";

/** `data-testid` of the error a trait's card shows when its lifecycle step
 *  (INIT/LOAD/$MOUNT) throws; verifiers count each as a failure. */
export const TRAIT_MOUNT_ERROR_TESTID = "trait-mount-error";

/** DOM attribute on an empty-state view's root, so a verifier finds empty collections by structure, never by text. */
export const EMPTY_STATE_MARKER = "data-empty-state";

/** DOM attribute on a loading view's root (spinner, loading state). */
export const LOADING_STATE_MARKER = "data-loading-state";

/** Web DOM attributes the verifier selects on; one owner for @almadar/ui (producer) and @almadar-io/verify (consumer). */
export const VERIFICATION_DOM_ATTRS = {
  pattern: "data-pattern",
  rowId: "data-row-id",
  entityRow: "data-entity-row",
  entityId: "data-entity-id",
  fieldName: "data-field-name",
  event: "data-event",
} as const;

export const ACTION_TESTID_PREFIX = verificationIds.actionPrefix;

export const ACTION_OVERFLOW_TESTID = `${ACTION_TESTID_PREFIX}${verificationIds.overflowKey}`;

/** Pattern name of the form container a verifier fills. */
export const FORM_PATTERN = "form-section";

/** `data-testid` (web) / native identifier of an element that dispatches `eventKey`. */
export function actionTestId(eventKey: string): string {
  return `${ACTION_TESTID_PREFIX}${eventKey}`;
}

/** True when `testId` dispatches `event`: the exact form, or a qualified `Orbital.Trait.EVENT` form. */
export function actionTestIdMatches(testId: string, event: string): boolean {
  if (!testId.startsWith(ACTION_TESTID_PREFIX)) return false;
  const key = testId.slice(ACTION_TESTID_PREFIX.length);
  return key === event || key.endsWith(`.${event}`);
}

/** How an affordance dispatches its event: a tap, or a gesture its pattern declares. */
export type ActionGesture = "tap" | "long-press" | "swipe-left" | "swipe-right";

const GESTURES: readonly ActionGesture[] = ["tap", "long-press", "swipe-left", "swipe-right"];

/** Pattern props whose event fires on a gesture, not a tap (`calendar-grid`, `data-list`). */
function gestureOf(name: string): Exclude<ActionGesture, "tap"> {
  const gesture = GESTURES.find((g): g is Exclude<ActionGesture, "tap"> => g !== "tap" && g === name);
  if (gesture === undefined) throw new Error(`verification-ids.json names an unknown gesture "${name}"`);
  return gesture;
}

export const GESTURE_EVENT_PROPS: Readonly<Record<string, Exclude<ActionGesture, "tap">>> = Object.fromEntries(
  Object.entries(verificationIds.gestureEventProps).map(([prop, gesture]) => [prop, gestureOf(gesture)]),
);

/** The identifier of an element whose `gesture` dispatches `eventKey`; a tap is the plain {@link actionTestId}. */
export function gestureActionTestId(eventKey: string, gesture: ActionGesture): string {
  return gesture === "tap" ? actionTestId(eventKey) : `${ACTION_TESTID_PREFIX}${gesture}:${eventKey}`;
}

/** The gesture `testId` dispatches `event` with, or null when it does not dispatch `event`. */
export function gestureOfActionTestId(testId: string, event: string): ActionGesture | null {
  if (!testId.startsWith(ACTION_TESTID_PREFIX)) return null;
  const rest = testId.slice(ACTION_TESTID_PREFIX.length);
  const colon = rest.indexOf(":");
  const gesture = colon < 0 ? "tap" : GESTURES.find((g) => g !== "tap" && g === rest.slice(0, colon));
  if (gesture === undefined) return null;
  const key = colon < 0 ? rest : rest.slice(colon + 1);
  return key === event || key.endsWith(`.${event}`) ? gesture : null;
}

/** Single-identifier prefixes for native shells (accessibilityIdentifier / testTag); row scope is hierarchical. */
export const NATIVE_ID_PREFIX = verificationIds.nativeIdPrefix;

/** Separates the ids of one native element that dispatches several actions (a tap and a gesture). */
export const NATIVE_ID_SEPARATOR = verificationIds.nativeIdSeparator;

/** The identifier of a native element carrying every non-empty id in `ids`. */
export function nativeIds(...ids: readonly string[]): string {
  return ids.filter((id) => id !== "").join(NATIVE_ID_SEPARATOR);
}

/** The ids a native identifier carries. */
export function splitNativeIds(identifier: string): string[] {
  return identifier.split(NATIVE_ID_SEPARATOR).filter((id) => id !== "");
}

export function nativePatternId(name: string): string {
  return `${NATIVE_ID_PREFIX.pattern}${name}`;
}

export function nativeRowId(id: string): string {
  return `${NATIVE_ID_PREFIX.row}${id}`;
}

export function nativeFieldId(name: string): string {
  return `${NATIVE_ID_PREFIX.field}${name}`;
}

export function nativeSlotId(name: string): string {
  return `${NATIVE_ID_PREFIX.slot}${name}`;
}
