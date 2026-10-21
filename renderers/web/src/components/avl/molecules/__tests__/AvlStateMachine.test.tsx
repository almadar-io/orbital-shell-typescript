// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AvlStateMachine } from '../AvlStateMachine';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';
import type { TraitLevelData } from '../../../../lib/avl-schema-parser';
import type { EventPayload } from '@almadar/core';

const ORDER: TraitLevelData = {
  name: 'OrderFlow',
  linkedEntity: 'Order',
  states: [
    { name: 'browsing', isInitial: true, isTerminal: false },
    { name: 'editing', isInitial: false, isTerminal: false },
    { name: 'saving', isInitial: false, isTerminal: false },
    { name: 'confirmed', isInitial: false, isTerminal: true },
    { name: 'failed', isInitial: false, isTerminal: false },
  ],
  transitions: [
    { from: 'browsing', to: 'editing', event: 'EDIT', guard: null, effects: [], index: 0 },
    { from: 'editing', to: 'saving', event: 'SAVE', guard: ['>', '@entity.qty', 0], effects: [{ type: 'persist', args: [] }], index: 1 },
    { from: 'saving', to: 'confirmed', event: 'SAVED', guard: null, effects: [], index: 2 },
    { from: 'saving', to: 'failed', event: 'SAVE_FAILED', guard: null, effects: [], index: 3 },
    { from: 'failed', to: 'editing', event: 'RETRY', guard: null, effects: [], index: 4 },
  ],
  emittedEvents: ['ORDER_SAVED'],
  listenedEvents: ['PAYMENT_OK'],
};

async function renderMachine(props: Partial<React.ComponentProps<typeof AvlStateMachine>> = {}) {
  const utils = render(
    <EventBusProvider debug={false}>
      <AvlStateMachine trait={ORDER} {...props} />
    </EventBusProvider>,
  );
  await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(5));
  return utils;
}

describe('AvlStateMachine', () => {
  it('draws one node per state and one wire per transition', async () => {
    await renderMachine();
    expect(screen.getAllByTestId('avl-sm-state').map((n) => n.dataset.state)).toEqual(['browsing', 'editing', 'saving', 'confirmed', 'failed']);
    expect(screen.getAllByTestId('avl-sm-wire')).toHaveLength(5);
  });

  it('marks exactly the active state and the fired transition (control: nothing marked without props)', async () => {
    const { unmount } = await renderMachine();
    expect(screen.getAllByTestId('avl-sm-state').filter((n) => n.dataset.active === 'true')).toHaveLength(0);
    expect(screen.getAllByTestId('avl-sm-wire').filter((w) => w.dataset.fired === 'true')).toHaveLength(0);
    unmount();

    await renderMachine({ activeState: 'saving', activeTransition: 1 });
    expect(screen.getAllByTestId('avl-sm-state').filter((n) => n.dataset.active === 'true').map((n) => n.dataset.state)).toEqual(['saving']);
    expect(screen.getAllByTestId('avl-sm-wire').filter((w) => w.dataset.fired === 'true').map((w) => w.dataset.event)).toEqual(['SAVE']);
  });

  it('numbers visited states in path order', async () => {
    await renderMachine({ visitedStates: ['browsing', 'editing'] });
    const badge = (state: string) =>
      screen.getAllByTestId('avl-sm-state').find((n) => n.dataset.state === state)?.querySelector('[data-testid="avl-sm-visit"]')?.textContent;
    expect(badge('browsing')).toBe('1');
    expect(badge('editing')).toBe('2');
    expect(badge('saving')).toBeUndefined();
  });

  it('carries the guard in .lolo form on a glyph instead of printing it', async () => {
    await renderMachine();
    const glyph = screen.getAllByTestId('avl-guard-glyph')[0];
    expect(glyph.getAttribute('aria-label')).toContain('(> @entity.qty 0)');
    expect(screen.queryByText('(> @entity.qty 0)')).toBeNull();
  });

  it('shows each effect as a labelled glyph chip', async () => {
    await renderMachine();
    const save = screen.getAllByTestId('avl-sm-label').find((l) => l.dataset.event === 'SAVE')!;
    const chips = [...save.querySelectorAll('[data-testid="avl-effect-chip"]')].map((c) => c.getAttribute('aria-label'));
    expect(chips).toEqual(['persist']);
    const edit = screen.getAllByTestId('avl-sm-label').find((l) => l.dataset.event === 'EDIT')!;
    expect(edit.querySelectorAll('[data-testid="avl-effect-chip"]')).toHaveLength(0);
  });

  it('shows listens / emits rails', async () => {
    await renderMachine();
    expect(screen.getByText('PAYMENT_OK')).toBeInTheDocument();
    expect(screen.getByText('ORDER_SAVED')).toBeInTheDocument();
  });

  it('emits the declared click events with the state / transition', async () => {
    const onState = vi.fn();
    const onTransition = vi.fn();
    function Listener() {
      const bus = useEventBus();
      useEffect(() => {
        const a = bus.on('UI:PICK_STATE', (e: { payload?: EventPayload }) => onState(e.payload));
        const b = bus.on('UI:PICK_TRANSITION', (e: { payload?: EventPayload }) => onTransition(e.payload));
        return () => { a(); b(); };
      }, [bus]);
      return null;
    }
    render(
      <EventBusProvider debug={false}>
        <Listener />
        <AvlStateMachine trait={ORDER} stateClickEvent="PICK_STATE" transitionClickEvent="PICK_TRANSITION" />
      </EventBusProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(5));
    fireEvent.click(screen.getAllByTestId('avl-sm-state').find((n) => n.dataset.state === 'failed')!);
    fireEvent.click(screen.getAllByTestId('avl-sm-label').find((l) => l.dataset.event === 'RETRY')!);
    expect(onState).toHaveBeenCalledWith({ stateId: 'failed' });
    expect(onTransition).toHaveBeenCalledWith({ index: 4, event: 'RETRY', from: 'failed', to: 'editing' });
  });

  it('a React host gets transition clicks through onTransitionClick (control: labels are inert without a handler)', async () => {
    const { unmount } = await renderMachine();
    expect(screen.getAllByTestId('avl-sm-label').every((l) => l.getAttribute('role') === null)).toBe(true);
    unmount();
    const onTransitionClick = vi.fn();
    await renderMachine({ onTransitionClick });
    fireEvent.click(screen.getAllByTestId('avl-sm-label').find((l) => l.dataset.event === 'SAVE')!);
    expect(onTransitionClick).toHaveBeenCalledWith({ index: 1, event: 'SAVE', from: 'editing', to: 'saving' });
  });

  it('fills its container instead of a fixed pixel width', async () => {
    await renderMachine();
    expect(screen.getByTestId('avl-state-machine').style.width).toBe('100%');
  });

  it('lays out transitions whose guard is absent rather than null (config data drops nulls)', async () => {
    const transitions = ORDER.transitions.map((tr) => {
      const copy = { ...tr };
      if (copy.guard === null) Reflect.deleteProperty(copy, 'guard');
      return copy;
    });
    expect(transitions.filter((tr) => 'guard' in tr)).toHaveLength(1);
    const dropped: TraitLevelData = { ...ORDER, transitions };
    render(<AvlStateMachine trait={dropped} />);
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(5));
  });

  it('marks the selected state and the pending transition source (control: neither without props)', async () => {
    const { unmount } = await renderMachine();
    expect(screen.getAllByTestId('avl-sm-state').filter((n) => n.dataset.selected === 'true' || n.dataset.pending === 'true')).toHaveLength(0);
    unmount();
    await renderMachine({ selectedState: 'editing', pendingSourceState: 'failed' });
    const node = (state: string) => screen.getAllByTestId('avl-sm-state').find((n) => n.dataset.state === state)!;
    expect(node('editing').dataset.selected).toBe('true');
    expect(node('failed').dataset.pending).toBe('true');
    expect(node('saving').dataset.selected).toBe('false');
  });

  it('draws gear-shaped states when nodeShape is gear', async () => {
    await renderMachine({ nodeShape: 'gear' });
    expect(screen.getAllByTestId('avl-sm-state').every((n) => n.dataset.shape === 'gear')).toBe(true);
    expect(screen.getAllByTestId('avl-sm-gear')).toHaveLength(5);
  });

  it('lists entity fields in the header when given', async () => {
    await renderMachine({ entityFields: ['customer', 'qty'] });
    expect(screen.getByTestId('avl-sm-fields').textContent).toContain('customer');
    expect(screen.getByTestId('avl-sm-fields').textContent).toContain('qty');
  });

  it('never truncates state names', async () => {
    const long = 'awaitingPaymentConfirmation';
    render(<AvlStateMachine trait={{ ...ORDER, states: [{ name: long, isInitial: true, isTerminal: false }], transitions: [] }} />);
    await waitFor(() => expect(screen.getByText(long)).toBeInTheDocument());
  });

  it('renders an empty state for a trait with no states', async () => {
    render(<AvlStateMachine trait={{ ...ORDER, states: [], transitions: [] }} />);
    expect(screen.queryAllByTestId('avl-sm-state')).toHaveLength(0);
    expect(screen.getByTestId('avl-state-machine-empty')).toBeInTheDocument();
  });
});
