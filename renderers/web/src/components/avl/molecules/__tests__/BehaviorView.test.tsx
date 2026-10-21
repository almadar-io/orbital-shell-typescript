// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BehaviorView } from '../BehaviorView';
import type { TraitLevelData } from '../../../../lib/avl-schema-parser';
import { type AvlNodeData } from '../../../../lib/avl-flow-converter';

const trait = (name: string, states: string[]): TraitLevelData => ({
  name,
  linkedEntity: 'Order',
  states: states.map((s, i) => ({ name: s, isInitial: i === 0, isTerminal: false })),
  transitions: states.slice(1).map((s, i) => ({ from: states[i], to: s, event: `GO_${s.toUpperCase()}`, guard: null, effects: [], index: i })),
  emittedEvents: [],
  listenedEvents: [],
});

const data = (details: TraitLevelData[]): AvlNodeData => ({
  orbitalName: 'OrderOrbital',
  entityName: 'Order',
  persistence: 'persistent',
  fields: [],
  traits: details.map((d) => ({ name: d.name, stateCount: d.states.length, eventCount: d.transitions.length, transitionCount: d.transitions.length, emits: [], listens: [] })),
  pages: [],
  traitDetails: Object.fromEntries(details.map((d) => [d.name, d])),
  externalLinks: [],
});

describe('BehaviorView', () => {
  it('draws a state machine for every trait, not just the first', async () => {
    render(<BehaviorView data={data([trait('OrderFlow', ['a', 'b', 'c']), trait('Audit', ['x', 'y'])])} />);
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(5));
    expect(screen.getAllByTestId('avl-state-machine')).toHaveLength(2);
    expect(screen.getByText('OrderFlow')).toBeInTheDocument();
    expect(screen.getByText('Audit')).toBeInTheDocument();
  });

  it('shows an empty state when no trait has details (control: no bare string)', () => {
    render(<BehaviorView data={data([])} />);
    expect(screen.getByTestId('behavior-view-empty')).toBeInTheDocument();
    expect(screen.queryAllByTestId('avl-state-machine')).toHaveLength(0);
  });
});
