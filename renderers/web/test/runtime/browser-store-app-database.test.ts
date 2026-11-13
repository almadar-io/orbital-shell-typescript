import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OrbitalDefinition, OrbitalEntity } from '@almadar/core';
import { openBrowserStore } from '../../src/runtime/evaluation/browser-store-transport';

const pick = (name: string): OrbitalEntity => ({
  name,
  persistence: 'persistent',
  collection: 'picks',
  browser: true,
  fields: [{ name: 'id', type: 'string', required: true }, { name: 'face', type: 'string' }],
});
const orbital = (name: string, entity: OrbitalEntity): OrbitalDefinition => ({ name, entity, traits: [], pages: [] });
const home = [orbital('Home', pick('HomePick'))];
const blog = [orbital('Blog', pick('BlogPick'))];

let factory: IDBFactory;
beforeEach(() => {
  factory = new IDBFactory();
});

async function seed(database: string, orbitals: readonly OrbitalDefinition[], entity: string, row: { id: string; face: string }): Promise<void> {
  const store = await openBrowserStore(database, orbitals, factory);
  await store?.create(entity, row);
  store?.close();
}

const databaseNames = async (): Promise<(string | undefined)[]> => (await factory.databases()).map((d) => d.name);

describe('one browser database per app', () => {
  it('two programs of one app share the rows of a collection', async () => {
    await seed('almadar:site:en', home, 'HomePick', { id: 'p1', face: 'serif' });
    const store = await openBrowserStore('almadar:site:en', blog, factory);
    expect((await store?.list('BlogPick'))?.map((r) => r.id)).toEqual(['p1']);
    store?.close();
  });

  it("rows kept under a page's own database move into the app's database", async () => {
    await seed('almadar:Blog:en', blog, 'BlogPick', { id: 'old', face: 'mono' });
    const store = await openBrowserStore('almadar:site:en', blog, factory, 'almadar:Blog:en');
    expect((await store?.list('BlogPick'))?.map((r) => r.id)).toEqual(['old']);
    store?.close();
    expect(await databaseNames()).not.toContain('almadar:Blog:en');
  });

  it("a row the app's database already holds wins over the former copy", async () => {
    await seed('almadar:site:en', home, 'HomePick', { id: 'same', face: 'serif' });
    await seed('almadar:Blog:en', blog, 'BlogPick', { id: 'same', face: 'mono' });
    const store = await openBrowserStore('almadar:site:en', blog, factory, 'almadar:Blog:en');
    const rows = await store?.list('BlogPick');
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({ id: 'same', face: 'serif' });
    store?.close();
  });

  it('control: without a former name no other database is opened or removed', async () => {
    await seed('almadar:Blog:en', blog, 'BlogPick', { id: 'old', face: 'mono' });
    const site = await openBrowserStore('almadar:site:en', blog, factory);
    expect(await site?.list('BlogPick')).toEqual([]);
    site?.close();
    expect(await databaseNames()).toContain('almadar:Blog:en');
    const former = await openBrowserStore('almadar:Blog:en', blog, factory);
    expect((await former?.list('BlogPick'))?.map((r) => r.id)).toEqual(['old']);
    former?.close();
  });

  it('control: a former name that never existed leaves nothing behind', async () => {
    const store = await openBrowserStore('almadar:site:en', blog, factory, 'almadar:Ghost:en');
    expect(store).not.toBeNull();
    store?.close();
    expect(await databaseNames()).not.toContain('almadar:Ghost:en');
  });
});
