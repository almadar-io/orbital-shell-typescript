// @vitest-environment jsdom
// A callsite-capture re-render repaints an embedded child under its parent's
// payload; it never moves the child out of the state it is in. std-inventory
// /stock-levels: every parent transition replayed the ledger's `browsing -> loading`
// INIT arm, so the page sat on its spinner with the rows already loaded.
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTraitStateMachine } from '../../src/hooks/useTraitStateMachine';
import { useEventBus } from '../../src/core';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import type { OrbitalId, OrbitalSchema, ResolvedTraitBinding, Trait } from '@almadar/core';
import { createEmptyResolvedTrait } from '@almadar/core';
import { TEST_STAMP } from '../../src/test-support/kernel-engine';

const parent: Trait = {
  name: 'Catalog',
  linkedEntity: 'Item',
  stateMachine: {
    states: [{ name: 'idle', isInitial: true }],
    events: [],
    transitions: [
      { from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Ledger'] }]] },
      { from: 'idle', to: 'idle', event: 'PING', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Ledger'] }]] },
    ],
  },
};

const ledger: Trait = {
  name: 'Ledger',
  linkedEntity: 'Item',
  stateMachine: {
    states: [{ name: 'loading', isInitial: true }, { name: 'browsing' }, { name: 'closed' }],
    events: [],
    transitions: [
      { from: 'loading', to: 'loading', event: 'INIT', effects: [['render-ui', 'main', { type: 'spinner', label: '@callsitePayload.note' }]] },
      { from: 'loading', to: 'browsing', event: 'LOADED', effects: [['render-ui', 'main', { type: 'table-view' }]] },
      { from: 'browsing', to: 'loading', event: 'INIT', effects: [['render-ui', 'main', { type: 'spinner' }]] },
      { from: 'loading', to: 'closed', event: 'CLOSE', effects: [] },
    ],
  },
};

function orbitals(): OrbitalSchema['orbitals'] {
  return [{
    name: 'PageOrbital',
    id: 'orb_page' as OrbitalId,
    pages: [],
    entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [parent, ledger],
  }];
}

function binding(name: string): ResolvedTraitBinding {
  const trait = createEmptyResolvedTrait(name, 'schema');
  trait.transitions = ([parent, ledger].find((t) => t.name === name)?.stateMachine?.transitions ?? []).map(({ from, to, event }) => ({ from, to, event, effects: [] }));
  return { trait, linkedEntity: 'Item' };
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

async function mounted() {
  const slots = stubSlots();
  const orbs = orbitals();
  const bindings = ['Catalog', 'Ledger'].map(binding);
  let bus!: ReturnType<typeof useEventBus>;
  const hook = renderHook(() => { bus = useEventBus(); return useTraitStateMachine(bindings, slots, {
    stamp: TEST_STAMP,
    orbitals: orbs,
  }); });
  await act(async () => undefined);
  const send = async (event: string) => {
    bus.emit(`UI:PageOrbital.${({ LOADED: 'Ledger', CLOSE: 'Ledger', PING: 'Catalog' } as Record<string, string>)[event]}.${event}`, {});
    await act(async () => undefined);
  };
  const ledgerRenders = () => slots.render.mock.calls.filter(([arg]) => (arg as { sourceTrait?: string }).sourceTrait === 'Ledger').length;
  const ledgerState = () => hook.result.current.getTraitState('Ledger')?.currentState;
  return { send, ledgerRenders, ledgerState };
}

describe('callsite-capture re-render keeps the child in its state', () => {
  it('a child whose lifecycle arm would leave its state stays put across a parent transition', async () => {
    const m = await mounted();
    await m.send('LOADED');
    expect(m.ledgerState()).toBe('browsing');
    await m.send('PING');
    expect(m.ledgerState()).toBe('browsing');
  });

  it('control: a child whose lifecycle arm is a self-loop is repainted and keeps its state', async () => {
    const m = await mounted();
    const before = m.ledgerRenders();
    await m.send('PING');
    expect(m.ledgerState()).toBe('loading');
    expect(m.ledgerRenders()).toBeGreaterThan(before);
  });

  it('edge: a child in a state with no lifecycle arm is untouched', async () => {
    const m = await mounted();
    await m.send('CLOSE');
    const before = m.ledgerRenders();
    await m.send('PING');
    expect(m.ledgerState()).toBe('closed');
    expect(m.ledgerRenders()).toBe(before);
  });
});
