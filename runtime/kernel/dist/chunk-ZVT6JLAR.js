// src/runtime/entities/seedBrowserStore.ts
async function isEmpty(store, entityType) {
  return store.countRows ? await store.countRows(entityType) === 0 : (await store.list(entityType)).length === 0;
}
async function seedBrowserStore(store, entities, locale, host) {
  const empty = [];
  for (const entity of entities) {
    if (entity.local === true && await isEmpty(store, entity.name)) empty.push(entity);
  }
  if (empty.length === 0) return;
  const program = {
    name: "BrowserStoreSeed",
    orbitals: empty.map((entity, index) => ({ name: `BrowserStore${index}`, entity, traits: [], pages: [] }))
  };
  await host.seeder.dataset(program, { nowMs: host.nowMs, ...locale !== void 0 ? { locale } : {} });
}

export { seedBrowserStore };
