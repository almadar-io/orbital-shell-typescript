// src/runtime/evaluation/routed-persistence.ts
function pushedDown(method, name, entityType) {
  if (method === void 0) throw new Error(`${name} is not supported by the store that holds ${entityType}`);
  return method;
}
function routeByEntity(storedEntities, stored, other) {
  const of = (entityType) => storedEntities.has(entityType) ? stored : other;
  return {
    create: (entityType, data) => of(entityType).create(entityType, data),
    update: (entityType, id, data) => of(entityType).update(entityType, id, data),
    delete: (entityType, id) => of(entityType).delete(entityType, id),
    getById: (entityType, id) => of(entityType).getById(entityType, id),
    list: (entityType) => of(entityType).list(entityType),
    bindCollection: (entityType, collection) => of(entityType).bindCollection?.(entityType, collection),
    queryPage: (entityType, query) => pushedDown(of(entityType).queryPage, "queryPage", entityType).call(of(entityType), entityType, query),
    queryIds: (entityType, query) => pushedDown(of(entityType).queryIds, "queryIds", entityType).call(of(entityType), entityType, query),
    queryCapabilities: (entityType) => pushedDown(of(entityType).queryCapabilities, "queryCapabilities", entityType).call(of(entityType), entityType),
    writeCapabilities: (entityType) => pushedDown(of(entityType).writeCapabilities, "writeCapabilities", entityType).call(of(entityType), entityType),
    writeWhere: (op) => pushedDown(of(op.entityType).writeWhere, "writeWhere", op.entityType).call(of(op.entityType), op),
    writeBatch: async (batch) => {
      const homes = new Set(batch.ops.map((op) => of(op.entityType)));
      if (homes.size > 1) throw new Error("A batch spans the browser store and the in-memory rows; a batch runs in one store");
      const [home] = homes;
      if (home === void 0) return [];
      return pushedDown(home.writeBatch, "writeBatch", batch.ops[0]?.entityType ?? "").call(home, batch);
    }
  };
}

export { routeByEntity };
