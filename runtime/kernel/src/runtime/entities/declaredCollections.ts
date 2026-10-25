import type { Entity, PersistenceAdapter } from '@almadar/core';

/** Tells the store each server-persisted entity's declared `[persistent: tbl]` collection (EXEC-STORE-1). */
export function bindDeclaredCollections(store: PersistenceAdapter, entities: readonly Entity[]): void {
  for (const entity of entities) {
    if (entity.name && entity.collection && entity.browser !== true && entity.persistence !== 'runtime') {
      store.bindCollection?.(entity.name, entity.collection);
    }
  }
}
