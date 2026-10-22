import { describe, expect, it } from 'vitest';
import type { EntityRow, RowQuery } from '@almadar/core';
import { NativeMemoryPersistenceAdapter } from '../src/persistence/native-memory.js';

import { loadRealKernel } from './real-kernel.js';
const implementations = [
  { name: 'native Node', path: process.env.ORBITAL_KERNEL_NODE },
  { name: 'WASM', path: process.env.ORBITAL_KERNEL_MEMORY_WASM },
];

for (const implementation of implementations) {
  describe.skipIf(!implementation.path)(`native memory adapter (${implementation.name})`, () => {
    function adapter(): NativeMemoryPersistenceAdapter {
      if (!implementation.path) throw new Error('a real MemoryStore module path is required');
      const kernel = loadRealKernel(implementation.path);
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

    it('forwards native rekey ordering, collision winners and transaction outcomes', async () => {
      const store = adapter();
      expect(store.writeCapabilities('Task').rekey).toBe(true);
      store.bindCollection('Task', 'tasks');
      store.bindCollection('Alias', 'tasks');
      const a: EntityRow = { id: 'a', sourceOnly: true, createdAt: 'source-created', updatedAt: 'source-updated' };
      const b: EntityRow = { id: 'b', destinationOnly: true, createdAt: 'destination-created', updatedAt: 'destination-updated' };
      const middle: EntityRow = { id: 'middle', unchanged: true };
      const last: EntityRow = { id: 'last', unchanged: true };
      const moved: EntityRow = { ...a, id: 'b' };
      async function fill(rows: EntityRow[]): Promise<void> {
        store.clear();
        for (const row of rows) expect(await store.writeWhere({ kind: 'create', entityType: 'Task', data: row })).toEqual({ kind: 'created', row });
      }
      const cases = [
        { rows: [a, middle, last], expected: [moved, middle, last], winner: moved },
        { rows: [middle, a, last], expected: [middle, moved, last], winner: moved },
        { rows: [middle, last, a], expected: [middle, last, moved], winner: moved },
        { rows: [a, middle, b], expected: [b, middle], winner: b },
        { rows: [b, middle, a], expected: [moved, middle], winner: moved },
      ];
      for (const control of cases) {
        await fill(control.rows);
        expect(await store.writeWhere({ kind: 'rekey', entityType: 'Alias', id: 'a', newId: 'b' })).toEqual({ kind: 'updated', row: control.winner });
        expect(await store.list('Task')).toEqual(control.expected);
        expect(await store.getById('Alias', 'a')).toBeNull();
      }
      await fill([a, middle]);
      expect(await store.writeWhere({ kind: 'rekey', entityType: 'Task', id: 'a', newId: 'a', guard: { kind: 'const', value: true } })).toEqual({ kind: 'updated', row: a, before: a });
      expect(await store.list('Task')).toEqual([a, middle]);
      expect(await store.writeWhere({ kind: 'rekey', entityType: 'Task', id: 'missing', newId: 'b' })).toEqual({ kind: 'not-found' });
      expect(await store.writeWhere({ kind: 'rekey', entityType: 'Task', id: 'a', newId: 'b', guard: { kind: 'const', value: false } })).toEqual({ kind: 'refused' });
      expect(await store.writeWhere({ kind: 'rekey', entityType: 'Task', id: 'a', newId: '' })).toMatchObject({ kind: 'failed' });
      expect(() => store.store.writeWhere(JSON.stringify({ kind: 'rekey', entityType: 'Task', id: 'a', newId: 12 }))).toThrow();
      expect(await store.list('Task')).toEqual([a, middle]);
      const ordered = await store.writeBatch({ onFailure: 'atomic', ops: [
        { kind: 'update', entityType: 'Task', id: 'a', data: { beforeMove: true } },
        { kind: 'rekey', entityType: 'Alias', id: 'a', newId: 'b' },
        { kind: 'update', entityType: 'Task', id: 'b', data: { afterMove: true } },
      ] });
      expect(ordered.map((outcome) => outcome.kind)).toEqual(['updated', 'updated', 'updated']);
      expect(await store.list('Alias')).toEqual([{ ...moved, beforeMove: true, afterMove: true }, middle]);
      for (const onFailure of ['atomic', 'stop'] as const) {
        await fill([a, middle]);
        const outcomes = await store.writeBatch({ onFailure, ops: [
          { kind: 'rekey', entityType: 'Task', id: 'a', newId: 'b' },
          { kind: 'update', entityType: 'Alias', id: 'missing', data: { ignored: true } },
          { kind: 'delete', entityType: 'Task', id: 'middle' },
        ] });
        expect(outcomes.map((outcome) => outcome.kind)).toEqual([onFailure === 'atomic' ? 'rolled-back' : 'updated', 'not-found']);
        expect(await store.list('Task')).toEqual(onFailure === 'atomic' ? [a, middle] : [moved, middle]);
      }
      console.info(`memory:rekey passed (${implementation.name}): native ordering/collisions/timestamps/aliases, guards and atomic/stop outcomes`);
    });
    it('raw admission refuses null optional guards before any batch prefix writes', () => {
      const raw = adapter().store;
      raw.create('Task', JSON.stringify({ id: 'a', title: 'initial' }));
      const before = raw.snapshot();
      const operations = [
        { kind: 'update', entityType: 'Task', id: 'a', data: { title: 'changed' }, guard: null },
        { kind: 'delete', entityType: 'Task', id: 'a', guard: null },
        { kind: 'rekey', entityType: 'Task', id: 'a', newId: 'b', guard: null },
      ];
      for (const operation of operations) {
        expect(() => raw.writeWhere(JSON.stringify(operation))).toThrow();
        expect(raw.snapshot()).toBe(before);
        expect(() => raw.writeBatch(JSON.stringify({ onFailure: 'stop', ops: [
          { kind: 'create', entityType: 'Task', data: { id: 'prefix' } }, operation,
        ] }))).toThrow();
        expect(raw.snapshot()).toBe(before);
      }
      expect(JSON.parse(raw.writeWhere(JSON.stringify({ kind: 'update', entityType: 'Task', id: 'a', data: { title: 'valid' } })))).toMatchObject({ kind: 'updated' });
    });

    it('raw admission distinguishes missing required nullable compare values from present null', () => {
      const raw = adapter().store;
      raw.create('Task', JSON.stringify({ id: 'a', nullable: null }));
      const before = raw.snapshot();
      const missingValue = { kind: 'compare', field: 'nullable', op: '==' };
      for (const guard of [missingValue, { kind: 'not', of: missingValue }]) {
        const operation = { kind: 'update', entityType: 'Task', id: 'a', data: { changed: true }, guard };
        expect(() => raw.writeWhere(JSON.stringify(operation))).toThrow();
        expect(raw.snapshot()).toBe(before);
        expect(() => raw.writeBatch(JSON.stringify({ onFailure: 'stop', ops: [
          { kind: 'create', entityType: 'Task', data: { id: 'prefix' } }, operation,
        ] }))).toThrow();
        expect(raw.snapshot()).toBe(before);
      }
      expect(JSON.parse(raw.writeWhere(JSON.stringify({ kind: 'update', entityType: 'Task', id: 'a', data: { changed: true }, guard: { ...missingValue, value: null } })))).toEqual({ kind: 'refused' });
    });

    it('raw admission refuses nonstring fixed ids across create update writeWhere and writeBatch', () => {
      const raw = adapter().store;
      raw.create('Task', JSON.stringify({ id: 'a', title: 'initial' }));
      const before = raw.snapshot();
      for (const id of [null, 1, false, [1], { bad: true }]) {
        const data = { id, title: 'invalid' };
        expect(() => raw.create('Task', JSON.stringify(data))).toThrow();
        expect(raw.snapshot()).toBe(before);
        expect(() => raw.update('Task', 'a', JSON.stringify(data))).toThrow();
        expect(raw.snapshot()).toBe(before);
        for (const kind of ['create', 'upsert', 'update']) {
          const operation = { kind, entityType: 'Task', id: 'a', data };
          expect(() => raw.writeWhere(JSON.stringify(operation))).toThrow();
          expect(raw.snapshot()).toBe(before);
          expect(() => raw.writeBatch(JSON.stringify({ onFailure: 'stop', ops: [
            { kind: 'create', entityType: 'Task', data: { id: 'prefix' } }, operation,
          ] }))).toThrow();
          expect(raw.snapshot()).toBe(before);
        }
      }
      expect(JSON.parse(raw.create('Task', JSON.stringify({ title: 'generated' })))).toMatchObject({ title: 'generated' });
      expect(JSON.parse(raw.update('Task', 'a', JSON.stringify({ title: 'valid' })))).toMatchObject({ kind: 'updated' });
    });
  });
}
