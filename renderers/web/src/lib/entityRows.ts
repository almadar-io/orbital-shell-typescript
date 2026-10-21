import type { EntityRow } from '@almadar/core';

/**
 * The rows a collection display renders. A bound `@entity` reaches a display
 * as either the fetched collection or — before the fetch lands, on an instance
 * trait's first paint — a single row, so every collection display reads its
 * `entity` prop through this one normalizer.
 */
export function entityRows(entity: EntityRow | readonly EntityRow[] | null | undefined): readonly EntityRow[] {
  if (isRowList(entity)) return entity;
  return entity ? [entity] : [];
}

function isRowList(entity: EntityRow | readonly EntityRow[] | null | undefined): entity is readonly EntityRow[] {
  return Array.isArray(entity);
}
