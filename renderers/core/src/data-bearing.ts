import type { OrbitalDefinition } from './types/orbital.js';
import type { SExpr } from './types/expression.js';
import type { TypedEffect } from './types/effect.js';
import { isInlineTrait } from './types/trait.js';

function touchesRecord(effect: TypedEffect | SExpr, name: string): boolean {
  if (!Array.isArray(effect)) return false;
  if (effect[0] === 'fetch' && effect[1] === name) return true;
  if (effect[0] === 'persist' && effect[2] === name) return true;
  for (const item of effect) {
    if (Array.isArray(item) && touchesRecord(item, name)) return true;
  }
  return false;
}

/** True when the orbital's own inline traits fetch or persist its primary record. */
export function orbitalTouchesOwnRecord(orbital: OrbitalDefinition): boolean {
  const entity = orbital.entity;
  const name = typeof entity === 'object' && entity !== null && 'name' in entity ? entity.name : undefined;
  if (typeof name !== 'string') return false;
  return (orbital.traits ?? []).some((trait) =>
    isInlineTrait(trait) && (trait.stateMachine?.transitions ?? []).some((t) => (t.effects ?? []).some((e) => touchesRecord(e, name))),
  );
}
