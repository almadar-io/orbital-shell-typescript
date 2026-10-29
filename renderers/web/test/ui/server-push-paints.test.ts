// @vitest-environment jsdom
// A server-pushed event (a live message of this tab's own running call, or a
// peer's persist) reaches its listener AND repaints the listener's slots —
// the same settle a bus-entered dispatch gets.
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTraitStateMachine } from '../../src/hooks/useTraitStateMachine';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import type { EventTransport, EventTransportRegisterResult, HostDispatchListener, PushTarget } from '../../src';
import type { OrbitalEventRequest, OrbitalEventResponse } from '@almadar/core';
import type { ClientEffectTuple, EmittedEvent, OrbitalId, OrbitalSchema, ResolvedTraitBinding, Trait } from '@almadar/core';
import { createEmptyResolvedTrait } from '@almadar/core';
import { TEST_STAMP } from '../../src/test-support/kernel-engine';

const chat: Trait = {
  name: 'Chat',
  linkedEntity: 'Turn',
  listens: [{ event: 'STEP', source: { kind: 'trait', trait: 'Loop' }, triggers: 'STEP' }],
  stateMachine: {
    states: [{ name: 'idle', isInitial: true }],
    events: [{ key: 'STEP', name: 'Step' }],
    transitions: [
      { from: 'idle', to: 'idle', event: 'STEP', effects: [['render-ui', 'main', { type: 'typography', content: '@payload.text' }]] },
    ],
  },
};

const orbitals: OrbitalSchema['orbitals'] = [{
  name: 'ChatOrbital',
  id: 'orb_chat' as OrbitalId,
  pages: [],
  entity: { name: 'Turn', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
  traits: [chat],
}];

class PushingServer implements EventTransport {
  push: ((emitted: EmittedEvent, target: PushTarget) => void) | undefined;
  register(): Promise<EventTransportRegisterResult> { return Promise.resolve({ success: true, carriesCircuitState: false }); }
  unregister(): Promise<void> { return Promise.resolve(); }
  send(_orbital: string, _request: OrbitalEventRequest): Promise<OrbitalEventResponse> {
    return Promise.resolve({ success: true, transitioned: false, states: {}, emittedEvents: [] });
  }
  subscribe(onPush: (emitted: EmittedEvent, target: PushTarget) => void): () => void {
    this.push = onPush;
    return () => { this.push = undefined; };
  }
}

function stubSlots(): UISlotManager & { render: ReturnType<typeof vi.fn> } {
  return {
    slots: {},
    render: vi.fn(() => 'id'),
    clear: vi.fn(),
    clearBySource: vi.fn(),
    clearById: vi.fn(),
    clearAll: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    hasContent: vi.fn(() => false),
    getContent: vi.fn(() => null),
    getTraitContent: vi.fn(() => null),
    subscribeTrait: vi.fn(() => () => undefined),
    updateTraitContent: vi.fn(() => 'id'),
  };
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function pushed(event: string, target: PushTarget) {
  const slots = stubSlots();
  const server = new PushingServer();
  const binding: ResolvedTraitBinding = { trait: createEmptyResolvedTrait('Chat', 'schema'), linkedEntity: 'Turn' };
  renderHook(() => useTraitStateMachine([binding], slots, { stamp: TEST_STAMP, orbitals, transport: server }));
  await settle();
  slots.render.mockClear();
  server.push?.({ event, payload: { text: 'reading Task' }, source: { orbital: 'ChatOrbital', trait: 'Loop' } }, target);
  await settle();
  await settle();
  return slots.render.mock.calls.map(([arg]) => (arg as { props?: { content?: string } }).props?.content);
}

describe('server push ingress', () => {
  it('a live message of this tab\'s own call repaints its listener', async () => {
    expect(await pushed('STEP', 'origin')).toEqual(['reading Task']);
  });

  it('a peer push repaints its listener too', async () => {
    expect(await pushed('STEP', 'peers')).toEqual(['reading Task']);
  });

  it('control: a push no trait listens to paints nothing', async () => {
    expect(await pushed('UNHEARD', 'origin')).toEqual([]);
  });
});

// A call-service `emit.onMessage` event is the CALLING trait's own event (declared in its
// `emits`, handled by its own arm, like `success`): the live push names that trait as its
// source and must reach it, not only traits that listen to it.
const creator: Trait = {
  name: 'Creator',
  linkedEntity: 'Turn',
  emits: [{ event: 'GOAL_PROGRESS', scope: 'internal' }],
  stateMachine: {
    states: [{ name: 'creating', isInitial: true }],
    events: [{ key: 'GOAL_PROGRESS', name: 'Progress' }],
    transitions: [
      { from: 'creating', to: 'creating', event: 'GOAL_PROGRESS', effects: [['render-ui', 'main', { type: 'typography', content: '@payload.text' }]] },
    ],
  },
};

const creatorOrbitals: OrbitalSchema['orbitals'] = [{
  name: 'StartOrbital',
  id: 'orb_start' as OrbitalId,
  pages: [],
  entity: { name: 'Turn', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
  traits: [creator],
}];

async function pushedToCaller(target: PushTarget, sourceTrait: string) {
  const slots = stubSlots();
  const server = new PushingServer();
  const binding: ResolvedTraitBinding = { trait: createEmptyResolvedTrait('Creator', 'schema'), linkedEntity: 'Turn' };
  renderHook(() => useTraitStateMachine([binding], slots, { stamp: TEST_STAMP, orbitals: creatorOrbitals, transport: server }));
  await settle();
  slots.render.mockClear();
  server.push?.({ event: 'GOAL_PROGRESS', payload: { text: 'Rust' }, source: { orbital: 'StartOrbital', trait: sourceTrait } }, target);
  await settle();
  await settle();
  return slots.render.mock.calls.map(([arg]) => (arg as { props?: { content?: string } }).props?.content);
}

describe('a running call\'s own live message', () => {
  it('reaches the calling trait\'s own arm', async () => {
    expect(await pushedToCaller('origin', 'Creator')).toEqual(['Rust']);
  });

  it('control: a peer push is never delivered back to its source trait', async () => {
    expect(await pushedToCaller('peers', 'Creator')).toEqual([]);
  });

  it('edge: a message whose calling trait is not on this page paints nothing', async () => {
    expect(await pushedToCaller('origin', 'Elsewhere')).toEqual([]);
  });
});

// A trait that calls a service reaches the server, so it is never client-only and the host's result is its own.
const builder: Trait = {
  name: 'Builder',
  linkedEntity: 'Turn',
  stateMachine: {
    states: [{ name: 'building', isInitial: true }, { name: 'built' }],
    events: [{ key: 'BUILD', name: 'Build' }, { key: 'BUILD_DONE', name: 'Done' }],
    transitions: [
      { from: 'building', to: 'building', event: 'BUILD', effects: [['call-service', 'knowledge', 'expand', { graphId: 'g' }, { emit: { success: 'BUILD_DONE' } }]] },
      { from: 'building', to: 'built', event: 'BUILD_DONE', effects: [['render-ui', 'main', { type: 'typography', content: 'Built' }]] },
    ],
  },
};

const builderOrbitals: OrbitalSchema['orbitals'] = [{
  name: 'BuildOrbital',
  id: 'orb_build' as OrbitalId,
  pages: [],
  entity: { name: 'Turn', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
  traits: [builder],
}];

class DispatchingServer extends PushingServer {
  dispatch: HostDispatchListener | undefined;
  dispatchParams: Record<string, string> | undefined;
  subscribeHostDispatches(onDispatch: HostDispatchListener, params?: Record<string, string>): () => void {
    this.dispatch = onDispatch;
    this.dispatchParams = params;
    return () => { this.dispatch = undefined; };
  }
}

describe('a host-run dispatch (a follow-on call\'s outcome)', () => {
  it('lands in the view: the trait repaints with the host\'s result, on the tab\'s own channel', async () => {
    const slots = stubSlots();
    const server = new DispatchingServer();
    const binding: ResolvedTraitBinding = { trait: createEmptyResolvedTrait('Builder', 'schema'), linkedEntity: 'Turn' };
    renderHook(() => useTraitStateMachine([binding], slots, { stamp: TEST_STAMP, orbitals: builderOrbitals, transport: server }));
    await settle();
    slots.render.mockClear();
    expect(typeof server.dispatchParams?.clientId).toBe('string');
    const effect: ClientEffectTuple = ['render-ui', 'main', { type: 'typography', content: 'Built' }];
    server.dispatch?.('BuildOrbital', { event: 'BUILD_DONE', targetTrait: 'Builder' }, {
      success: true, transitioned: true, states: { Builder: 'built' }, emittedEvents: [],
      clientEffectsByTrait: [{ traitName: 'Builder', effect, event: 'BUILD_DONE', fromState: 'building' }],
    });
    for (let i = 0; i < 10; i += 1) await settle();
    expect(slots.render.mock.calls.map(([arg]) => (arg as { props?: { content?: string } }).props?.content)).toContain('Built');
  });
});

