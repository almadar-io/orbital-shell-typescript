import { describe, expect, it } from 'vitest';

import {
  createSharedEntityStore,
  runTickFrame,
  type SharedEntityWriter,
} from '../../src/hooks/useSharedEntityStore';

describe('runTickFrame + createSharedEntityStore', () => {
  it('merges disjoint writer writes without clobbering (field-level merge)', () => {
    const store = createSharedEntityStore();
    const writerA: SharedEntityWriter = () => [
      { field: 'x', value: 10 },
      { field: 'y', value: 20 },
    ];
    const writerB: SharedEntityWriter = () => [{ field: 'fx', value: 0.5 }];

    const result = runTickFrame('board-1', [writerA, writerB], store);

    expect(result).toEqual({ x: 10, y: 20, fx: 0.5 });
  });

  it('lets a later writer read an earlier writer\'s same-frame write (ordered live-read)', () => {
    const store = createSharedEntityStore();
    const writerA: SharedEntityWriter = () => [{ field: 'count', value: 1 }];
    const writerB: SharedEntityWriter = (scratch) => {
      const count = scratch.count;
      const doubled = typeof count === 'number' ? count * 2 : 0;
      return [{ field: 'doubled', value: doubled }];
    };

    const result = runTickFrame('board-1', [writerA, writerB], store);

    expect(result.doubled).toBe(2);
  });

  it('coalesces N writer writes into exactly one commit + one notify per frame', () => {
    const store = createSharedEntityStore();
    let notifyCount = 0;
    store.subscribe('board-1', () => {
      notifyCount++;
    });

    const writerA: SharedEntityWriter = () => [{ field: 'a', value: 1 }];
    const writerB: SharedEntityWriter = () => [{ field: 'b', value: 2 }];

    const result = runTickFrame('board-1', [writerA, writerB], store);

    expect(notifyCount).toBe(1);
    expect(result).toEqual({ a: 1, b: 2 });
    expect(store.getSnapshot('board-1')).toEqual({ a: 1, b: 2 });
  });

  it('keys independently by entity id — a commit to A never touches or notifies B', () => {
    const store = createSharedEntityStore();
    let notifiedB = false;
    store.subscribe('B', () => {
      notifiedB = true;
    });

    const writer: SharedEntityWriter = () => [{ field: 'x', value: 1 }];
    runTickFrame('A', [writer], store);

    expect(store.getSnapshot('A')).toEqual({ x: 1 });
    expect(store.getSnapshot('B')).toEqual({});
    expect(notifiedB).toBe(false);
  });

  it('seed sets frame-0 defaults only when absent, and never notifies', () => {
    const store = createSharedEntityStore();
    let notifyCount = 0;
    store.subscribe('board-1', () => { notifyCount++; });

    store.seed('board-1', { x: 0, y: 0 });
    expect(store.getSnapshot('board-1')).toEqual({ x: 0, y: 0 });
    expect(notifyCount).toBe(0);

    // Idempotent: a second seed never overwrites already-present state.
    store.seed('board-1', { x: 99 });
    expect(store.getSnapshot('board-1')).toEqual({ x: 0, y: 0 });

    // A tick reads the seeded default as its starting value (0 + 1 = 1).
    const writer: SharedEntityWriter = (scratch) => [
      { field: 'x', value: (typeof scratch.x === 'number' ? scratch.x : 0) + 1 },
    ];
    expect(runTickFrame('board-1', [writer], store).x).toBe(1);
  });
});
