// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { OrbitalSchema, Trait } from '@almadar/core';
import { JazariStateMachine } from '../JazariStateMachine';

const trait: Trait = {
  name: 'DoorTrait',
  stateMachine: {
    events: [{ key: 'OPEN', name: 'Open' }, { key: 'DONE', name: 'Done' }],
    states: [
      { name: 'closed', isInitial: true },
      { name: 'opening' },
      { name: 'awaitingPaymentConfirmation', isFinal: true },
    ],
    transitions: [
      { from: 'closed', to: 'opening', event: 'OPEN', guard: ['>', '@entity.power', 0] },
      { from: 'opening', to: 'awaitingPaymentConfirmation', event: 'DONE' },
    ],
  },
};

const schema: OrbitalSchema = {
  name: 'Doors',
  orbitals: [{ name: 'DoorOrbital', entity: { name: 'Door', fields: [{ name: 'power', type: 'number' }] }, traits: [trait], pages: [] }],
};

const node = (state: string) => screen.getAllByTestId('avl-sm-state').find((n) => n.dataset.state === state)!;

describe('JazariStateMachine renders through the AVL state machine as gears', () => {
  it('draws a gear per state from a trait, keeping full names and the legacy isFinal terminal', async () => {
    render(<JazariStateMachine trait={trait} />);
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(3));
    expect(screen.getAllByTestId('avl-sm-gear')).toHaveLength(3);
    expect(screen.getByText('awaitingPaymentConfirmation')).toBeInTheDocument();
    expect(node('closed').dataset.shape).toBe('gear');
    expect(screen.getByTestId('avl-guard-glyph').getAttribute('aria-label')).toContain('(> @entity.power 0)');
  });

  it('resolves the trait and entity fields from a schema', async () => {
    render(<JazariStateMachine schema={schema} />);
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(3));
    expect(screen.getByTestId('avl-sm-fields').textContent).toContain('power');
  });

  it('shows the empty state when there is no state machine (control)', () => {
    render(<JazariStateMachine trait={{ name: 'Empty' }} />);
    expect(screen.queryAllByTestId('avl-sm-state')).toHaveLength(0);
  });
});
