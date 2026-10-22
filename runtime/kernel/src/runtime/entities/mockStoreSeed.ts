/**
 * The one mock-store seed both JS hosts of a mock program run: `OrbitalServerRuntime` in mock mode and the
 * plugin host's local kernel (`OrbitalPluginHost`). It is the JS twin of `seed.rs` `seed_sample_data_as` and the
 * compiled `seedMockData.ts`: the `[identity]` entity seeds first (its rows are the persona roster), the owner
 * columns come from that entity, the `@create`/`@read` policies gate who owns a seeded row, and the owner cells
 * are stamped for the viewer, so an "only mine" view of the dev viewer has rows.
 *
 * @packageDocumentation
 */
import type { Entity, OrbitalDefinition, OrbitalSchema, PersistenceAdapter, UserContext } from '@almadar/core';
import { applyRowAccess, checkMutationAccess, isEntityCall, personaFromIdentityRow, resolveDefaultViewer } from '@almadar/core';
import { entityAccessPoliciesByStoreKey, identityEntitiesOf, identityEntityName, ownerFieldsFromSchema } from '@almadar/core/mock';
import { stampSeedTimestamps, type MockPersistenceAdapter } from '@almadar/db/mock';
import { createLogger } from '@almadar/logger';
import { parseOrbitalTraits } from '../traits/OrbitalTraitParsing.js';

const log = createLogger('almadar:shell-web:mock-seed');

/**
 * Install the schema's access policies as the seeder's owner gates. `@create` decides who may author a row
 * (`viewer()` is read at evaluation time, so one installation covers every persona switch); `@read` decides a
 * column it scopes by ownership. Also installed by the compiled apps' `MockDataService`.
 */
export function installPolicyOwnerGates(
  adapter: MockPersistenceAdapter,
  schema: OrbitalSchema,
  viewer: () => UserContext | undefined,
): void {
  const policiesByStore = entityAccessPoliciesByStoreKey(schema);
  adapter.setOwnerGate((storeKey, candidateRow) => {
    const user = viewer();
    if (!user) return true;
    return checkMutationAccess('create', candidateRow, policiesByStore.get(storeKey)?.create, { user }, storeKey);
  });
  // A row without a usable identity id fails closed rather than evaluating as anonymous.
  adapter.setOwnerCandidateGate((storeKey, candidateRow, candidateIdentityRow) => {
    const persona = personaFromIdentityRow(candidateIdentityRow);
    if (!persona) return false;
    return checkMutationAccess('create', candidateRow, policiesByStore.get(storeKey)?.create, { user: persona }, storeKey);
  });
  adapter.setOwnerReadGate((storeKey, candidateRow, candidateIdentityRow) => {
    const read = policiesByStore.get(storeKey)?.read;
    const persona = personaFromIdentityRow(candidateIdentityRow);
    if (read === undefined || !persona) return false;
    return applyRowAccess([candidateRow], read, undefined, { user: persona }, storeKey).length === 1;
  });
}

export interface MockSeedViewer {
  /** Whether the host named the viewer; when it did not, the viewer is the app's first declared persona. */
  namedByHost: boolean;
  /** The viewer at evaluation time, read by the owner gates. */
  current: () => UserContext | undefined;
  /** Seed the `[identity]` entity (the persona roster) now; a host that only gates a store it seeds elsewhere passes false. */
  seedIdentity: boolean;
}

/** The `[identity]` entity's generated rows: the persona roster. */
export function seedMockIdentity(store: MockPersistenceAdapter, schema: OrbitalSchema): void {
  const identity = identityEntitiesOf(schema.orbitals ?? [])[0];
  if (!identity?.name || !identity.fields) return;
  if (identity.instances && identity.instances.length > 0) return;
  store.registerEntity({
    name: identity.name,
    id: identity.id,
    collection: identity.collection,
    fields: identity.fields.filter((f): f is typeof f & { name: string } => typeof f.name === 'string' && f.name.length > 0),
    persistence: identity.persistence,
    identity: true,
  });
}

/**
 * Everything the seeder needs before the first entity seeds: the owner columns derived from the `[identity]`
 * entity, the owner gates, and the `[identity]` entity itself. Returns the viewer the rows are stamped for: the
 * host's when it named one, else the app's first declared persona.
 */
export function prepareMockSeeding(store: MockPersistenceAdapter, schema: OrbitalSchema, viewer: MockSeedViewer): UserContext | undefined {
  const derived = ownerFieldsFromSchema(schema);
  if (derived.length > 0) {
    store.addOwnerFields(derived);
    log.debug('identity-owner-fields', { identity: identityEntityName(schema), columns: derived });
  }
  installPolicyOwnerGates(store, schema, viewer.current);
  // A named viewer owns the rows from the first seed; otherwise the roster seeds unstamped, then stamps for its first persona.
  store.restampOwner(viewer.namedByHost ? viewer.current()?.id : undefined);
  if (viewer.seedIdentity) seedMockIdentity(store, schema);
  if (viewer.namedByHost) return viewer.current();
  const identity = identityEntitiesOf(schema.orbitals ?? [])[0]?.name;
  const roster = identity
    ? store.rowsOf(identity).map((row) => personaFromIdentityRow(row)).filter((p): p is UserContext => p !== undefined)
    : [];
  const resolved = resolveDefaultViewer(roster);
  store.restampOwner(resolved.id);
  return resolved;
}

/** Create an entity's written-out `instances`; a no-op for an entity that declares none. */
export async function seedEntityInstances(store: PersistenceAdapter, entity: Entity): Promise<void> {
  const instances = entity.instances ?? [];
  if (instances.length === 0) return;
  const seededAt = new Date().toISOString();
  let seeded = 0;
  await Promise.all(instances.map(async (instance) => {
    try {
      await store.create(entity.name, stampSeedTimestamps(instance, seededAt));
      seeded += 1;
    } catch (err) {
      log.error('instance-error', { entity: entity.name, id: instance.id, error: err instanceof Error ? err : String(err) });
    }
  }));
  log.debug('instances', { entity: entity.name, success: seeded, total: instances.length });
}

/** Tells the store each server-persisted entity's declared `[persistent: tbl]` collection (EXEC-STORE-1). */
export function bindDeclaredCollections(store: PersistenceAdapter, entities: readonly Entity[]): void {
  for (const entity of entities) {
    if (entity.name && entity.collection && entity.local !== true && entity.persistence !== 'runtime') {
      store.bindCollection?.(entity.name, entity.collection);
    }
  }
}

function inlineAuxiliaryEntities(orbital: OrbitalDefinition): Entity[] {
  return (orbital.auxiliaryEntities ?? []).filter((ref): ref is Entity => typeof ref !== 'string' && !isEntityCall(ref));
}

/** One entity's generated rows. */
export function registerMockEntity(store: MockPersistenceAdapter, entity: Entity): void {
  if (!entity.name || !entity.fields) return;
  store.registerEntity({
    name: entity.name,
    id: entity.id,
    collection: entity.collection,
    fields: entity.fields.filter((f): f is typeof f & { name: string } => typeof f.name === 'string' && f.name.length > 0),
    persistence: entity.persistence,
    identity: entity.identity,
  });
  log.debug('seeded', { entity: entity.name, count: store.count(entity.name) });
}

/**
 * One orbital's rows in a mock store: its entity's `instances` when it writes some out, else generated rows
 * (a browser-stored entity only when it declares `mock`), then its inline auxiliary entities (imported atom
 * entities a trait reference surfaced without a rebind).
 */
export async function seedMockOrbital(store: MockPersistenceAdapter, orbital: OrbitalDefinition): Promise<void> {
  const { entity } = parseOrbitalTraits(orbital);
  const auxiliary = inlineAuxiliaryEntities(orbital);
  bindDeclaredCollections(store, [entity, ...auxiliary]);
  if (entity.instances !== undefined && Array.isArray(entity.instances)) {
    await seedEntityInstances(store, entity);
  } else if (entity.local !== true || entity.seedMock === true) {
    registerMockEntity(store, entity);
  }
  for (const aux of auxiliary) {
    if (aux.local === true && aux.seedMock !== true) continue;
    registerMockEntity(store, aux);
  }
}

/** A whole program's mock store, seeded for the viewer: `prepareMockSeeding`, then every orbital in order. */
export async function seedMockStore(store: MockPersistenceAdapter, schema: OrbitalSchema, viewer: MockSeedViewer): Promise<UserContext | undefined> {
  const seededFor = prepareMockSeeding(store, schema, viewer);
  for (const orbital of schema.orbitals) await seedMockOrbital(store, orbital);
  return seededFor;
}
