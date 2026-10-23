/**
 * `seedMockStore` — the one mock-store seed `OrbitalServerRuntime` (mock mode) and `OrbitalPluginHost` run: the native
 * `std-mock-seed` program decides the rows and the owner stamps, and the host writes them. The `[identity]` roster
 * seeds first, and the owner cells are stamped for the viewer, so the dev viewer's "only mine" list has rows. The
 * program is scripted here (its sampler and restamp rules are pinned by its own goldens); these cases pin what the host
 * does with the answers.
 */
import { describe, expect, it } from 'vitest';
import type { EmittedEvent, EntityRow, EventPayload, OrbitalEventRequest, OrbitalEventResponse, OrbitalSchema, UserContext } from '@almadar/core';
import { seedMockStore } from '../../src/runtime/entities/mockStoreSeed';
import { StdMockSeed, type MockSeedEngine } from '../../src/runtime/entities/std-mock-seed';
import { writableRows } from '../helpers/persistence.js';

function notesApp(identity: boolean): OrbitalSchema {
  return {
    name: 'notes',
    orbitals: [
      {
        name: 'People',
        entity: {
          name: 'Person', persistence: 'persistent', collection: 'people', ...(identity ? { identity: true } : {}),
          fields: [{ name: 'id', type: 'string', required: true }, { name: 'name', type: 'string' }, { name: 'role', type: 'string' }],
        },
        traits: [],
        pages: [],
      },
      {
        name: 'Notes',
        entity: {
          name: 'Note', persistence: 'persistent', collection: 'notes',
          fields: [{ name: 'id', type: 'string', required: true }, { name: 'title', type: 'string' }, { name: 'owner', type: 'relation', relation: { entity: 'Person' } }],
        },
        traits: [],
        pages: [],
      },
    ],
  };
}

const people: EntityRow[] = [{ id: 'p1', name: 'Ada', role: 'admin' }, { id: 'p2', name: 'Bo', role: 'member' }];
const notes: EntityRow[] = [{ id: 'n1', title: 'one', owner: '' }, { id: 'n2', title: 'two', owner: '' }, { id: 'n3', title: 'three', owner: '' }];
const journal = { viewerId: '', stamped: [], deferred: [] };
const run = { nowMs: 1000 };
const declared = (defaultPersona: string) => ({ count: 6, seed: 1, defaultPersona, restampOnPersona: false });

interface Asked { event: string; payload: EventPayload }

function scripted(answers: Record<string, EmittedEvent[]>): { engine: MockSeedEngine; asked: Asked[] } {
  const asked: Asked[] = [];
  const engine: MockSeedEngine = {
    async evaluate(_orbital: string, request: OrbitalEventRequest): Promise<OrbitalEventResponse> {
      asked.push({ event: request.event, payload: request.payload ?? {} });
      return { success: true, transitioned: true, states: {}, emittedEvents: answers[request.event] ?? [] };
    },
  };
  return { engine, asked };
}

function emitted(event: string, payload: EventPayload): EmittedEvent {
  return { event, payload, source: { orbital: 'MockSeedOrbital', trait: 'MockSeed' } };
}

function setOwner(id: string, ownerId: string) {
  return { kind: 'set', store: 'notes', id, column: 'owner', ownerId };
}

const ownedBy = (rows: EntityRow[], id: string | undefined) => rows.filter((row) => row['owner'] === id);

describe('seedMockStore', () => {
  it('seeds the [identity] persona roster and stamps owner rows for the declared defaultPersona, the dev viewer', async () => {
    const { engine, asked } = scripted({
      DATASET_INPUT: [emitted('DATASET_DONE', { stores: { people, notes }, journal })],
      RESTAMP_INPUT: [emitted('RESTAMP_DONE', { journal, changes: [setOwner('n1', 'p1'), setOwner('n2', 'p1')] })],
    });
    const store = writableRows();
    const { viewer } = await seedMockStore({ seeder: new StdMockSeed(engine, declared('p1')), persistence: store, ...run }, notesApp(true), { namedByHost: false, current: () => undefined, seedIdentity: true });
    const roster = await store.list('Person');
    expect(roster.length).toBeGreaterThan(1);
    expect(viewer?.id).toBe('p1');
    expect(asked.map((a) => a.event)).toEqual(['DATASET_INPUT', 'RESTAMP_INPUT']);
    expect(asked[1]?.payload).toMatchObject({ viewer: { id: 'p1', name: 'Ada', role: 'admin' } });
    expect(ownedBy(await store.list('Note'), viewer?.id).length).toBeGreaterThan(0);
  });

  it("control: another persona of the roster does not see the dev viewer's rows as its own", async () => {
    const { engine } = scripted({
      DATASET_INPUT: [emitted('DATASET_DONE', { stores: { people, notes }, journal })],
      RESTAMP_INPUT: [emitted('RESTAMP_DONE', { journal, changes: [setOwner('n1', 'p1'), setOwner('n2', 'p1')] })],
    });
    const store = writableRows();
    const { viewer } = await seedMockStore({ seeder: new StdMockSeed(engine, declared('p1')), persistence: store, ...run }, notesApp(true), { namedByHost: false, current: () => undefined, seedIdentity: true });
    const rows = await store.list('Note');
    const other = (await store.list('Person')).map((row) => row['id']).find((id) => id !== viewer?.id);
    expect(typeof other).toBe('string');
    const mine = new Set(ownedBy(rows, viewer?.id).map((row) => row['id']));
    expect(ownedBy(rows, typeof other === 'string' ? other : undefined).some((row) => mine.has(row['id']))).toBe(false);
    expect(mine.size).toBeLessThan(rows.length);
  });

  it('a viewer the host named owns the stamped rows instead of the declared persona, and no restamp is asked', async () => {
    const named: UserContext = { id: 'host-viewer', name: 'Host' };
    const stamped = notes.map((row) => ({ ...row, owner: 'host-viewer' }));
    const { engine, asked } = scripted({ DATASET_INPUT: [emitted('DATASET_DONE', { stores: { people, notes: stamped }, journal })] });
    const store = writableRows();
    const { viewer } = await seedMockStore({ seeder: new StdMockSeed(engine, declared('p1')), persistence: store, ...run }, notesApp(true), { namedByHost: true, current: () => named, seedIdentity: true });
    expect(viewer).toEqual(named);
    expect(asked.map((a) => a.event)).toEqual(['DATASET_INPUT']);
    expect(asked[0]?.payload).toMatchObject({ viewerId: 'host-viewer' });
    expect(ownedBy(await store.list('Note'), 'host-viewer').length).toBeGreaterThan(0);
  });

  it('control: a program with no [identity] entity derives no owner column and stamps nothing', async () => {
    const { engine, asked } = scripted({
      DATASET_INPUT: [emitted('DATASET_DONE', { stores: { people, notes }, journal })],
      RESTAMP_INPUT: [emitted('RESTAMP_DONE', { journal, changes: [] })],
    });
    const store = writableRows();
    const { viewer } = await seedMockStore({ seeder: new StdMockSeed(engine, declared('')), persistence: store, ...run }, notesApp(false), { namedByHost: false, current: () => undefined, seedIdentity: true });
    expect(asked[0]?.payload).toMatchObject({ ownerPairs: [] });
    expect((await store.list('Note')).length).toBeGreaterThan(0);
    expect(ownedBy(await store.list('Note'), viewer?.id).length).toBe(0);
  });

  it('control: with no defaultPersona the viewer is anonymous and nothing restamps', async () => {
    const { engine, asked } = scripted({ DATASET_INPUT: [emitted('DATASET_DONE', { stores: { people, notes }, journal })] });
    const store = writableRows();
    const { viewer } = await seedMockStore({ seeder: new StdMockSeed(engine, declared('')), persistence: store, ...run }, notesApp(true), { namedByHost: false, current: () => undefined, seedIdentity: true });
    expect(viewer).toBeUndefined();
    expect(asked.map((a) => a.event)).toEqual(['DATASET_INPUT']);
  });

  it('a defaultPersona that names no identity row is an error, not a fallback', async () => {
    const { engine } = scripted({ DATASET_INPUT: [emitted('DATASET_DONE', { stores: { people, notes }, journal })] });
    await expect(seedMockStore({ seeder: new StdMockSeed(engine, declared('nobody')), persistence: writableRows(), ...run }, notesApp(true), { namedByHost: false, current: () => undefined, seedIdentity: true })).rejects.toThrow('names no');
  });
});
