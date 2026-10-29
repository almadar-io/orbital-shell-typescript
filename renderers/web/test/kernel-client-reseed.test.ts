import { describe, expect, it } from 'vitest';
import type { OrbitalEventRequest, OrbitalEventResponse, TraitIndex } from '@almadar/core';
import type { DispatchWire, MountWire } from '@almadar/core/kernel-wire';
import { createMemoryCircuitStore } from '@almadar/shell-runtime/client/circuit-store';
import { SessionEndedError, type EventTransport } from '@almadar/shell-runtime/client/EventTransport';
import { createKernelClient } from '../src/lib/kernel-client';
import type { KernelInstance } from '../src/lib/kernel-wire';

const response = (over: Partial<OrbitalEventResponse> = {}): OrbitalEventResponse => ({ success: true, transitioned: true, states: { Viewer: 'idle' }, emittedEvents: [], ...over });
const traitIndex: TraitIndex = { byName: new Map(), allEntities: [], orbitals: [] };

const leg = (event: string): OrbitalEventRequest => ({ event, targetTrait: 'Viewer', clientId: 'tab-a' });

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
  alreadyDelivered: [], awaiting: [], foldSeeded: [],
  statefulLeg: { orbital: 'Main', leg: leg('READ_BACK'), awaiting: [] },
};

const appliedWire = JSON.stringify({ applied: [], response: response(), serverLegs: [] });

function fakeKernel(reseeded: string[]): KernelInstance {
  const refuse = (): never => { throw new Error('not used by this test'); };
  return {
    dispatch: () => JSON.stringify(dispatchWire),
    dispatchMount: () => JSON.stringify(mountWire),
    applyServerResponse: () => appliedWire,
    foldBase: () => undefined,
    statefulLeg: (legJson: string) => legJson,
    reseedLeg: (seedsJson: string) => {
      reseeded.push(seedsJson);
      return JSON.stringify({ event: 'INIT', mount: JSON.parse(seedsJson), clientId: 'tab-a', traits: [{ trait: 'Viewer', from: 'idle' }], entityByTrait: { Viewer: { topic: 'app' } } });
    },
    mount: () => undefined,
    remount: () => undefined,
    unmount: () => undefined,
    getState: () => 'idle',
    dispatchMode: () => JSON.stringify('persistedAwaited'),
    restore: refuse, tick: refuse, frame: refuse, framePause: refuse, frameResume: refuse, tickCount: refuse, traitConfig: refuse,
    setCurrentUser: refuse, setMessages: refuse, setHostFansOut: refuse, setRecordEntityAfter: refuse, setFrameEffectResults: refuse, bootMounts: refuse, routeMounts: refuse,
    setTraitOnScreen: refuse, seed: refuse, free: refuse,
  };
}

function clientOver(sent: OrbitalEventRequest[], endedOnce: boolean, reseeded: string[]) {
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

describe('kernel client — a host that freed this client session', () => {
  it('mounts again with the frame and state the client holds, then sends the refused event once more', async () => {
    const sent: OrbitalEventRequest[] = [];
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
    const sent: OrbitalEventRequest[] = [];
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
