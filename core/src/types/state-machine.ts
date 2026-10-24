/**
 * State Machine Types (Self-Contained)
 *
 * Defines state machine types for traits.
 * Copied from schema/state-machine.ts to make orbitals/ self-contained.
 *
 * @packageDocumentation
 */

import { AwaitRenderSchema, type AwaitRender } from "./skeleton.js";
import { z } from "zod";
import { FieldProjectionSchema, type FieldProjection } from "./projection.js";
import type { Effect } from "./effect.js";
import { EffectSchema } from "./effect.js";
import type { Expression, SExpr } from "./expression.js";
import { ExpressionSchema, SExprListSchema, SExprSchema } from "./expression.js";
import type { EventId } from "./identity.js";
import { EventIdSchema } from "./identity.js";

// ============================================================================
// State
// ============================================================================

/**
 * Represents a state in the state machine
 */
export type State = {
  /** State name (unique identifier) */
  name: string;
  /** Whether this is the initial state */
  isInitial?: boolean;
  /** Whether this is a terminal state (no outgoing transitions expected) */
  isTerminal?: boolean;
  /** Whether this is a final state (legacy alias for isTerminal) */
  isFinal?: boolean;
  /** Human-readable description */
  description?: string;
  /** Effect names to run on entry */
  onEntry?: string[];
  /** Effect names to run on exit */
  onExit?: string[];
  /** `@holds <expr>`: the trait's `@entity` satisfies it whenever the trait is in this state, proved by `orb validate`. No runtime effect. */
  holds?: SExpr;
};

export const StateSchema = z.object({
  name: z.string().min(1, "State name is required"),
  isInitial: z.boolean().optional(),
  isTerminal: z.boolean().optional(),
  isFinal: z.boolean().optional(),
  description: z.string().optional(),
  onEntry: z.array(z.string()).optional(),
  onExit: z.array(z.string()).optional(),
  holds: SExprSchema.optional(),
});

// ============================================================================
// Event
// ============================================================================

/**
 * Payload field definition for events
 */
/**
 * One condition of a payload field's `typeWhen` conditional list: "when
 * config knob `knob` resolves to the literal whose string spelling is
 * `equals`, this field's type is `type`". Declared DATA — authored in
 * `.lolo` as a type-level `match` block (§25 — REPLACED the `@typeWhen`
 * annotation spelling outright) — never a compiler-side predicate over a
 * specific knob name. This wire shape is `match`'s lowered form, unchanged.
 * Mirrors Rust `PayloadTypeWhen`.
 */
export type PayloadTypeWhen = {
  knob: string;
  equals: string;
  type: string;
};

export const PayloadTypeWhenSchema: z.ZodType<PayloadTypeWhen> = z.object({
  knob: z.string().min(1),
  equals: z.string().min(1),
  type: z.string().min(1),
});

export type PayloadField = {
  name: string;
  /**
   * Field type. Mirrors the Rust validator's acceptance: any non-empty
   * string. Primitives ('string' | 'number' | 'boolean' | 'object' |
   * 'array') are the canonical values; entity-name references like
   * 'CartItem' and array-of-entity references like '[CartItem]' are also
   * valid because the Rust IR's PayloadField.field_type is just a String.
   */
  type: string;
  required?: boolean;
  nullable?: boolean;
  additionalProperties?: PayloadField;
  /** Closed value set (`"a" | "b"`) — element-wise for an array type. Mirrors Rust `PayloadField.values`. */
  values?: ReadonlyArray<string>;
  /** Structured property schema for object-typed payload fields (recursive). */
  properties?: ReadonlyArray<PayloadField>;
  /**
   * Declared knob-conditional type list (`match` in `.lolo`, §25). Resolved
   * and cleared once composed — the emitted `.orb` carries only the
   * resolved truth, never the conditional.
   */
  typeWhen?: ReadonlyArray<PayloadTypeWhen>;
  /**
   * The declared entity this field's value IS an instance of — stamped by
   * lowering when an entity-typed payload field (`row: Note`, scalar or
   * `[Note]` array — the array form names the element entity) is flattened
   * into `type: "object"`/`"[object]"` + `properties`. Mirrors Rust
   * `PayloadField.entity`. Absent for an anonymous struct/object field with
   * no declared entity — never inferred from shape or name.
   */
  entity?: string;
  /**
   * `.lolo` `T.f` / `[T.f]`: the declared field this field's value — each
   * element's, for an array type — was projected from. Mirrors Rust
   * `PayloadField.projected_from`.
   */
  projectedFrom?: FieldProjection;
  /**
   * The element type of an `array` field whose element is itself a typed field (a union of named types:
   * `[(Adv | string)]`), the nested form an entity field's `items` takes. Mirrors Rust `PayloadField.items`.
   */
  items?: PayloadField;
};

/**
 * The container a payload field's `type` string declares. `[X]` (and the
 * bare `array` primitive) is an array of `X`; `Map<K,V>` carries key/value
 * types; `object` is a plain object;
 * every other spelling — scalars, entity names, `@entity`, type variables,
 * unions — is opaque to a container check.
 */
export type PayloadTypeContainer =
  | { kind: 'array'; element: string }
  | { kind: 'map'; key: string; value: string }
  | { kind: 'object' }
  | { kind: 'opaque' };

export function payloadTypeContainer(type: string): PayloadTypeContainer {
  if (type === 'array') return { kind: 'array', element: '' };
  if (type === 'object') return { kind: 'object' };
  if (type.startsWith('Map<') && type.endsWith('>')) {
    const inner = type.slice(4, -1);
    const comma = inner.indexOf(',');
    if (comma > 0 && comma < inner.length - 1) {
      return { kind: 'map', key: inner.slice(0, comma).trim(), value: inner.slice(comma + 1).trim() };
    }
  }
  if (type.length > 2 && type.startsWith('[') && type.endsWith(']')) {
    return { kind: 'array', element: type.slice(1, -1) };
  }
  return { kind: 'opaque' };
}

const payloadFieldShape = {
  type: z.string().min(1),
  required: z.boolean().optional(),
  nullable: z.boolean().optional(),
  additionalProperties: z.lazy(() => PayloadFieldDescriptorSchema).optional(),
  values: z.array(z.string()).optional(),
  properties: z.lazy(() => z.array(PayloadFieldSchema)).optional(),
  typeWhen: z.array(PayloadTypeWhenSchema).optional(),
  entity: z.string().min(1).optional(),
  projectedFrom: FieldProjectionSchema.optional(),
  items: z.lazy(() => PayloadFieldDescriptorSchema).optional(),
};

const PayloadFieldDescriptorSchema: z.ZodType<PayloadField> = z.object({
  name: z.string(),
  ...payloadFieldShape,
});

export const PayloadFieldSchema: z.ZodType<PayloadField> = z.object({
  name: z.string().min(1),
  ...payloadFieldShape,
});

/** What an inbound event declares: the hook name it receives and the event whose payload answers the request. */
export type InboundDeclaration = {
  name: string;
  answers: string;
  /** The sender check the runtime makes before the handler runs; its result is the payload's `verified`. */
  verifies?: InboundVerification;
};

/** `verifies "<header>" "<CREDENTIAL>"`: the request header that must equal the named credential (compared in constant time, never exposed to program data). */
export type InboundVerification = {
  header: string;
  credential: string;
};

export const InboundVerificationSchema = z.object({
  header: z.string().min(1),
  credential: z.string().min(1),
});

export const InboundDeclarationSchema = z.object({
  name: z.string().min(1),
  answers: z.string().min(1),
  verifies: InboundVerificationSchema.optional(),
});

/**
 * Represents an event that can trigger transitions
 */
export type Event = {
  /** Event key (UPPER_SNAKE_CASE) */
  key: string;
  /** V4 dual-carry id sibling of `key` — optional until the Phase-7 flip. */
  id?: EventId;
  /** Human-readable name */
  name: string;
  /** Description (authored `@description` on the emit/listen). */
  description?: string;
  /** User-vocabulary synonyms (comma-separated) — per-event analogue of a
   *  field/config `@synonyms`. Feeds the curation event matcher. */
  synonyms?: string;
  /** Authoring tier (`essential`/`customization`/`advanced`/`internal`). */
  tier?: string;
  /** Expected payload structure */
  payloadSchema?: PayloadField[];
  /**
   * The entity this WHOLE payload was declared as (`type X = Event
   * <EntityName>`, the bare/concrete form) — mirrors Rust
   * `EventDefinition.payload_entity` (G4, `Almadar_Compiler_Gaps.md` §82).
   * Distinct from `PayloadField.entity` (a single NESTED field's value is
   * an entity instance): this marks the payload schema ITSELF as a 1:1
   * mirror of that entity's CURRENT fields. Consumed by
   * `resolveTraitTypeParamSentinels` (`resolver/sentinel-resolution.ts`)
   * to re-derive `payloadSchema` from the entity's post-`fields{}`/
   * `extend{}` shape once an orbital-import or trait-reference override
   * has materialized; kept in sync across entity renames the same one
   * owner `PayloadField.entity` already uses
   * (`renamePayloadEntityMarkers`, `reference-resolver.ts`).
   */
  payloadEntity?: string;
  /**
   * A declared input (`listens { EVENT -> input { … } }`): a client
   * outside the program (an API, an agent, an MCP client) may send this event to
   * the trait. Absent = not an input. Mirrors Rust `EventDefinition.input`.
   */
  input?: boolean;
  /**
   * Declared in the trait's own `listens { EVENT … }` block (the local form, input or
   * not): an input the author offers to the program. Absent = not declared there.
   * Mirrors Rust `EventDefinition.listened`.
   */
  listened?: boolean;
  /**
   * A declared inbound delivery (`listens { EVENT -> inbound "name" answers ANSWER { … } }`): the
   * host carries the request at `/api/hooks/<name>` and the kernel delivers it to this event; the
   * handler's emit of `answers` (`{ status, body }`) is the HTTP answer. Mirrors Rust
   * `EventDefinition.inbound`.
   */
  inbound?: InboundDeclaration;
  /** Domain vs System classification (optional, for analysis) */
  classification?: "domain" | "system";
  /** Semantic role of this event (optional, for analysis) */
  semanticRole?: string;
};

export const EventSchema = z.object({
  key: z.string().min(1, "Event key is required"),
  id: EventIdSchema.optional(),
  name: z.string().min(1, "Event name is required"),
  description: z.string().optional(),
  synonyms: z.string().optional(),
  tier: z.string().optional(),
  payloadSchema: z.array(PayloadFieldSchema).optional(),
  payloadEntity: z.string().optional(),
  input: z.boolean().optional(),
  listened: z.boolean().optional(),
  inbound: InboundDeclarationSchema.optional(),
  classification: z.enum(["domain", "system"]).optional(),
  semanticRole: z.string().optional(),
});

// ============================================================================
// Guard
// ============================================================================

/**
 * Represents a named guard condition.
 * Expression must be an S-expression.
 *
 * @example
 * {
 *   name: "hasHealth",
 *   expression: [">", "@entity.health", 0],
 *   description: "Check if entity has health remaining"
 * }
 */
export type Guard = {
  name: string;
  /** Guard expression - S-expression array only */
  expression: Expression;
  description?: string;
};

export const GuardSchema = z.object({
  name: z.string().min(1, "Guard name is required"),
  expression: ExpressionSchema,
  description: z.string().optional(),
});

// ============================================================================
// Transition (Effect imported separately to avoid circular deps)
// ============================================================================

/**
 * Represents a transition between states.
 * Guards and effects must be S-expressions.
 *
 * @example
 * {
 *   from: "idle",
 *   to: "running",
 *   event: "START",
 *   guard: [">", "@entity.fuel", 0],
 *   effects: [
 *     ["set", "@entity.status", "running"],
 *     ["emit", "ENGINE_STARTED"]
 *   ]
 * }
 */
export type Transition = {
  /** Source state name */
  from: string;
  /** Target state name */
  to: string;
  /** Event key that triggers this transition */
  event: string;
  /** V4 dual-carry id sibling of `event` — optional until the Phase-7 flip. */
  eventId?: EventId;
  /** Guard expression - S-expression array */
  guard?: Expression | null;
  /** Effects to execute - S-expression arrays */
  effects?: Effect[];
  /** `@ensures <expr>`: the outcome contract owed at this transition (`@fromEntity` is the row before it); proved by `orb validate`, judged by `orb verify`. No runtime effect. */
  ensures?: SExpr[];
  /** Description */
  description?: string | null;
  /**
   * Predicted renders this transition's server effects lead to, used to draw
   * awaiting-server skeletons. Computed by orbital-compiler (enrich) in the
   * resolved schema only — never authored, never persisted in a registry `.orb`.
   */
  awaitRender?: AwaitRender[];
};

export const TransitionSchema = z.object({
  from: z.string().min(1, "Transition source state is required"),
  to: z.string().min(1, "Transition target state is required"),
  event: z.string().min(1, "Transition event is required"),
  eventId: EventIdSchema.optional(),
  guard: ExpressionSchema.nullish(),
  effects: z.array(EffectSchema).optional(),
  ensures: SExprListSchema.optional(),
  description: z.string().nullish(),
  awaitRender: z.array(AwaitRenderSchema).optional(),
});

// ============================================================================
// State Machine
// ============================================================================

/**
 * Complete state machine definition
 */
export type StateMachine = {
  /** All states in the machine */
  states: State[];
  /** All events that can be triggered */
  events: Event[];
  /** All transitions between states */
  transitions: Transition[];
  /** Named guard definitions */
  guards?: Guard[];
};

export const StateMachineSchema = z.object({
  states: z.array(StateSchema).min(1, "At least one state is required"),
  events: z.array(EventSchema),
  transitions: z.array(TransitionSchema),
  guards: z.array(GuardSchema).optional(),
});

// ============================================================================
// Type exports
// ============================================================================

export type StateInput = z.input<typeof StateSchema>;
export type EventInput = z.input<typeof EventSchema>;
export type GuardInput = z.input<typeof GuardSchema>;
export type TransitionInput = z.input<typeof TransitionSchema>;
export type StateMachineInput = z.input<typeof StateMachineSchema>;

// ============================================================================
// Event Utilities
// ============================================================================

/**
 * Check if an event is a circuit event (not internal/system event).
 * Circuit events are user-defined events that participate in the closed circuit pattern.
 * Internal/system events start with underscore (e.g., _INIT, _TICK, _TIMER).
 *
 * @param {string} event - Event name to check
 * @returns {boolean} true if event is a circuit event (doesn't start with underscore)
 *
 * @example
 * isCircuitEvent('CREATE') // true
 * isCircuitEvent('SAVE') // true
 * isCircuitEvent('_INIT') // false (internal)
 * isCircuitEvent('_TICK') // false (internal)
 */
export function isCircuitEvent(event: string): boolean {
  return !event.startsWith('_');
}
