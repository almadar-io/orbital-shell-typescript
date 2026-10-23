import { OrbitalDefinition, TraitIndex } from '@almadar/core';

/**
 * trait-index — build the per-trait evaluation index ONE time, for every
 * execution path.
 *
 * The index is the composition's view of a resolved schema: for each
 * trait, its flat `TraitDefinition` (the shape `processEvent` consumes),
 * its IR-level trait (payload schemas, `emits` contracts), its RESOLVED
 * linked entity (a trait's `linkedEntity` can name another orbital's
 * primary or an auxiliary entity — resolved against every orbital's
 * entities, never stubbed silently), its host orbital's name + V4 id
 * (emit stamping), and its entity-frame key (the `$shared::<entity>`
 * group key `OrbitalServerRuntime.sharedFieldKey` computes, resolved here
 * ONCE from the entity declaration's own `shared` flag instead of
 * re-walking per lookup).
 *
 * Consumers: the unified `evaluateOrbitalEvent` composition (both the
 * stateful server's session view and the stateless per-request handler's
 * compiled-behavior cache). Pure — no I/O, no instance state.
 *
 * @packageDocumentation
 */

/**
 * Build the trait index from a RESOLVED schema's orbitals (no `uses`
 * left to expand — the compiler's inline phase already ran). Pure derived
 * data: safe to cache per schema (the stateless deployment caches one
 * index per catalog behavior; the stateful server builds one per
 * registered orbital set).
 * A trait's config is the kernel's (`traitConfig`), never merged here.
 */
declare function buildTraitIndex(orbitals: readonly OrbitalDefinition[]): TraitIndex;

export { buildTraitIndex };
