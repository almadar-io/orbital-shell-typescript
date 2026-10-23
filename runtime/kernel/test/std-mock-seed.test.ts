import { describe, expect, it } from 'vitest';
import {
  EntityRowSchema,
  OrbitalSchemaSchema,
  type EmittedEvent,
  type EntityRow,
  type EventPayload,
  type OrbitalEventRequest,
  type OrbitalEventResponse,
  type PersistenceAdapter,
  type RowWriteOp,
  type RowWriteOutcome,
} from '@almadar/core';
import { StdMockSeed, applyOwnerChanges, writeSeededStores, type MockSeedEngine } from '../src/runtime/entities/std-mock-seed.js';
import { seedMockStore } from '../src/runtime/entities/mockStoreSeed.js';
import { seedBrowserStore } from '../src/runtime/entities/seedBrowserStore.js';

const program = OrbitalSchemaSchema.parse({
  name: 'Seeded',
  orbitals: [{
    name: 'Main',
    entity: { name: 'User', collection: 'users', persistence: 'persistent', identity: true, fields: [{ name: 'id', type: 'string', required: true }] },
    auxiliaryEntities: [{
      name: 'Task', collection: 'tasks', persistence: 'persistent',
      fields: [{ name: 'id', type: 'string', required: true }, { name: 'ownerId', type: 'relation', relation: { entity: 'User', cardinality: 'many-to-one' } }],
    }],
    traits: [],
  }],
});

const journal = { viewerId: '', stamped: [], deferred: [] };

interface Asked { event: string; payload: EventPayload }

function scriptedEngine(answers: Record<string, EmittedEvent[]>): { engine: MockSeedEngine; asked: Asked[] } {
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

class Store implements PersistenceAdapter {
  readonly tables = new Map<string, EntityRow[]>();
  readonly ops: RowWriteOp[] = [];
  async create(entityType: string, data: EntityRow): Promise<{ id: string }> {
    this.tables.set(entityType, [...(this.tables.get(entityType) ?? []), data]);
    return { id: String(data.id) };
  }
  async update(): Promise<void> {}
  async delete(): Promise<void> {}
  async getById(entityType: string, id: string): Promise<EntityRow | null> {
    return (this.tables.get(entityType) ?? []).find((row) => row.id === id) ?? null;
  }
  async list(entityType: string): Promise<EntityRow[]> {
    return this.tables.get(entityType) ?? [];
  }
  async writeWhere(op: RowWriteOp): Promise<RowWriteOutcome> {
    this.ops.push(op);
    const rows = this.tables.get(op.entityType) ?? [];
    if (op.kind === 'upsert') {
      this.tables.set(op.entityType, [...rows.filter((row) => row.id !== op.data.id), op.data]);
      return { kind: 'created', row: op.data };
    }
    if (op.kind === 'update') {
      const found = rows.find((row) => row.id === op.id);
      if (found === undefined) return { kind: 'not-found' };
      const row = { ...found, ...op.data };
      this.tables.set(op.entityType, rows.map((r) => (r.id === op.id ? row : r)));
      return { kind: 'updated', row };
    }
    if (op.kind === 'rekey') {
      const found = rows.find((row) => row.id === op.id);
      if (found === undefined) return { kind: 'not-found' };
      const row = { ...found, id: op.newId };
      this.tables.set(op.entityType, rows.map((r) => (r.id === op.id ? row : r)));
      return { kind: 'updated', row };
    }
    return { kind: 'failed', message: 'unused' };
  }
}

const run = { nowMs: 1000 };
const declared = { count: 2, seed: 7, defaultPersona: '', restampOnPersona: false };

describe('StdMockSeed', () => {
  it('sends the resolved program with derived owner pairs and reads the typed dataset', async () => {
    const { engine, asked } = scriptedEngine({ DATASET_INPUT: [emitted('DATASET_DONE', { stores: { users: [{ id: 'u1' }] }, journal })] });
    const dataset = await new StdMockSeed(engine, declared).dataset(program, { ...run, viewerId: 'u1', locale: 'ar' });
    expect(dataset.stores).toEqual({ users: [{ id: 'u1' }] });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.payload).toMatchObject({ count: 2, seed: 7, nowMs: 1000, viewerId: 'u1', locale: 'ar', ownerPairs: [{ entity: 'Task', column: 'ownerId' }] });
  });

  it('control: a refusal from the program is an error, not an empty dataset', async () => {
    const { engine } = scriptedEngine({ DATASET_INPUT: [emitted('DATASET_FAILED', { error: 'Type mismatch' })] });
    await expect(new StdMockSeed(engine, declared).dataset(program, run)).rejects.toThrow('Type mismatch');
  });

  it('control: an absent answer is an error', async () => {
    const { engine } = scriptedEngine({});
    await expect(new StdMockSeed(engine, declared).dataset(program, run)).rejects.toThrow('did not answer DATASET_DONE');
  });
});

describe('applying the program answers', () => {
  it('upserts rows under the entity that declares each collection', async () => {
    const store = new Store();
    await writeSeededStores(store, program, { users: [{ id: 'u1' }], tasks: [{ id: 't1', ownerId: 'u1' }] });
    expect(store.tables.get('User')).toEqual([{ id: 'u1' }]);
    expect(store.tables.get('Task')).toEqual([{ id: 't1', ownerId: 'u1' }]);
  });

  it('control: a collection no entity declares is refused', async () => {
    await expect(writeSeededStores(new Store(), program, { ghosts: [{ id: 'g' }] })).rejects.toThrow('ghosts');
  });

  it('applies set and rekey changes and refuses a change that did not land', async () => {
    const store = new Store();
    await writeSeededStores(store, program, { users: [{ id: 'u1' }], tasks: [{ id: 't1', ownerId: 'old' }] });
    await applyOwnerChanges(store, program, [
      { kind: 'set', store: 'tasks', id: 't1', column: 'ownerId', ownerId: 'u2' },
      { kind: 'rekey', store: 'users', id: 'u1', column: 'id', ownerId: 'u2' },
    ]);
    expect(store.tables.get('Task')).toEqual([{ id: 't1', ownerId: 'u2' }]);
    expect(store.tables.get('User')).toEqual([{ id: 'u2' }]);
    await expect(applyOwnerChanges(store, program, [{ kind: 'set', store: 'tasks', id: 'missing', column: 'ownerId', ownerId: 'x' }])).rejects.toThrow('not-found');
  });
});

describe('seedMockStore', () => {
  const dataset = emitted('DATASET_DONE', { stores: { users: [{ id: 'u1' }, { id: 'u2' }], tasks: [{ id: 't1', ownerId: '' }] }, journal });

  it('stamps for the viewer the host named and asks no restamp', async () => {
    const { engine, asked } = scriptedEngine({ DATASET_INPUT: [dataset] });
    const store = new Store();
    const viewer = { id: 'u2' };
    const seeded = await seedMockStore({ seeder: new StdMockSeed(engine, declared), persistence: store, ...run }, program, { namedByHost: true, current: () => viewer, seedIdentity: true });
    expect(seeded.viewer).toEqual(viewer);
    expect(asked.map((a) => a.event)).toEqual(['DATASET_INPUT']);
    expect(asked[0]?.payload).toMatchObject({ viewerId: 'u2' });
    expect(store.tables.get('Task')).toEqual([{ id: 't1', ownerId: '' }]);
  });

  it('control: an unnamed viewer is the declared defaultPersona and the rows restamp for it', async () => {
    const restamped = emitted('RESTAMP_DONE', { journal, changes: [{ kind: 'set', store: 'tasks', id: 't1', column: 'ownerId', ownerId: 'u1' }] });
    const { engine, asked } = scriptedEngine({ DATASET_INPUT: [dataset], RESTAMP_INPUT: [restamped] });
    const store = new Store();
    const seeded = await seedMockStore({ seeder: new StdMockSeed(engine, { ...declared, defaultPersona: 'u1' }), persistence: store, ...run }, program, { namedByHost: false, current: () => undefined, seedIdentity: true });
    expect(seeded.viewer).toEqual({ id: 'u1' });
    expect(asked.map((a) => a.event)).toEqual(['DATASET_INPUT', 'RESTAMP_INPUT']);
    expect(asked[1]?.payload).toMatchObject({ viewer: { id: 'u1' } });
    expect(store.tables.get('Task')).toEqual([{ id: 't1', ownerId: 'u1' }]);
  });
});

describe('seedBrowserStore', () => {
  const local = (name: string, extra: object) => OrbitalSchemaSchema.parse({
    name: 'L', orbitals: [{ name: 'O', entity: { name, collection: 'notes', persistence: 'persistent', local: true, fields: [{ name: 'id', type: 'string', required: true }], ...extra }, traits: [] }],
  }).orbitals.map((o) => o.entity);

  it('seeds an empty browser-stored entity from the program for the locale', async () => {
    const { engine, asked } = scriptedEngine({ DATASET_INPUT: [emitted('DATASET_DONE', { stores: { notes: [{ id: 'arabic' }] }, journal })] });
    const store = new Store();
    await seedBrowserStore(store, local('Note', {}), 'ar', { seeder: new StdMockSeed(engine, declared), ...run });
    expect(store.tables.get('Note')).toEqual([{ id: 'arabic' }]);
    expect(asked[0]?.payload).toMatchObject({ locale: 'ar' });
  });

  it('control: a store that already has rows is left alone and the program is not asked', async () => {
    const { engine, asked } = scriptedEngine({});
    const store = new Store();
    await store.create('Note', { id: 'mine' });
    await seedBrowserStore(store, local('Note', {}), undefined, { seeder: new StdMockSeed(engine, declared), ...run });
    expect(asked).toEqual([]);
    expect(store.tables.get('Note')).toEqual([{ id: 'mine' }]);
    expect(EntityRowSchema.array().parse(store.tables.get('Note'))).toHaveLength(1);
  });
});
