// The browser host's credential store: the server host's encrypted rows kept in `chrome.storage`, run against a fake of it.
import { describe, expect, it } from 'vitest';
import { CREDENTIAL_ENTITY_TYPE, CredentialStore, DERIVED_ENTITY_TYPE } from '@almadar/shell-web';
import { createExtensionHttpPorts } from '../src/kernel/extension-ports.js';
import {
  CHROME_CREDENTIAL_MASTER_KEY,
  CHROME_CREDENTIAL_ROWS_KEY,
  chromeCredentialRows,
  createChromeCredentialStore,
  type ChromeStorageArea,
} from '../src/host/index.js';

function storageArea(): ChromeStorageArea & { held: Map<string, object> } {
  const held = new Map<string, object>();
  return {
    held,
    async get(key) {
      const value = held.get(key);
      return value === undefined ? {} : { [key]: value };
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) held.set(key, structuredClone(value));
    },
    async remove(key) {
      held.delete(key);
    },
  };
}

describe('chrome credential store', () => {
  it('refuses stored rows it cannot read instead of answering an empty store', async () => {
    const storage = storageArea();
    storage.held.set(CHROME_CREDENTIAL_ROWS_KEY, { not: 'an array' });
    await expect(chromeCredentialRows(storage).list(CREDENTIAL_ENTITY_TYPE)).rejects.toThrow('unreadable');
    expect(await chromeCredentialRows(storageArea()).list(CREDENTIAL_ENTITY_TYPE)).toEqual([]);
  });

  it('keeps encrypted rows in storage that a later store reads back, with the label in the clear and the secret nowhere', async () => {
    const storage = storageArea();
    const store = await createChromeCredentialStore(storage);
    await store.set('kernel', 'KNOWLEDGE_REFRESH_TOKEN', '1//firebase-refresh-SECRET', undefined, 'ada@example.com');
    const text = JSON.stringify(storage.held.get(CHROME_CREDENTIAL_ROWS_KEY));
    expect(text).toContain('ada@example.com');
    expect(text).not.toContain('firebase-refresh-SECRET');
    const reopened = await createChromeCredentialStore(storage);
    expect(reopened.resolve('KNOWLEDGE_REFRESH_TOKEN')).toBe('1//firebase-refresh-SECRET');
    expect(reopened.label('KNOWLEDGE_REFRESH_TOKEN')).toBe('ada@example.com');
    await reopened.remove('KNOWLEDGE_REFRESH_TOKEN');
    expect((await createChromeCredentialStore(storage)).resolve('KNOWLEDGE_REFRESH_TOKEN')).toBeUndefined();
  });

  it('control: the master key is minted once, a lost key makes the rows unreadable rather than wrong, and an empty profile holds nothing', async () => {
    const storage = storageArea();
    const first = await createChromeCredentialStore(storage);
    await first.set('kernel', 'K', 'v');
    const key = JSON.stringify(storage.held.get(CHROME_CREDENTIAL_MASTER_KEY));
    await createChromeCredentialStore(storage);
    expect(JSON.stringify(storage.held.get(CHROME_CREDENTIAL_MASTER_KEY))).toBe(key);
    storage.held.set(CHROME_CREDENTIAL_MASTER_KEY, { key: '11'.repeat(32) });
    expect((await createChromeCredentialStore(storage)).resolve('K')).toBeUndefined();
    expect((await createChromeCredentialStore(storageArea())).entries()).toEqual([]);
  });

  it('serialises concurrent writes so no row is lost', async () => {
    const storage = storageArea();
    const store = await createChromeCredentialStore(storage);
    await Promise.all(['A', 'B', 'C'].map((name) => store.set('kernel', name, `value-${name}`)));
    const reopened = await createChromeCredentialStore(storage);
    expect(['A', 'B', 'C'].map((name) => reopened.resolve(name))).toEqual(['value-A', 'value-B', 'value-C']);
  });
});

describe('chrome credential store: a pending OAuth grant survives a worker restart', () => {
  const grant = { provider: 'google', redirectUri: 'https://kflow.academy/', verifier: 'V', subject: null, scopes: ['openid'] };
  const MASTER = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

  async function worker(storage: ChromeStorageArea) {
    const store = new CredentialStore(chromeCredentialRows(storage), MASTER);
    await store.warm();
    return createExtensionHttpPorts({ kernel: () => Promise.reject(new Error('never')), egress: [], credentials: Promise.resolve(store) });
  }

  it('a new host instance over the same storage takes the grant stored before the restart', async () => {
    const storage = storageArea();
    const before = await worker(storage);
    await before.oauth?.answer({ ask: 'pendingPut', state: 'S1', grant, ttlMs: 60_000 }, undefined);
    const after = await worker(storage);
    expect(await after.oauth?.answer({ ask: 'pendingTake', state: 'S1' }, undefined)).toEqual({ reply: 'taken', taken: { found: 'grant', grant } });
  });

  it('control: a consumed grant, and a state never stored, answer missing', async () => {
    const storage = storageArea();
    const before = await worker(storage);
    await before.oauth?.answer({ ask: 'pendingPut', state: 'S2', grant, ttlMs: 60_000 }, undefined);
    const after = await worker(storage);
    await after.oauth?.answer({ ask: 'pendingTake', state: 'S2' }, undefined);
    const again = await worker(storage);
    expect(await again.oauth?.answer({ ask: 'pendingTake', state: 'S2' }, undefined)).toEqual({ reply: 'taken', taken: { found: 'missing' } });
    expect(await again.oauth?.answer({ ask: 'pendingTake', state: 'never' }, undefined)).toEqual({ reply: 'taken', taken: { found: 'missing' } });
  });

  it('credential rows and derived rows stay in separate partitions', async () => {
    const storage = storageArea();
    const rows = chromeCredentialRows(storage);
    await rows.create(DERIVED_ENTITY_TYPE, { id: 'x', v: 1 });
    expect(await rows.list(CREDENTIAL_ENTITY_TYPE)).toEqual([]);
    expect(await rows.writeWhere?.({ kind: 'delete', entityType: DERIVED_ENTITY_TYPE, id: 'x', guard: { kind: 'compare', field: 'v', op: '==', value: 2 } })).toEqual({ kind: 'refused' });
    expect(await rows.writeWhere?.({ kind: 'delete', entityType: DERIVED_ENTITY_TYPE, id: 'x' })).toMatchObject({ kind: 'deleted' });
    expect(await rows.getById(DERIVED_ENTITY_TYPE, 'x')).toBeNull();
  });
});
