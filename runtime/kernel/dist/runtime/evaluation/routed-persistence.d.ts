import { PersistenceAdapter } from '@almadar/core';

/**
 * One persistence over two stores: `stored` entities (a program's browser-stored ones) go to `stored`, every other entity to
 * `other`. The kernel reads and writes every entity through one adapter; a batch is one store's transaction, so it stays in one.
 */
declare function routeByEntity(storedEntities: ReadonlySet<string>, stored: PersistenceAdapter, other: PersistenceAdapter): PersistenceAdapter;

export { routeByEntity };
