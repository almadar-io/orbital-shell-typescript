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
import {
  orbitalInlineEntities,
  type BusEventSource,
  type Entity,
  type OrbitalDefinition,
  type Trait,
} from '@almadar/core';
import { createLogger } from '@almadar/logger';
import { parseOrbitalTraits } from './OrbitalTraitParsing.js';
import type { IndexedTrait, TraitDefinition, TraitIndex } from "@almadar/core";
import { findEntityAmongOrbitals, tickEventKey } from '@almadar/core';

const traitIndexLog = createLogger('almadar:runtime:trait-index');

/**
 * Parse cache: `parseOrbitalTraits`/`orbitalInlineEntities` are pure
 * functions of the schema object, and the stateful host builds a
 * per-orbital view over EVERY registered orbital (catalog servers hold
 * ~1.5k) — without memoization the first event per orbital re-parses the
 * whole registry. Keyed by schema identity: a re-registered orbital is a
 * fresh object and re-parses.
 */
const parseCache = new WeakMap<OrbitalDefinition, { traits: ReturnType<typeof parseOrbitalTraits>; entities: Entity[] }>();

function parseOrbitalCached(orbital: OrbitalDefinition): { traits: ReturnType<typeof parseOrbitalTraits>; entities: Entity[] } {
  let cached = parseCache.get(orbital);
  if (cached === undefined) {
    cached = { traits: parseOrbitalTraits(orbital), entities: orbitalInlineEntities(orbital) };
    parseCache.set(orbital, cached);
  }
  return cached;
}

/**
 * Build the trait index from a RESOLVED schema's orbitals (no `uses`
 * left to expand — the compiler's inline phase already ran). Pure derived
 * data: safe to cache per schema (the stateless deployment caches one
 * index per catalog behavior; the stateful server builds one per
 * registered orbital set).
 * A trait's config is the kernel's (`traitConfig`), never merged here.
 */
export function buildTraitIndex(
  orbitals: readonly OrbitalDefinition[],
): TraitIndex {
  const parsed = orbitals.map((orbital) => ({ orbital, parsed: parseOrbitalCached(orbital).traits }));
  const allEntities = orbitals.map((orbital) => parseOrbitalCached(orbital).entities).flat();
  const orbitalsView = parsed.map(({ orbital, parsed: p }) => ({ schema: orbital, entity: p.entity }));
  const byName = new Map<string, IndexedTrait>();

  for (const { orbital, parsed: p } of parsed) {
    const { traits, inlineTraits, entity } = p;
    for (let i = 0; i < traits.length; i++) {
      const traitDef = traits[i];
      const irTrait = inlineTraits[i];
      const linkedEntityName = irTrait?.linkedEntity;
      // A trait's own linkedEntity may differ from its host orbital's
      // top-level entity (a composed sub-orbital can bind a different
      // entity, including another orbital's primary or an auxiliary) —
      // resolve against every orbital's entities; only stub (and warn)
      // when genuinely not found anywhere, which indicates a real schema
      // issue rather than the common cross-orbital case.
      let traitEntity = entity;
      if (linkedEntityName && linkedEntityName !== traitEntity.name) {
        const resolved = findEntityAmongOrbitals(allEntities, linkedEntityName);
        if (resolved) {
          traitEntity = resolved;
        } else {
          traitIndexLog.warn('linkedEntity:unresolved', {
            orbital: orbital.name,
            trait: traitDef.name,
            linkedEntityName,
          });
          traitEntity = { name: linkedEntityName, fields: [] as Entity['fields'] };
        }
      }
      const isShared = traitEntity.shared === true;
      byName.set(traitDef.name, {
        traitDef,
        irTrait: irTrait as Trait,
        entity: traitEntity,
        orbitalName: orbital.name,
        ...(orbital.id !== undefined ? { orbitalId: orbital.id as BusEventSource['orbitalId'] } : {}),
        frameKey: isShared ? `$shared::${traitEntity.name}` : traitDef.name,
        isSharedEntity: isShared,
      });
    }
  }
  return { byName, allEntities, orbitals: orbitalsView };
}
