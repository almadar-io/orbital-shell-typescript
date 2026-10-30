// @vitest-environment jsdom
// Walking the capture tree THROUGH a child that is not repainted (its lifecycle
// arm reloads) must leave that child's own children with the payload their
// composer last gave them. std-devops-dashboard /activity: a sibling's INIT
// walked through ActivityFeed and repainted its timeline under `{}`.
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTraitStateMachine } from '../../src/hooks/useTraitStateMachine';
import { machineReady } from '../../src/test-support/circuit';
import { useEventBus } from '../../src/core';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import type { EventPayload, OrbitalId, OrbitalSchema, Trait } from '@almadar/core';
import { TEST_STAMP } from '../../src/test-support/kernel-engine';

const host: Trait = {
  name: 'Host', linkedEntity: 'Item',
  stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [],
    transitions: [{ from: 'idle', to: 'idle', event: 'PING', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Feed'] }]] }] },
};
const feed: Trait = {
  name: 'Feed', linkedEntity: 'Item',
  stateMachine: { states: [{ name: 'browsing', isInitial: true }], events: [],
    transitions: [
      { from: 'browsing', to: 'browsing', event: 'INIT', effects: [['set', '@entity.id', 'reload'], ['render-ui', 'main', { type: 'spinner' }]] },
      { from: 'browsing', to: 'browsing', event: 'LOADED', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Leaf'] }]] },
    ] },
};
const leaf: Trait = {
  name: 'Leaf', linkedEntity: 'Item',
  config: { content: { type: 'string', default: '@callsitePayload.label' } },
  stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [],
    transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'button', label: '@config.content' }]] }] },
};

const orbitals: OrbitalSchema['orbitals'] = [{
  name: 'PageOrbital', id: 'orb_page' as OrbitalId, pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Host' }, { ref: 'Feed' }, { ref: 'Leaf' }] }],
  entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
  traits: [host, feed, leaf],
}];

function stubSlots(): UISlotManager & { render: ReturnType<typeof vi.fn> } {
  // An embedded trait paints its sidecar (`updateTraitContent`); both channels are the trait's paints here.
  const render = vi.fn((_content: object) => 'id');
  return {
    slots: {}, render, clear: vi.fn(), clearBySource: vi.fn(), clearById: vi.fn(), clearAll: vi.fn(),
    subscribe: vi.fn(() => () => undefined), hasContent: vi.fn(() => false), getContent: vi.fn(() => null),
    getTraitContent: vi.fn(() => null), subscribeTrait: vi.fn(() => () => undefined), updateTraitContent: vi.fn((traitName: string, content: object) => render({ ...content, sourceTrait: traitName })),
  };
}

async function mounted() {
  const slots = stubSlots();
  let bus!: ReturnType<typeof useEventBus>;
  const hook = renderHook(() => { bus = useEventBus(); return useTraitStateMachine(slots, {
    stamp: TEST_STAMP,
    orbitals,
    routePath: '/',
  }); });
  await machineReady(hook.result);
  const send = async (event: string, payload: EventPayload) => {
    bus.emit(`UI:PageOrbital.${({ LOADED: 'Feed', PING: 'Host' } as Record<string, string>)[event]}.${event}`, payload);
    await act(async () => undefined);
  };
  const leafLabel = () => {
    const calls = slots.render.mock.calls.filter(([arg]) => (arg as { sourceTrait?: string }).sourceTrait === 'Leaf');
    return calls.length > 0 ? (calls[calls.length - 1][0] as { props?: { label?: string } }).props?.label : undefined;
  };
  return { send, leafLabel };
}

describe('capture walk through a reloading child', () => {
  it('the grandchild keeps the payload its own composer gave it', async () => {
    const m = await mounted();
    await m.send('LOADED', { label: 'Mine' });
    expect(m.leafLabel()).toBe('Mine');
    await m.send('PING', { label: 'Host' });
    expect(m.leafLabel()).toBe('Mine');
  });

  it('edge: a grandchild never composed yet (it waits for its composer at mount) takes the ancestor\'s payload', async () => {
    const m = await mounted();
    await m.send('PING', { label: 'Host' });
    expect(m.leafLabel()).toBe('Host');
  });
});
