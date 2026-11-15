import { describe, expect, it } from 'vitest';
import type { OrbitalSchema } from '@almadar/core';
import { AskedLoader, loadLazyPage } from '../src/index.js';

const program = (orbital: string): OrbitalSchema => ({
  name: orbital,
  orbitals: [{ name: orbital, entity: { name: `${orbital}Row`, fields: [] }, traits: [], pages: [] }],
});

const asking = (): { loader: AskedLoader; asked: string[] } => {
  const asked: string[] = [];
  return { loader: new AskedLoader((file) => asked.push(file)), asked };
};

describe('AskedLoader', () => {
  it('asks for a lazy page by its orbRef and loads it when the answer arrives', async () => {
    const { loader, asked } = asking();
    const loading = loadLazyPage(loader, { path: '/late', orbital: 'Late', orbRef: 'lazy/Late.orb' });
    expect(asked).toEqual(['lazy/Late.orb']);
    expect(loader.answer({ file: 'lazy/Late.orb', program: program('Late') })).toBe(true);
    const loaded = await loading;
    expect(loaded.success && loaded.data.orbitals[0].name).toBe('Late');
  });

  it('asks once for a file two loads wait on, and a loaded file is not asked again', async () => {
    const { loader, asked } = asking();
    const first = loader.load('lazy/Late.orb');
    const second = loader.load('lazy/Late.orb');
    loader.answer({ file: 'lazy/Late.orb', program: program('Late') });
    expect((await first).success && (await second).success).toBe(true);
    expect((await loader.load('lazy/Late.orb')).success).toBe(true);
    expect(asked).toEqual(['lazy/Late.orb']);
  });

  it('control: a refused file fails every load waiting on it, naming the reason, and the next load asks again', async () => {
    const { loader, asked } = asking();
    const loading = loader.load('lazy/Gone.orb');
    loader.answer({ file: 'lazy/Gone.orb', error: 'program/lazy: the guest carries no lazy program `lazy/Gone.orb`' });
    const loaded = await loading;
    expect(loaded.success).toBe(false);
    expect(!loaded.success && loaded.error).toContain('lazy/Gone.orb');
    void loader.load('lazy/Gone.orb');
    expect(asked).toEqual(['lazy/Gone.orb', 'lazy/Gone.orb']);
  });

  it("edge: a nested lazy child is asked for by its path joined to its importer's folder, as the kernel flattens it", async () => {
    const { loader, asked } = asking();
    const loading = loader.load('lazy/Deep.orb', 'lazy/Late.orb');
    expect(asked).toEqual(['lazy/lazy/Deep.orb']);
    loader.answer({ file: 'lazy/lazy/Deep.orb', program: program('Deep') });
    const loaded = await loading;
    expect(loaded.success && loaded.data.sourcePath).toBe('lazy/lazy/Deep.orb');
  });

  it('edge: an answer no load asked for is not taken', () => {
    const { loader } = asking();
    expect(loader.answer({ file: 'lazy/Late.orb', program: program('Late') })).toBe(false);
    expect(loader.getCacheStats().size).toBe(0);
  });

  it('edge: a page whose answered program lacks its orbital is refused by loadLazyPage', async () => {
    const { loader } = asking();
    const loading = loadLazyPage(loader, { path: '/late', orbital: 'Other', orbRef: 'lazy/Late.orb' });
    loader.answer({ file: 'lazy/Late.orb', program: program('Late') });
    expect((await loading).success).toBe(false);
  });
});
