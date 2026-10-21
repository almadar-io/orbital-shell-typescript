// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TraitStateViewer, type TraitStateMachineDefinition } from '../TraitStateViewer';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const TRAIT: TraitStateMachineDefinition = {
  name: 'Door',
  states: ['closed', 'open', 'locked'],
  currentState: 'open',
  transitions: [
    { from: 'closed', to: 'open', event: 'OPEN' },
    { from: 'open', to: 'closed', event: 'CLOSE' },
  ],
};

describe('TraitStateViewer accessibility', () => {
  it('linear: exactly the current step is aria-current=step', async () => {
    const { container } = render(<TraitStateViewer trait={TRAIT} variant="linear" />);
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain('open');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('full: the current state node is aria-current, others are not', async () => {
    const onStateClick = vi.fn();
    const { container } = render(<TraitStateViewer trait={TRAIT} variant="full" onStateClick={onStateClick} />);
    const nodes = screen.getAllByRole('button');
    expect(nodes.map((n) => n.getAttribute('aria-current'))).toEqual([null, 'true', null]);
    fireEvent.keyDown(nodes[2], { key: 'Enter' });
    expect(onStateClick).toHaveBeenCalledWith('locked');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('full without a click handler: the current state still reports aria-current (control)', () => {
    const { container } = render(<TraitStateViewer trait={TRAIT} variant="full" />);
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('forwards aria-label to the root', () => {
    render(<TraitStateViewer trait={TRAIT} role="group" aria-label="Door states" />);
    expect(screen.getByRole('group', { name: 'Door states' })).toBeTruthy();
  });

  it('a trait whose current state is not listed marks no step', () => {
    const { container } = render(<TraitStateViewer trait={{ ...TRAIT, currentState: 'ghost' }} variant="linear" />);
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(0);
  });
});
