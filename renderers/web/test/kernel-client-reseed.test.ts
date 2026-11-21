import { describe, expect, it } from 'vitest';
import type { EventRequest, EventResponse, TraitDefinition } from '@almadar/core';
import type { ClientEffectByTrait, DispatchWire, MountSeed, MountWire, PageCircuit } from '@almadar/core/kernel-wire';
import { createMemoryCircuitStore } from '@almadar/shell-runtime/client/circuit-store';
import { SessionEndedError, type EventTransport } from '@almadar/shell-runtime/client/EventTransport';
import { createKernelClient } from '../src/lib/kernel-client';
import { NO_CIRCUIT } from '../src/lib/circuit-surface';
import type { KernelInstance } from '../src/lib/kernel-wire';

const response = (over: Partial<EventResponse> = {}): EventResponse => ({ success: true, transitioned: true, states: { Viewer: 'idle' }, emittedEvents: [], ...over });
const traitIndex = NO_CIRCUIT;

const leg = (event: string): EventRequest => ({ event, targetTrait: 'Viewer', clientId: 'tab-a' });

const mountWire: MountWire = {
  announced: null,
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
  traits: ['Viewer'], entities: ['Note'], ancestors: [],
  access: { verdict: 'admitted' },
};
const pageCircuitStub = (page?: string, route?: string): string => {
  if (page === 'Home' || route === '/') return JSON.stringify(homeCircuit);
  throw new Error(`unknown page: ${page ?? route ?? ''}`);
};

const appliedWire = { applied: [], response: response(), hostPaints: [], serverLegs: [] };
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
    heldReleased: () => '[]',
    blobsReleased: () => '[]',
    foldBase: () => undefined,
    statefulLeg: (legJson: string) => legJson,
    reseedLeg: (seedsJson: string) => {
      reseeded.push(seedsJson);
      return JSON.stringify({ event: 'INIT', mount: JSON.parse(seedsJson), clientId: 'tab-a', traits: [{ trait: 'Viewer', from: 'idle' }], entityByTrait: { Viewer: { topic: 'app' } } });
    },
    mount: () => undefined,
    enter: refuse,
    leave: refuse,
    leaveMount: refuse,
    registerLazy: refuse,
    deliverEmitToListeners: refuse,
    deliverOriginEmit: refuse,
    getState: () => 'idle',
    dispatchMode: () => JSON.stringify('persistedAwaited'),
    restore: refuse, framesSince: refuse, tick: refuse, frame: refuse, framePause: refuse, frameResume: refuse, tickCount: refuse, sessionTheme: () => undefined, seedIdentity: () => false, sessionIdentity: () => undefined, traitConfig: refuse,
    setViewerLocale: refuse, setHostFansOut: refuse, setRecordEntityAfter: refuse, setTraceOn: refuse, takeTrace: refuse, setTraceCost: refuse, takeTraceViews: refuse, setFrameEffectResults: refuse, bootMounts: refuse, routeMounts: refuse, pageCircuit: pageCircuitStub, contractQuery: refuse,
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

  it('G-CROSS-729: the re-mount carries the page the client mounted: its payload, route and crumb', async () => {
    const sent: EventRequest[] = [];
    const client = clientOver(sent, true, []);
    await client.dispatchMount([{ trait: 'Viewer', event: 'INIT' }], undefined, { payload: { name: 'project-friday', version: '1.1.0' }, route: '/review/project-friday/1.1.0', crumb: 'Review' });
    sent.length = 0;
    await client.dispatch({ event: 'READ_BACK', targetTrait: 'Viewer' });
    const remount = sent[1];
    expect(remount?.mount).toBeDefined();
    expect(remount?.payload).toEqual({ name: 'project-friday', version: '1.1.0' });
    expect(remount?.route).toBe('/review/project-friday/1.1.0');
    expect(remount?.crumb).toBe('Review');
  });

  it('control: a mount with no route or payload re-mounts without them', async () => {
    const sent: EventRequest[] = [];
    const client = clientOver(sent, true, []);
    await client.dispatchMount([{ trait: 'Viewer', event: 'INIT' }]);
    sent.length = 0;
    await client.dispatch({ event: 'READ_BACK', targetTrait: 'Viewer' });
    expect(sent[1]?.mount).toBeDefined();
    expect(sent[1]?.route).toBeUndefined();
    expect(sent[1]?.payload).toBeUndefined();
  });

  it('with no seeds mounted on that host, sends the refused event once more and mounts nothing (a fresh hosted guest)', async () => {
    const sent: EventRequest[] = [];
    const reseeded: string[] = [];
    const client = clientOver(sent, true, reseeded);
    await client.dispatch({ event: 'READ_BACK', targetTrait: 'Viewer' });
    expect(reseeded).toHaveLength(0);
    expect(sent.map((r) => (r.mount !== undefined ? 'mount' : r.event))).toEqual(['READ_BACK', 'READ_BACK']);
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
  const mountOf = (seeds: DispatchWire[], announced: DispatchWire | null = null): MountWire => ({
    announced,
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

  // G-ORBITAL-CORE-146 + EXEC-SEED-7: the browser's own $MOUNT ran before the seeds, so it paints first and its server work leaves first.
  const announcedWire: DispatchWire = {
    ...seedWire('Nav', 'hybridClientOnly', 2),
    seed: { trait: 'Nav', event: '$MOUNT' },
    serverLegs: [{ orbital: 'Main', leg: { event: 'LOAD', targetTrait: 'Data', sourceTrait: 'Nav', clientId: 'tab-a' } }],
  };

  it('paints the announce first and posts its server work before the mount leg', async () => {
    const sent: EventRequest[] = [];
    const painted: string[] = [];
    const client = mountOver(mountOf([seedWire('Data', 'persistedAwaited', 3)], announcedWire), sent);
    await client.dispatchMount([{ trait: 'Data', event: 'INIT' }], { onLocal: (trait) => painted.push(trait) });
    expect(painted).toEqual(['Nav', 'Data']);
    expect(sent.map((r) => r.mount?.map((s) => s.trait).join(',') ?? `${r.targetTrait}:${r.event}`)).toEqual(['Data:LOAD', 'Data']);
  });

  it('control: a mount with no announce posts only the mount leg', async () => {
    const sent: EventRequest[] = [];
    const painted: string[] = [];
    const client = mountOver(mountOf([seedWire('Data', 'persistedAwaited', 3)]), sent);
    await client.dispatchMount([{ trait: 'Data', event: 'INIT' }], { onLocal: (trait) => painted.push(trait) });
    expect(painted).toEqual(['Data']);
    expect(sent.map((r) => r.mount?.map((s) => s.trait).join(','))).toEqual(['Data']);
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
  const mount: MountWire = { announced: null, seeds: [match, sources], legs: [group([sources])], statefulLegs: [group([match, sources])], hops: [], failed: null };
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

describe('kernel client — a server answer crosses into the kernel', () => {
  it('as UTF-8 bytes of its JSON, so the kernel copies exactly its size', async () => {
    const folded: Uint8Array[] = [];
    const kernel = fakeKernel([]);
    const answer = response({ states: { Viewer: 'نص' } });
    kernel.foldInOrder = (_flight, responseJson) => {
      folded.push(responseJson);
      return applied();
    };
    const transport: EventTransport = {
      register: async () => ({ success: true, carriesCircuitState: false }),
      unregister: async () => undefined,
      send: async () => answer,
    };
    const client = createKernelClient({ instance: Promise.resolve(kernel), store: createMemoryCircuitStore(), traitIndex, transport, topology: Promise.resolve({ carriesCircuitState: false }) });
    await client.dispatch({ event: 'READ_BACK', targetTrait: 'Viewer' });
    expect(folded).toHaveLength(1);
    expect(folded[0]).toBeInstanceOf(Uint8Array);
    expect(JSON.parse(new TextDecoder().decode(folded[0]))).toEqual(answer);
  });
});

// G-CROSS-639: the snapshot a frame resync folds carries the identity frame and the kernel's redraw of what read `@user`.
describe('kernel client — a frame resync carries the redraw it folded', () => {
  const header: ClientEffectByTrait = { traitName: 'Header', effect: ['render-ui', 'main', { type: 'typography', content: 'Osama' }] };
  const resyncOver = (resync: boolean, sent: EventRequest[]) => {
    let folds = 0;
    const kernel: KernelInstance = {
      ...fakeKernel([]),
      framesSince: () => JSON.stringify({ since: 0, frames: [] }),
      foldInOrder: () => {
        folds += 1;
        if (folds === 1) return applied({ ...appliedWire, resync: resync ? { session: 's', since: 0 } : null });
        return applied({ ...appliedWire, response: response({ clientEffectsByTrait: [header] }) });
      },
    };
    const transport: EventTransport = {
      register: async () => ({ success: true, carriesCircuitState: false }),
      unregister: async () => undefined,
      send: async (_orbital, request) => { sent.push(request); return response(); },
    };
    return createKernelClient({ instance: Promise.resolve(kernel), store: createMemoryCircuitStore(), traitIndex, transport, topology: Promise.resolve({ carriesCircuitState: false }) });
  };

  it('hands the resync fold\'s render effects to the painter with the dispatch\'s own', async () => {
    const sent: EventRequest[] = [];
    const client = resyncOver(true, sent);
    const outcome = await client.dispatch({ event: 'READ_BACK', targetTrait: 'Viewer' }, { onLocal: () => undefined });
    expect(sent.map((r) => r.event)).toEqual(['READ_BACK', '$FRAMES']);
    expect(outcome.serverEffects?.clientEffectsByTrait).toEqual([header]);
    expect(outcome.response.clientEffectsByTrait).toEqual([header]);
  });

  it('control: an answer with no resync sends nothing more and paints only its own fold', async () => {
    const sent: EventRequest[] = [];
    const client = resyncOver(false, sent);
    const outcome = await client.dispatch({ event: 'READ_BACK', targetTrait: 'Viewer' }, { onLocal: () => undefined });
    expect(sent.map((r) => r.event)).toEqual(['READ_BACK']);
    expect(outcome.serverEffects?.clientEffectsByTrait).toEqual([]);
  });
});


describe('kernel client — host answers paint as they land', () => {
  const render = (slot: string): ClientEffectByTrait => ({ traitName: 'Viewer', effect: ['render-ui', slot, { type: 'text', text: slot }] });
  const followOn = { orbital: 'Main', leg: { event: 'DETAIL', targetTrait: 'Viewer', clientId: 'tab-a' } };
  const streaming = (sent: EventRequest[], second: Promise<void>) => {
    let folds = 0;
    const kernel: KernelInstance = {
      ...fakeKernel([]),
      foldInOrder: () => {
        folds += 1;
        return folds === 1
          ? applied({ ...appliedWire, response: response({ clientEffectsByTrait: [render('first')] }), serverLegs: [followOn] })
          : applied({ ...appliedWire, response: response({ clientEffectsByTrait: [render('second')] }) });
      },
    };
    const transport: EventTransport = {
      register: async () => ({ success: true, carriesCircuitState: false }),
      unregister: async () => undefined,
      send: async (_orbital, request) => {
        sent.push(request);
        if (request.event === 'DETAIL') await second;
        return response();
      },
    };
    return createKernelClient({ instance: Promise.resolve(kernel), store: createMemoryCircuitStore(), traitIndex, transport, topology: Promise.resolve({ carriesCircuitState: false }) });
  };
  const slots = (effects: ClientEffectByTrait[]): string[] => effects.map((e) => String(e.effect[1]));

  it('paints the first answer before the follow-on request it owes has come back', async () => {
    const sent: EventRequest[] = [];
    let release = (): void => undefined;
    const second = new Promise<void>((resolve) => { release = resolve; });
    const painted: string[][] = [];
    const client = streaming(sent, second);
    const done = client.dispatch({ event: 'READ_BACK', targetTrait: 'Viewer' }, { onLocal: () => undefined, onServer: (effects) => painted.push(slots(effects)) });
    await expect.poll(() => sent.map((r) => r.event)).toEqual(['READ_BACK', 'DETAIL']);
    expect(painted).toEqual([['first']]);
    release();
    const outcome = await done;
    expect(painted).toEqual([['first'], ['second']]);
    expect(outcome.serverPainted).toBe(true);
  });

  it('control: without onServer every answer\'s paint comes back once, at the end, and nothing says it was painted', async () => {
    const sent: EventRequest[] = [];
    const client = streaming(sent, Promise.resolve());
    const outcome = await client.dispatch({ event: 'READ_BACK', targetTrait: 'Viewer' }, { onLocal: () => undefined });
    expect(slots(outcome.serverEffects?.clientEffectsByTrait ?? [])).toEqual(['first', 'second']);
    expect(outcome.serverPainted).toBeUndefined();
  });
});
