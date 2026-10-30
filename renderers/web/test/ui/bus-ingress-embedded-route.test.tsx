// @vitest-environment jsdom
// G-RUNTIME-053: one click in an embedded child is ONE kernel dispatch; the kernel bubbles it to the host and the listen routes (EXEC-DISP).
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import type { OrbitalId, OrbitalSchema, ResolvedTraitBinding, TraitEventListener } from '@almadar/core';
import { createEmptyResolvedTrait } from '@almadar/core';
import { buildTraitIndex } from '../../src/runtime';
import { useBusIngress, type BusDispatch, type BusEmitDelivery } from '../../src/hooks/circuit/useBusIngress';
import { useEventBus } from '../../src/core';
import { EventBusProvider } from '../../src/core';
import { TraitScopeProvider } from '../../src/core';

const ORBITAL = 'EmbedOrbital';
const idle = [{ name: 'idle', isInitial: true }];

function orbitals(routes: TraitEventListener[]): OrbitalSchema['orbitals'] {
  const transitions = [{ from: 'idle', to: 'idle', event: 'REQUEST', effects: [] }];
  return [{
    name: ORBITAL,
    id: 'orb_embed' as OrbitalId,
    pages: [],
    entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [
      { name: 'Child', linkedEntity: 'Item', stateMachine: { states: idle, events: [], transitions: [] } },
      { name: 'Other', linkedEntity: 'Item', stateMachine: { states: idle, events: [], transitions: [] } },
      { name: 'Host', linkedEntity: 'Item', listens: routes, stateMachine: { states: idle, events: [], transitions } },
    ],
  }];
}

function bindings(routes: TraitEventListener[]): ResolvedTraitBinding[] {
  const host = createEmptyResolvedTrait('Host', 'schema');
  host.transitions = [{ from: 'idle', to: 'idle', event: 'REQUEST', effects: [] }];
  host.listens = routes;
  return [{ trait: host, linkedEntity: 'Item' }];
}

function route(source: string, event: string, triggers: string): TraitEventListener {
  return { event, triggers, source: { kind: 'trait', trait: source } };
}

function mount(routes: TraitEventListener[], chain: string[]) {
  const settle = vi.fn<BusDispatch>(async () => {});
  const deliver = vi.fn<BusEmitDelivery>(async () => {});
  const traitIndex = buildTraitIndex(orbitals(routes));
  const bs = bindings(routes);
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
