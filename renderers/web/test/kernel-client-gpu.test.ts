import { describe, expect, it } from 'vitest';
import type { EventResponse } from '@almadar/core';
import type { DispatchWire } from '@almadar/core/kernel-wire';
import { createMemoryCircuitStore } from '@almadar/shell-runtime/client/circuit-store';
import type { KernelGpuHost } from '@almadar/shell-runtime/kernel/wire';
import { createKernelClient } from '../src/lib/kernel-client';
import { NO_CIRCUIT } from '../src/lib/circuit-surface';
import type { KernelInstance } from '../src/lib/kernel-wire';

const response = (): EventResponse => ({ success: true, transitioned: true, states: { Sim: 'idle' }, emittedEvents: [] });
const wire = (event: string): DispatchWire => ({
  orbital: 'Main', seed: { trait: 'Sim', event }, response: response(), serverLegs: [], mode: 'hybridClientOnly', snapshot: null,
  alreadyDelivered: [], awaiting: [], foldSeeded: [], statefulLeg: null, flight: null,
});

interface Seen {
  installed: Array<KernelGpuHost>;
  completed: Array<(json: string) => void>;
  dispatched: string[];
  held: Array<{ trait: string; entity: string | undefined; event: string; ticket: number }>;
  dropped: number[];
}

function fakeKernel(seen: Seen, heldFails = false): KernelInstance {
  const refuse = (): never => { throw new Error('not used by this test'); };
  return {
    dispatch: (_trait: string, _entity: string | undefined, event: string) => { seen.dispatched.push(event); return JSON.stringify(wire(event)); },
    installGpu: (gpu: KernelGpuHost, completed: (json: string) => void) => { seen.installed.push(gpu); seen.completed.push(completed); },
    dispatchHeld: (trait: string, entity: string | undefined, event: string, ticket: number) => {
      if (heldFails) throw new Error('no completion payload is held');
      seen.held.push({ trait, entity, event, ticket });
      return JSON.stringify(wire(event));
    },
    dropHeldPayload: (ticket: number) => { seen.dropped.push(ticket); return true; },
    dispatchMount: refuse, openFlight: refuse, foldInOrder: refuse, nextFold: () => undefined, endFlight: () => true, foldBase: refuse,
    statefulLeg: refuse, reseedLeg: refuse, mount: refuse, enter: refuse, leave: refuse, deliverEmitToListeners: refuse, deliverOriginEmit: refuse,
    getState: () => 'idle', dispatchMode: () => JSON.stringify('hybridClientOnly'),
    restore: refuse, framesSince: () => JSON.stringify({ from: 0, to: 0, ops: [] }), tick: refuse, frame: refuse, framePause: refuse, frameResume: refuse, tickCount: refuse,
    sessionTheme: () => undefined, traitConfig: refuse, setViewerLocale: refuse, setHostFansOut: refuse, setRecordEntityAfter: refuse, setTraceOn: refuse,
    takeTrace: () => '[]', setTraceCost: refuse, takeTraceViews: () => '[]', setFrameEffectResults: refuse, bootMounts: refuse, routeMounts: refuse, pageCircuit: refuse, contractQuery: refuse,
    setTraitOnScreen: refuse, seed: refuse, free: refuse,
  };
}

const seenNow = (): Seen => ({ installed: [], completed: [], dispatched: [], held: [], dropped: [] });
const gpuHost: KernelGpuHost = { closeAll: () => undefined };
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

describe('kernel client — a host GPU answerer', () => {
  it('is installed before the first dispatch, and a completion runs its route event with the payload the kernel holds', async () => {
    const seen = seenNow();
    const client = createKernelClient({ instance: Promise.resolve(fakeKernel(seen)), store: createMemoryCircuitStore(), traitIndex: NO_CIRCUIT, topology: Promise.resolve({ carriesCircuitState: false }), gpu: Promise.resolve(gpuHost) });
    await client.dispatch({ event: 'START', targetTrait: 'Sim' });
    expect(seen.installed).toEqual([gpuHost]);
    expect(seen.dispatched).toEqual(['START']);
    seen.completed[0]?.(JSON.stringify({ traitName: 'Sim', event: 'GPU_RESULT', heldPayload: 7 }));
    await settle();
    expect(seen.held).toEqual([{ trait: 'Sim', entity: undefined, event: 'GPU_RESULT', ticket: 7 }]);
    expect(seen.dispatched, 'a held completion never crosses as a payload').toEqual(['START']);
  });

  it('a completion is painted by the running frame clock, as a tick is', async () => {
    const seen = seenNow();
    const client = createKernelClient({ instance: Promise.resolve(fakeKernel(seen)), store: createMemoryCircuitStore(), traitIndex: NO_CIRCUIT, topology: Promise.resolve({ carriesCircuitState: false }), gpu: Promise.resolve(gpuHost) });
    const painted: string[] = [];
    const stop = client.startFrames((outcomes) => { painted.push(...outcomes.map((o) => o.response.states['Sim'] ?? '')); }, () => () => undefined);
    await client.dispatch({ event: 'START', targetTrait: 'Sim' });
    seen.completed[0]?.(JSON.stringify({ traitName: 'Sim', event: 'GPU_RESULT', heldPayload: 4 }));
    await settle();
    expect(painted).toEqual(['idle']);
    stop();
    seen.completed[0]?.(JSON.stringify({ traitName: 'Sim', event: 'GPU_RESULT', heldPayload: 5 }));
    await settle();
    expect(painted, 'a stopped clock paints nothing more').toEqual(['idle']);
  });

  it('a completion that takes no route dispatches nothing', async () => {
    const seen = seenNow();
    const client = createKernelClient({ instance: Promise.resolve(fakeKernel(seen)), store: createMemoryCircuitStore(), traitIndex: NO_CIRCUIT, topology: Promise.resolve({ carriesCircuitState: false }), gpu: Promise.resolve(gpuHost) });
    await client.dispatch({ event: 'START', targetTrait: 'Sim' });
    seen.completed[0]?.('null');
    await settle();
    expect(seen.held).toEqual([]);
  });

  it('a completion whose dispatch fails drops its held payload', async () => {
    const seen = seenNow();
    const client = createKernelClient({ instance: Promise.resolve(fakeKernel(seen, true)), store: createMemoryCircuitStore(), traitIndex: NO_CIRCUIT, topology: Promise.resolve({ carriesCircuitState: false }), gpu: Promise.resolve(gpuHost) });
    await client.dispatch({ event: 'START', targetTrait: 'Sim' });
    seen.completed[0]?.(JSON.stringify({ traitName: 'Sim', event: 'GPU_RESULT', heldPayload: 9 }));
    await settle();
    expect(seen.dropped).toEqual([9]);
  });

  it('control: with no answerer nothing is installed', async () => {
    const seen = seenNow();
    const client = createKernelClient({ instance: Promise.resolve(fakeKernel(seen)), store: createMemoryCircuitStore(), traitIndex: NO_CIRCUIT, topology: Promise.resolve({ carriesCircuitState: false }) });
    await client.dispatch({ event: 'START', targetTrait: 'Sim' });
    expect(seen.installed).toEqual([]);
  });
});
