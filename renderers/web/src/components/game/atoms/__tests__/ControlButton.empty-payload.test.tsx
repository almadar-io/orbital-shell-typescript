import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BusEvent } from '@almadar/core';
import { EventBusProvider, useEventBus } from '../../../../core';
import { ControlButton } from '../ControlButton';

function Capture({ onPress, onRelease }: {
  onPress: (payload: BusEvent['payload']) => void;
  onRelease: (payload: BusEvent['payload']) => void;
}): null {
  const bus = useEventBus();
  React.useEffect(() => {
    const stopPress = bus.on('UI:PRESS', (event: BusEvent) => onPress(event.payload));
    const stopRelease = bus.on('UI:RELEASE', (event: BusEvent) => onRelease(event.payload));
    return () => {
      stopPress();
      stopRelease();
    };
  }, [bus, onPress, onRelease]);
  return null;
}

describe('ControlButton event payload', () => {
  it('emits the authored empty-object payload on press and release', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    render(
      <EventBusProvider debug={false}>
        <Capture onPress={onPress} onRelease={onRelease} />
        <ControlButton label="Fire" pressEvent="PRESS" releaseEvent="RELEASE" />
      </EventBusProvider>,
    );
    const button = screen.getByRole('button', { name: 'Fire' });
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    expect(onPress).toHaveBeenCalledWith({});
    expect(onRelease).toHaveBeenCalledWith({});
  });
});
