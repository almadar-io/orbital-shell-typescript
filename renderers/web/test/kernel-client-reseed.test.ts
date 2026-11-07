import { describe, expect, it } from 'vitest';
import type { EventRequest, EventResponse, TraitDefinition } from '@almadar/core';
import type { DispatchWire, MountSeed, MountWire, PageCircuit } from '@almadar/core/kernel-wire';
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
  hops: [],
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
  traits: ['Viewer'], entities: ['Note'],
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
    installGpu: refuse,
    dispatchHeld: refuse,
    dropHeldPayload: refuse,
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
    restore: refuse, framesSince: refuse, tick: refuse, frame: refuse, framePause: refuse, frameResume: refuse, tickCount: refuse, sessionTheme: () => undefined, traitConfig: refuse,
    setViewerLocale: refuse, setHostFansOut: refuse, setRecordEntityAfter: refuse, setTraceOn: refuse, takeTrace: refuse, setFrameEffectResults: refuse, bootMounts: refuse, routeMounts: refuse, pageCircuit: pageCircuitStub, contractQuery: refuse,
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

describe('kernel client — a mount group with a client-only seed', () => {
  const seedWire = (trait: string, mode: DispatchWire['mode'], flight: number | null): DispatchWire => ({
    orbital: 'Main', seed: { trait, event: 'INIT' }, response: response(), serverLegs: [], mode, snapshot: null,
    alreadyDelivered: [], awaiting: [], statefulLeg: null, foldSeeded: [], flight,
  });
  const mountOf = (seeds: DispatchWire[]): MountWire => ({
    seeds,
    legs: [],
    statefulLegs: [{
      orbital: 'Main', seeds: seeds.map((s) => s.seed), alreadyDelivered: [], awaiting: [], foldSeeded: [],
      leg: { event: 'INIT', mount: seeds.map((s): MountSeed => ({ trait: s.seed.trait, event: 'INIT' })), clientId: 'tab-a' },
    }],
    hops: [],
    failed: null,
  });
  const mountOver = (mount: MountWire, sent: EventRequest[]) => {
    const kernel: KernelInstance = { ...fakeKernel([]), dispatchMount: () => JSON.stringify(mount) };
    const transport: EventTransport = {
      register: async () => ({ success: true, carriesCircuitState: false }),
      unregister: async () => undefined,
      send: async (_orbital, request) => { sent.push(request); return response(); },
    };
    return createKernelClient({ instance: Promise.resolve(kernel), store: createMemoryCircuitStore(), traitIndex, transport, topology: Promise.resolve({ carriesCircuitState: false }) });
  };

  it('posts the group under the flight its server seed opened when the client-only seed opened none', async () => {
    const sent: EventRequest[] = [];
    const client = mountOver(mountOf([seedWire('Picker', 'hybridClientOnly', null), seedWire('Asker', 'persistedAwaited', 3)]), sent);
    await client.dispatchMount([{ trait: 'Picker', event: 'INIT' }, { trait: 'Asker', event: 'INIT' }]);
    expect(sent.map((r) => r.mount?.map((s) => s.trait))).toEqual([['Picker', 'Asker']]);
  });

  it('control: a group no seed opened a flight for is refused', async () => {
    const client = mountOver(mountOf([seedWire('Picker', 'hybridClientOnly', null)]), []);
    await expect(client.dispatchMount([{ trait: 'Picker', event: 'INIT' }])).rejects.toThrow('carries no flight');
  });
});

describe('kernel client — a server answer never rewrites a client trait\'s state (EXEC-DIST-4)', () => {
  const traitOf = (name: string, to: string): TraitDefinition => ({
    name,
    states: [{ name: 'idle', isInitial: true }, { name: to }],
    transitions: [{ from: 'idle', to, event: 'GO' }],
  });
  const boardWire: DispatchWire = {
    orbital: 'Main', seed: { trait: 'Board', event: 'LOAD' }, response: response({ states: { Board: 'loading' } }), mode: 'hybridClientOnly', snapshot: null,
    serverLegs: [{ orbital: 'Main', leg: { event: 'RUN', targetTrait: 'Retry', sourceTrait: 'Board', clientId: 'tab-a' } }],
    alreadyDelivered: [], awaiting: [], foldSeeded: [], statefulLeg: null, flight: 1,
  };
  const over = (answer: Partial<EventResponse>) => {
    const held: Record<string, string> = { Board: 'loading', Retry: 'running' };
    const kernel: KernelInstance = { ...fakeKernel([]), dispatch: () => JSON.stringify(boardWire), getState: (trait: string) => held[trait] ?? '' };
    const transport: EventTransport = {
      register: async () => ({ success: true, carriesCircuitState: false }),
      unregister: async () => undefined,
      send: async () => response(answer),
    };
    const store = createMemoryCircuitStore([traitOf('Board', 'loading'), traitOf('Retry', 'running')]);
    return createKernelClient({ instance: Promise.resolve(kernel), store, traitIndex, transport, topology: Promise.resolve({ carriesCircuitState: false }) });
  };

  it('keeps the client trait loading when the answer lists it idle, and takes the server trait\'s state', async () => {
    const client = over({ states: { Board: 'idle', Retry: 'running' } });
    await client.dispatch({ event: 'LOAD', targetTrait: 'Board' });
    expect(client.store.states.getState('Board')?.currentState).toBe('loading');
    expect(client.store.states.getState('Retry')?.currentState).toBe('running');
  });
});

describe('kernel client — a mount seed its topology posts in no group', () => {
  const seedWire = (trait: string, flight: number): DispatchWire => ({
    orbital: 'Main', seed: { trait, event: 'INIT' }, response: response(), serverLegs: [], mode: 'persistedAwaited', snapshot: null,
    alreadyDelivered: [], awaiting: [], statefulLeg: null, foldSeeded: [], flight,
  });
  const group = (seeds: DispatchWire[]) => ({
    orbital: 'Main', seeds: seeds.map((s) => s.seed), alreadyDelivered: [], awaiting: [], foldSeeded: [],
    leg: { event: 'INIT', mount: seeds.map((s): MountSeed => ({ trait: s.seed.trait, event: 'INIT' })), clientId: 'tab-a' },
  });
  // `Match` holds a stateful leg only (flight 0); `Sources` delegated (flight 1): a carried-state host is posted Sources alone.
  const match = seedWire('Match', 0);
  const sources = seedWire('Sources', 1);
  const mount: MountWire = { seeds: [match, sources], legs: [group([sources])], statefulLegs: [group([match, sources])], hops: [], failed: null };
  const run = async (carriesCircuitState: boolean) => {
    const log: string[] = [];
    const kernel: KernelInstance = {
      ...fakeKernel([]),
      dispatchMount: () => JSON.stringify(mount),
      endFlight: (flight: number) => { log.push(`end ${flight}`); return true; },
    };
    const transport: EventTransport = {
      register: async () => ({ success: true, carriesCircuitState }),
      unregister: async () => undefined,
      send: async (_orbital, request) => { log.push(`send ${request.mount?.map((s) => s.trait).join(',') ?? request.event}`); return response(); },
    };
    const client = createKernelClient({ instance: Promise.resolve(kernel), store: createMemoryCircuitStore(), traitIndex, transport, topology: Promise.resolve({ carriesCircuitState }) });
    await client.dispatchMount([{ trait: 'Match', event: 'INIT' }, { trait: 'Sources', event: 'INIT' }]);
    return log;
  };

  it('ends the unposted seed\'s flight before the group is sent, so the group\'s answer is not folded behind it', async () => {
    const log = await run(true);
    expect(log.slice(0, 3)).toEqual(['end 0', 'send Sources', 'end 1']);
  });

  it('control: a stateful host is posted both seeds and both flights end after the send', async () => {
    const log = await run(false);
    expect(log.slice(0, 3)).toEqual(['send Match,Sources', 'end 0', 'end 1']);
  });
});
