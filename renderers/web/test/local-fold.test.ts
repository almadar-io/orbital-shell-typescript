import { describe, expect, it } from 'vitest';
import type { OrbitalEventResponse } from '@almadar/core';
import { createMemoryCircuitStore } from '../src/client/circuit-store.js';
import type { FrameWire } from '@almadar/core/kernel-wire';
import { applyFrame } from '../src/kernel/frame-applier.js';
import { createLocalFold } from '../src/client/local-fold.js';

const response: OrbitalEventResponse = {
  success: true,
  transitioned: true,
  states: { T: 'running' },
  entityByTrait: { T: { n: 2 }, Ghost: { n: 9 } },
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
      frameKeyOf: (trait) => (trait === 'T' ? 'T-frame' : undefined),
      observer: { onTransition: (t) => { hops.push(t.event); } },
    });
    await fold.foldLocalResponse(response, false, true);
    expect(hops).toEqual([]);
    expect(store.states.getState('T')?.currentState).toBe('running');
    expect(store.frames.get('T-frame')).toEqual({ n: 2 });
    expect(store.frames.has('Ghost')).toBe(false);
    expect(notified).toBe(1);
    await fold.foldLocalResponse(response, true, false);
    expect(hops).toEqual(['GO']);
    expect(notified).toBe(1);
  });

  it('a frame of an aggregate plus 2 dispatches notifies exactly once', async () => {
    const store = createMemoryCircuitStore();
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    const fold = createLocalFold({ store, frameKeyOf: () => undefined });
    const frame: FrameWire = {
      fired: [], response, droppedServerEffects: 0, errors: [], browserLegs: [],
      dispatches: [1, 2].map(() => ({
        trait: 'T', orbital: 'Main', seed: { trait: 'T', event: 'GO' }, response, serverLegs: [],
        mode: 'hybridClientOnly' as const, snapshot: null, alreadyDelivered: [], awaiting: [], statefulLeg: null, foldSeeded: [],
      })),
    };
    await applyFrame(JSON.stringify(frame), fold, undefined);
    expect(notified).toBe(1);
  });
});
