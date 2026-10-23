/**
 * `seedBrowserStore` — the one seed rule for browser-stored entities (`[persistent: x, local]`): an EMPTY store gets the
 * rows the native `std-mock-seed` program answers for the viewer's locale; rows the user already has are never
 * overwritten. The program is scripted here; the sampler is pinned by its own goldens.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import type { EmittedEvent, EventPayload, OrbitalEntity, OrbitalEventRequest, OrbitalEventResponse } from '@almadar/core';
import { IndexedDbPersistence } from '@almadar/shell-browser/storage';
import { seedBrowserStore } from '../../src/runtime/entities/seedBrowserStore';
import { StdMockSeed, type MockSeedEngine } from '../../src/runtime/entities/std-mock-seed';
import { writableRows } from '../helpers/persistence.js';

const fields = [
  { name: 'id', type: 'string' as const, required: true },
  { name: 'client', type: 'string' as const },
  { name: 'amount', type: 'number' as const },
];

function invoice(extra: Partial<OrbitalEntity>): OrbitalEntity {
  return { name: 'Invoice', persistence: 'persistent', collection: 'invoices', local: true, fields, ...extra };
}

const journal = { viewerId: '', stamped: [], deferred: [] };
const run = { nowMs: 1000 };

function scripted(rows: Array<Record<string, string | number>>): { host: { seeder: StdMockSeed; nowMs: number }; asked: Array<{ event: string; payload: EventPayload }> } {
  const asked: Array<{ event: string; payload: EventPayload }> = [];
  const done: EmittedEvent = { event: 'DATASET_DONE', payload: { stores: { invoices: rows }, journal }, source: { orbital: 'MockSeedOrbital', trait: 'MockSeed' } };
  const engine: MockSeedEngine = {
    async evaluate(_orbital: string, request: OrbitalEventRequest): Promise<OrbitalEventResponse> {
      asked.push({ event: request.event, payload: request.payload ?? {} });
      return { success: true, transitioned: true, states: {}, emittedEvents: [done] };
    },
  };
  return { host: { seeder: new StdMockSeed(engine, { count: 6, seed: 1, defaultPersona: '', restampOnPersona: false }), ...run }, asked };
}

describe('seedBrowserStore', () => {
  it('writes the rows the program answers into an empty browser store', async () => {
    const store = await IndexedDbPersistence.open({ databaseName: 'seed-browser-1', entityTypes: ['Invoice'] });
    const { host, asked } = scripted([{ id: 'INV-1', client: 'Noor', amount: 4200 }]);
    await seedBrowserStore(store, [invoice({})], undefined, host);
    expect(await store.list('Invoice')).toMatchObject([{ id: 'INV-1', client: 'Noor', amount: 4200 }]);
    expect(asked.map((a) => a.event)).toEqual(['DATASET_INPUT']);
  });

  it('asks for the viewer locale', async () => {
    const store = await IndexedDbPersistence.open({ databaseName: 'seed-browser-2', entityTypes: ['Invoice'] });
    const { host, asked } = scripted([{ id: 'INV-1', client: 'نور', amount: 1 }]);
    await seedBrowserStore(store, [invoice({})], 'ar', host);
    expect(asked[0]?.payload).toMatchObject({ locale: 'ar' });
  });

  it('control: a store that already has rows is left alone and the program is not asked', async () => {
    const store = await IndexedDbPersistence.open({ databaseName: 'seed-browser-3', entityTypes: ['Invoice'] });
    await store.create('Invoice', { id: 'mine', client: 'me', amount: 1 });
    const { host, asked } = scripted([{ id: 'INV-1', client: 'Noor', amount: 4200 }]);
    await seedBrowserStore(store, [invoice({})], undefined, host);
    expect((await store.list('Invoice')).map((r) => r.id)).toEqual(['mine']);
    expect(asked).toEqual([]);
  });

  it('control: server-stored entities are not seeded into the browser store', async () => {
    const store = writableRows();
    const { host, asked } = scripted([{ id: 'INV-1', client: 'x', amount: 1 }]);
    await seedBrowserStore(store, [invoice({ local: false })], undefined, host);
    expect(await store.list('Invoice')).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('seeds an empty in-memory store by the same rule', async () => {
    const store = writableRows();
    const { host } = scripted([{ id: 'INV-1', client: 'Noor', amount: 4200 }]);
    await seedBrowserStore(store, [invoice({})], undefined, host);
    expect((await store.list('Invoice')).map((r) => r.id)).toEqual(['INV-1']);
  });
});
