import { unwrapTraitRef, normalizeCallSiteConfigToValues, isInlineTrait, isEntityCall } from '@almadar/core';

// src/runtime/traits/OrbitalTraitParsing.ts
function parseOrbitalTraits(orbital) {
  const configByTrait = /* @__PURE__ */ new Map();
  const unwrapped = (orbital.traits || []).map((t) => {
    const { trait, config } = unwrapTraitRef(t);
    const normalizedConfig = normalizeCallSiteConfigToValues(config);
    if (normalizedConfig && typeof trait !== "string" && isInlineTrait(trait) && trait.name) {
      configByTrait.set(trait.name, normalizedConfig);
    }
    return trait;
  });
  const inlineTraits = unwrapped.filter(isInlineTrait);
  const traits = inlineTraits.map((t) => {
    const sm = t.stateMachine;
    return {
      ...t.id !== void 0 ? { id: t.id } : {},
      name: t.name,
      states: sm?.states || [],
      transitions: sm?.transitions || [],
      listens: t.listens
    };
  });
  const entityRef = orbital.entity;
  let entity;
  if (typeof entityRef === "string") {
    entity = { name: entityRef, fields: [] };
  } else if (isEntityCall(entityRef)) {
    const fallbackName = entityRef.name ?? entityRef.extends.replace(/\.entity$/, "");
    entity = {
      name: fallbackName,
      fields: entityRef.fields ?? [],
      ...entityRef.persistence ? { persistence: entityRef.persistence } : {},
      ...entityRef.collection ? { collection: entityRef.collection } : {}
    };
  } else {
    entity = entityRef;
  }
  return { traits, inlineTraits, configByTrait, entity };
}

export { parseOrbitalTraits };
