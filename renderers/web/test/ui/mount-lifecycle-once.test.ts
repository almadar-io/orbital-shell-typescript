// @vitest-environment jsdom
// Runtime Spec Clause 4.1: a trait's mount lifecycle event fires exactly once per mount and again on remount.
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTraitStateMachine } from '../../src/hooks/useTraitStateMachine';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import type { EventPayload, OrbitalId, OrbitalSchema, ResolvedTraitBinding, Trait } from '@almadar/core';
import { createEmptyResolvedTrait } from '@almadar/core';

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
    pages: [],
    entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [mk('Header'), mk('Detail'), mk('Sidebar'), mk('NoInit')],
  }];
}

function binding(name: string): ResolvedTraitBinding {
  return { trait: createEmptyResolvedTrait(name, 'schema'), linkedEntity: 'Item' };
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

type Props = { names: string[]; mountKey?: string; initPayload?: EventPayload };

function mount(initial: Props) {
  const slots = stubSlots();
  const orbs = orbitals();
  const hook = renderHook(
    ({ names, mountKey, initPayload }: Props) =>
      useTraitStateMachine(names.map(binding), slots, {
        orbitals: orbs,
        ...(mountKey !== undefined ? { mountKey } : {}),
        ...(initPayload !== undefined ? { initPayload } : {}),
      }),
    { initialProps: initial },
  );
  const inits = (trait: string) =>
    slots.render.mock.calls.filter(([arg]) => (arg as { sourceTrait?: string }).sourceTrait === trait).length;
  const rerender = async (next: Props) => {
    hook.rerender(next);
    await act(async () => undefined);
  };
  return { inits, rerender };
}

async function mounted(initial: Props) {
  const m = mount(initial);
  await act(async () => undefined);
  return m;
}

describe('useTraitStateMachine — once-per-mount lifecycle', () => {
  it('fires each trait\'s INIT exactly once on first mount', async () => {
    const m = await mounted({ names: ['Header', 'Detail'], mountKey: 'DetailPage' });
    expect(m.inits('Header')).toBe(1);
    expect(m.inits('Detail')).toBe(1);
  });

  it('does not re-fire when the bindings array identity churns with the same traits', async () => {
    const m = await mounted({ names: ['Header', 'Detail'], mountKey: 'DetailPage', initPayload: { id: 'a' } });
    await m.rerender({ names: ['Header', 'Detail'], mountKey: 'DetailPage', initPayload: { id: 'a' } });
    await m.rerender({ names: ['Detail', 'Header'], mountKey: 'DetailPage', initPayload: { id: 'a' } });
    expect(m.inits('Header')).toBe(1);
    expect(m.inits('Detail')).toBe(1);
  });

  it('treats an equal route-param object (any key order) as the same mount', async () => {
    const m = await mounted({ names: ['Detail'], mountKey: 'DetailPage', initPayload: { id: 'a', tab: 'x' } });
    await m.rerender({ names: ['Detail'], mountKey: 'DetailPage', initPayload: { tab: 'x', id: 'a' } });
    expect(m.inits('Detail')).toBe(1);
  });

  it('re-fires when the route params change on the same page (/items/a -> /items/b)', async () => {
    const m = await mounted({ names: ['Detail'], mountKey: 'DetailPage', initPayload: { id: 'a' } });
    await m.rerender({ names: ['Detail'], mountKey: 'DetailPage', initPayload: { id: 'b' } });
    expect(m.inits('Detail')).toBe(2);
  });

  it('re-fires every trait on a page change, including one bound on both pages', async () => {
    const m = await mounted({ names: ['Header', 'Detail'], mountKey: 'PageA' });
    await m.rerender({ names: ['Header', 'Sidebar'], mountKey: 'PageB' });
    expect(m.inits('Header')).toBe(2);
    expect(m.inits('Sidebar')).toBe(1);
    expect(m.inits('Detail')).toBe(1);
  });

  it('re-fires a trait that unmounts and remounts within the same page', async () => {
    const m = await mounted({ names: ['Header', 'Detail'], mountKey: 'PageA' });
    await m.rerender({ names: ['Header'], mountKey: 'PageA' });
    await m.rerender({ names: ['Header', 'Detail'], mountKey: 'PageA' });
    expect(m.inits('Detail')).toBe(2);
    // A trait-set change rebuilds the circuit store, resetting the survivor too, so it re-inits (G-UI-015).
    expect(m.inits('Header')).toBe(3);
  });

  it('dispatches nothing for a trait with no lifecycle event', async () => {
    const m = await mounted({ names: ['NoInit', 'Header'], mountKey: 'PageA' });
    expect(m.inits('NoInit')).toBe(0);
    expect(m.inits('Header')).toBe(1);
  });
});
