/**
 * The per-trait evaluation index contract: a trait's flat definition and the
 * resolved index a host builds over a schema's orbitals. Types only — the
 * builder lives in `@almadar/runtime`.
 */
import type { BusEventSource } from './bus.js';
import type { Entity } from './entity.js';
import type { EventId, TraitId } from './identity.js';
import type { OrbitalDefinition } from './orbital.js';
import type { SExpr } from './expression.js';
import type { Trait, TraitEventListener } from './trait.js';

/** Minimal trait definition for state machine processing. */
export interface TraitDefinition {
    /** V4 dual-carry id sibling of `name` — the stable state-machine lookup
     *  key when present (ledger-backed). Absent → keyed by name (legacy). */
    id?: TraitId;
    name: string;
    states: Array<{ name: string; isInitial?: boolean }>;
    transitions: Array<{
        from: string | string[];
        to: string;
        event: string;
        /** V4 dual-carry id sibling of `event` — optional until the Phase-7 flip. */
        eventId?: EventId;
        guard?: SExpr;
        effects?: SExpr[];
        /** Compensating transition when effects fail (RCG-04) */
        onEffectError?: {
            to: string;
            effects?: SExpr[];
        };
    }>;
    /** Cross-trait event listeners (optional). */
    listens?: TraitEventListener[];
}

/** One trait's fully-resolved evaluation entry. */
export interface IndexedTrait {
  /** Flat shape `processEvent`/`runTraitCascade` consume. */
  traitDef: TraitDefinition;
  /** IR-level trait — `stateMachine.events[].payloadSchema`, `emits[]`. */
  irTrait: Trait;
  /** The trait's RESOLVED linked entity (cross-orbital/auxiliary aware). */
  entity: Entity;
  /** Host orbital's declared name (emit stamping, bus keys). */
  orbitalName: string;
  /** Host orbital's V4 id (emit stamping), when the schema carries one. */
  orbitalId?: BusEventSource['orbitalId'];
  /**
   * The entity-frame key: `$shared::<entityName>` when the linked entity
   * is declared `[shared]` (every trait bound to it shares ONE frame),
   * else the trait's own name.
   */
  frameKey: string;
  /** The linked entity's declared `shared` flag (render-binding deferral). */
  isSharedEntity: boolean;
}

export interface TraitIndex {
  byName: Map<string, IndexedTrait>;
  /** Every orbital's primary + auxiliary entities (persistence routing, entity lookups). */
  allEntities: Entity[];
  /** The source orbitals with their resolved primary entities. */
  orbitals: Array<{ schema: OrbitalDefinition; entity: Entity }>;
}
