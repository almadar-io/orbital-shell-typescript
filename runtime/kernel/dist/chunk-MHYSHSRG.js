import { isInlineTrait } from '@almadar/core';

// src/runtime/effects/composition/event-wiring.ts
function findInlineTrait(orbitals, name) {
  for (const orbital of orbitals) {
    for (const traitRef of orbital.traits) {
      if (isInlineTrait(traitRef) && traitRef.name === name) {
        return traitRef;
      }
    }
  }
  return null;
}
function hasEmit(emits, event) {
  return emits.some((e) => e.event === event);
}
function hasListen(listens, event, triggers) {
  return listens.some((l) => l.event === event && l.triggers === triggers);
}
function applyEventWiring(orbitals, wiring) {
  const cloned = JSON.parse(
    JSON.stringify(orbitals)
  );
  for (const entry of wiring) {
    const sourceTrait = findInlineTrait(cloned, entry.from);
    if (sourceTrait) {
      if (!sourceTrait.emits) {
        sourceTrait.emits = [];
      }
      if (!hasEmit(sourceTrait.emits, entry.event)) {
        sourceTrait.emits.push({
          event: entry.event,
          scope: "external"
        });
      }
    }
    const targetTrait = findInlineTrait(cloned, entry.to);
    if (targetTrait) {
      if (!targetTrait.listens) {
        targetTrait.listens = [];
      }
      if (!hasListen(targetTrait.listens, entry.event, entry.triggers)) {
        targetTrait.listens.push({
          event: entry.event,
          triggers: entry.triggers,
          scope: "external"
        });
      }
    }
  }
  return cloned;
}

export { applyEventWiring };
