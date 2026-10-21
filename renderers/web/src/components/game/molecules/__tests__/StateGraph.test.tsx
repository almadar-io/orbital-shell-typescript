// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { EventPayload } from '@almadar/core';
import { StateGraph } from '../StateGraph';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

const node = (state: string) => screen.getAllByTestId('avl-sm-state').find((n) => n.dataset.state === state)!;

describe('StateGraph renders through the AVL state machine', () => {
  it('maps current / selected / adding-from / initial onto the AVL markers', async () => {
    render(
      <StateGraph
        states={['idle', 'walking', 'jumping']}
        transitions={[{ from: 'idle', to: 'walking', event: 'MOVE' }, { from: 'walking', to: 'jumping', event: 'JUMP' }]}
        currentState="walking"
        selectedState="idle"
        addingFrom="jumping"
        initialState="idle"
      />,
    );
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(3));
    expect(node('walking').dataset.active).toBe('true');
    expect(node('idle').dataset.selected).toBe('true');
    expect(node('jumping').dataset.pending).toBe('true');
    expect(screen.getAllByTestId('avl-sm-wire').map((w) => w.dataset.event)).toEqual(['MOVE', 'JUMP']);
  });

  it('keeps the host box size it is given', async () => {
    const { container } = render(<StateGraph states={['a']} width={420} height={300} />);
    const host = container.firstElementChild as HTMLElement;
    expect(host.style.width).toBe('420px');
    expect(host.style.height).toBe('300px');
  });

  it('emits nodeClickEvent with the state id', async () => {
    const onClick = vi.fn();
    function Listener() {
      const bus = useEventBus();
      useEffect(() => bus.on('UI:SELECT_NODE', (e: { payload?: EventPayload }) => onClick(e.payload)), [bus]);
      return null;
    }
    render(
      <EventBusProvider debug={false}>
        <Listener />
        <StateGraph states={['a', 'b']} transitions={[{ from: 'a', to: 'b', event: 'GO' }]} nodeClickEvent="SELECT_NODE" />
      </EventBusProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(2));
    fireEvent.click(node('b'));
    expect(onClick).toHaveBeenCalledWith({ stateId: 'b' });
  });
});
