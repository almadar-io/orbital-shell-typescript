// @vitest-environment jsdom
// G-RUNTIME-053: one click in an embedded child reaches its host once, even with a same-name listen route.
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import type { OrbitalId, OrbitalSchema, ResolvedTraitBinding, TraitEventListener } from '@almadar/core';
import { createEmptyResolvedTrait } from '@almadar/core';
import { buildTraitIndex } from '../../src/runtime';
import { useBusIngress, type BusDispatch } from '../../src/hooks/circuit/useBusIngress';
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
    useBusIngress(bs, traitIndex, settle, bus, new Set(traitIndex.byName.keys()));
    return bus;
  }, { wrapper });
  return { settle, bus: result };
}

const hostRuns = (settle: ReturnType<typeof vi.fn>): number =>
  settle.mock.calls.filter(([trait, event]) => trait === 'Host' && event === 'REQUEST').length;

describe('useBusIngress — one physical emit reaches a host trait once', () => {
  it('same-name route from the embedded child plus the host transition settles once', () => {
    const { settle, bus } = mount([route('Child', 'REQUEST', 'REQUEST')], ['Host', 'Child']);
    bus.current.emit('UI:REQUEST', { n: 1 });
    expect(hostRuns(settle)).toBe(1);
  });

  it('holds through a transitive embed (Child in Mid in Host)', () => {
    const { settle, bus } = mount([route('Child', 'REQUEST', 'REQUEST')], ['Host', 'Mid', 'Child']);
    bus.current.emit('UI:REQUEST');
    expect(hostRuns(settle)).toBe(1);
  });

  it('control: no route, the host transition alone settles once', () => {
    const { settle, bus } = mount([], ['Host', 'Child']);
    bus.current.emit('UI:REQUEST');
    expect(hostRuns(settle)).toBe(1);
  });

  it('control: a route from a trait outside the emit chain is the only path and still settles', () => {
    const { settle, bus } = mount([route('Other', 'REQUEST', 'REQUEST')], ['Other']);
    bus.current.emit('UI:REQUEST');
    expect(hostRuns(settle)).toBe(1);
  });

  it('control: a route to a different trigger is a distinct delivery', () => {
    const { settle, bus } = mount([route('Child', 'REQUEST', 'ADMIT')], ['Host', 'Child']);
    bus.current.emit('UI:REQUEST');
    expect(hostRuns(settle)).toBe(1);
    expect(settle.mock.calls.filter(([t, e]) => t === 'Host' && e === 'ADMIT')).toHaveLength(1);
  });

  it('edge: the claim is per physical emit, so a second click settles again', () => {
    const { settle, bus } = mount([route('Child', 'REQUEST', 'REQUEST')], ['Host', 'Child']);
    bus.current.emit('UI:REQUEST');
    bus.current.emit('UI:REQUEST');
    expect(hostRuns(settle)).toBe(2);
  });
});
