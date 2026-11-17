/**
 * A selected node offers its actions where it was clicked: each `selectedNodeActions` entry is a button beside
 * the node that emits its event with the node's id.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GraphCanvas } from '../GraphCanvas';
import { EventBusProvider, useEventBus } from '../../../../core';

afterEach(() => vi.restoreAllMocks());

const nodes = [{ id: 'a', label: 'Rust' }, { id: 'b', label: 'Lean' }];

function Listen({ type, fn }: { type: string; fn: (e: { payload?: Record<string, unknown> }) => void }): null {
  const bus = useEventBus();
  React.useEffect(() => bus.on(type, fn), [bus, type, fn]);
  return null;
}

function mount(props: Partial<React.ComponentProps<typeof GraphCanvas>>, listen: (e: { payload?: Record<string, unknown> }) => void = () => undefined) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  return render(
    <EventBusProvider debug={false}>
      <Listen type="UI:OPEN_PATH" fn={listen} />
      <GraphCanvas nodes={nodes} edges={[]} {...props} />
    </EventBusProvider>,
  );
}

describe('GraphCanvas selected node actions', () => {
  it('shows the selected node\'s actions and a click emits the action with the node id', () => {
    const opened = vi.fn();
    mount({ selectedNodeId: 'b', selectedNodeActions: [{ label: 'Open', event: 'OPEN_PATH', icon: 'arrow-right' }, { label: 'Show concepts', event: 'DRILL' }] }, opened);
    const group = screen.getByRole('group', { name: 'Lean' });
    expect(group).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ payload: { id: 'b' } }));
  });

  it('control: with no node selected there are no node actions', () => {
    mount({ selectedNodeActions: [{ label: 'Open', event: 'OPEN_PATH' }] });
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });
});
