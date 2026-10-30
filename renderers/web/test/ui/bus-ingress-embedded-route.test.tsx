// @vitest-environment jsdom
// G-RUNTIME-053: one click in an embedded child is ONE kernel dispatch; the kernel bubbles it to the host and the listen routes (EXEC-DISP).
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import type { TraitEventListener } from '@almadar/core';
import { useBusIngress, type BusDispatch, type BusEmitDelivery } from '../../src/hooks/circuit/useBusIngress';
import type { TraitSurface } from '@almadar/core/kernel-wire';
import { useEventBus } from '../../src/core';
import { EventBusProvider } from '../../src/core';
import { TraitScopeProvider } from '../../src/core';

const ORBITAL = 'EmbedOrbital';
const idle = [{ name: 'idle', isInitial: true }];

function surfaces(routes: TraitEventListener[]): ReadonlyMap<string, TraitSurface> {
  return new Map([['Host', {
    name: 'Host',
    orbital: ORBITAL,
    shared: false,
    browser: false,
    frameKey: 'Host',
    ticks: [],
    emits: [],
    states: ['idle'],
    initial: 'idle',
    events: ['REQUEST'],
    listens: routes.flatMap((r) => (r.source?.kind === 'trait' ? [{ event: r.event, source: { orbital: ORBITAL, trait: r.source.trait } }] : [])),
    transitions: [{ from: 'idle', to: 'idle', event: 'REQUEST' }],
  }]]);
}

function route(source: string, event: string, triggers: string): TraitEventListener {
  return { event, triggers, source: { kind: 'trait', trait: source } };
}

function mount(routes: TraitEventListener[], chain: string[]) {
  const settle = vi.fn<BusDispatch>(async () => {});
  const deliver = vi.fn<BusEmitDelivery>(async () => {});
  const bs = surfaces(routes);
  const traitIndex = { byName: bs };
  const wrapper = ({ children }: { children?: React.ReactNode }): React.JSX.Element => (
    <EventBusProvider isolated>
      {chain.reduceRight<React.JSX.Element>(
        (inner, trait) => <TraitScopeProvider orbital={ORBITAL} trait={trait}>{inner}</TraitScopeProvider>,
        <>{children}</>,
      )}
    </EventBusProvider>
  );
  const { result } = renderHook(() => {
    const bus = useEventBus();
    useBusIngress(bs, traitIndex, settle, deliver, bus, new Set(traitIndex.byName.keys()));
    return bus;
  }, { wrapper });
  return { settle, deliver, bus: result };
}

const dispatches = (settle: ReturnType<typeof vi.fn>): Array<[string, string]> =>
  settle.mock.calls.map(([trait, event]) => [trait, event]);

describe('useBusIngress — one physical emit is one kernel dispatch', () => {
  it('a same-name route from the embedded child: the child is dispatched once, the host and the route are the kernel\'s', () => {
    const { settle, bus } = mount([route('Child', 'REQUEST', 'REQUEST')], ['Host', 'Child']);
    bus.current.emit('UI:REQUEST', { n: 1 });
    expect(dispatches(settle)).toEqual([['Child', 'REQUEST']]);
  });

  it('holds through a transitive embed (Child in Mid in Host)', () => {
    const { settle, bus } = mount([route('Child', 'REQUEST', 'REQUEST')], ['Host', 'Mid', 'Child']);
    bus.current.emit('UI:REQUEST');
    expect(dispatches(settle)).toEqual([['Child', 'REQUEST']]);
  });

  it('control: no route, the host transition alone is the one dispatch', () => {
    const { settle, bus } = mount([], ['Host', 'Child']);
    bus.current.emit('UI:REQUEST');
    expect(dispatches(settle)).toEqual([['Host', 'REQUEST']]);
  });

  it('control: a route from a trait outside the host chain dispatches the source, never the listener', () => {
    const { settle, bus } = mount([route('Other', 'REQUEST', 'REQUEST')], ['Other']);
    bus.current.emit('UI:REQUEST');
    expect(dispatches(settle)).toEqual([['Other', 'REQUEST']]);
  });

  it('control: a route to a different trigger is still one dispatch of the source', () => {
    const { settle, bus } = mount([route('Child', 'REQUEST', 'ADMIT')], ['Host', 'Child']);
    bus.current.emit('UI:REQUEST');
    expect(dispatches(settle)).toEqual([['Child', 'REQUEST']]);
  });

  it('edge: the claim is per physical emit, so a second click dispatches again', () => {
    const { settle, bus } = mount([route('Child', 'REQUEST', 'REQUEST')], ['Host', 'Child']);
    bus.current.emit('UI:REQUEST');
    bus.current.emit('UI:REQUEST');
    expect(dispatches(settle)).toEqual([['Child', 'REQUEST'], ['Child', 'REQUEST']]);
  });

  it('edge: a listen route is never delivered by the shell: no listener is dispatched by name', () => {
    const { settle, bus } = mount([route('Child', 'REQUEST', 'ADMIT')], ['Host', 'Child']);
    bus.current.emit('UI:REQUEST');
    expect(settle.mock.calls.some(([trait]) => trait === 'Host')).toBe(false);
  });
});
