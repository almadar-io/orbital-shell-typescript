import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbPersistence } from '../src/storage/IndexedDbPersistence.js';

let factory: IDBFactory;
beforeEach(() => {
  factory = new IDBFactory();
});

function within<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within 2 seconds`)), 2000);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

describe('IndexedDbPersistence version change', () => {
  it('a connection yields to another connection adding a collection, then works again', async () => {
    const first = await IndexedDbPersistence.open({ databaseName: 'app', entityTypes: ['a'], factory });
    await first.create('a', { id: '1' });
    const second = await within(IndexedDbPersistence.open({ databaseName: 'app', entityTypes: ['a', 'b'], factory }), 'the second open');
    expect((await first.list('a')).map((r) => r.id)).toEqual(['1']);
    await first.create('a', { id: '2' });
    expect((await second.list('a')).map((r) => r.id).sort()).toEqual(['1', '2']);
    first.close();
    second.close();
  });

  it('control: two connections with the same collections do not disturb each other', async () => {
    const first = await IndexedDbPersistence.open({ databaseName: 'app', entityTypes: ['a'], factory });
    const second = await IndexedDbPersistence.open({ databaseName: 'app', entityTypes: ['a'], factory });
    await first.create('a', { id: '1' });
    expect((await second.list('a')).map((r) => r.id)).toEqual(['1']);
    first.close();
    second.close();
  });
});
