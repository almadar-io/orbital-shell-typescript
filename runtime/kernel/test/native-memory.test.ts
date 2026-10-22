import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { KernelMemoryStoreExports, RowQuery } from '@almadar/core';
import { NativeMemoryPersistenceAdapter } from '../src/persistence/native-memory.js';

const require = createRequire(import.meta.url);
const implementations = [
  { name: 'native Node', path: process.env.ORBITAL_KERNEL_NODE },
  { name: 'WASM', path: process.env.ORBITAL_KERNEL_MEMORY_WASM },
];

for (const implementation of implementations) {
  describe.skipIf(!implementation.path)(`native memory adapter (${implementation.name})`, () => {
    function adapter(): NativeMemoryPersistenceAdapter {
      if (!implementation.path) throw new Error('a real MemoryStore module path is required');
      const kernel: KernelMemoryStoreExports = require(implementation.path);
      return new NativeMemoryPersistenceAdapter(new kernel.MemoryStore());
    }

    it('uses collection aliases and preserves native create merging', async () => {
      const store = adapter();
      store.bindCollection('Task', 'tasks');
      store.bindCollection('OtherTask', 'tasks');
      expect(await store.create('Task', { id: 'a', title: 'first', kept: true })).toEqual({ id: 'a' });
      await store.create('Task', { id: 'a', title: 'second' });
      expect(await store.getById('OtherTask', 'a')).toMatchObject({ id: 'a', title: 'second', kept: true });
      expect(await store.getById('Task', 'missing')).toBeNull();
      expect(store.snapshot().tasks).toHaveLength(1);
      await store.delete('Task', 'a');
      expect(await store.list('OtherTask')).toEqual([]);
    });

    it('retains explicit strict-create and replacement-upsert outcomes', async () => {
      const store = adapter();
      await store.create('Task', { id: 'a', old: true });
      expect(await store.writeWhere({ kind: 'create', entityType: 'Task', data: { id: 'a' } })).toEqual({ kind: 'duplicate-id' });
      expect(await store.writeWhere({ kind: 'upsert', entityType: 'Task', data: { id: 'a', title: 'replacement' } })).toMatchObject({ kind: 'updated' });
      expect(await store.getById('Task', 'a')).not.toHaveProperty('old');
      await expect(store.update('Task', 'missing', { title: 'x' })).rejects.toMatchObject({ outcome: { kind: 'not-found' } });
      await store.update('Task', 'a', { title: 'updated' });
      expect(await store.getById('Task', 'a')).toMatchObject({ title: 'updated' });
    });

    it('delegates policy/filter intersection, pagination and ids to the kernel', async () => {
      const store = adapter();
      await store.create('Task', { id: 'a', owner: 'alice', rank: 1 });
      await store.create('Task', { id: 'b', owner: 'alice', rank: 2 });
      await store.create('Task', { id: 'c', owner: 'bob', rank: 3 });
      const query: RowQuery = {
        policy: { kind: 'compare', field: 'owner', op: '==', value: 'alice' },
        filter: { kind: 'compare', field: 'rank', op: '>=', value: 1 },
        order: { field: 'rank', direction: 'desc' },
        limit: 1,
      };
      expect(await store.queryPage('Task', query)).toMatchObject({ rows: [{ id: 'b' }], total: 2 });
      expect(await store.queryIds('Task', query)).toEqual({ ids: ['b'], total: 2 });
      expect(await store.queryIds('Task', { ...query, filter: { kind: 'const', value: false } })).toEqual({ ids: [], total: 0 });
      expect(store.queryCapabilities('Task').idsOnly).toBe(true);
      expect(store.writeCapabilities('Task').atomicBatch).toBe(true);
    });

    it('preserves guard refusal and atomic rollback without partial rows', async () => {
      const store = adapter();
      await store.create('Task', { id: 'existing', owner: 'alice' });
      expect(await store.writeWhere({ kind: 'delete', entityType: 'Task', id: 'existing', guard: { kind: 'const', value: false } })).toEqual({ kind: 'refused' });
      expect(await store.writeBatch({ onFailure: 'atomic', ops: [
        { kind: 'create', entityType: 'Task', data: { id: 'new' } },
        { kind: 'create', entityType: 'Task', data: { id: 'existing' } },
      ] })).toEqual([{ kind: 'rolled-back' }, { kind: 'duplicate-id' }]);
      expect(await store.getById('Task', 'new')).toBeNull();
      expect(await store.getById('Task', 'existing')).toMatchObject({ owner: 'alice' });
      store.clear();
      expect(await store.list('Task')).toEqual([]);
    });
  });
}
