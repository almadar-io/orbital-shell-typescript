// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BusEvent } from '@almadar/core';
import { EventBusProvider, useEventBus } from '../../../../core';
import { TraitSlot } from '../TraitSlot';

function Capture({ onEvent }: { onEvent: (event: BusEvent) => void }): null {
  const bus = useEventBus();
  React.useEffect(() => bus.on('UI:SLOT_CLICK', onEvent), [bus, onEvent]);
  return null;
}

describe('TraitSlot authored events', () => {
  it('dispatches declarative click and callback independently', () => {
    const onEvent = vi.fn();
    const onClick = vi.fn();
    render(
      <EventBusProvider debug={false}>
        <Capture onEvent={onEvent} />
        <TraitSlot slotNumber={2} emptyLabel="Empty action slot" clickEvent="SLOT_CLICK" onClick={onClick} />
      </EventBusProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Empty action slot' }));
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[0][0].payload).toEqual({ slotNumber: 2 });
    expect(onClick).toHaveBeenCalledOnce();
  });
});
