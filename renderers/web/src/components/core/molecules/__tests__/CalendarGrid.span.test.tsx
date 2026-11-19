// @vitest-environment jsdom
/**
 * A range pick drives the grid: `month`, `3months` and `year` draw that many month grids with each event on its
 * start day; the default stays the hourly week timeline.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CalendarGrid } from '../CalendarGrid';
import { EventBusProvider } from '../../../../core';

const events = [{ id: 'e1', title: 'Launch review', dueDate: '2026-11-26T10:00:00' }];

function renderGrid(props: Partial<React.ComponentProps<typeof CalendarGrid>>) {
  return render(
    <EventBusProvider debug={false}>
      <CalendarGrid weekStart={new Date(2026, 10, 16)} events={events} startField="dueDate" {...props} />
    </EventBusProvider>,
  );
}

describe('CalendarGrid span', () => {
  it('month draws the whole month with the event on its day', () => {
    const { container } = renderGrid({ span: 'month' });
    expect(container.querySelectorAll('[data-calendar-day]').length).toBe(30);
    const day26 = container.querySelector('[data-calendar-day="26"]');
    expect(day26?.textContent).toContain('Launch review');
  });

  it('3months and year draw three and twelve months', () => {
    expect(renderGrid({ span: '3months' }).container.querySelectorAll('[data-calendar-span] h5').length).toBe(3);
    expect(renderGrid({ span: 'year' }).container.querySelectorAll('[data-calendar-span] h5').length).toBe(12);
  });

  it('control: the default is the week timeline, not a month grid', () => {
    const { container } = renderGrid({});
    expect(container.querySelector('[data-calendar-span]')).toBeNull();
    expect(container.querySelectorAll('[data-calendar-day]').length).toBe(0);
  });
});
