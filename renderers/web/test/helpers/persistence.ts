import type { EntityRow, PersistenceAdapter } from '@almadar/core';
import { NativeMemoryPersistenceAdapter } from '@almadar/shell-runtime/persistence/native-memory';
import { nativeMemoryPersistence } from '../../src/runtime/evaluation/native-memory.js';
import { loadTestKernel } from '../../src/test-support/kernel-engine.js';

/** A row store the kernel holds itself (its native `MemoryStore`), as a host keeps rows with no database. */
export async function nativeMemory(): Promise<NativeMemoryPersistenceAdapter> {
  const kernel = await loadTestKernel();
  return nativeMemoryPersistence(kernel);
}

const unused = (method: string) => (): never => { throw new Error(`the host store was not expected to be asked: ${method}`); };

/** A store a test must never reach: every row ask fails loudly. */
export function untouchedPersistence(): PersistenceAdapter {
  return {
    getById: unused('getById'),
    list: unused('list'),
    create: unused('create'),
    update: unused('update'),
    delete: unused('delete'),
  };
}

/** A fixed set of rows a test hands the host, with the deletes it makes; no query or write semantics of its own. */
export function fixtureRows(entityType: string, rows: readonly EntityRow[]): PersistenceAdapter {
  const held = new Map(rows.map((row) => [String(row.id), row]));
  return {
    getById: async (type, id) => (type === entityType ? held.get(id) ?? null : null),
    list: async (type) => (type === entityType ? [...held.values()] : []),
    create: unused('create'),
    update: unused('update'),
    delete: async (type, id) => { if (type === entityType) held.delete(id); },
  };
}

/** An in-process row store with the write semantics a seed applies (upsert, update, rekey), needing no kernel. */
export function writableRows(): PersistenceAdapter & { writeWhere: NonNullable<PersistenceAdapter['writeWhere']> } {
  const tables = new Map<string, EntityRow[]>();
  const rowsOf = (entityType: string): EntityRow[] => tables.get(entityType) ?? [];
  return {
    async create(entityType, data) {
      tables.set(entityType, [...rowsOf(entityType), data]);
      return { id: String(data.id) };
    },
    async update() {},
    async delete() {},
    async getById(entityType, id) {
      return rowsOf(entityType).find((row) => row.id === id) ?? null;
    },
    async list(entityType) {
      return rowsOf(entityType);
    },
    async writeWhere(op) {
      const rows = rowsOf(op.entityType);
      if (op.kind === 'upsert') {
        tables.set(op.entityType, [...rows.filter((row) => row.id !== op.data.id), op.data]);
        return { kind: 'created', row: op.data };
      }
      if (op.kind === 'update' || op.kind === 'rekey') {
        const found = rows.find((row) => row.id === op.id);
        if (found === undefined) return { kind: 'not-found' };
        const row = op.kind === 'update' ? { ...found, ...op.data } : { ...found, id: op.newId };
        tables.set(op.entityType, rows.map((r) => (r.id === op.id ? row : r)));
        return { kind: 'updated', row };
      }
      return { kind: 'failed', message: `writableRows does not apply ${op.kind}` };
    },
  };
}
