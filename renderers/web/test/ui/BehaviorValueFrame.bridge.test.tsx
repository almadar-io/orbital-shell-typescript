// @vitest-environment jsdom
/**
 * A behavior value embedded with a declared bridge runs on the HOST's bus: the bridge's
 * `listens` events reach every trait that handles one, its `emits` events come back out,
 * and nothing else crosses either way. The program starts with INIT once mounted.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import type { BehaviorRef, EventPayload, OrbitalSchema } from '@almadar/core';
import { EventBusProvider } from '../../src/core';
import { UISlotProvider } from '../../src/providers/UISlotContext';
import { useEventBus } from '../../src/core';
import type { EventBusContextType } from '../../src/core';
import { TraitValueMountProvider, type TraitValueMountHost } from '../../src/preview/TraitValueFrame';
import { BehaviorValueFrame } from '../../src/preview/BehaviorValueFrame';
import { bridgeInbound } from '../../src/preview/bridgeInbound';
import { TraitScopeProvider } from '../../src/core';

function plugin(): OrbitalSchema {
  return {
    name: 'Echo',
    orbitals: [
      {
        name: 'EchoOrbital',
        entity: { name: 'EchoView', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        traits: [
          {
            name: 'Echo',
            linkedEntity: 'EchoView',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }],
              events: [{ key: 'INIT', name: 'INIT' }, { key: 'KEY', name: 'KEY' }, { key: 'OTHER', name: 'OTHER' }],
              transitions: [
                { from: 'idle', to: 'idle', event: 'INIT', effects: [['emit', 'STATUS', { text: 'ready' }]] },
                { from: 'idle', to: 'idle', event: 'KEY', effects: [['emit', 'STATUS', { text: '@payload.key' }], ['emit', 'HIDDEN', {}]] },
                { from: 'idle', to: 'idle', event: 'OTHER', effects: [['emit', 'STATUS', { text: 'other' }]] },
              ],
            },
            emits: [{ event: 'STATUS', scope: 'external' }, { event: 'HIDDEN', scope: 'external' }],
          },
        ],
        pages: [{ name: 'EchoPage', path: '/echo', traits: [{ ref: 'Echo' }] }],
      },
    ],
  };
}

const VALUE: BehaviorRef = { behavior: 'almadar-behaviors/echo', bridge: { listens: ['KEY'], emits: ['STATUS'] } };

function mount(value: BehaviorRef) {
  let bus!: EventBusContextType;
  const seen: Array<{ type: string; payload: EventPayload }> = [];
  function Grab(): null {
    bus = useEventBus();
    React.useEffect(() => {
      const offs = ['STATUS', 'HIDDEN'].map((t) => bus.on(`UI:${t}`, (e) => { seen.push({ type: t, payload: e.payload ?? {} }); }));
      return () => offs.forEach((off) => off());
    }, []);
    return null;
  }
  const host: TraitValueMountHost = {
    mount: vi.fn(async () => ({ ok: false as const, error: 'not used' })),
    mountBehavior: vi.fn(async () => ({ ok: true as const, mounted: { schema: plugin(), firstPage: '/echo' } })),
  };
  render(
    <EventBusProvider debug={false}>
      <UISlotProvider>
        <Grab />
        <TraitValueMountProvider host={host}>
          <BehaviorValueFrame value={value} />
        </TraitValueMountProvider>
      </UISlotProvider>
    </EventBusProvider>,
  );
  return { bus: () => bus, seen };
}

describe('BehaviorValueFrame with a bridge', () => {
  it('starts the program and a bridged emit reaches the host', async () => {
    const { seen } = mount(VALUE);
    await waitFor(() => expect(seen).toContainEqual({ type: 'STATUS', payload: { text: 'ready' } }));
  });

  it('a host event the bridge listens for reaches the trait that handles it', async () => {
    const { bus, seen } = mount(VALUE);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    await act(async () => { bus().emit('UI:KEY', { key: 'i' }); });
    await waitFor(() => expect(seen).toContainEqual({ type: 'STATUS', payload: { text: 'i' } }));
  });

  it('control: an emit outside the bridge stays inside the program', async () => {
    const { bus, seen } = mount(VALUE);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    await act(async () => { bus().emit('UI:KEY', { key: 'i' }); });
    await waitFor(() => expect(seen).toContainEqual({ type: 'STATUS', payload: { text: 'i' } }));
    expect(seen.some((e) => e.type === 'HIDDEN')).toBe(false);
  });

  it('control: a host event the bridge does not list is not delivered', async () => {
    const { bus, seen } = mount(VALUE);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    await act(async () => { bus().emit('UI:OTHER', {}); });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).not.toContainEqual({ type: 'STATUS', payload: { text: 'other' } });
  });
});

function mountScoped(value: BehaviorRef) {
  let hostBus!: EventBusContextType;
  const seen: Array<{ type: string; payload: EventPayload }> = [];
  const bare: Array<{ type: string; payload: EventPayload }> = [];
  function HostEmitter(): null {
    hostBus = useEventBus();
    return null;
  }
  function Grab(): null {
    const bus = useEventBus();
    React.useEffect(() => bus.on('UI:Host.Workspace.STATUS', (e) => { seen.push({ type: 'STATUS', payload: e.payload ?? {} }); }), [bus]);
    React.useEffect(() => bus.on('UI:STATUS', (e) => { bare.push({ type: 'STATUS', payload: e.payload ?? {} }); }), [bus]);
    return null;
  }
  const host: TraitValueMountHost = {
    mount: vi.fn(async () => ({ ok: false as const, error: 'not used' })),
    mountBehavior: vi.fn(async () => ({ ok: true as const, mounted: { schema: plugin(), firstPage: '/echo' } })),
  };
  render(
    <EventBusProvider debug={false}>
      <UISlotProvider>
        <Grab />
        <TraitScopeProvider orbital="Host" trait="Workspace">
          <HostEmitter />
          <TraitValueMountProvider host={host}>
            <BehaviorValueFrame value={value} />
          </TraitValueMountProvider>
        </TraitScopeProvider>
      </UISlotProvider>
    </EventBusProvider>,
  );
  return { hostBus: () => hostBus, seen, bare };
}

describe('BehaviorValueFrame with a bridge, embedded in a trait (scoped bus)', () => {
  it('starts inside a trait scope and its bridged emit reaches the host trait', async () => {
    const { seen } = mountScoped(VALUE);
    await waitFor(() => expect(seen).toContainEqual({ type: 'STATUS', payload: { text: 'ready' } }));
  });

  it('a host control emitting a bridged event inside the scope reaches the plugin', async () => {
    const { hostBus, seen } = mountScoped(VALUE);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    await act(async () => { hostBus().emit('UI:KEY', { key: 'k' }); });
    await waitFor(() => expect(seen).toContainEqual({ type: 'STATUS', payload: { text: 'k' } }));
    expect(seen.filter((e) => e.payload.text === 'k')).toHaveLength(1);
  });

  it('a bridged emit also reaches a bare-key pattern listener in the scope (a code editor`s onSetMode), once', async () => {
    const { hostBus, bare } = mountScoped(VALUE);
    await waitFor(() => expect(bare).toContainEqual({ type: 'STATUS', payload: { text: 'ready' } }));
    await act(async () => { hostBus().emit('UI:KEY', { key: 'k' }); });
    await waitFor(() => expect(bare).toContainEqual({ type: 'STATUS', payload: { text: 'k' } }));
    expect(bare.filter((e) => e.payload.text === 'k')).toHaveLength(1);
  });
});

describe('bridgeInbound', () => {
  it('routes each listened event to every trait that handles it', () => {
    expect(bridgeInbound(plugin(), ['KEY'])).toEqual([{ busEvent: 'KEY', orbital: 'EchoOrbital', trait: 'Echo', trigger: 'KEY' }]);
  });

  it('edge: an event no trait handles routes nowhere', () => {
    expect(bridgeInbound(plugin(), ['NOPE'])).toEqual([]);
  });
});
