import { instancesForLocale, type EntityRow, type OrbitalEntity, type PersistenceAdapter, RowWriteBatch, RowWriteOp, RowWriteOutcome } from '@almadar/core';
import type { ChangeRecord } from '@almadar/shell-browser/storage';
import type { KernelModule } from '../../lib/kernel-wire.js';
import { nativeMemoryPersistence } from './native-memory.js';

/** Where a browser keeps rows between visits: it stores and returns whole rows, and answers no query. */
export interface BrowserDatabase extends Pick<PersistenceAdapter, 'create' | 'delete' | 'list'> {
  /** The write log: empty only for a database no visit has written to. */
  changes(): Promise<readonly ChangeRecord[]>;
}

/**
 * Browser-stored rows held in the kernel's native memory store, persisted to the browser database: the kernel answers every
 * read and query by its own row predicates and decides every write; the database only receives the rows the kernel kept.
 */
export async function persistedMemory(kernel: KernelModule, database: BrowserDatabase, entities: readonly OrbitalEntity[], locale?: string): Promise<PersistenceAdapter> {
  const memory = nativeMemoryPersistence(kernel);
  const firstVisit = (await database.changes()).length === 0;
  for (const entity of entities) {
    if (firstVisit) {
      for (const row of instancesForLocale(entity, locale)) await database.create(entity.name, row);
    }
    for (const row of await database.list(entity.name)) {
      await memory.writeWhere({ kind: 'upsert', entityType: entity.name, data: row });
    }
  }

  const keep = async (entityType: string, row: EntityRow): Promise<void> => {
    await database.create(entityType, row);
  };
  const mirror = async (op: RowWriteOp, outcome: RowWriteOutcome): Promise<void> => {
    if (outcome.kind === 'created') await keep(op.entityType, outcome.row);
    else if (outcome.kind === 'updated') {
      if (op.kind === 'rekey') await database.delete(op.entityType, op.id);
      await keep(op.entityType, outcome.row);
    } else if (outcome.kind === 'deleted' && op.kind !== 'create' && op.kind !== 'upsert') await database.delete(op.entityType, op.id);
  };

  return {
    getById: (entityType, id) => memory.getById(entityType, id),
    list: (entityType) => memory.list(entityType),
    queryPage: (entityType, query) => memory.queryPage(entityType, query),
    queryIds: (entityType, query) => memory.queryIds(entityType, query),
    queryCapabilities: (entityType) => memory.queryCapabilities(entityType),
    writeCapabilities: (entityType) => memory.writeCapabilities(entityType),
    bindCollection: (entityType, collection) => memory.bindCollection(entityType, collection),
    async create(entityType, data) {
      const { id } = await memory.create(entityType, data);
      const row = await memory.getById(entityType, id);
      if (row !== null) await keep(entityType, row);
      return { id };
    },
    async update(entityType, id, data) {
      await memory.update(entityType, id, data);
      const row = await memory.getById(entityType, id);
      if (row !== null) await keep(entityType, row);
    },
    async delete(entityType, id) {
      await memory.delete(entityType, id);
      await database.delete(entityType, id);
    },
    async writeWhere(op) {
      const outcome = await memory.writeWhere(op);
      await mirror(op, outcome);
      return outcome;
    },
    async writeBatch(batch: RowWriteBatch) {
      const outcomes = await memory.writeBatch(batch);
      for (const [index, op] of batch.ops.entries()) {
        const outcome = outcomes[index];
        if (outcome !== undefined) await mirror(op, outcome);
      }
      return outcomes;
    },
  };
}
