import { parseOrbitalTraits } from './chunk-SAS5KKCR.js';
import { findEntityAmongOrbitals, orbitalInlineEntities } from '@almadar/core';
import { createLogger } from '@almadar/logger';

var traitIndexLog = createLogger("almadar:runtime:trait-index");
var parseCache = /* @__PURE__ */ new WeakMap();
function parseOrbitalCached(orbital) {
  let cached = parseCache.get(orbital);
  if (cached === void 0) {
    cached = { traits: parseOrbitalTraits(orbital), entities: orbitalInlineEntities(orbital) };
    parseCache.set(orbital, cached);
  }
  return cached;
}
function buildTraitIndex(orbitals) {
  const parsed = orbitals.map((orbital) => ({ orbital, parsed: parseOrbitalCached(orbital).traits }));
  const allEntities = orbitals.map((orbital) => parseOrbitalCached(orbital).entities).flat();
  const orbitalsView = parsed.map(({ orbital, parsed: p }) => ({ schema: orbital, entity: p.entity }));
  const byName = /* @__PURE__ */ new Map();
  for (const { orbital, parsed: p } of parsed) {
    const { traits, inlineTraits, entity } = p;
    for (let i = 0; i < traits.length; i++) {
      const traitDef = traits[i];
      const irTrait = inlineTraits[i];
      const linkedEntityName = irTrait?.linkedEntity;
      let traitEntity = entity;
      if (linkedEntityName && linkedEntityName !== traitEntity.name) {
        const resolved = findEntityAmongOrbitals(allEntities, linkedEntityName);
        if (resolved) {
          traitEntity = resolved;
        } else {
          traitIndexLog.warn("linkedEntity:unresolved", {
            orbital: orbital.name,
            trait: traitDef.name,
            linkedEntityName
          });
          traitEntity = { name: linkedEntityName, fields: [] };
        }
      }
      const isShared = traitEntity.shared === true;
      byName.set(traitDef.name, {
        traitDef,
        irTrait,
        entity: traitEntity,
        orbitalName: orbital.name,
        ...orbital.id !== void 0 ? { orbitalId: orbital.id } : {},
        frameKey: isShared ? `$shared::${traitEntity.name}` : traitDef.name,
        isSharedEntity: isShared
      });
    }
  }
  return { byName, allEntities, orbitals: orbitalsView };
}

export { buildTraitIndex };
