import { describe, expect, it } from 'vitest';
import type { OrbitalSchema } from '@almadar/core';
import { CarriedLoader, loadLazyPage } from '../src/index.js';

const program = (orbital: string): OrbitalSchema => ({
  name: orbital,
  orbitals: [{ name: orbital, entity: { name: `${orbital}Row`, fields: [] }, traits: [], pages: [] }],
});

describe('CarriedLoader', () => {
  const loader = new CarriedLoader({ 'lazy/Late.orb': program('Late'), 'lazy/lazy/Deep.orb': program('Deep') });

  it('loads a lazy page from the program carried under its orbRef', async () => {
    const loaded = await loadLazyPage(loader, { path: '/late', orbital: 'Late', orbRef: 'lazy/Late.orb' });
    expect(loaded.success && loaded.data.orbitals[0].name).toBe('Late');
  });

  it('control: an orbRef the program does not carry fails and names it', async () => {
    const loaded = await loadLazyPage(loader, { path: '/gone', orbital: 'Gone', orbRef: 'lazy/Gone.orb' });
    expect(loaded.success).toBe(false);
    expect(!loaded.success && loaded.error).toContain('lazy/Gone.orb');
  });

  it("edge: a nested lazy child resolves against its importer's folder, as the kernel flattens it", async () => {
    const loaded = await loader.load('lazy/Deep.orb', 'lazy/Late.orb');
    expect(loaded.success && loaded.data.sourcePath).toBe('lazy/lazy/Deep.orb');
  });

  it('edge: a page whose carried program lacks its orbital is refused by loadLazyPage', async () => {
    const loaded = await loadLazyPage(loader, { path: '/late', orbital: 'Other', orbRef: 'lazy/Late.orb' });
    expect(loaded.success).toBe(false);
  });
});
