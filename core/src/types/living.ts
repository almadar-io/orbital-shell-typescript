/**
 * Living Orbital Schema — Golden Data Structure type system.
 *
 * The Living layer treats an `OrbitalSchema` as a heterogeneous attributed
 * graph: every vertex (orbital, entity, trait, state, transition, page, field,
 * event, effect, config-knob) carries a `SemanticAnnotation` + an embedding
 * vector, and the whole object can embed / validate / compile / similarity-
 * search / evolve itself. These are the canonical TYPE definitions shared by
 * the masar (Python) implementation and any TS implementation (rabit, Phase 5);
 * the numeric implementation lives outside @almadar/core.
 *
 * See `docs/Almadar_Masar_Golden_Data_Structure.md` §II/§III/§VIII. Existing
 * core vocabulary is reused, never re-defined: `SchemaChange`/`SemanticChangeKind`
 * (changeset.ts) back the evolution delta, `ValidationError`/`ValidationResult`
 * (validation.ts) back `validate()`, and the per-vertex payloads ARE the existing
 * structural types.
 *
 * @packageDocumentation
 */

import type { OrbitalSchema } from "./schema.js";
import type { OrbitalDefinition } from "./orbital.js";
import type { Entity } from "./entity.js";
import type { EntityField } from "./field.js";
import type { Trait, TraitConfigValue, ConfigFieldDeclaration } from "./trait.js";
import type { State, Transition, Event } from "./state-machine.js";
import type { Page } from "./page.js";
import type { Effect } from "./effect.js";
import type { SExpr, EvalContext, EventPayload } from "./expression.js";
import type { SchemaChange } from "./changeset.js";
import type { ValidationError, ValidationResult } from "./validation.js";
// Type-only import (erased at build): no runtime cycle even though factory/
// imports from types/. `AnnotationTier` is the documented superset of this.
import type { FactoryConfigTier } from "../factory/types.js";

// ============================================================================
// Semantic annotation (the NL → typed bridge)
// ============================================================================

/**
 * Decision-kind tier for the annotation layer. SUPERSET of the validator-
 * enforced `FactoryConfigTier` (`domain`/`policy`/`infra`/`presentation`/
 * `internal`), adding `essential` and `customization` for non-knob (event)
 * vertices that still carry the old vocabulary. Every `FactoryConfigTier`
 * value must be a member so `widenTier` stays a valid identity widen.
 */
export type AnnotationTier =
  | "essential"
  | "domain"
  | "policy"
  | "infra"
  | "presentation"
  | "customization"
  | "internal";

/** Widen a knob's `FactoryConfigTier` into the annotation-layer `AnnotationTier`. */
export function widenTier(tier: FactoryConfigTier): AnnotationTier {
  return tier;
}

/**
 * The natural-language metadata attached to every living vertex — the text that
 * gets embedded for `similar()`/`match_intent()`. Today these four members live
 * scattered inline across core types (`EntityField.description`/`synonyms`,
 * `Event`/`TraitEventContract`.`description`/`synonyms`/`tier`,
 * `FactoryConfigParam.label`/`description`/`synonyms`/`tier`); `SemanticAnnotation`
 * is the uniform bundle of them, generalized to every vertex.
 */
export interface SemanticAnnotation {
  description: string;
  synonyms: string[];
  label: string;
  tier: AnnotationTier;
}

// ============================================================================
// ML scalar/vector aliases
// ============================================================================

/**
 * A dense semantic embedding. In-memory form is `Float32Array`; the at-rest
 * JSON form (e.g. rabit's `knob-embeddings.json`) is `number[]`.
 */
export type SemanticVector = Float32Array;

/** A probability in `[0, 1]`. */
export type Probability = number;

/** Whether a semantic gate's transition is open, closed, or ~0.5 ambiguous. */
export type GateState = "open" | "closed" | "ambiguous";

// ============================================================================
// Graph vertex / edge typing
// ============================================================================

/** The typed vertex kinds of the living attributed graph (§II.1 `V_*`). */
export type VertexType =
  | "orbital"
  | "entity"
  | "trait"
  | "state"
  | "transition"
  | "page"
  | "field"
  | "event"
  | "effect"
  | "value";

/**
 * A stable, structural, embedding-independent vertex id (path style, e.g.
 * `orb:Cart/trt:AddItem/st:Open`). Re-embedding never changes it.
 */
export type VertexId = string;

/** The typed directed edge kinds of the living attributed graph (§II.1 `E_*`). */
export type EdgeType =
  | "belongs_to"
  | "has_trait"
  | "has_state"
  | "has_transition"
  | "from_state"
  | "to_state"
  | "on_event"
  | "emits"
  | "listens"
  | "cross_orbital"
  | "has_effect"
  | "effect_seq"
  | "data_flow"
  | "ref_in_effect"
  | "has_page"
  | "has_field"
  | "ref";

/**
 * An effect vertex's payload. Effects are positional S-expression tuples
 * (`Effect`), so the synthesized coordinates (operator, owning transition,
 * positional index) carry the addressing the raw tuple lacks.
 */
export interface EffectPayload {
  sexpr: Effect;
  operator: string;
  transitionId: VertexId;
  index: number;
}

/**
 * A config-knob vertex's payload — joins a `Trait.config` dict key with its
 * declaration (no single core type carries both).
 */
export interface KnobPayload {
  name: string;
  declaration: ConfigFieldDeclaration;
  traitId: VertexId;
}

/** The union of every kind of vertex payload (the existing structural types). */
export type VertexPayload =
  | OrbitalDefinition
  | Entity
  | Trait
  | State
  | Transition
  | Page
  | EntityField
  | Event
  | EffectPayload
  | KnobPayload;

/**
 * One vertex of the living graph: a structural payload plus its annotation and
 * embedding. Identity is `id` (structural); annotation/embedding are derived.
 */
export interface LivingVertex<P extends VertexPayload = VertexPayload> {
  id: VertexId;
  vtype: VertexType;
  payload: P;
  annotation: SemanticAnnotation;
  /** Lazily populated — undefined until the schema's `embed()` runs. */
  embedding?: SemanticVector;
}

export type LivingOrbital = LivingVertex<OrbitalDefinition>;
export type LivingEntity = LivingVertex<Entity>;
export type LivingTrait = LivingVertex<Trait>;
export type LivingState = LivingVertex<State>;
export type LivingTransition = LivingVertex<Transition>;
export type LivingPage = LivingVertex<Page>;
export type LivingField = LivingVertex<EntityField>;
export type LivingEvent = LivingVertex<Event>;
export type LivingEffect = LivingVertex<EffectPayload>;
export type LivingValue = LivingVertex<KnobPayload>;

/**
 * One directed edge. `via` carries the transition vertex for the ternary
 * `has_transition(from, via, to)` decomposition; `seq` carries the ordering for
 * `effect_seq`.
 */
export interface LivingEdge {
  etype: EdgeType;
  src: VertexId;
  dst: VertexId;
  via?: VertexId;
  seq?: number;
}

// ============================================================================
// Evolution + lineage (composes changeset.ts vocabulary)
// ============================================================================

/**
 * A single evolution step over the living graph. `modified` reuses the canonical
 * `SchemaChange` (changeset.ts) rather than inventing a parallel operation enum;
 * `intent` is the natural-language delta that caused the change.
 */
export interface EvolutionDelta {
  added: VertexId[];
  removed: VertexId[];
  modified: SchemaChange[];
  intent: string;
}

/** One immutable entry in a living schema's evolution lineage (§6.2). */
export interface LineageEntry {
  root: string;
  parent: string;
  delta: EvolutionDelta;
  intent: string;
  time: number;
  valid: boolean;
}

// ============================================================================
// Effect-simulation results
// ============================================================================

/** The result of simulating one effect's S-expression (§4.6) — pure, no I/O. */
export interface EffectResult {
  result: SExpr;
  sideEffects: string[];
  emittedEvents: string[];
}

// ============================================================================
// The living schema contract (§VIII) — implemented by masar (Python) + rabit (TS)
// ============================================================================

/**
 * The operation surface of a living orbital schema. This interface is the shared
 * CONTRACT; the numeric implementation (embedding, cosine, validator shelling)
 * is language-specific. `compile()` is the bridge back to the canonical
 * `OrbitalSchema` (the ML surface — annotations beyond `description`, embeddings,
 * gates — is stripped).
 */
export interface LivingOrbitalSchema {
  // Orbital container
  orbitals: LivingOrbital[];
  addOrbital(name: string): LivingOrbital;
  removeOrbital(name: string): void;
  getOrbital(name: string): LivingOrbital;

  // Semantic layer
  annotations: Map<VertexId, SemanticAnnotation>;
  embeddings: Map<VertexId, SemanticVector>;

  // Structural operations
  embed(): void;
  compile(): OrbitalSchema;
  validate(): ValidationResult;

  // Semantic retrieval
  similar(query: string | SemanticVector, k: number, type?: VertexType): LivingVertex[];
  matchIntent(intent: string, threshold?: number): { vertex: LivingVertex; score: number }[];

  // Predictive operations
  predictConfig(intent: string, trait: Trait): Record<string, TraitConfigValue>;
  predictPresence(intent: string): Set<string>;
  suggestOrbital(intent: string): LivingOrbital[];
  suggestEntity(intent: string): LivingEntity[];
  suggestTrait(intent: string): LivingTrait[];

  // Evolution
  evolve(intentDelta: string): LivingOrbitalSchema;
  compose(other: LivingOrbitalSchema): LivingOrbitalSchema;
  repair(errors: ValidationError[]): LivingOrbitalSchema;

  // Cross-orbital wiring
  wireEvents(source: LivingEvent, target: LivingEvent): void;
  findWiringGaps(): LivingEvent[];

  // Effect simulation
  simulateEffect(effect: LivingEffect, context: EvalContext): EffectResult;
  simulateInteraction(effect: LivingEffect, path: string[]): { event: LivingEvent; payload: EventPayload };
  traceDataFlow(transition: LivingTransition, inputEntity: LivingEntity): LivingEffect[];

  // Gates
  evaluateGates(intentEmbedding: SemanticVector): Map<VertexId, GateState[]>;
  sampleTrajectory(intentEmbedding: SemanticVector, steps: number): LivingVertex[];

  // Lineage
  lineage: LineageEntry[];
  checkout(hash: string): LivingOrbitalSchema;
  diff(hash1: string, hash2: string): EvolutionDelta;
}
