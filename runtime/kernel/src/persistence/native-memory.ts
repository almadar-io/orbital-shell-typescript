import {
  EntityRowSchema,
  JsonValueSchema,
  QueryCapabilitiesSchema,
  RowIdPageSchema,
  RowQueryPageSchema,
  RowWriteOutcomeSchema,
  WriteCapabilitiesSchema,
  isJsonObject,
  type EntityRow,
  type KernelMemoryStoreWire,
  type PersistenceAdapter,
  type QueryCapabilities,
  type RowIdPage,
  type RowQuery,
  type RowQueryPage,
  type RowWriteBatch,
  type RowWriteOp,
  type RowWriteOutcome,
  type WriteCapabilities,
} from '@almadar/core';

export class NativeMemoryWriteError extends Error {
  constructor(readonly outcome: RowWriteOutcome) {
    super(`native memory update failed: ${outcome.kind}`);
    this.name = 'NativeMemoryWriteError';
  }
}

export class NativeMemoryPersistenceAdapter implements PersistenceAdapter {
  constructor(readonly store: KernelMemoryStoreWire) {}

  async getById(entityType: string, id: string): Promise<EntityRow | null> {
    return EntityRowSchema.nullable().parse(JSON.parse(this.store.getById(entityType, id)));
  }

  async list(entityType: string): Promise<EntityRow[]> {
    return EntityRowSchema.array().parse(JSON.parse(this.store.list(entityType)));
  }

  // The kernel's plain create merges a supplied existing id; writeWhere exposes strict create and replacement upsert.
  async create(entityType: string, data: EntityRow): Promise<{ id: string }> {
    const row = EntityRowSchema.parse(JSON.parse(this.store.create(entityType, JSON.stringify(data))));
    if (typeof row.id !== 'string') throw new Error('native memory create returned a row without an id');
    return { id: row.id };
  }

  async update(entityType: string, id: string, data: EntityRow): Promise<void> {
    const outcome = RowWriteOutcomeSchema.parse(JSON.parse(this.store.update(entityType, id, JSON.stringify(data))));
    if (outcome.kind !== 'updated') throw new NativeMemoryWriteError(outcome);
  }

  async delete(entityType: string, id: string): Promise<void> {
    this.store.delete(entityType, id);
  }

  async queryPage(entityType: string, query: RowQuery): Promise<RowQueryPage> {
    return RowQueryPageSchema.parse(JSON.parse(this.store.queryPage(entityType, JSON.stringify(query))));
  }

  async queryIds(entityType: string, query: RowQuery): Promise<RowIdPage> {
    return RowIdPageSchema.parse(JSON.parse(this.store.queryIds(entityType, JSON.stringify(query))));
  }

  queryCapabilities(_entityType: string): QueryCapabilities {
    return QueryCapabilitiesSchema.parse(JSON.parse(this.store.queryCapabilities()));
  }

  async writeWhere(op: RowWriteOp): Promise<RowWriteOutcome> {
    return RowWriteOutcomeSchema.parse(JSON.parse(this.store.writeWhere(JSON.stringify(op))));
  }

  async writeBatch(batch: RowWriteBatch): Promise<RowWriteOutcome[]> {
    return RowWriteOutcomeSchema.array().parse(JSON.parse(this.store.writeBatch(JSON.stringify(batch))));
  }

  writeCapabilities(_entityType: string): WriteCapabilities {
    return WriteCapabilitiesSchema.parse(JSON.parse(this.store.writeCapabilities()));
  }

  bindCollection(entityType: string, collection: string): void {
    this.store.bindCollection(entityType, collection);
  }

  clear(): void {
    this.store.clear();
  }

  snapshot(): Record<string, EntityRow[]> {
    const value = JsonValueSchema.parse(JSON.parse(this.store.snapshot()));
    if (!isJsonObject(value)) throw new Error('native memory snapshot returned a non-object');
    return Object.fromEntries(Object.entries(value).map(([key, rows]) => [key, EntityRowSchema.array().parse(rows)]));
  }
}
