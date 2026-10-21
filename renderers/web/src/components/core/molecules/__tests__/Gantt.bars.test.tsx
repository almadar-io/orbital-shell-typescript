/**
 * Gantt bars on a day axis. Project Friday's schedule mapped start and end to the
 * same due date, and every bar drew as a half-day sliver: a day axis must cover
 * the end day. A row whose end is before its start is shown as reversed, never
 * silently redrawn as something the data does not say.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Gantt } from '../Gantt';

const DAY = 28;

function bar(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector(`[data-gantt-bar="${id}"]`);
}
const widthOf = (el: HTMLElement | null): number => parseFloat(el?.style.width ?? 'NaN');

describe('Gantt bars', () => {
  it('a task starting and ending on the same day covers that whole day', () => {
    const { container } = render(<Gantt tasks={[{ id: 'a', title: 'A', start: '2026-10-05', end: '2026-10-05' }]} showToday={false} />);
    expect(widthOf(bar(container, 'a'))).toBe(DAY);
  });

  it('control: Monday to Wednesday covers three days, the end day included', () => {
    const { container } = render(<Gantt tasks={[{ id: 'a', title: 'A', start: '2026-10-05', end: '2026-10-07' }]} showToday={false} />);
    expect(widthOf(bar(container, 'a'))).toBe(3 * DAY);
  });

  it('a row with only an end date is a one-day milestone on that day', () => {
    const { container } = render(
      <Gantt tasks={[{ id: 'm', title: 'M', end: '2026-10-07' }, { id: 'a', title: 'A', start: '2026-10-05', end: '2026-10-05' }]} showToday={false} />,
    );
    const m = bar(container, 'm');
    const a = bar(container, 'a');
    expect(widthOf(m)).toBe(DAY);
    expect(parseFloat(m?.style.left ?? 'NaN') - parseFloat(a?.style.left ?? 'NaN')).toBe(2 * DAY);
  });

  it('control: a row with neither date is not placed', () => {
    const { container } = render(<Gantt tasks={[{ id: 'x', title: 'X' }, { id: 'a', title: 'A', start: '2026-10-05', end: '2026-10-05' }]} showToday={false} />);
    expect(bar(container, 'x')).toBeNull();
    expect(bar(container, 'a')).not.toBeNull();
  });

  it('a row that ends before it starts is marked reversed and spans the two dates it carries', () => {
    const { container } = render(<Gantt tasks={[{ id: 'r', title: 'R', start: '2026-10-07', end: '2026-10-05' }]} showToday={false} />);
    const r = bar(container, 'r');
    expect(r?.getAttribute('data-dates-reversed')).toBe('true');
    expect(widthOf(r)).toBe(3 * DAY);
  });

  it('control: an ordered row is not marked reversed', () => {
    const { container } = render(<Gantt tasks={[{ id: 'a', title: 'A', start: '2026-10-05', end: '2026-10-07' }]} showToday={false} />);
    expect(bar(container, 'a')?.getAttribute('data-dates-reversed')).toBeNull();
  });
});

describe('Gantt bar colours are declared', () => {
  const task = { id: 'a', title: 'A', start: '2026-10-05', end: '2026-10-07', status: 'blocked' };
  it('a declared statusColorMap colours the bar', () => {
    const { container } = render(<Gantt tasks={[task]} statusColorMap={{ blocked: 'danger' }} showToday={false} />);
    expect(container.innerHTML).toContain('bg-error/80');
  });

  it('control: an undeclared status word is a primary bar', () => {
    const { container } = render(<Gantt tasks={[task]} showToday={false} />);
    expect(container.innerHTML).not.toContain('bg-error/80');
    expect(container.innerHTML).toContain('bg-primary/80');
  });
});
