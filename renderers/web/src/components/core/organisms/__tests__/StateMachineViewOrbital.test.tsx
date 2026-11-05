// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { EventBusProvider, useEventBus } from '../../../../core';
import { StateMachineView } from '../StateMachineView';
import type { MountedOrbital, MountedTrait } from '@almadar/core';

function trait(name: string, patch: Partial<MountedTrait> = {}): MountedTrait {
  return {
    trait: name, orbital: 'O', parent: null, depth: 0, embeddedIn: [], renders: true, observer: false, stepsIn: 'browser',
    linkedEntity: 'Thing',
    states: [{ name: 'idle', isInitial: true, isTerminal: false }, { name: 'busy', isInitial: false, isTerminal: false }],
    transitions: [
      { index: 0, from: ['idle'], to: 'busy', event: 'GO', guarded: false, emits: ['STARTED'] },
      { index: 1, from: ['busy'], to: 'idle', event: 'STOP', guarded: false, emits: [] },
    ],
    emits: ['STARTED'], listens: [], instances: [], ...patch,
  };
}

const boxes = () => screen.getAllByTestId('avl-om-box');
const box = (name: string) => boxes().find((b) => b.dataset.trait === name)!;

describe('StateMachineView orbital mode', () => {
  it('draws one box per rendering trait, a child inside its parent', async () => {
    const orbital: MountedOrbital = {
      page: '/p',
      traits: [trait('Parent'), trait('Child', { parent: 'Parent', depth: 1, embeddedIn: ['idle'] }), trait('Other')],
    };
    render(<StateMachineView orbital={orbital} />);
    await waitFor(() => expect(boxes()).toHaveLength(3));
    expect(box('Child').parentElement).toBe(box('Parent'));
    expect(box('Other').parentElement).not.toBe(box('Parent'));
    expect(screen.getAllByTestId('avl-om-embed')).toHaveLength(1);
  });

  it('single-trait mode still draws without an orbital (control)', async () => {
    render(<StateMachineView trait={{ name: 'T', linkedEntity: 'T', states: [{ name: 'a', isInitial: true, isTerminal: false }], transitions: [], emittedEvents: [], listenedEvents: [] }} />);
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(1));
    expect(screen.queryByTestId('avl-orbital-machine')).toBeNull();
  });

  it('collapses at depth >= expandDepth and expands below it (control)', async () => {
    const orbital: MountedOrbital = { page: '/p', traits: [trait('Top'), trait('Deep', { parent: 'Top', depth: 2 })] };
    render(<StateMachineView orbital={orbital} expandDepth={2} activeStates={[{ trait: 'Deep', state: 'busy' }]} />);
    await waitFor(() => expect(boxes()).toHaveLength(2));
    expect(box('Top').dataset.kind).toBe('machine');
    expect(box('Deep').dataset.kind).toBe('collapsed');
    expect(screen.getAllByTestId('avl-om-state-node').every((n) => n.dataset.trait === 'Top')).toBe(true);
    expect(screen.getByTestId('avl-om-state').textContent).toBe('busy');
  });

  it('a single-state trait is a chip even above expandDepth', async () => {
    const one = trait('One', { states: [{ name: 'only', isInitial: true, isTerminal: false }], transitions: [] });
    render(<StateMachineView orbital={{ page: '/p', traits: [one] }} activeStates={[{ trait: 'One', state: 'only' }]} />);
    await waitFor(() => expect(boxes()).toHaveLength(1));
    expect(box('One').dataset.kind).toBe('chip');
    expect(within(box('One')).queryByTestId('avl-om-state')).toBeNull();
  });

  it('puts renders:false traits in the background lane, never renders:true ones', async () => {
    const orbital: MountedOrbital = { page: '/p', traits: [trait('Ui'), trait('Store', { renders: false })] };
    render(<StateMachineView orbital={orbital} />);
    await waitFor(() => expect(boxes()).toHaveLength(2));
    expect(box('Store').dataset.lane).toBe('true');
    expect(box('Ui').dataset.lane).toBe('false');
    expect(screen.getByText('Runs in the background')).toBeInTheDocument();
  });

  it('draws no lane without background traits (control)', async () => {
    render(<StateMachineView orbital={{ page: '/p', traits: [trait('Ui')] }} />);
    await waitFor(() => expect(boxes()).toHaveLength(1));
    expect(screen.queryByTestId('avl-om-lane')).toBeNull();
  });

  it('draws one labelled arrow for a listen on a mounted trait', async () => {
    const orbital: MountedOrbital = {
      page: '/p',
      traits: [trait('A'), trait('B', { listens: [{ event: 'A.GO', triggers: 'GO' }, { event: 'A.GO', triggers: 'STOP' }] })],
    };
    render(<StateMachineView orbital={orbital} />);
    await waitFor(() => expect(screen.getAllByTestId('avl-om-wire')).toHaveLength(1));
    const wire = screen.getByTestId('avl-om-wire');
    expect(wire.dataset.from).toBe('A');
    expect(wire.dataset.to).toBe('B');
    expect(screen.getByTestId('avl-om-wire-event').textContent).toBe('GO');
  });

  it('draws no arrow for a listen naming an unmounted trait (control)', async () => {
    const orbital: MountedOrbital = { page: '/p', traits: [trait('A'), trait('B', { listens: [{ event: 'Missing.GO', triggers: null }] })] };
    render(<StateMachineView orbital={orbital} />);
    await waitFor(() => expect(boxes()).toHaveLength(2));
    expect(screen.queryAllByTestId('avl-om-wire')).toHaveLength(0);
  });
});

describe('StateMachineView orbital packing', () => {
  const leaf = (name: string, parent: string): MountedTrait =>
    trait(name, { parent, depth: 1, states: [{ name: 'only', isInitial: true, isTerminal: false }], transitions: [] });
  const width = (el: HTMLElement) => parseFloat(el.style.width);
  const left = (el: HTMLElement) => parseFloat(el.style.left);
  const top = (el: HTMLElement) => parseFloat(el.style.top);

  it('lays 12 leaf children out in rows, not one column', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `Leaf${i}`);
    const orbital: MountedOrbital = { page: '/p', traits: [trait('Host', { depth: 0 }), ...names.map((n) => leaf(n, 'Host'))] };
    render(<StateMachineView orbital={orbital} expandDepth={0} />);
    await waitFor(() => expect(boxes()).toHaveLength(13));
    const lefts = new Set(names.map((n) => left(box(n))));
    expect(lefts.size).toBeGreaterThan(1);
    expect(new Set(names.map((n) => top(box(n)))).size).toBeLessThan(12);
    expect(width(box('Host'))).toBeGreaterThan(width(box('Leaf0')) * 2);
  });

  it('a single child stays its own width inside a one-column box (control)', async () => {
    const orbital: MountedOrbital = { page: '/p', traits: [trait('Host', { depth: 0 }), leaf('OnlyChildWithALongName', 'Host')] };
    render(<StateMachineView orbital={orbital} expandDepth={0} />);
    await waitFor(() => expect(boxes()).toHaveLength(2));
    expect(width(box('Host'))).toBeLessThan(width(box('OnlyChildWithALongName')) + 40);
  });
});

describe('StateMachineView orbital boxes open in place', () => {
  const orbital = (): MountedOrbital => ({ page: '/p', traits: [trait('Top'), trait('Deep', { parent: 'Top', depth: 2 })] });
  const toggle = (name: string) => within(box(name)).getAllByTestId('avl-om-toggle')[0]!;
  const statesOf = (name: string) => screen.queryAllByTestId('avl-om-state-node').filter((n) => n.dataset.trait === name);

  it('opening a collapsed box draws its machine inside it', async () => {
    render(<StateMachineView orbital={orbital()} expandDepth={2} />);
    await waitFor(() => expect(box('Deep').dataset.kind).toBe('collapsed'));
    expect(toggle('Deep').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle('Deep'));
    await waitFor(() => expect(box('Deep').dataset.kind).toBe('machine'));
    expect(statesOf('Deep').map((n) => n.dataset.state)).toEqual(['idle', 'busy']);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closing an open box hides its machine (control)', async () => {
    render(<StateMachineView orbital={orbital()} expandDepth={2} />);
    await waitFor(() => expect(box('Top').dataset.kind).toBe('machine'));
    fireEvent.click(toggle('Top'));
    await waitFor(() => expect(box('Top').dataset.kind).toBe('collapsed'));
    expect(statesOf('Top')).toHaveLength(0);
  });

  it('a single-state chip has nothing to open (edge)', async () => {
    const one = trait('One', { states: [{ name: 'only', isInitial: true, isTerminal: false }], transitions: [] });
    render(<StateMachineView orbital={{ page: '/p', traits: [one] }} />);
    await waitFor(() => expect(box('One').dataset.kind).toBe('chip'));
    expect(within(box('One')).queryByTestId('avl-om-toggle')).toBeNull();
  });
});

describe('StateMachineView orbital selection', () => {
  function Listen({ on }: { on: (payload: object | undefined) => void }) {
    const bus = useEventBus();
    React.useEffect(() => bus.on('UI:PICK', (e) => on(e.payload)), [bus, on]);
    return null;
  }

  it('choosing a box emits selectEvent with its trait', async () => {
    const heard = vi.fn();
    render(
      <EventBusProvider debug={false}>
        <Listen on={heard} />
        <StateMachineView orbital={{ page: '/p', traits: [trait('A'), trait('B')] }} selectEvent="PICK" />
      </EventBusProvider>,
    );
    await waitFor(() => expect(boxes()).toHaveLength(2));
    fireEvent.click(within(box('B')).getByTestId('avl-om-head'));
    expect(heard).toHaveBeenCalledWith({ trait: 'B' });
    fireEvent.keyDown(within(box('A')).getByTestId('avl-om-head'), { key: 'Enter' });
    expect(heard).toHaveBeenLastCalledWith({ trait: 'A' });
  });

  it('marks only the selected trait (control)', async () => {
    render(<StateMachineView orbital={{ page: '/p', traits: [trait('A'), trait('B')] }} selectedTrait="B" />);
    await waitFor(() => expect(boxes()).toHaveLength(2));
    expect(box('B').dataset.selected).toBe('true');
    expect(box('A').dataset.selected).toBe('false');
    expect(within(box('B')).getByTestId('avl-om-head').getAttribute('aria-pressed')).toBe('true');
  });
});
