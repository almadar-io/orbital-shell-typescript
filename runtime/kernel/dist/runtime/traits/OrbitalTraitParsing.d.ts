import { TraitDefinition, Trait, TraitConfig, Entity, OrbitalDefinition } from '@almadar/core';

/**
 * OrbitalTraitParsing — turn a resolved `OrbitalSchema.traits` array into the
 * `TraitDefinition[]` shape `processEvent` (`StateMachineCore.ts`) consumes.
 *
 * Extracted from `OrbitalServerRuntime.register()` (the trait-unwrap +
 * config-by-trait block) so a SECOND consumer — a stateless, per-request
 * transition handler that never instantiates the full stateful
 * `OrbitalServerRuntime` — can reuse the exact same parsing instead of a
 * second copy. `register()` now calls this too; behavior is unchanged.
 *
 * @packageDocumentation
 */

interface ParsedOrbitalTraits {
    /** Inline (unwrapped) traits, ready for `processEvent`. */
    traits: TraitDefinition[];
    /** The same traits at IR level (`@almadar/core` `Trait`) — `registered.traits`'s shape, kept for callers that need more than states/transitions/listens (e.g. `stateMachine.events` for payload validation). */
    inlineTraits: Trait[];
    /** Call-site `config` block per resolved trait name, from `uses` refs. */
    configByTrait: Map<string, TraitConfig>;
    /** The orbital's entity, resolved from a string ref / `EntityCall` / inline `Entity`. */
    entity: Entity;
}
/**
 * Parse `orbital.traits` (already-resolved — no `uses` left to expand) into
 * `TraitDefinition[]` + the call-site config map, and resolve `orbital.entity`
 * to a concrete `Entity`. Pure — no I/O, no instance state.
 */
declare function parseOrbitalTraits(orbital: OrbitalDefinition): ParsedOrbitalTraits;

export { type ParsedOrbitalTraits, parseOrbitalTraits };
