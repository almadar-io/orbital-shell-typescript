// The browser host's credential rows: the kernel's encrypted store over `chrome.storage`, run against a fake of it. The host
// answers raw rows; encryption, identity and every failure rule are the kernel's, so these tests run the built kernel.
import { describe, expect, it } from 'vitest';
import { EntityRowSchema, type EntityRow } from '@almadar/core';
import {
  CHROME_CREDENTIAL_MASTER_KEY,
  CHROME_CREDENTIAL_ROWS_KEY,
  chromeCredentialRows,
  createChromeCredentialVault,
  type ChromeStorageArea,
} from '../src/host/index.js';
import { kernel } from './helpers/kernel.js';

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

function storedRows(storage: { held: Map<string, object> }): EntityRow[] {
  return EntityRowSchema.array().parse(storage.held.get(CHROME_CREDENTIAL_ROWS_KEY));
}

describe('chrome credential rows', () => {
  it('refuses stored rows it cannot read instead of answering an empty store', async () => {
    const storage = storageArea();
    storage.held.set(CHROME_CREDENTIAL_ROWS_KEY, { not: 'an array' });
    await expect(chromeCredentialRows(storage).list()).rejects.toThrow('unreadable');
    await expect(createChromeCredentialVault(storage, kernel)).rejects.toThrow('unreadable');
    expect(await chromeCredentialRows(storageArea()).list()).toEqual([]);
  });

  it('keeps encrypted rows in storage that a later vault reads back, with the label in the clear and the secret nowhere', async () => {
    const storage = storageArea();
    const vault = await createChromeCredentialVault(storage, kernel);
    await vault.set('kernel', 'KNOWLEDGE_REFRESH_TOKEN', '1//firebase-refresh-SECRET', undefined, 'ada@example.com');
    const text = JSON.stringify(storage.held.get(CHROME_CREDENTIAL_ROWS_KEY));
    expect(text).toContain('ada@example.com');
    expect(text).not.toContain('firebase-refresh-SECRET');
    const reopened = await createChromeCredentialVault(storage, kernel);
    expect(reopened.resolve('KNOWLEDGE_REFRESH_TOKEN')).toBe('1//firebase-refresh-SECRET');
    expect(reopened.label('KNOWLEDGE_REFRESH_TOKEN')).toBe('ada@example.com');
    await reopened.remove('KNOWLEDGE_REFRESH_TOKEN');
    expect((await createChromeCredentialVault(storage, kernel)).resolve('KNOWLEDGE_REFRESH_TOKEN')).toBeUndefined();
  });

  it('control: the master key is minted once, a lost key fails the open naming the unreadable row, and an empty profile holds nothing', async () => {
    const storage = storageArea();
    const first = await createChromeCredentialVault(storage, kernel);
    await first.set('kernel', 'K', 'v');
    const key = JSON.stringify(storage.held.get(CHROME_CREDENTIAL_MASTER_KEY));
    await createChromeCredentialVault(storage, kernel);
    expect(JSON.stringify(storage.held.get(CHROME_CREDENTIAL_MASTER_KEY))).toBe(key);
    const [row] = storedRows(storage);
    storage.held.set(CHROME_CREDENTIAL_MASTER_KEY, { key: '11'.repeat(32) });
    await expect(createChromeCredentialVault(storage, kernel)).rejects.toThrow(`cannot be read (malformed, or no held master key opens them): ${row.id}`);
    expect((await createChromeCredentialVault(storageArea(), kernel)).entries()).toEqual([]);
  });

  it('control: a corrupt row fails the open naming it, and nothing is read as an empty store', async () => {
    const storage = storageArea();
    const vault = await createChromeCredentialVault(storage, kernel);
    await vault.set('kernel', 'A', 'value-A');
    await vault.set('kernel', 'B', 'value-B');
    const [good, bad] = storedRows(storage);
    storage.held.set(CHROME_CREDENTIAL_ROWS_KEY, [good, { ...bad, authTag: '00'.repeat(16) }]);
    const failure = await createChromeCredentialVault(storage, kernel).then(
      () => undefined,
      (error: Error) => error.message,
    );
    expect(failure).toContain(String(bad.id));
    expect(failure).not.toContain(String(good.id));
  });

  it('serialises concurrent writes so no row is lost', async () => {
    const storage = storageArea();
    const vault = await createChromeCredentialVault(storage, kernel);
    await Promise.all(['A', 'B', 'C'].map((name) => vault.set('kernel', name, `value-${name}`)));
    const reopened = await createChromeCredentialVault(storage, kernel);
    expect(['A', 'B', 'C'].map((name) => reopened.resolve(name))).toEqual(['value-A', 'value-B', 'value-C']);
  });
});
