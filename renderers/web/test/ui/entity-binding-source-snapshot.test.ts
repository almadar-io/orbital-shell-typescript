/**
 * `useEntityBindingSource.getEntitySnapshot` is the `useSyncExternalStore`
 * snapshot for a trait's entity: it must return a NEW value whenever the
 * entity changed. Tick effects (`runCircuitEffects`) write the live frame in
 * place, so returning the live frame kept one identity forever — a
 * non-`[shared]` 3D board (`ui-platformer-board-3d`) advanced its physics at
 * 30 Hz while its canvas never re-rendered.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { buildTraitIndex } from '../../src/runtime';
import { createMemoryCircuitStore } from '../../src';
import type { EntityRow } from '@almadar/core';
import { useEntityBindingSource } from '../../src/hooks/circuit/useEntityBindingSource';

function setup() {
  const store = createMemoryCircuitStore();
  const traitIndex = buildTraitIndex([]);
  const { result } = renderHook(() => useEntityBindingSource(store, traitIndex));
  return { store, source: result.current };
}

describe('useEntityBindingSource — snapshot identity', () => {
  it('returns a new snapshot after an in-place write to the live frame', () => {
    const { store, source } = setup();
    const frame: EntityRow = { player: { x: 80 }, score: 0 };
    store.frames.set('Board', frame);
    const before = source.getEntitySnapshot('Board');
    frame.player = { x: 84 };
    store.notify();
    const after = source.getEntitySnapshot('Board');
    expect(after).not.toBe(before);
    expect(after.player).toEqual({ x: 84 });
  });

  it('keeps the same snapshot while nothing changed (stable across repeat reads)', () => {
    const { store, source } = setup();
    store.frames.set('Board', { player: { x: 80 }, score: 0 });
    const a = source.getEntitySnapshot('Board');
    store.notify();
    expect(source.getEntitySnapshot('Board')).toBe(a);
  });

  it('returns a new snapshot when the frame object is replaced with different values', () => {
    const { store, source } = setup();
    store.frames.set('Board', { score: 0 });
    const a = source.getEntitySnapshot('Board');
    store.frames.set('Board', { score: 1 });
    expect(source.getEntitySnapshot('Board')).not.toBe(a);
  });

  it('detects an added or removed field', () => {
    const { store, source } = setup();
    const frame: EntityRow = { score: 0 };
    store.frames.set('Board', frame);
    const a = source.getEntitySnapshot('Board');
    frame.lives = 3;
    const b = source.getEntitySnapshot('Board');
    expect(b).not.toBe(a);
    delete frame.lives;
    expect(source.getEntitySnapshot('Board')).not.toBe(b);
  });

  it('snapshots per trait independently and returns the empty row for an unknown trait', () => {
    const { store, source } = setup();
    store.frames.set('A', { v: 1 });
    store.frames.set('B', { v: 2 });
    const a = source.getEntitySnapshot('A');
    const b = source.getEntitySnapshot('B');
    (store.frames.get('A') as EntityRow).v = 9;
    expect(source.getEntitySnapshot('A')).not.toBe(a);
    expect(source.getEntitySnapshot('B')).toBe(b);
    expect(source.getEntitySnapshot('Missing')).toEqual({});
  });
});
