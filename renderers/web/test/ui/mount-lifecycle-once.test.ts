// @vitest-environment jsdom
// Runtime Spec Clause 4.1: a trait's mount lifecycle event fires exactly once per mount and again on remount.
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { machineReady } from '../../src/test-support/circuit';
import { useTraitStateMachine } from '../../src/hooks/useTraitStateMachine';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import type { EventPayload, EventResponse, OrbitalId, OrbitalSchema, Trait } from '@almadar/core';
import type { EventTransport, EventTransportRegisterResult, HostDispatchListener } from '../../src';
import { TEST_STAMP } from '../../src/test-support/kernel-engine';

const WITH_INIT = ['Header', 'Detail', 'Sidebar'];

function orbitals(): OrbitalSchema['orbitals'] {
  const mk = (name: string): Trait => ({
    name,
    linkedEntity: 'Item',
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }],
      events: [],
      transitions: WITH_INIT.includes(name)
        ? [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'box' }]] }]
        : [{ from: 'idle', to: 'idle', event: 'PING', effects: [] }],
    },
  });
  return [{
    name: 'PageOrbital',
    id: 'orb_page' as OrbitalId,
    pages: [
      { name: 'DetailPage', path: '/detail', traits: [{ ref: 'Header' }, { ref: 'Detail' }, { ref: 'NoInit' }] },
      { name: 'PageA', path: '/a', traits: [{ ref: 'Header' }, { ref: 'Detail' }] },
      { name: 'PageB', path: '/b', traits: [{ ref: 'Header' }, { ref: 'Sidebar' }] },
    ],
    entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [mk('Header'), mk('Detail'), mk('Sidebar'), mk('NoInit')],
  }];
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
    setDeclaredTraitOrder: vi.fn(),
    updateTraitContent: vi.fn(() => 'id'),
  };
}

const ROUTES: Record<string, string> = { DetailPage: '/detail', PageA: '/a', PageB: '/b' };

type Props = { mountKey?: string; initPayload?: EventPayload };

function mount(initial: Props) {
  const slots = stubSlots();
  const orbs = orbitals();
  const hook = renderHook(
    ({ mountKey, initPayload }: Props) =>
      useTraitStateMachine(slots, {
        stamp: TEST_STAMP,
        orbitals: orbs,
        ...(mountKey !== undefined ? { mountKey, routePath: ROUTES[mountKey] } : {}),
        ...(initPayload !== undefined ? { initPayload } : {}),
      }),
    { initialProps: initial },
  );
  const inits = (trait: string) =>
    slots.render.mock.calls.filter(([arg]) => (arg as { sourceTrait?: string }).sourceTrait === trait).length;
  const rerender = async (next: Props) => {
    hook.rerender(next);
    await machineReady(hook.result);
  };
  return { inits, rerender, ready: () => machineReady(hook.result) };
}

async function mounted(initial: Props) {
  const m = mount(initial);
  await m.ready();
  return m;
}

describe('useTraitStateMachine — once-per-mount lifecycle', () => {
  it('fires each trait\'s INIT exactly once on first mount', async () => {
    const m = await mounted({ mountKey: 'DetailPage' });
    expect(m.inits('Header')).toBe(1);
    expect(m.inits('Detail')).toBe(1);
  });

  it('does not re-fire when the bindings array identity churns with the same traits', async () => {
    const m = await mounted({ mountKey: 'DetailPage', initPayload: { id: 'a' } });
    await m.rerender({ mountKey: 'DetailPage', initPayload: { id: 'a' } });
    await m.rerender({ mountKey: 'DetailPage', initPayload: { id: 'a' } });
    expect(m.inits('Header')).toBe(1);
    expect(m.inits('Detail')).toBe(1);
  });

  it('treats an equal route-param object (any key order) as the same mount', async () => {
    const m = await mounted({ mountKey: 'DetailPage', initPayload: { id: 'a', tab: 'x' } });
    await m.rerender({ mountKey: 'DetailPage', initPayload: { tab: 'x', id: 'a' } });
    expect(m.inits('Detail')).toBe(1);
  });

  it('re-fires when the route params change on the same page (/items/a -> /items/b)', async () => {
    const m = await mounted({ mountKey: 'DetailPage', initPayload: { id: 'a' } });
    await m.rerender({ mountKey: 'DetailPage', initPayload: { id: 'b' } });
    expect(m.inits('Detail')).toBe(2);
  });

  it('re-fires every trait on a page change, including one bound on both pages', async () => {
    const m = await mounted({ mountKey: 'PageA' });
    await m.rerender({ mountKey: 'PageB' });
    expect(m.inits('Header')).toBe(2);
    expect(m.inits('Sidebar')).toBe(1);
    expect(m.inits('Detail')).toBe(1);
  });

  it('dispatches nothing for a trait with no lifecycle event', async () => {
    const m = await mounted({ mountKey: 'PageA' });
    expect(m.inits('NoInit')).toBe(0);
    expect(m.inits('Header')).toBe(1);
  });

  it('mounts only the opened route\'s traits, the kernel\'s list, not every bound trait', async () => {
    const m = await mounted({ mountKey: 'PageA' });
    expect(m.inits('Header')).toBe(1);
    expect(m.inits('Detail')).toBe(1);
    expect(m.inits('Sidebar')).toBe(0);
  });

  it('mounts the kernel\'s initial page when the host names no route', async () => {
    const m = await mounted({});
    expect(m.inits('Header')).toBe(1);
  });
});

// EXEC-DIST-9: the session lives while its live stream is open, so a page change must not drop the stream.
class LiveTransport implements EventTransport {
  open = 0;
  opened = 0;
  private dispatches: HostDispatchListener[] = [];
  register(): Promise<EventTransportRegisterResult> {
    return Promise.resolve({ success: true, carriesCircuitState: false });
  }
  unregister(): Promise<void> {
    return Promise.resolve();
  }
  send(): Promise<EventResponse> {
    return Promise.resolve({ success: true, transitioned: false, states: {}, emittedEvents: [] });
  }
  subscribe(): () => void {
    return this.hold();
  }
  subscribeHostDispatches(onDispatch: HostDispatchListener): () => void {
    this.dispatches.push(onDispatch);
    return this.hold();
  }
  /** The host ran `trait`'s INIT on its own and painted `main`. */
  hostDispatch(trait: string): void {
    const response: EventResponse = {
      success: true,
      transitioned: true,
      states: { [trait]: 'idle' },
      emittedEvents: [],
      clientEffectsByTrait: [{ traitName: trait, effect: ['render-ui', 'main', { type: 'box' }] }],
    };
    for (const onDispatch of this.dispatches) onDispatch('PageOrbital', { event: 'INIT', targetTrait: trait }, response);
  }
  private hold(): () => void {
    this.open += 1;
    this.opened += 1;
    return () => { this.open -= 1; };
  }
}

function mountLive(transport: LiveTransport) {
  const slots = stubSlots();
  const orbs = orbitals();
  const hook = renderHook(
    ({ mountKey }: { mountKey: string }) =>
      useTraitStateMachine(slots, { stamp: TEST_STAMP, orbitals: orbs, mountKey, routePath: ROUTES[mountKey], transport }),
    { initialProps: { mountKey: 'PageA' } },
  );
  const inits = (trait: string) =>
    slots.render.mock.calls.filter(([arg]) => (arg as { sourceTrait?: string }).sourceTrait === trait).length;
  return { hook, inits };
}

describe('useTraitStateMachine — the live stream outlives a page change', () => {
  it('a page change keeps the push subscriptions it opened at mount, never closing them', async () => {
    const transport = new LiveTransport();
    const { hook } = mountLive(transport);
    await machineReady(hook.result);
    expect(transport.open).toBe(2);
    hook.rerender({ mountKey: 'PageB' });
    await machineReady(hook.result);
    expect(transport.open).toBe(2);
    expect(transport.opened).toBe(2);
  });

  it('control: unmounting the view closes both subscriptions', async () => {
    const transport = new LiveTransport();
    const { hook } = mountLive(transport);
    await machineReady(hook.result);
    hook.unmount();
    expect(transport.open).toBe(0);
  });

  it('a host dispatch after a page change is judged against the page now shown', async () => {
    const transport = new LiveTransport();
    const { hook, inits } = mountLive(transport);
    await machineReady(hook.result);
    hook.rerender({ mountKey: 'PageB' });
    await machineReady(hook.result);
    expect(inits('Sidebar')).toBe(1);
    await act(async () => {
      transport.hostDispatch('Sidebar');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(inits('Sidebar')).toBe(2);
  });

  it('control: a host dispatch for a trait that left with the old page paints nothing', async () => {
    const transport = new LiveTransport();
    const { hook, inits } = mountLive(transport);
    await machineReady(hook.result);
    hook.rerender({ mountKey: 'PageB' });
    await machineReady(hook.result);
    await act(async () => {
      transport.hostDispatch('Detail');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(inits('Detail')).toBe(1);
  });
});
