/**
 * The one mock-store seed both JS hosts of a mock program run. The native `std-mock-seed` program decides the rows,
 * the owner columns and who owns them, and writes them through the kernel; this module binds the declared collections
 * and hands the program the app's resolved schema.
 *
 * @packageDocumentation
 */
import type { Entity, OrbitalSchema, PersistenceAdapter, UserContext } from '@almadar/core';
import { orbitalInlineEntities, personaFromIdentityRow } from '@almadar/core';
import { identityEntitiesOf } from '@almadar/core/mock';
import { createLogger } from '@almadar/logger';
import { readSeededStores, type SeedOwnerJournal, type StdMockSeed } from './std-mock-seed.js';

const log = createLogger('almadar:shell-web:mock-seed');

export interface MockSeedHost {
  /** The kernel running the std seed program. */
  seeder: StdMockSeed;
  persistence: PersistenceAdapter;
  /** The clock mock dates and seed stamps resolve against, in epoch milliseconds. */
  nowMs: number;
}

export interface MockSeedViewer {
  /** Whether the host named the viewer; when it did not, the viewer is the declared `defaultPersona` (anonymous when none). */
  namedByHost: boolean;
  /** The viewer at evaluation time. */
  current: () => UserContext | undefined;
  /** Whether the `[identity]` entity (the persona roster) seeds now; a host that seeds it elsewhere passes false. */
  seedIdentity: boolean;
}

export interface MockSeeded {
  viewer: UserContext | undefined;
  /** The owner cells the seed stamped, kept for a later persona restamp. */
  journal: SeedOwnerJournal;
}

/** Tells the store each server-persisted entity's declared `[persistent: tbl]` collection (EXEC-STORE-1). */
export function bindDeclaredCollections(store: PersistenceAdapter, entities: readonly Entity[]): void {
  for (const entity of entities) {
    if (entity.name && entity.collection && entity.browser !== true && entity.persistence !== 'runtime') {
      store.bindCollection?.(entity.name, entity.collection);
    }
  }
}

/**
 * A whole program's mock store, seeded for the viewer. A named viewer owns the rows from the first seed; otherwise
 * the roster seeds unstamped and the viewer is the identity row the declared `defaultPersona` names, whose tracked
 * owner cells restamp to it; with no `defaultPersona` the viewer is anonymous and nothing restamps.
 */
export async function seedMockStore(host: MockSeedHost, schema: OrbitalSchema, viewer: MockSeedViewer): Promise<MockSeeded> {
  bindDeclaredCollections(host.persistence, schema.orbitals.flatMap(orbitalInlineEntities));
  const named = viewer.namedByHost ? viewer.current() : undefined;
  const dataset = await host.seeder.dataset(schema, { nowMs: host.nowMs, ...(named !== undefined ? { viewerId: named.id } : {}) });
  if (viewer.namedByHost) return { viewer: named, journal: dataset.journal };
  const declared = host.seeder.config.defaultPersona;
  if (declared === '') return { viewer: undefined, journal: dataset.journal };
  const identity = identityEntitiesOf(schema.orbitals)[0];
  const row = identity?.collection !== undefined ? (dataset.stores[identity.collection] ?? []).find((r) => r.id === declared) : undefined;
  const resolved = row === undefined ? undefined : personaFromIdentityRow(row);
  if (resolved === undefined) throw new Error(`std-mock-seed: defaultPersona ${declared} names no ${identity?.name ?? 'identity'} row of the seeded dataset`);
  const restamp = await host.seeder.restamp(schema, dataset.stores, dataset.journal, resolved, true);
  log.debug('seeded', { identity: identity?.name, viewer: resolved.id, changes: restamp.changes.length });
  return { viewer: resolved, journal: restamp.journal };
}

/** Re-point the seeded owner cells at `user` after a persona switch; the rows are the store's current ones. */
export async function restampMockOwner(host: MockSeedHost, schema: OrbitalSchema, journal: SeedOwnerJournal, user: UserContext): Promise<SeedOwnerJournal> {
  const stores = await readSeededStores(host.persistence, schema);
  const restamp = await host.seeder.restamp(schema, stores, journal, user, false);
  return restamp.journal;
}
