import { describe, expect, it } from 'vitest';
import type { EventRequest, EventResponse } from '@almadar/core';
import type { DispatchWire, MountWire, PageCircuit } from '@almadar/core/kernel-wire';
import { createMemoryCircuitStore } from '@almadar/shell-runtime/client/circuit-store';
import { SessionEndedError, type EventTransport } from '@almadar/shell-runtime/client/EventTransport';
import { createKernelClient } from '../src/lib/kernel-client';
import { NO_CIRCUIT } from '../src/lib/circuit-surface';
import type { KernelInstance } from '../src/lib/kernel-wire';

const response = (over: Partial<EventResponse> = {}): EventResponse => ({ success: true, transitioned: true, states: { Viewer: 'idle' }, emittedEvents: [], ...over });
const traitIndex = NO_CIRCUIT;

const leg = (event: string): EventRequest => ({ event, targetTrait: 'Viewer', clientId: 'tab-a' });

const mountWire: MountWire = {
  seeds: [{
    orbital: 'Main', seed: { trait: 'Viewer', event: 'INIT' }, response: response(), serverLegs: [], mode: 'persistedAwaited', snapshot: null,
    alreadyDelivered: [], awaiting: [], statefulLeg: null, foldSeeded: [],
  } satisfies DispatchWire],
  legs: [],
  statefulLegs: [],
  failed: null,
};

const dispatchWire: DispatchWire = {
  orbital: 'Main', seed: { trait: 'Viewer', event: 'READ_BACK' }, response: response(), serverLegs: [], mode: 'persistedAwaited', snapshot: null,
  alreadyDelivered: [], awaiting: [], foldSeeded: [], flight: 1,
  statefulLeg: { orbital: 'Main', leg: leg('READ_BACK'), awaiting: [] },
};

const homeCircuit: PageCircuit = {
  route: '/', page: 'Home', notFound: false, mounts: [{ trait: 'Viewer', event: 'INIT' }],
  embedded: [], embeddedBy: [],
  orbitalByTrait: { Viewer: 'Main' }, linkedEntityByTrait: { Viewer: 'Note' },
};
const pageCircuitStub = (page?: string, route?: string): string => {
  if (page === 'Home' || route === '/') return JSON.stringify(homeCircuit);
  throw new Error(`unknown page: ${page ?? route ?? ''}`);
};

const appliedWire = { applied: [], response: response(), serverLegs: [] };
const applied = (fold: object = appliedWire): string => JSON.stringify({ status: 'applied', fold });

function fakeKernel(reseeded: string[]): KernelInstance {
  const refuse = (): never => { throw new Error('not used by this test'); };
  return {
    dispatch: () => JSON.stringify(dispatchWire),
    dispatchMount: () => JSON.stringify(mountWire),
    openFlight: () => 2,
    foldInOrder: () => applied(),
    nextFold: () => undefined,
    endFlight: () => true,
    foldBase: () => undefined,
    statefulLeg: (legJson: string) => legJson,
    reseedLeg: (seedsJson: string) => {
      reseeded.push(seedsJson);
      return JSON.stringify({ event: 'INIT', mount: JSON.parse(seedsJson), clientId: 'tab-a', traits: [{ trait: 'Viewer', from: 'idle' }], entityByTrait: { Viewer: { topic: 'app' } } });
    },
    mount: () => undefined,
    enter: refuse,
    leave: refuse,
    deliverEmitToListeners: refuse,
    deliverOriginEmit: refuse,
    getState: () => 'idle',
    dispatchMode: () => JSON.stringify('persistedAwaited'),
    restore: refuse, framesSince: refuse, tick: refuse, frame: refuse, framePause: refuse, frameResume: refuse, tickCount: refuse, traitConfig: refuse,
    setMessages: refuse, setHostFansOut: refuse, setRecordEntityAfter: refuse, setFrameEffectResults: refuse, bootMounts: refuse, routeMounts: refuse, pageCircuit: pageCircuitStub, contractQuery: refuse,
    setTraitOnScreen: refuse, seed: refuse, free: refuse,
  };
}

function clientOver(sent: EventRequest[], endedOnce: boolean, reseeded: string[]) {
  let refusals = endedOnce ? 1 : 0;
  const transport: EventTransport = {
    register: async () => ({ success: true, carriesCircuitState: false }),
    unregister: async () => undefined,
    send: async (_orbital, request) => {
      sent.push(request);
      if (request.mount === undefined && refusals > 0) {
        refusals -= 1;
        throw new SessionEndedError('the session ended');
      }
      return response();
    },
  };
  return createKernelClient({ instance: Promise.resolve(fakeKernel(reseeded)), store: createMemoryCircuitStore(), traitIndex, transport, topology: Promise.resolve({ carriesCircuitState: false }) });
}

describe('kernel client — the page circuit is the kernel\'s answer', () => {
  it('returns the parsed PageCircuit for a page name and for a route', async () => {
    const client = clientOver([], false, []);
    expect(await client.pageCircuit('Home')).toEqual(homeCircuit);
    expect(await client.pageCircuit(undefined, '/')).toEqual(homeCircuit);
  });

  it('control: a page the kernel refuses rejects the call', async () => {
    const client = clientOver([], false, []);
    await expect(client.pageCircuit('Nope')).rejects.toThrow('unknown page: Nope');
  });
});

describe('kernel client — a host that freed this client session', () => {
  it('mounts again with the frame and state the client holds, then sends the refused event once more', async () => {
    const sent: EventRequest[] = [];
    const reseeded: string[] = [];
    const client = clientOver(sent, true, reseeded);
    await client.dispatchMount([{ trait: 'Viewer', event: 'INIT' }]);
    sent.length = 0;
    await client.dispatch({ event: 'READ_BACK', targetTrait: 'Viewer' });
    expect(reseeded).toHaveLength(1);
    expect(sent.map((r) => (r.mount !== undefined ? 'mount' : r.event))).toEqual(['READ_BACK', 'mount', 'READ_BACK']);
    expect(sent[1]?.entityByTrait).toEqual({ Viewer: { topic: 'app' } });
  });

  it('control: a live session sends the event once and mounts nothing again', async () => {
    const sent: EventRequest[] = [];
    const reseeded: string[] = [];
    const client = clientOver(sent, false, reseeded);
    await client.dispatchMount([{ trait: 'Viewer', event: 'INIT' }]);
    sent.length = 0;
    await client.dispatch({ event: 'READ_BACK', targetTrait: 'Viewer' });
    expect(reseeded).toHaveLength(0);
    expect(sent.map((r) => r.event)).toEqual(['READ_BACK']);
  });
});
