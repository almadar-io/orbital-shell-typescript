// @vitest-environment jsdom
// A server-settled dispatch already repainted its capture children under the
// payload that composed them; the client must not repaint them again under the
// dispatched event's payload. std-construction-pm /site-diary: the server's
// timeline frame carried the rows, the client's INIT-payload repaint erased them.
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTraitStateMachine } from '../../src/hooks/useTraitStateMachine';
import { machineReady } from '../../src/test-support/circuit';
import { useEventBus } from '../../src/core';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import type { EventTransport, EventTransportRegisterResult } from '../../src';
import type { EventRequest, EventResponse } from '@almadar/core';
import type { EntityRow, OrbitalId, OrbitalSchema, Trait } from '@almadar/core';
import { TEST_STAMP } from '../../src/test-support/kernel-engine';

const rows: EntityRow[] = [{ id: 't1', title: 'Pour' }, { id: 't2', title: 'Frame' }];

const feed: Trait = {
  name: 'Feed',
  linkedEntity: 'Entry',
  stateMachine: {
    states: [{ name: 'loading', isInitial: true }, { name: 'browsing' }],
    events: [],
    transitions: [
      { from: 'loading', to: 'loading', event: 'INIT', effects: [['fetch', 'Entry', { emit: { success: 'LOADED' } }]] },
      { from: 'loading', to: 'browsing', event: 'LOADED', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Body'] }]] },
      { from: 'browsing', to: 'browsing', event: 'PING', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Body'] }]] },
    ],
  },
};

const body: Trait = {
  name: 'Body',
  linkedEntity: 'Entry',
  config: { rows: { type: 'unknown', default: '@callsitePayload.data' } },
  stateMachine: {
    states: [{ name: 'idle', isInitial: true }],
    events: [],
    transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'timeline', entity: '@config.rows' }]] }],
  },
};

const orbitals: OrbitalSchema['orbitals'] = [{
  name: 'DiaryOrbital',
  id: 'orb_diary' as OrbitalId,
  pages: [{ name: 'Diary', path: '/diary', traits: [{ ref: 'Feed' }, { ref: 'Body' }] }],
  entity: { name: 'Entry', persistence: 'persistent', collection: 'entries', fields: [{ name: 'id', type: 'string' }, { name: 'title', type: 'string' }] },
  traits: [feed, body],
}];

const loaded: EventResponse = {
  success: true,
  transitioned: true,
  states: { Feed: 'browsing', Body: 'idle' },
  emittedEvents: [{ event: 'LOADED', payload: { data: rows }, source: { trait: 'Feed' } }],
  clientEffectsByTrait: [
    { traitName: 'Feed', event: 'LOADED', fromState: 'loading', effect: ['render-ui', 'main', { type: 'stack', children: ['@trait.Body'] }] },
    { traitName: 'Body', effect: ['render-ui', 'main', { type: 'timeline', entity: rows, fields: ['title'] }], callsitePayload: { data: rows } },
  ],
};

class Server implements EventTransport {
  register(): Promise<EventTransportRegisterResult> { return Promise.resolve({ success: true, carriesCircuitState: false }); }
  unregister(): Promise<void> { return Promise.resolve(); }
  send(_orbital: string, request: EventRequest): Promise<EventResponse> {
    const mountsFeed = request.mount?.some((m) => m.trait === 'Feed' && m.event === 'INIT') ?? false;
    if (!mountsFeed && (request.event !== 'INIT' || request.targetTrait !== 'Feed')) {
      return Promise.resolve({ success: true, transitioned: false, states: {}, emittedEvents: [] });
    }
    return Promise.resolve(loaded);
  }
}

function stubSlots(): UISlotManager & { render: ReturnType<typeof vi.fn> } {
  // An embedded trait paints its sidecar (`updateTraitContent`); both channels are the trait's paints here.
  const render = vi.fn((_content: object) => 'id');
  return {
    slots: {},
    render,
    clear: vi.fn(),
    clearBySource: vi.fn(),
    clearById: vi.fn(),
    clearAll: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    hasContent: vi.fn(() => false),
    getContent: vi.fn(() => null),
    getTraitContent: vi.fn(() => null),
    subscribeTrait: vi.fn(() => () => undefined),
    updateTraitContent: vi.fn((traitName: string, content: object) => render({ ...content, sourceTrait: traitName })),
  };
}

async function mounted() {
  const slots = stubSlots();
  let bus!: ReturnType<typeof useEventBus>;
  const transport = new Server();
  const hook = renderHook(() => { bus = useEventBus(); return useTraitStateMachine(slots, {
    stamp: TEST_STAMP,
    orbitals,
    routePath: '/diary',
    transport,
  }); });
  await machineReady(hook.result);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const lastBody = () => {
    const calls = slots.render.mock.calls.filter(([arg]) => (arg as { sourceTrait?: string }).sourceTrait === 'Body');
    return calls.length > 0 ? (calls[calls.length - 1][0] as { props?: { entity?: EntityRow[] } }) : undefined;
  };
  const send = async (event: string, payload?: Record<string, EntityRow[]>) => {
    bus.emit(`UI:DiaryOrbital.Feed.${event}`, payload);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  };
  return { hook, lastBody, send };
}

describe('callsite capture after a server-settled dispatch', () => {
  it('the server\'s capture frame for the child is the one that stays', async () => {
    const m = await mounted();
    expect(m.hook.result.current.getTraitState('Feed')?.currentState).toBe('browsing');
    expect(m.lastBody()?.props?.entity).toEqual(rows);
  });

  it('control: a client-only transition still repaints the child under its own payload', async () => {
    const m = await mounted();
    const fresh: EntityRow[] = [{ id: 't3', title: 'Roof' }];
    await m.send('PING', { data: fresh });
    expect(m.lastBody()?.props?.entity).toEqual(fresh);
  });
});
