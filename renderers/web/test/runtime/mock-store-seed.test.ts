/**
 * `seedMockStore` — the one mock-store seed `OrbitalServerRuntime` (mock mode) and `OrbitalPluginHost` run: the
 * `[identity]` roster seeds first, the owner columns come from the relations to it, and the owner cells are stamped
 * for the viewer, so the dev viewer's "only mine" list has rows. No access policy is declared here, so no gate
 * evaluates on the kernel.
 */
import { describe, expect, it } from 'vitest';
import type { OrbitalSchema, UserContext } from '@almadar/core';
import { MockPersistenceAdapter } from '@almadar/db/mock';
import { seedMockStore } from '../../src/runtime/entities/mockStoreSeed';

function notesApp(): OrbitalSchema {
  return {
    name: 'notes',
    orbitals: [
      {
        name: 'People',
        entity: {
          name: 'Person', persistence: 'persistent', collection: 'people', identity: true,
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

const ownedBy = (store: MockPersistenceAdapter, id: string | undefined) => store.rowsOf('Note').filter((row) => row['owner'] === id);

async function seeded(viewer: { namedByHost: boolean; named?: UserContext }) {
  const store = new MockPersistenceAdapter({ defaultSeedCount: 6 });
  let current: UserContext | undefined = viewer.named;
  current = await seedMockStore(store, notesApp(), { namedByHost: viewer.namedByHost, current: () => current, seedIdentity: true });
  return { store, viewer: current };
}

describe('seedMockStore', () => {
  it('seeds the [identity] persona roster and stamps owner rows for its first persona, the dev viewer', async () => {
    const { store, viewer } = await seeded({ namedByHost: false });
    const roster = store.rowsOf('Person');
    expect(roster.length).toBeGreaterThan(1);
    expect(viewer?.id).toBe(roster[0]?.['id']);
    expect(ownedBy(store, viewer?.id).length).toBeGreaterThan(0);
  });

  it('control: another persona of the roster does not see the dev viewer\'s rows as its own', async () => {
    const { store, viewer } = await seeded({ namedByHost: false });
    const other = store.rowsOf('Person').map((row) => row['id']).find((id) => id !== viewer?.id);
    expect(typeof other).toBe('string');
    const mine = new Set(ownedBy(store, viewer?.id).map((row) => row['id']));
    expect(ownedBy(store, typeof other === 'string' ? other : undefined).some((row) => mine.has(row['id']))).toBe(false);
    expect(mine.size).toBeLessThan(store.rowsOf('Note').length);
  });

  it('a viewer the host named owns the stamped rows instead of the first persona', async () => {
    const named: UserContext = { id: 'host-viewer', name: 'Host' };
    const { store, viewer } = await seeded({ namedByHost: true, named });
    expect(viewer).toEqual(named);
    expect(ownedBy(store, 'host-viewer').length).toBeGreaterThan(0);
  });

  it('control: a program with no [identity] entity derives no owner column and stamps nothing', async () => {
    const schema = notesApp();
    const people = schema.orbitals[0];
    if (people === undefined || typeof people.entity === 'string' || !('fields' in people.entity) || people.entity.fields === undefined) throw new Error('fixture');
    schema.orbitals[0] = { ...people, entity: { name: 'Person', persistence: 'persistent', collection: 'people', fields: people.entity.fields } };
    const store = new MockPersistenceAdapter({ defaultSeedCount: 6 });
    let current: UserContext | undefined;
    current = await seedMockStore(store, schema, { namedByHost: false, current: () => current, seedIdentity: true });
    expect(store.rowsOf('Note').length).toBeGreaterThan(0);
    expect(ownedBy(store, current?.id).length).toBe(0);
  });
});
