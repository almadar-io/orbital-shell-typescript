import { EntityRowSchema, RowWriteOutcomeSchema, RowQueryPageSchema, RowIdPageSchema, QueryCapabilitiesSchema, WriteCapabilitiesSchema, JsonValueSchema, isJsonObject } from '@almadar/core';

// src/persistence/native-memory.ts
var NativeMemoryWriteError = class extends Error {
  constructor(outcome) {
    super(`native memory update failed: ${outcome.kind}`);
    this.outcome = outcome;
    this.name = "NativeMemoryWriteError";
  }
  outcome;
};
var NativeMemoryPersistenceAdapter = class {
  constructor(store) {
    this.store = store;
  }
  store;
  async getById(entityType, id) {
    return EntityRowSchema.nullable().parse(JSON.parse(this.store.getById(entityType, id)));
  }
  async list(entityType) {
    return EntityRowSchema.array().parse(JSON.parse(this.store.list(entityType)));
  }
  // The kernel's plain create merges a supplied existing id; writeWhere exposes strict create and replacement upsert.
  async create(entityType, data) {
    const row = EntityRowSchema.parse(JSON.parse(this.store.create(entityType, JSON.stringify(data))));
    if (typeof row.id !== "string") throw new Error("native memory create returned a row without an id");
    return { id: row.id };
  }
  async update(entityType, id, data) {
    const outcome = RowWriteOutcomeSchema.parse(JSON.parse(this.store.update(entityType, id, JSON.stringify(data))));
    if (outcome.kind !== "updated") throw new NativeMemoryWriteError(outcome);
  }
  async delete(entityType, id) {
    this.store.delete(entityType, id);
  }
  async queryPage(entityType, query) {
    return RowQueryPageSchema.parse(JSON.parse(this.store.queryPage(entityType, JSON.stringify(query))));
  }
  async queryIds(entityType, query) {
    return RowIdPageSchema.parse(JSON.parse(this.store.queryIds(entityType, JSON.stringify(query))));
  }
  queryCapabilities(_entityType) {
    return QueryCapabilitiesSchema.parse(JSON.parse(this.store.queryCapabilities()));
  }
  async writeWhere(op) {
    return RowWriteOutcomeSchema.parse(JSON.parse(this.store.writeWhere(JSON.stringify(op))));
  }
  async writeBatch(batch) {
    return RowWriteOutcomeSchema.array().parse(JSON.parse(this.store.writeBatch(JSON.stringify(batch))));
  }
  writeCapabilities(_entityType) {
    return WriteCapabilitiesSchema.parse(JSON.parse(this.store.writeCapabilities()));
  }
  bindCollection(entityType, collection) {
    this.store.bindCollection(entityType, collection);
  }
  clear() {
    this.store.clear();
  }
  snapshot() {
    const value = JsonValueSchema.parse(JSON.parse(this.store.snapshot()));
    if (!isJsonObject(value)) throw new Error("native memory snapshot returned a non-object");
    return Object.fromEntries(Object.entries(value).map(([key, rows]) => [key, EntityRowSchema.array().parse(rows)]));
  }
};

export { NativeMemoryPersistenceAdapter, NativeMemoryWriteError };
