// @vitest-environment jsdom
// An embedded child that reads `@callsitePayload` and only repaints on INIT waits for its
// composer instead of painting at mount with no payload — the compiled path evaluates it
// when its parent renders it. std-executive-dashboard's win-rate stat filtered `?data`
// before DEALS_LOADED delivered any (a TypeMismatch under the strict array rule).
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTraitStateMachine } from '../../src/hooks/useTraitStateMachine';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import type { EventPayload, OrbitalId, OrbitalSchema, ResolvedTraitBinding, Trait } from '@almadar/core';
import { createEmptyResolvedTrait } from '@almadar/core';

const content: Trait = {
  name: 'Content', scope: 'instance', linkedEntity: 'Deal',
  stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [],
    transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Panel'] }]] }] },
};
const panel: Trait = {
  name: 'Panel', scope: 'instance', linkedEntity: 'Deal',
  stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [],
    transitions: [
      { from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'stack', children: [] }]] },
      { from: 'idle', to: 'idle', event: 'DEALS_LOADED', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Won', '@trait.Title'] }]] },
      { from: 'idle', to: 'idle', event: 'TICK', effects: [['render-ui', 'modal', { type: 'typography', content: 'tick' }]] },
    ] },
};
const won: Trait = {
  name: 'Won', scope: 'instance', linkedEntity: 'Deal',
  stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [],
    transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', {
      type: 'stat-display', label: 'Won',
      value: ['array/len', ['array/filter', '@callsitePayload.data', ['fn', 'd', ['=', '@d.status', 'won']]]],
    }]] }] },
};
const title: Trait = {
  name: 'Title', scope: 'instance', linkedEntity: 'Deal',
  stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [],
    transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: 'Deals' }]] }] },
};
const reloader: Trait = {
  name: 'Reloader', scope: 'instance', linkedEntity: 'Deal',
  stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [],
    transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['set', '@entity.id', 'r'], ['render-ui', 'main', { type: 'typography', content: '@callsitePayload.label' }]] }] },
};

const orbitals: OrbitalSchema['orbitals'] = [{
  name: 'DealOrbital', id: 'orb_deal' as OrbitalId, pages: [],
  entity: { name: 'Deal', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }, { name: 'status', type: 'string' }] },
  traits: [content, panel, won, title, reloader],
}];

function stubSlots(): UISlotManager & { render: ReturnType<typeof vi.fn> } {
  return {
    slots: {}, render: vi.fn(() => 'id'), clear: vi.fn(), clearBySource: vi.fn(), clearById: vi.fn(), clearAll: vi.fn(),
    subscribe: vi.fn(() => () => undefined), hasContent: vi.fn(() => false), getContent: vi.fn(() => null),
    getTraitContent: vi.fn(() => null), subscribeTrait: vi.fn(() => () => undefined), updateTraitContent: vi.fn(() => 'id'),
  };
}

const binding = (name: string): ResolvedTraitBinding => ({ trait: createEmptyResolvedTrait(name, 'schema'), linkedEntity: 'Deal' });

async function mounted() {
  const slots = stubSlots();
  const hook = renderHook(() => useTraitStateMachine(['Content', 'Panel', 'Won', 'Title', 'Reloader'].map(binding), slots, {
    orbitals,
    callsiteCaptureChildrenByTrait: new Map([['Content', new Set(['Panel'])], ['Panel', new Set(['Won', 'Title', 'Reloader'])]]),
  }));
  await act(async () => undefined);
  const rendersOf = (trait: string) => slots.render.mock.calls
    .map(([arg]) => arg as { sourceTrait?: string; pattern?: string; props?: Record<string, unknown> })
    .filter((c) => c.sourceTrait === trait);
  const send = async (event: string, payload: EventPayload) => {
    hook.result.current.sendEvent(event, payload);
    await act(async () => undefined);
  };
  return { slots, rendersOf, send };
}

describe('an embedded capturing child waits for its composer', () => {
  it('nothing fails at mount, and the stat is not painted from an absent payload', async () => {
    const logged: string[] = [];
    const capture = (...args: unknown[]) => { logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(capture);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(capture);
    const m = await mounted();
    errSpy.mockRestore();
    warnSpy.mockRestore();
    // Content's INIT composes Panel; Panel's own INIT composes no stat, so the walk stops there.
    expect(logged.filter((l) => /Type mismatch|effects:error/.test(l))).toEqual([]);
    expect(m.slots.render.mock.calls.some(([arg]) => (arg as { pattern?: string }).pattern === 'error-state')).toBe(false);
    expect(m.rendersOf('Won')).toHaveLength(0);
  });

  it('the composer\'s payload paints it: 2 of 3 deals won', async () => {
    const m = await mounted();
    await m.send('DEALS_LOADED', { data: [{ status: 'won' }, { status: 'lost' }, { status: 'won' }] });
    const last = m.rendersOf('Won').at(-1);
    expect(last?.props?.value).toBe(2);
  });

  it('a parent transition that embeds no children leaves them at their last payload', async () => {
    const m = await mounted();
    await m.send('DEALS_LOADED', { data: [{ status: 'won' }, { status: 'won' }] });
    const paints = m.rendersOf('Won').length;
    const logged: string[] = [];
    const capture = (...args: unknown[]) => { logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(capture);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(capture);
    await m.send('TICK', {});
    errSpy.mockRestore();
    warnSpy.mockRestore();
    expect(logged.filter((l) => /Type mismatch|effects:error/.test(l))).toEqual([]);
    expect(m.rendersOf('Won')).toHaveLength(paints);
    expect(m.slots.render.mock.calls.some(([arg]) => (arg as { pattern?: string }).pattern === 'error-state')).toBe(false);
  });

  it('control: a child that does not read the call-site payload still paints at mount', async () => {
    const m = await mounted();
    expect(m.rendersOf('Title').length).toBeGreaterThan(0);
  });

  it('edge: a capturing child whose INIT does more than repaint still starts at mount', async () => {
    const m = await mounted();
    expect(m.rendersOf('Reloader').length).toBeGreaterThan(0);
  });
});
