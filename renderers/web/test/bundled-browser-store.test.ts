/**
 * `openBundledBrowserStore` hands the resolved program to the kernel, which validates it on register: the host never
 * parses it (G-ORBITAL-SHELL-TYPESCRIPT-088, a 37 MB program ran `parseOrbitalSchema` out of a 4 GB heap).
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { parseOrbitalSchema, type OrbitalDefinition, type OrbitalEntity, type OrbitalSchema } from '@almadar/core';
import { openBrowserStore, openBundledBrowserStore } from '../src/runtime/index.js';
import { KERNEL_AVAILABLE, loadTestKernel } from '../src/test-support/kernel-engine.js';

const unparsable: OrbitalSchema = JSON.parse('{"name":5,"orbitals":[]}');

describe.skipIf(!KERNEL_AVAILABLE)('openBundledBrowserStore', () => {
  it('opens the program as given, without a parse of its own', async () => {
    const kernel = await loadTestKernel();
    await expect(openBundledBrowserStore(unparsable, kernel)).rejects.toThrow('declares no browser-stored entity');
  });

  it('control: the zod parse the host used to run refuses the same program', () => {
    expect(() => parseOrbitalSchema(unparsable)).toThrow();
  });
});

const stored = (name: string, collection?: string): OrbitalEntity => ({
  name,
  persistence: 'persistent',
  browser: true,
  ...(collection !== undefined ? { collection } : {}),
  fields: [{ name: 'id', type: 'string', required: true }],
});
const orbital = (name: string, entity: OrbitalEntity): OrbitalDefinition => ({ name, entity, traits: [], pages: [] });
const dbName = () => `bs-${Math.random()}`;

function rawStore(name: string, stores: Record<string, { id: string }[]>, version = 1): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      for (const [store, rows] of Object.entries(stores)) {
        const created = req.result.createObjectStore(store, { keyPath: 'id' });
        for (const row of rows) created.put(row);
      }
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

function storeNames(name: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => {
      const names = [...req.result.objectStoreNames].sort();
      req.result.close();
      resolve(names);
    };
    req.onerror = () => reject(req.error);
  });
}

describe('openBrowserStore files rows by collection', () => {
  it('entities bound to one collection share its rows across pages and reopens', async () => {
    const name = dbName();
    const home = await openBrowserStore(name, [orbital('Home', stored('HomeOsamaTypePick', 'osama_type_picks'))]);
    await home?.create('HomeOsamaTypePick', { id: 'pick', face: 'serif' });
    home?.close();
    const blog = await openBrowserStore(name, [orbital('Blog', stored('BlogOsamaTypePick', 'osama_type_picks'))]);
    expect(await blog?.list('BlogOsamaTypePick')).toMatchObject([{ id: 'pick', face: 'serif' }]);
    blog?.close();
  });

  it('control: entities on different collections keep separate rows', async () => {
    const name = dbName();
    const store = await openBrowserStore(name, [orbital('A', stored('Pick', 'picks_a')), orbital('B', stored('Other', 'picks_b'))]);
    await store?.create('Pick', { id: 'one' });
    expect(await store?.list('Other')).toEqual([]);
    store?.close();
  });

  it('control: an entity with no collection files its rows under its own name', async () => {
    const name = dbName();
    const store = await openBrowserStore(name, [orbital('A', stored('Loose'))]);
    await store?.create('Loose', { id: 'one' });
    store?.close();
    expect(await storeNames(name)).toContain('Loose');
  });

  it('rows kept under the old per-type stores move into the collection store and the old store is removed', async () => {
    const name = dbName();
    await rawStore(name, { HomeOsamaTypePick: [{ id: 'old' }], BlogOsamaTypePick: [{ id: 'blog' }, { id: 'old' }], osama_type_picks: [{ id: 'old', kept: true } as { id: string }] });
    const store = await openBrowserStore(name, [
      orbital('Home', stored('HomeOsamaTypePick', 'osama_type_picks')),
      orbital('Blog', stored('BlogOsamaTypePick', 'osama_type_picks')),
    ]);
    const rows = await store?.list('HomeOsamaTypePick');
    expect(rows?.map((row) => row.id).sort()).toEqual(['blog', 'old']);
    expect(rows?.find((row) => row.id === 'old')).toMatchObject({ kept: true });
    store?.close();
    expect(await storeNames(name)).not.toContain('HomeOsamaTypePick');
    expect(await storeNames(name)).not.toContain('BlogOsamaTypePick');
  });

  it('control: a database with no old per-type store is not upgraded', async () => {
    const name = dbName();
    const first = await openBrowserStore(name, [orbital('A', stored('Pick', 'picks'))]);
    first?.close();
    const before = await new Promise<number>((resolve) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => {
        const version = req.result.version;
        req.result.close();
        resolve(version);
      };
    });
    const second = await openBrowserStore(name, [orbital('A', stored('Pick', 'picks'))]);
    second?.close();
    const after = await new Promise<number>((resolve) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => {
        const version = req.result.version;
        req.result.close();
        resolve(version);
      };
    });
    expect(after).toBe(before);
  });
});
