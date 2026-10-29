// @vitest-environment jsdom
/** G-ORBITAL-SHELL-TYPESCRIPT-045: a rejected layout shows a failure with a retry, not "Computing layout..." forever. */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AvlStateMachine } from '../AvlStateMachine';
import { EventBusProvider } from '../../../../core';
import type { TraitLevelData } from '../../../../lib/avl-schema-parser';

const layout = vi.hoisted(() => ({ fail: true }));

vi.mock('../../../../lib/avl-elk-layout', async (importActual) => {
  const actual = await importActual<typeof import('../../../../lib/avl-elk-layout')>();
  return {
    ...actual,
    computeTraitLayout: (...args: Parameters<typeof actual.computeTraitLayout>) =>
      layout.fail ? Promise.reject(new Error('chunk gone')) : actual.computeTraitLayout(...args),
  };
});

const TRAIT: TraitLevelData = {
  name: 'Flow',
  linkedEntity: 'Order',
  states: [
    { name: 'a', isInitial: true, isTerminal: false },
    { name: 'b', isInitial: false, isTerminal: false },
  ],
  transitions: [{ from: 'a', to: 'b', event: 'GO', guard: null, effects: [], index: 0 }],
  emittedEvents: [],
  listenedEvents: [],
};

describe('AvlStateMachine layout failure', () => {
  it('shows the failure and recovers on retry', async () => {
    layout.fail = true;
    render(<EventBusProvider debug={false}><AvlStateMachine trait={TRAIT} /></EventBusProvider>);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('The state machine layout failed to load.'));
    expect(screen.queryByText('Computing layout...')).toBeNull();
    layout.fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('control: while the layout is pending it shows the computing text and no failure', () => {
    layout.fail = false;
    render(<EventBusProvider debug={false}><AvlStateMachine trait={TRAIT} /></EventBusProvider>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Computing layout...')).toBeTruthy();
  });
});
