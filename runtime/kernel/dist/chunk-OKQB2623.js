import { readSeededStores } from './chunk-HMK6YMQS.js';
import { orbitalInlineEntities, personaFromIdentityRow } from '@almadar/core';
import { identityEntitiesOf } from '@almadar/core/mock';
import { createLogger } from '@almadar/logger';

var log = createLogger("almadar:shell-web:mock-seed");
function bindDeclaredCollections(store, entities) {
  for (const entity of entities) {
    if (entity.name && entity.collection && entity.local !== true && entity.persistence !== "runtime") {
      store.bindCollection?.(entity.name, entity.collection);
    }
  }
}
async function seedMockStore(host, schema, viewer) {
  bindDeclaredCollections(host.persistence, schema.orbitals.flatMap(orbitalInlineEntities));
  const named = viewer.namedByHost ? viewer.current() : void 0;
  const dataset = await host.seeder.dataset(schema, { nowMs: host.nowMs, ...named !== void 0 ? { viewerId: named.id } : {} });
  if (viewer.namedByHost) return { viewer: named, journal: dataset.journal };
  const declared = host.seeder.config.defaultPersona;
  if (declared === "") return { viewer: void 0, journal: dataset.journal };
  const identity = identityEntitiesOf(schema.orbitals)[0];
  const row = identity?.collection !== void 0 ? (dataset.stores[identity.collection] ?? []).find((r) => r.id === declared) : void 0;
  const resolved = row === void 0 ? void 0 : personaFromIdentityRow(row);
  if (resolved === void 0) throw new Error(`std-mock-seed: defaultPersona ${declared} names no ${identity?.name ?? "identity"} row of the seeded dataset`);
  const restamp = await host.seeder.restamp(schema, dataset.stores, dataset.journal, resolved, true);
  log.debug("seeded", { identity: identity?.name, viewer: resolved.id, changes: restamp.changes.length });
  return { viewer: resolved, journal: restamp.journal };
}
async function restampMockOwner(host, schema, journal, user) {
  const stores = await readSeededStores(host.persistence, schema);
  const restamp = await host.seeder.restamp(schema, stores, journal, user, false);
  return restamp.journal;
}

export { bindDeclaredCollections, restampMockOwner, seedMockStore };
