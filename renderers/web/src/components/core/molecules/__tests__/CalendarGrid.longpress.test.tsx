import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { CalendarGrid } from '../CalendarGrid';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

const Listen: React.FC<{ event: string; spy: (p: unknown) => void }> = ({ event, spy }) => {
  const bus = useEventBus();
  React.useEffect(() => bus.on(event, (e) => spy(e.payload)), [bus, event, spy]);
  return null;
};

function renderGrid(props: Partial<React.ComponentProps<typeof CalendarGrid>>, spy: (p: unknown) => void) {
  return render(
    <EventBusProvider debug={false}>
      <Listen event="UI:SLOT_HOLD" spy={spy} />
      <CalendarGrid weekStart={new Date(2026, 8, 28)} events={[]} {...props} />
    </EventBusProvider>,
  );
}

afterEach(() => vi.useRealTimers());

describe('CalendarGrid long-press', () => {
  it('emits the long-press event after a held pointer on a time slot', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const { getAllByTestId } = renderGrid({ longPressEvent: 'SLOT_HOLD' }, spy);
    fireEvent.pointerDown(getAllByTestId('time-slot-09:00')[0]);
    act(() => { vi.advanceTimersByTime(600); });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ time: '09:00' });
  });

  it('control: a quick tap (pointer up before the hold) does not emit', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const { getAllByTestId } = renderGrid({ longPressEvent: 'SLOT_HOLD' }, spy);
    const cell = getAllByTestId('time-slot-09:00')[0];
    fireEvent.pointerDown(cell);
    fireEvent.pointerUp(cell);
    act(() => { vi.advanceTimersByTime(600); });
    expect(spy).not.toHaveBeenCalled();
  });

  it('control: leaving the slot cancels the hold', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const { getAllByTestId } = renderGrid({ longPressEvent: 'SLOT_HOLD' }, spy);
    const cell = getAllByTestId('time-slot-09:00')[0];
    fireEvent.pointerDown(cell);
    fireEvent.pointerLeave(cell);
    act(() => { vi.advanceTimersByTime(600); });
    expect(spy).not.toHaveBeenCalled();
  });

  it('a completed long-press does not also fire the slot click', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const onSlotClick = vi.fn();
    const { getAllByTestId } = renderGrid({ longPressEvent: 'SLOT_HOLD', onSlotClick }, spy);
    const cell = getAllByTestId('time-slot-09:00')[0];
    fireEvent.pointerDown(cell);
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.pointerUp(cell);
    fireEvent.click(cell);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(onSlotClick).not.toHaveBeenCalled();
  });

  it('control: a plain click still fires the slot click', () => {
    const onSlotClick = vi.fn();
    const { getAllByTestId } = renderGrid({ longPressEvent: 'SLOT_HOLD', onSlotClick }, vi.fn());
    fireEvent.click(getAllByTestId('time-slot-09:00')[0]);
    expect(onSlotClick).toHaveBeenCalledTimes(1);
  });
});
