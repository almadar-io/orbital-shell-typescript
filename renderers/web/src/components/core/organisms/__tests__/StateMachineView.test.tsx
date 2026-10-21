// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StateMachineView } from '../StateMachineView';
import type { TraitDescription } from '@almadar/core';
import type { TraitLevelData } from '../../../../lib/avl-schema-parser';

const TRAIT: TraitLevelData = {
  name: 'Ticket',
  linkedEntity: 'Ticket',
  states: [{ name: 'open', isInitial: true, isTerminal: false }, { name: 'closed', isInitial: false, isTerminal: true }],
  transitions: [
    { from: 'open', to: 'closed', event: 'CLOSE', guard: null, effects: [], index: 0 },
    { from: 'open', to: 'closed', event: 'RESOLVE', guard: null, effects: [], index: 1 },
  ],
  emittedEvents: [],
  listenedEvents: [],
};

describe('StateMachineView renders through the AVL state machine', () => {
  it('draws the trait, one labelled wire per transition (no bundling)', async () => {
    render(<StateMachineView trait={TRAIT} activeState="open" />);
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(2));
    expect(screen.getAllByTestId('avl-sm-wire').map((w) => w.dataset.event)).toEqual(['CLOSE', 'RESOLVE']);
    expect(screen.getAllByTestId('avl-sm-state').find((n) => n.dataset.state === 'open')!.dataset.active).toBe('true');
  });

  it('shows loading and error states instead of the diagram', () => {
    const { unmount } = render(<StateMachineView trait={TRAIT} isLoading />);
    expect(screen.queryAllByTestId('avl-sm-state')).toHaveLength(0);
    unmount();
    render(<StateMachineView trait={TRAIT} error={new Error('boom')} />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('renders nothing but the empty state without a trait (control)', () => {
    render(<StateMachineView />);
    expect(screen.queryAllByTestId('avl-sm-state')).toHaveLength(0);
    expect(screen.getByTestId('state-machine-view-empty')).toBeInTheDocument();
  });

  it('draws a described trait (behavior/describe) the same way', async () => {
    const description: TraitDescription = {
      value: { behavior: 'std/std-ticket', trait: 'Ticket' },
      knobs: [],
      events: { emits: [], listens: [], transitions: ['CLOSE', 'RESOLVE'] },
      machine: {
        linkedEntity: 'Ticket',
        stateMachine: {
          states: [{ name: 'open', isInitial: true }, { name: 'closed', isTerminal: true }],
          events: [],
          transitions: [{ from: 'open', to: 'closed', event: 'CLOSE' }, { from: 'open', to: 'closed', event: 'RESOLVE' }],
        },
      },
      model: '',
    };
    render(<StateMachineView description={description} activeState="open" />);
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(2));
    expect(screen.getAllByTestId('avl-sm-wire').map((w) => w.dataset.event)).toEqual(['CLOSE', 'RESOLVE']);
  });

  it('a description without a machine shows the empty state (control)', () => {
    const description: TraitDescription = {
      value: { behavior: 'std/std-ticket', trait: 'Ticket' },
      knobs: [],
      events: { emits: [], listens: [], transitions: [] },
      model: '',
    };
    render(<StateMachineView description={description} />);
    expect(screen.getByTestId('state-machine-view-empty')).toBeInTheDocument();
  });

  it('a null description (json/parse of an empty subject) shows the empty state, not a crash', () => {
    render(<StateMachineView description={null} />);
    expect(screen.getByTestId('state-machine-view-empty')).toBeInTheDocument();
  });
});
