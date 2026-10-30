import { describe, expect, it } from 'vitest';
import type { EventResponse } from '@almadar/core';
import { createMemoryCircuitStore } from '@almadar/shell-runtime/client/circuit-store';
import type { FrameDelta, FrameWire } from '@almadar/core/kernel-wire';
import { applyFrame } from '@almadar/shell-runtime/kernel/frame-applier';
import { createLocalFold } from '@almadar/shell-runtime/client/local-fold';

const response: EventResponse = {
  success: true,
  transitioned: true,
  states: { T: 'running' },
  frames: { session: '$program', from: 0, to: 1, ops: [['clear'], ['put', 'T-frame', { n: 2 }]] },
  emittedEvents: [],
  transitions: [{ trait: 'T', from: 'idle', to: 'running', event: 'GO', effects: [] }],
};

describe('local fold', () => {
  it('mirrors states and rows, notifies, and traces only when asked', async () => {
    const store = createMemoryCircuitStore([{ name: 'T', states: [{ name: 'idle', isInitial: true }, { name: 'running' }], transitions: [{ from: 'idle', to: 'running', event: 'GO' }] }]);
    const hops: string[] = [];
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    const fold = createLocalFold({
      store,
      framesSince: () => ({ session: '$program', from: 0, to: 1, ops: [['clear']] }),
      observer: { onTransition: (t) => { hops.push(t.event); } },
    });
    await fold.foldLocalResponse(response, false, true);
    expect(hops).toEqual([]);
    expect(store.states.getState('T')?.currentState).toBe('running');
    expect(store.frames.get('T-frame')).toEqual({ n: 2 });
    expect(store.frameVersion).toBe(1);
    expect(notified).toBe(1);
    await fold.foldLocalResponse(response, true, false);
    expect(hops).toEqual(['GO']);
    expect(notified).toBe(1);
  });

  it('a frame of an aggregate plus 2 dispatches notifies exactly once', async () => {
    const store = createMemoryCircuitStore();
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    const fold = createLocalFold({ store, framesSince: () => ({ session: '$program', from: 0, to: 0, ops: [] }) });
    const frame: FrameWire = {
      fired: {}, response, droppedServerEffects: 0, errors: [], browserLegs: [],
      dispatches: [1, 2].map(() => ({
        trait: 'T', orbital: 'Main', seed: { trait: 'T', event: 'GO' }, response, serverLegs: [],
        mode: 'hybridClientOnly' as const, snapshot: null, alreadyDelivered: [], awaiting: [], statefulLeg: null, foldSeeded: [],
      })),
    };
    await applyFrame(JSON.stringify(frame), fold, undefined);
    expect(notified).toBe(1);
  });

  it('a set delta folded over an existing frame keeps the fields it does not name', async () => {
    const store = createMemoryCircuitStore();
    store.frames.set('T-frame', { id: 'r1', n: 1, items: ['a', 'b'] });
    const fold = createLocalFold({ store, framesSince: () => ({ session: '$program', from: 0, to: 0, ops: [] }) });
    await fold.foldLocalResponse({ ...response, frames: { from: 0, to: 0, ops: [['set', { 'T-frame': { n: 2 } }]] } }, false, true);
    expect(store.frames.get('T-frame')).toEqual({ id: 'r1', n: 2, items: ['a', 'b'] });
  });

  it('control: a set for a frame never seen creates a frame of just that field', async () => {
    const store = createMemoryCircuitStore();
    const fold = createLocalFold({ store, framesSince: () => ({ session: '$program', from: 0, to: 0, ops: [] }) });
    await fold.foldLocalResponse({ ...response, frames: { from: 0, to: 0, ops: [['set', { 'T-frame': { n: 2 } }]] } }, false, true);
    expect(store.frames.get('T-frame')).toEqual({ n: 2 });
  });
});

describe('the store paints frame deltas by version', () => {
  const delta = (from: number, to: number, ops: FrameDelta['ops']): FrameDelta => ({ session: '$program', from, to, ops });

  it('applies a delta at its from version and a repeat of it changes nothing', () => {
    const store = createMemoryCircuitStore();
    expect(store.applyFrames(delta(0, 1, [['put', 'F', { n: 1 }]]))).toBe('applied');
    expect(store.applyFrames(delta(1, 2, [['set', { 'F': { n: 2 } }]]))).toBe('applied');
    expect(store.applyFrames(delta(1, 2, [['set', { 'F': { n: 2 } }]]))).toBe('stale');
    expect(store.frames.get('F')).toEqual({ n: 2 });
    expect(store.frameVersion).toBe(2);
  });

  it('a stale repaint does not overwrite a newer value', () => {
    const store = createMemoryCircuitStore();
    store.applyFrames(delta(0, 1, [['put', 'F', { n: 1 }]]));
    store.applyFrames(delta(1, 2, [['set', { 'F': { n: 2 } }]]));
    expect(store.applyFrames(delta(0, 1, [['clear'], ['put', 'F', { n: 1 }]]))).toBe('applied');
    store.applyFrames(delta(1, 2, [['set', { 'F': { n: 2 } }]]));
    expect(store.applyFrames(delta(0, 1, [['set', { 'F': { n: 1 } }]]))).toBe('stale');
    expect(store.frames.get('F')).toEqual({ n: 2 });
  });

  it('a gap applies nothing and the snapshot heals it', () => {
    const store = createMemoryCircuitStore();
    store.applyFrames(delta(0, 1, [['put', 'F', { n: 1 }]]));
    expect(store.applyFrames(delta(3, 4, [['set', { 'F': { n: 4 } }]]))).toBe('gap');
    expect(store.frames.get('F')).toEqual({ n: 1 });
    expect(store.applyFrames(delta(0, 4, [['clear'], ['put', 'F', { n: 4, m: 1 }]]))).toBe('applied');
    expect(store.frames.get('F')).toEqual({ n: 4, m: 1 });
    expect(store.applyFrames(delta(4, 5, [['del', 'F']]))).toBe('applied');
    expect(store.frames.has('F')).toBe(false);
  });

  it('an unversioned delta applies wherever it lands and moves no version', () => {
    const store = createMemoryCircuitStore();
    expect(store.applyFrames({ from: 0, to: 0, ops: [['set', { 'F': { n: 7 } }]] })).toBe('applied');
    expect(store.frameVersion).toBe(0);
    expect(store.frames.get('F')).toEqual({ n: 7 });
  });
});
