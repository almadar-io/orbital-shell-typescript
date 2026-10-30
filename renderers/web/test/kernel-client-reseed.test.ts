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
    setCurrentUser: refuse, setMessages: refuse, setHostFansOut: refuse, setRecordEntityAfter: refuse, setFrameEffectResults: refuse, bootMounts: refuse, routeMounts: refuse, pageCircuit: pageCircuitStub, contractQuery: refuse,
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

describe('kernel client — the viewer is bound before the first mount and dispatch', () => {
  function orderedKernel(calls: string[]): KernelInstance {
    return { ...fakeKernel([]), setCurrentUser: (userJson: string) => { calls.push(`user:${(JSON.parse(userJson) as { id: string }).id}`); }, dispatchMount: () => { calls.push('mount'); return JSON.stringify(mountWire); }, dispatch: () => { calls.push('dispatch'); return JSON.stringify(dispatchWire); } };
  }
  const slowClient = (calls: string[]) => {
    let load!: (k: KernelInstance) => void;
    const instance = new Promise<KernelInstance>((resolve) => { load = resolve; });
    const client = createKernelClient({ instance, store: createMemoryCircuitStore(), traitIndex, topology: Promise.resolve({ carriesCircuitState: false }) });
    return { client, load: () => load(orderedKernel(calls)) };
  };

  it('binds the viewer before a mount queued ahead of it', async () => {
    const calls: string[] = [];
    const { client, load } = slowClient(calls);
    const mounted = client.dispatchMount([{ trait: 'Viewer', event: 'INIT' }]);
    const bound = client.setViewer({ id: 'maya' });
    load();
    await Promise.all([mounted, bound]);
    expect(calls).toEqual(['user:maya', 'mount']);
  });

  it('binds the viewer before a dispatch queued ahead of it', async () => {
    const calls: string[] = [];
    const { client, load } = slowClient(calls);
    const sent = client.dispatch({ event: 'READ_BACK', targetTrait: 'Viewer' });
    const bound = client.setViewer({ id: 'maya' });
    load();
    await Promise.all([sent, bound]);
    expect(calls).toEqual(['user:maya', 'dispatch']);
  });

  it('control: with no viewer declared the mount runs on its own', async () => {
    const calls: string[] = [];
    const { client, load } = slowClient(calls);
    const mounted = client.dispatchMount([{ trait: 'Viewer', event: 'INIT' }]);
    load();
    await mounted;
    expect(calls).toEqual(['mount']);
  });
});

describe('kernel client — frames the host numbered past the version the kernel holds', () => {
  it('asks the host for the frames since that version, folds the snapshot, and asks once', async () => {
    const sent: EventRequest[] = [];
    let folds = 0;
    const kernel: KernelInstance = {
      ...fakeKernel([]),
      foldInOrder: () => {
        folds += 1;
        return applied({ ...appliedWire, ...(folds === 1 ? { resync: { session: 'tab-a', since: 3 } } : {}) });
      },
    };
    const transport: EventTransport = {
      register: async () => ({ success: true, carriesCircuitState: false }),
      unregister: async () => undefined,
      send: async (_orbital, request) => {
        sent.push(request);
        return response();
      },
    };
    const client = createKernelClient({ instance: Promise.resolve(kernel), store: createMemoryCircuitStore(), traitIndex, transport, topology: Promise.resolve({ carriesCircuitState: false }) });
    await client.dispatch({ event: 'READ_BACK', targetTrait: 'Viewer' });
    expect(sent.map((r) => r.framesSince ?? r.event)).toEqual(['READ_BACK', 3]);
    expect(sent[1]?.clientId).toBe('tab-a');
  });
});

describe('kernel client — the kernel orders the folds of dispatches in flight (EXEC-CONC-8, twin of exec_conc_8_* in orbital-core)', () => {
  const flush = async (): Promise<void> => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

  /** A kernel that keeps the kernel's rule: flights number in dispatch order and an answer folds only as the oldest open flight. */
  function orderingKernel(folded: number[], ended: number[]): KernelInstance {
    let nextFlight = 1;
    let nextTicket = 1;
    const open: number[] = [];
    const queued: Array<{ ticket: number; flight: number }> = [];
    const apply = (flight: number): string => { folded.push(flight); return JSON.stringify({ applied: [], response: response(), serverLegs: [] }); };
    return {
      ...fakeKernel([]),
      dispatch: (_trait, _entity, event) => {
        const flight = nextFlight;
        nextFlight += 1;
        open.push(flight);
        return JSON.stringify({ ...dispatchWire, seed: { trait: 'Viewer', event }, flight, statefulLeg: { orbital: 'Main', leg: leg(event), awaiting: [] } } satisfies DispatchWire);
      },
      foldInOrder: (flight) => {
        if (open[0] === flight && !queued.some((q) => q.flight === flight)) return JSON.stringify({ status: 'applied', fold: JSON.parse(apply(flight)) });
        const ticket = nextTicket;
        nextTicket += 1;
        queued.push({ ticket, flight });
        return JSON.stringify({ status: 'queued', ticket });
      },
      nextFold: () => {
        const at = queued.findIndex((q) => q.flight === open[0]);
        if (at < 0) return undefined;
        const [q] = queued.splice(at, 1);
        return JSON.stringify({ outcome: 'applied', ticket: q!.ticket, fold: JSON.parse(apply(q!.flight)) });
      },
      endFlight: (flight) => {
        ended.push(flight);
        queued.splice(0, queued.length, ...queued.filter((q) => q.flight !== flight));
        const at = open.indexOf(flight);
        if (at >= 0) open.splice(at, 1);
        return at >= 0;
      },
    };
  }

  function deferred() {
    const sends: string[] = [];
    const settle = new Map<string, () => void>();
    const transport: EventTransport = {
      register: async () => ({ success: true, carriesCircuitState: false }),
      unregister: async () => undefined,
      send: (_orbital, request) => new Promise<EventResponse>((resolve) => {
        sends.push(request.event);
        settle.set(request.event, () => resolve(response()));
      }),
    };
    return { sends, settle, transport };
  }

  const clientFor = (kernel: KernelInstance, transport: EventTransport) =>
    createKernelClient({ instance: Promise.resolve(kernel), store: createMemoryCircuitStore(), traitIndex, transport, topology: Promise.resolve({ carriesCircuitState: false }) });

  it('posts both dispatches at once and folds them in dispatch order when the later post resolves first', async () => {
    const folded: number[] = [];
    const ended: number[] = [];
    const { sends, settle, transport } = deferred();
    const client = clientFor(orderingKernel(folded, ended), transport);
    const first = client.dispatch({ event: 'A', targetTrait: 'Viewer' });
    const second = client.dispatch({ event: 'B', targetTrait: 'Viewer' });
    await flush();
    expect(sends).toEqual(['A', 'B']);
    settle.get('B')?.();
    await flush();
    expect(folded).toEqual([]);
    settle.get('A')?.();
    await Promise.all([first, second]);
    expect(folded).toEqual([1, 2]);
    expect(ended).toEqual([1, 2]);
  });

  it('control: answers arriving in dispatch order fold as they arrive', async () => {
    const folded: number[] = [];
    const ended: number[] = [];
    const { sends, settle, transport } = deferred();
    const client = clientFor(orderingKernel(folded, ended), transport);
    const first = client.dispatch({ event: 'A', targetTrait: 'Viewer' });
    const second = client.dispatch({ event: 'B', targetTrait: 'Viewer' });
    await flush();
    settle.get('A')?.();
    await first;
    expect(folded).toEqual([1]);
    settle.get('B')?.();
    await second;
    expect(sends).toEqual(['A', 'B']);
    expect(folded).toEqual([1, 2]);
  });

  it('a post that fails ends its flight so the dispatches behind it still fold', async () => {
    const folded: number[] = [];
    const ended: number[] = [];
    const transport: EventTransport = {
      register: async () => ({ success: true, carriesCircuitState: false }),
      unregister: async () => undefined,
      send: async (_orbital, request) => {
        if (request.event === 'A') throw new Error('offline');
        return response();
      },
    };
    const client = clientFor(orderingKernel(folded, ended), transport);
    const first = client.dispatch({ event: 'A', targetTrait: 'Viewer' });
    const second = client.dispatch({ event: 'B', targetTrait: 'Viewer' });
    await expect(first).rejects.toThrow('offline');
    await second;
    expect(folded).toEqual([2]);
    expect(ended).toEqual([1, 2]);
  });
});

describe('kernel client — a host dispatch the client folds can owe the host a leg (G-ORBITAL-SHELL-TYPESCRIPT-096)', () => {
  const owed = { orbital: 'Main', leg: leg('CLI_RUN') };
  const withFold = (fold: object): KernelInstance => {
    let first = true;
    return { ...fakeKernel([]), dispatchMode: () => JSON.stringify('persistedAwaited'), foldInOrder: () => { const now = first ? fold : appliedWire; first = false; return applied(now); } };
  };
  const recording = (sent: string[]): EventTransport => ({
    register: async () => ({ success: true, carriesCircuitState: false }),
    unregister: async () => undefined,
    send: async (_orbital, request) => { sent.push(request.event); return response(); },
  });
  const clientOf = (kernel: KernelInstance, transport: EventTransport) =>
    createKernelClient({ instance: Promise.resolve(kernel), store: createMemoryCircuitStore(), traitIndex, transport, topology: Promise.resolve({ carriesCircuitState: false }) });

  it('posts the leg the folded host answer owes, so a multi-stage board does not stall after stage one', async () => {
    const sent: string[] = [];
    const client = clientOf(withFold({ ...appliedWire, serverLegs: [owed] }), recording(sent));
    await client.foldHostDispatch({ event: 'CR_RAN', targetTrait: 'Viewer' }, response());
    expect(sent).toEqual(['CLI_RUN']);
  });

  it('control: a folded host answer that owes nothing posts nothing', async () => {
    const sent: string[] = [];
    const client = clientOf(withFold(appliedWire), recording(sent));
    await client.foldHostDispatch({ event: 'CR_RAN', targetTrait: 'Viewer' }, response());
    expect(sent).toEqual([]);
  });
});
