// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AvlStateMachine } from '../AvlStateMachine';
import { EventBusProvider } from '../../../../core';
import type { TraitLevelData } from '../../../../lib/avl-schema-parser';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

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

async function renderMachine(props: Partial<React.ComponentProps<typeof AvlStateMachine>> = {}) {
  const utils = render(
    <EventBusProvider debug={false}>
      <AvlStateMachine trait={TRAIT} {...props} />
    </EventBusProvider>,
  );
  await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(2));
  return utils;
}

describe('AvlStateMachine accessibility', () => {
  it('marks the active state and fired transition as current', async () => {
    const { container } = await renderMachine({ activeState: 'a', activeTransition: 0 });
    const states = screen.getAllByTestId('avl-sm-state');
    expect(states.map((n) => n.getAttribute('aria-current'))).toEqual(['true', null]);
    expect(screen.getByTestId('avl-sm-label').getAttribute('aria-current')).toBe('true');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: nothing is current without an execution position', async () => {
    const { container } = await renderMachine();
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(0);
  });

  it('a clickable state reports its selection as pressed', async () => {
    await renderMachine({ stateClickEvent: 'PICK', selectedState: 'b' });
    expect(screen.getAllByTestId('avl-sm-state').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  });

  it('a non-clickable state exposes no pressed state (control)', async () => {
    const { container } = await renderMachine({ selectedState: 'b' });
    expect(container.querySelectorAll('[aria-pressed]')).toHaveLength(0);
  });

  it('forwards aria-label to the root', async () => {
    await renderMachine({ role: 'group', 'aria-label': 'Order flow' });
    expect(screen.getByRole('group', { name: 'Order flow' })).toBeTruthy();
  });
});
