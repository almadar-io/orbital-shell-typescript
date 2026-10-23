/**
 * The one seed rule for browser-stored entities (`[persistent: x, local]`): an EMPTY store gets the rows the native
 * `std-mock-seed` program selects for the viewer's locale (the entity's written-out rows, or generated rows when it
 * declares `mock`), written by that program through the kernel. Rows the user already has are never overwritten.
 */
import type { OrbitalEntity, PersistenceAdapter, OrbitalSchema } from '@almadar/core';
import type { MockSeedRun, StdMockSeed } from './std-mock-seed.js';

export interface BrowserSeedHost extends Pick<MockSeedRun, 'nowMs'> {
  seeder: StdMockSeed;
}

async function isEmpty(store: PersistenceAdapter, entityType: string): Promise<boolean> {
  return store.countRows ? (await store.countRows(entityType)) === 0 : (await store.list(entityType)).length === 0;
}

export async function seedBrowserStore(store: PersistenceAdapter, entities: readonly OrbitalEntity[], locale: string | undefined, host: BrowserSeedHost): Promise<void> {
  const empty: OrbitalEntity[] = [];
  for (const entity of entities) {
    if (entity.local === true && (await isEmpty(store, entity.name))) empty.push(entity);
  }
  if (empty.length === 0) return;
  const program: OrbitalSchema = {
    name: 'BrowserStoreSeed',
    orbitals: empty.map((entity, index) => ({ name: `BrowserStore${index}`, entity, traits: [], pages: [] })),
  };
  await host.seeder.dataset(program, { nowMs: host.nowMs, ...(locale !== undefined ? { locale } : {}) });
}
