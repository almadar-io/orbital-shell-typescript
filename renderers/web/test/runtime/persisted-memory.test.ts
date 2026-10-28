import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { RowQuery } from '@almadar/core';
import { IndexedDbPersistence } from '@almadar/shell-browser/storage';
import type { OrbitalEntity } from '@almadar/core';
import { persistedMemory } from '../../src/runtime/evaluation/persisted-memory';
import { loadTestKernel } from '../../src/test-support/kernel-engine';

const invoice: OrbitalEntity = { name: 'Invoice', persistence: 'persistent', collection: 'invoices', browser: true, fields: [{ name: 'id', type: 'string', required: true }] };
const all: RowQuery = { offset: 0, limit: 10, total: 'exact' };
const open = (name: string) => IndexedDbPersistence.open({ databaseName: name, entityTypes: ['Invoice'] });

describe('persistedMemory', () => {
  it('serves queries from the kernel store, hydrated from the browser database, and persists writes across a reopen', async () => {
    const kernel = await loadTestKernel();
    const name = `pm-${Math.random()}`;
    const first = await open(name);
    await first.create('Invoice', { id: 'a', client: 'Noor', amount: 5 });
    const store = await persistedMemory(kernel, first, [invoice]);

    expect((await store.queryPage?.('Invoice', { ...all, filter: { kind: 'compare', field: 'amount', op: '>', value: 1 } }))?.rows).toHaveLength(1);
    expect(store.queryCapabilities?.('Invoice')).toBeDefined();
    await store.create('Invoice', { id: 'b', client: 'Bled', amount: 9 });
    await store.update('Invoice', 'a', { client: 'Noor 2' });
    await store.writeWhere?.({ kind: 'upsert', entityType: 'Invoice', data: { id: 'c', client: 'Koz', amount: 1 } });
    await store.writeWhere?.({ kind: 'rekey', entityType: 'Invoice', id: 'c', newId: 'd' });
    await store.delete('Invoice', 'b');
    first.close();

    const second = await open(name);
    const rows = await second.list('Invoice');
    expect(rows.map((row) => row.id).sort()).toEqual(['a', 'd']);
    expect(rows.find((row) => row.id === 'a')).toMatchObject({ client: 'Noor 2' });
    const reopened = await persistedMemory(kernel, second, [invoice]);
    expect((await reopened.queryPage?.('Invoice', all))?.rows).toHaveLength(2);
    second.close();
  });

  it('control: a write the kernel refuses is not persisted', async () => {
    const kernel = await loadTestKernel();
    const database = await open(`pm-${Math.random()}`);
    const store = await persistedMemory(kernel, database, [invoice]);
    await store.writeWhere?.({ kind: 'create', entityType: 'Invoice', data: { id: 'a', client: 'one' } });
    const outcome = await store.writeWhere?.({ kind: 'create', entityType: 'Invoice', data: { id: 'a', client: 'two' } });
    expect(outcome?.kind).toBe('duplicate-id');
    expect(await database.list('Invoice')).toMatchObject([{ id: 'a', client: 'one' }]);
    database.close();
  });

  it('a first visit starts with the declared instances of the viewer locale, and a later visit does not seed again', async () => {
    const kernel = await loadTestKernel();
    const name = `pm-${Math.random()}`;
    const seeded: OrbitalEntity = { ...invoice, instances: [{ id: 'en-1', client: 'Noor' }], localeInstances: { ar: [{ id: 'ar-1', client: 'نور' }] } };
    const first = await open(name);
    const store = await persistedMemory(kernel, first, [seeded], 'ar');
    expect((await store.list('Invoice')).map((row) => row.id)).toEqual(['ar-1']);
    await store.delete('Invoice', 'ar-1');
    first.close();

    const second = await open(name);
    const again = await persistedMemory(kernel, second, [seeded], 'ar');
    expect(await again.list('Invoice')).toEqual([]);
    second.close();
  });
});
