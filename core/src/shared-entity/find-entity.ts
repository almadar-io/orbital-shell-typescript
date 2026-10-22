import type { Entity } from '../types/entity.js';

/** The entity named `name` among a set of orbitals' own resolved entities. */
export function findEntityAmongOrbitals(
  entities: Iterable<Entity | undefined>,
  name: string,
): Entity | undefined {
  for (const entity of entities) {
    if (entity?.name === name) return entity;
  }
  return undefined;
}
