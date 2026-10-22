/**
 * Pattern-swap compatibility — the deterministic shape gate for a contextual
 * pattern swap. A swap keeps the circuit closed when the replacement shares the
 * current pattern's entity-inlet cardinality and can emit the events the
 * consumer's trait listens for. Semantic ranking (which compatible pattern best
 * matches the user's instruction) is the embedding step, layered on top of this
 * gate — never the other way around.
 */

import { patternsRegistry } from '../definitions.js';
import eventContracts from '../event-contracts.json' with { type: 'json' };
import type { PatternPropDef } from '../types.js';

interface PatternsFile {
  patterns?: Record<string, { propsSchema?: Record<string, PatternPropDef> }>;
}

interface EventContractsFile {
  contracts?: Record<string, { emits?: Array<{ event?: string }> }>;
}

const PATTERNS = patternsRegistry as PatternsFile;
const CONTRACTS = eventContracts as EventContractsFile;

function entityInlet(patternType: string): PatternPropDef | null {
  const propsSchema = PATTERNS.patterns?.[patternType]?.propsSchema;
  if (!propsSchema) return null;
  for (const prop of Object.values(propsSchema)) {
    if (prop.kind === 'entity') return prop;
  }
  return propsSchema['entity'] ?? null;
}

/** The data-inlet cardinality of a pattern (`record`/`collection`), or `null`
 *  when the pattern has no entity inlet (layout / leaf patterns). */
export function getEntityCardinality(patternType: string): 'record' | 'collection' | null {
  return entityInlet(patternType)?.cardinality ?? null;
}

/** Events a pattern emits, from its declared event-outlet contract. */
export function getEmittedEvents(patternType: string): string[] {
  const emits = CONTRACTS.contracts?.[patternType]?.emits ?? [];
  const out: string[] = [];
  for (const e of emits) {
    if (typeof e.event === 'string') out.push(e.event);
  }
  return out;
}

export interface PatternSwapGate {
  /** Events the replacement MUST be able to emit (the trait's listened set), so
   *  handlers still fire after the swap. Omit to skip the outlet gate. */
  requiredEmits?: readonly string[];
}

/**
 * Pattern types a `currentType` node can be swapped to while keeping the circuit
 * closed: same entity-inlet cardinality, and — when `requiredEmits` is given —
 * able to emit every required event. Deterministic and unranked; the caller
 * ranks the result semantically (embeddings).
 */
export function findCompatiblePatterns(currentType: string, gate: PatternSwapGate = {}): string[] {
  const cardinality = getEntityCardinality(currentType);
  const required = gate.requiredEmits ?? [];
  const result: string[] = [];
  for (const type of Object.keys(PATTERNS.patterns ?? {})) {
    if (type === currentType) continue;
    if (getEntityCardinality(type) !== cardinality) continue;
    if (required.length > 0) {
      const emits = new Set(getEmittedEvents(type));
      if (!required.every((ev) => emits.has(ev))) continue;
    }
    result.push(type);
  }
  return result;
}
