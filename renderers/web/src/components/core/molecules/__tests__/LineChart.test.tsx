import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LineChart } from '../LineChart';

describe('LineChart numeric x-axis', () => {
  it('spaces points evenly by index when no date or x is given (categorical)', () => {
    const { container } = render(
      <LineChart data={[{ value: 0 }, { value: 1 }, { value: 2 }]} width={100} height={100} />
    );
    const cx = Array.from(container.querySelectorAll('circle')).map((c) => Number(c.getAttribute('cx')));
    expect(cx).toEqual([20, 50, 80]);
  });

  it('spaces points proportionally to their true numeric x, not evenly by index', () => {
    // Mixed 1mL/0.1mL increments: index-based spacing would put these at
    // 20/50/80/... regardless of the actual gap between 0, 0.1, and 1.
    const { container } = render(
      <LineChart
        data={[
          { x: 0, value: 0 },
          { x: 0.1, value: 1 },
          { x: 1, value: 2 },
        ]}
        width={100}
        height={100}
      />
    );
    const cx = Array.from(container.querySelectorAll('circle')).map((c) => Number(c.getAttribute('cx')));
    expect(cx[0]).toBeCloseTo(20, 5);
    expect(cx[2]).toBeCloseTo(80, 5);
    // 0.1 of the way from 0 to 1 is 10% of the chart width, not 50%.
    expect(cx[1]).toBeCloseTo(20 + 0.1 * 60, 5);
  });

  it('sorts by numeric x before plotting, same as it already does for date', () => {
    const { container } = render(
      <LineChart
        data={[
          { x: 1, value: 10 },
          { x: 0, value: 20 },
        ]}
        width={100}
        height={100}
      />
    );
    const cx = Array.from(container.querySelectorAll('circle')).map((c) => Number(c.getAttribute('cx')));
    // x=0 (value 20) plots first even though it was given second.
    expect(cx[0]).toBeLessThan(cx[1]);
  });

  it('ignores x when date is also present (date wins)', () => {
    const { container } = render(
      <LineChart
        data={[
          { date: '2024-01-02', x: 0, value: 0 },
          { date: '2024-01-01', x: 100, value: 1 },
        ]}
        width={100}
        height={100}
      />
    );
    const cx = Array.from(container.querySelectorAll('circle')).map((c) => Number(c.getAttribute('cx')));
    // Sorted by date (2024-01-01 first), and spaced by index (date does not
    // space linearly) rather than by the x field.
    expect(cx).toEqual([20, 80]);
  });
});

describe('LineChart single point', () => {
  it('a lone point sits in the middle of the plot and shows its value', () => {
    const { container } = render(<LineChart data={[{ value: 799, label: 'Sep' }]} width={100} height={100} />);
    const circle = container.querySelector('circle');
    expect(Number(circle?.getAttribute('cx'))).toBe(50);
    expect(Number(circle?.getAttribute('cy'))).toBe(50);
    expect(Array.from(container.querySelectorAll('text')).map((t) => t.textContent)).toContain('Sep: 799');
  });

  it('control: two points keep the edges and show no values unless asked', () => {
    const { container } = render(<LineChart data={[{ value: 1 }, { value: 2 }]} width={100} height={100} />);
    const cx = Array.from(container.querySelectorAll('circle')).map((c) => Number(c.getAttribute('cx')));
    expect(cx).toEqual([20, 80]);
    expect(container.querySelectorAll('text')).toHaveLength(0);
  });
});
