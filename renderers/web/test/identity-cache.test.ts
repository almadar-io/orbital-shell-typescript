import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createKvWebPort, type KvHostPort } from '@almadar/shell-browser/kv';
import { identityKeeper, seedCachedIdentity, type IdentityKernel } from '../src/lib/identity-cache';

let factory: IDBFactory;
const port = (): KvHostPort => createKvWebPort({ app: 'shop', locale: 'en', factory });

function kernel(held: string | undefined): IdentityKernel & { seeded: string[]; held: string | undefined } {
  const k = {
    seeded: [] as string[],
    held,
    seedIdentity(json: string): boolean { if (k.held !== undefined) return false; k.seeded.push(json); k.held = json; return true; },
    sessionIdentity(): string | undefined { return k.held; },
  };
  return k;
}

const ada = JSON.stringify({ user: { id: 'u1', name: 'Ada' } });

beforeEach(() => {
  factory = new IDBFactory();
});

describe('identity cache', () => {
  it('keeps the identity a fold set and seeds the next visit with it', async () => {
    const store = port();
    const first = kernel(undefined);
    first.held = ada;
    await identityKeeper(first, store)();
    const next = kernel(undefined);
    await seedCachedIdentity(next, store);
    expect(next.seeded).toEqual([ada]);
  });

  it('a signed-out frame deletes the kept identity, so the next visit seeds nothing', async () => {
    const store = port();
    const k = kernel(ada);
    const keep = identityKeeper(k, store);
    await keep();
    k.held = JSON.stringify({});
    await keep();
    const next = kernel(undefined);
    await seedCachedIdentity(next, store);
    expect(next.seeded).toEqual([]);
  });

  it('control: a first visit with nothing kept seeds nothing, and an unchanged identity is not written again', async () => {
    const store = port();
    const k = kernel(undefined);
    await seedCachedIdentity(k, store);
    expect(k.seeded).toEqual([]);
    k.held = ada;
    const keep = identityKeeper(k, store);
    expect(await keep()).toBe(true);
    expect(await keep()).toBe(false);
  });

  it('edge: a kv failure never blocks the boot', async () => {
    const broken: KvHostPort = { answer: async () => ({ error: { kind: 'unsupported', message: 'no IndexedDB' } }), close: () => undefined };
    const k = kernel(undefined);
    await expect(seedCachedIdentity(k, broken)).resolves.toBeUndefined();
    expect(k.seeded).toEqual([]);
  });
});
