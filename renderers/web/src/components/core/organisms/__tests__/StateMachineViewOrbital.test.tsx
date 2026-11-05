// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { EventBusProvider, useEventBus } from '../../../../core';
import { StateMachineView } from '../StateMachineView';
import type { MountedOrbital, MountedTrait } from '@almadar/core';

function trait(name: string, patch: Partial<MountedTrait> = {}): MountedTrait {
  return {
    trait: name, orbital: 'O', parent: null, depth: 0, embeddedIn: [], renders: true, linked: false, observer: false, stepsIn: 'browser',
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
      wires: [],
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
    const orbital: MountedOrbital = { page: '/p', wires: [], traits: [trait('Top'), trait('Deep', { parent: 'Top', depth: 2 })] };
    render(<StateMachineView orbital={orbital} expandDepth={2} activeStates={[{ trait: 'Deep', state: 'busy' }]} />);
    await waitFor(() => expect(boxes()).toHaveLength(2));
    expect(box('Top').dataset.kind).toBe('machine');
    expect(box('Deep').dataset.kind).toBe('collapsed');
    expect(screen.getAllByTestId('avl-om-state-node').every((n) => n.dataset.trait === 'Top')).toBe(true);
    expect(screen.getByTestId('avl-om-state').textContent).toBe('busy');
  });

  it('a single-state trait is a chip even above expandDepth', async () => {
    const one = trait('One', { states: [{ name: 'only', isInitial: true, isTerminal: false }], transitions: [] });
    render(<StateMachineView orbital={{ page: '/p', wires: [], traits: [one] }} activeStates={[{ trait: 'One', state: 'only' }]} />);
    await waitFor(() => expect(boxes()).toHaveLength(1));
    expect(box('One').dataset.kind).toBe('chip');
    expect(within(box('One')).queryByTestId('avl-om-state')).toBeNull();
  });

  it('puts renders:false traits in the background lane, never renders:true ones', async () => {
    const orbital: MountedOrbital = { page: '/p', wires: [], traits: [trait('Ui'), trait('Store', { renders: false })] };
    render(<StateMachineView orbital={orbital} />);
    await waitFor(() => expect(boxes()).toHaveLength(2));
    expect(box('Store').dataset.lane).toBe('true');
    expect(box('Ui').dataset.lane).toBe('false');
    expect(screen.getByText('Runs in the background')).toBeInTheDocument();
  });

  it('draws no lane without background traits (control)', async () => {
    render(<StateMachineView orbital={{ page: '/p', wires: [], traits: [trait('Ui')] }} />);
    await waitFor(() => expect(boxes()).toHaveLength(1));
    expect(screen.queryByTestId('avl-om-lane')).toBeNull();
  });

  it('draws one labelled arrow for the kernel wires between two traits', async () => {
    const orbital: MountedOrbital = {
      page: '/p',
      wires: [{ from: 'A', to: 'B', event: 'GO', triggers: 'GO' }, { from: 'A', to: 'B', event: 'GO', triggers: 'STOP' }],
      traits: [trait('A'), trait('B', { listens: [{ event: 'A.GO', triggers: 'GO' }, { event: 'A.GO', triggers: 'STOP' }] })],
    };
    render(<StateMachineView orbital={orbital} selectedTrait="A" />);
    await waitFor(() => expect(screen.getAllByTestId('avl-om-wire')).toHaveLength(1));
    const wire = screen.getByTestId('avl-om-wire');
    expect(wire.dataset.from).toBe('A');
    expect(wire.dataset.to).toBe('B');
    expect(screen.getByTestId('avl-om-wire-event').textContent).toBe('GO');
  });

  it('draws no arrow from a listen string alone: only kernel wires draw (control)', async () => {
    const orbital: MountedOrbital = { page: '/p', wires: [], traits: [trait('A'), trait('B', { listens: [{ event: 'Missing.GO', triggers: null }] })] };
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
    const orbital: MountedOrbital = { page: '/p', wires: [], traits: [trait('Host', { depth: 0 }), ...names.map((n) => leaf(n, 'Host'))] };
    render(<StateMachineView orbital={orbital} expandDepth={0} />);
    await waitFor(() => expect(boxes()).toHaveLength(13));
    const lefts = new Set(names.map((n) => left(box(n))));
    expect(lefts.size).toBeGreaterThan(1);
    expect(new Set(names.map((n) => top(box(n)))).size).toBeLessThan(12);
    expect(width(box('Host'))).toBeGreaterThan(width(box('Leaf0')) * 2);
  });

  it('a single child stays its own width inside a one-column box (control)', async () => {
    const orbital: MountedOrbital = { page: '/p', wires: [], traits: [trait('Host', { depth: 0 }), leaf('OnlyChildWithALongName', 'Host')] };
    render(<StateMachineView orbital={orbital} expandDepth={0} />);
    await waitFor(() => expect(boxes()).toHaveLength(2));
    expect(width(box('Host'))).toBeLessThan(width(box('OnlyChildWithALongName')) + 40);
  });
});

describe('StateMachineView orbital boxes open in place', () => {
  const orbital = (): MountedOrbital => ({ page: '/p', wires: [], traits: [trait('Top'), trait('Deep', { parent: 'Top', depth: 2 })] });
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
    render(<StateMachineView orbital={{ page: '/p', wires: [], traits: [one] }} />);
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
        <StateMachineView orbital={{ page: '/p', wires: [], traits: [trait('A'), trait('B')] }} selectEvent="PICK" />
      </EventBusProvider>,
    );
    await waitFor(() => expect(boxes()).toHaveLength(2));
    fireEvent.click(within(box('B')).getByTestId('avl-om-head'));
    expect(heard).toHaveBeenCalledWith({ trait: 'B' });
    fireEvent.keyDown(within(box('A')).getByTestId('avl-om-head'), { key: 'Enter' });
    expect(heard).toHaveBeenLastCalledWith({ trait: 'A' });
  });

  it('marks only the selected trait (control)', async () => {
    render(<StateMachineView orbital={{ page: '/p', wires: [], traits: [trait('A'), trait('B')] }} selectedTrait="B" />);
    await waitFor(() => expect(boxes()).toHaveLength(2));
    expect(box('B').dataset.selected).toBe('true');
    expect(box('A').dataset.selected).toBe('false');
    expect(within(box('B')).getByTestId('avl-om-head').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('StateMachineView orbital linked orbitals', () => {
  const linked = (name: string, orbital: string) => trait(name, { orbital, linked: true, renders: false });

  it('puts the traits of another orbital the page talks to in one box per orbital, not in the background lane', async () => {
    const orbital: MountedOrbital = {
      page: '/p',
      wires: [{ from: 'Dock', to: 'Thread', event: 'GO', triggers: 'GO' }],
      traits: [trait('Dock'), trait('Store', { renders: false }), linked('Thread', 'Assistant'), linked('Llm', 'Assistant'), linked('Mailer', 'Mail')],
    };
    render(<StateMachineView orbital={orbital} selectedTrait="Dock" />);
    await waitFor(() => expect(boxes()).toHaveLength(5));
    const groups = screen.getAllByTestId('avl-om-group');
    expect(groups.map((g) => g.dataset.orbital)).toEqual(['Assistant', 'Mail']);
    expect(box('Thread').dataset.lane).toBe('false');
    expect(box('Store').dataset.lane).toBe('true');
    const group = groups[0]!;
    const inside = (name: string) => {
      const b = box(name);
      const gx = parseFloat(group.style.left);
      const gy = parseFloat(group.style.top);
      return parseFloat(b.style.left) >= gx && parseFloat(b.style.top) >= gy
        && parseFloat(b.style.left) + parseFloat(b.style.width) <= gx + parseFloat(group.style.width)
        && parseFloat(b.style.top) + parseFloat(b.style.height) <= gy + parseFloat(group.style.height);
    };
    expect(inside('Thread') && inside('Llm')).toBe(true);
    expect(inside('Mailer')).toBe(false);
    expect(screen.getByTestId('avl-om-wire').dataset.to).toBe('Thread');
  });

  it('draws no linked section when the page talks to no other orbital (control)', async () => {
    render(<StateMachineView orbital={{ page: '/p', wires: [], traits: [trait('Ui')] }} />);
    await waitFor(() => expect(boxes()).toHaveLength(1));
    expect(screen.queryByTestId('avl-om-linked')).toBeNull();
    expect(screen.queryAllByTestId('avl-om-group')).toHaveLength(0);
  });
});

describe('StateMachineView orbital runtime layer', () => {
  const statesOf = (name: string) => screen.queryAllByTestId('avl-om-state-node').filter((n) => n.dataset.trait === name);
  const edges = (name: string) => screen.queryAllByTestId('avl-om-transition').filter((n) => n.dataset.trait === name);

  it('tints only the transitions that can leave the current state', async () => {
    render(<StateMachineView orbital={{ page: '/p', wires: [], traits: [trait('T')] }} activeStates={[{ trait: 'T', state: 'idle' }]} />);
    await waitFor(() => expect(edges('T')).toHaveLength(2));
    const next = Object.fromEntries(edges('T').map((e) => [e.dataset.event, e.dataset.next]));
    expect(next).toEqual({ GO: 'true', STOP: 'false' });
  });

  it('marks a guarded next transition with the guard glyph; an unguarded one carries none (control)', async () => {
    const guardedGo = trait('T', {
      transitions: [
        { index: 0, from: ['idle'], to: 'busy', event: 'GO', guarded: true, emits: [] },
        { index: 1, from: ['idle'], to: 'busy', event: 'RUN', guarded: false, emits: [] },
      ],
    });
    render(<StateMachineView orbital={{ page: '/p', wires: [], traits: [guardedGo] }} activeStates={[{ trait: 'T', state: 'idle' }]} />);
    await waitFor(() => expect(screen.getAllByTestId('avl-om-label')).toHaveLength(2));
    const label = (event: string) => screen.getAllByTestId('avl-om-label').find((l) => l.dataset.event === event)!;
    expect(within(label('GO')).queryByTestId('avl-om-guard')).not.toBeNull();
    expect(within(label('RUN')).queryByTestId('avl-om-guard')).toBeNull();
  });

  it('numbers the last dispatch route, then lets it fade', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <StateMachineView
          orbital={{ page: '/p', wires: [{ from: 'A', to: 'B', event: 'STARTED', triggers: 'GO' }], traits: [trait('A'), trait('B')] }}
          route={[{ trait: 'A', index: 0 }, { trait: 'B', index: 0 }]}
        />,
      );
      await waitFor(() => expect(screen.getAllByTestId('avl-om-step').map((n) => n.textContent)).toEqual(['1', '2']));
      expect(screen.getByTestId('avl-om-wire').dataset.hot).toBe('true');
      await act(async () => { vi.advanceTimersByTime(2500); });
      expect(screen.queryAllByTestId('avl-om-step')).toHaveLength(0);
      expect(screen.queryAllByTestId('avl-om-wire')).toHaveLength(0);
      expect(edges('A').every((e) => e.dataset.fired === 'false')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('folds three self-transitions of a state into a chip that opens in place', async () => {
    const loopy = trait('L', {
      transitions: [
        { index: 0, from: ['idle'], to: 'idle', event: 'A', guarded: false, emits: [] },
        { index: 1, from: ['idle'], to: 'idle', event: 'B', guarded: false, emits: [] },
        { index: 2, from: ['idle'], to: 'idle', event: 'C', guarded: false, emits: [] },
        { index: 3, from: ['idle'], to: 'busy', event: 'GO', guarded: false, emits: [] },
      ],
    });
    render(<StateMachineView orbital={{ page: '/p', wires: [], traits: [loopy] }} />);
    await waitFor(() => expect(edges('L')).toHaveLength(1));
    const chip = within(statesOf('L').find((n) => n.dataset.state === 'idle')!).getByTestId('avl-om-loops');
    expect(chip.textContent).toBe('3');
    expect(screen.queryByTestId('avl-om-loop-list')).toBeNull();
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByTestId('avl-om-loop-list').textContent).toBe('ABC'));
  });

  it('keeps two self-transitions as drawn loops (control)', async () => {
    const two = trait('L', {
      transitions: [
        { index: 0, from: ['idle'], to: 'idle', event: 'A', guarded: false, emits: [] },
        { index: 1, from: ['idle'], to: 'idle', event: 'B', guarded: false, emits: [] },
      ],
    });
    render(<StateMachineView orbital={{ page: '/p', wires: [], traits: [two] }} />);
    await waitFor(() => expect(edges('L')).toHaveLength(2));
    expect(screen.queryByTestId('avl-om-loops')).toBeNull();
  });
});

describe('StateMachineView orbital wires stay out of sight', () => {
  const orbital = (): MountedOrbital => ({
    page: '/p',
    wires: [{ from: 'A', to: 'B', event: 'STARTED', triggers: 'GO' }, { from: 'C', to: 'D', event: 'STARTED', triggers: 'GO' }],
    traits: [trait('A'), trait('B'), trait('C'), trait('D')],
  });

  it('draws only the wires that touch the chosen trait', async () => {
    render(<StateMachineView orbital={orbital()} selectedTrait="B" />);
    await waitFor(() => expect(boxes()).toHaveLength(4));
    expect(screen.getAllByTestId('avl-om-wire').map((w) => `${w.dataset.from}>${w.dataset.to}`)).toEqual(['A>B']);
  });

  it('draws no wire with nothing chosen and no route (control)', async () => {
    render(<StateMachineView orbital={orbital()} />);
    await waitFor(() => expect(boxes()).toHaveLength(4));
    expect(screen.queryAllByTestId('avl-om-wire')).toHaveLength(0);
  });
});
