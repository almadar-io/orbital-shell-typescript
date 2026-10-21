import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Timeline } from '../Timeline';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

function listen(event: string, listener: (e: { type: string; payload?: object }) => void): React.FC {
  return function Listener() {
    const bus = useEventBus();
    React.useEffect(() => bus.on(event, listener), [bus]);
    return null;
  };
}

const items = [{ id: 'v2', title: 'Add discount', description: 'agent', date: 'today' }];

describe('Timeline item actions', () => {
  it('an item action is a button that emits UI:{event} with the item row', () => {
    const listener = vi.fn();
    const Listener = listen('UI:RESTORE', listener);
    render(
      <EventBusProvider debug={false}>
        <Listener />
        <Timeline items={items} fields={['title']} itemActions={[{ label: 'Restore', event: 'RESTORE' }]} />
      </EventBusProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { row: expect.objectContaining({ id: 'v2', title: 'Add discount' }) } }),
    );
  });

  it('keyboard: Enter on the action emits too', () => {
    const listener = vi.fn();
    const Listener = listen('UI:RESTORE', listener);
    render(
      <EventBusProvider debug={false}>
        <Listener />
        <Timeline items={items} fields={['title']} itemActions={[{ label: 'Restore', event: 'RESTORE' }]} />
      </EventBusProvider>,
    );
    const button = screen.getByRole('button', { name: 'Restore' });
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.click(button);
    expect(listener).toHaveBeenCalled();
  });

  it('control: no itemActions renders no action buttons', () => {
    render(
      <EventBusProvider debug={false}>
        <Timeline items={items} fields={['title']} />
      </EventBusProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });
});
