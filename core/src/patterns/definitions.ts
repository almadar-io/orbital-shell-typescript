import patternsRegistryJson from './patterns-registry.json' with { type: 'json' };
import type { PatternEntry, PatternsRegistry } from './index.js';

/**
 * The full pattern registry (descriptions, enum lists, recommender hints). Built as its own entry so
 * a client bundle that never calls into it never carries it: running clients read the slim
 * `./runtime-contract.js`. Designers, validators and prompt builders import from here.
 */
export const patternsRegistry: PatternsRegistry = patternsRegistryJson as PatternsRegistry;

export const registry: PatternsRegistry = patternsRegistry;

export const PATTERN_REGISTRY: PatternsRegistry = patternsRegistry;

export function getPatternDefinition(patternType: string): PatternEntry | null {
  return patternsRegistry.patterns?.[patternType] ?? null;
}
