/**
 * A line/area chart must say what its points mean. Project Friday's leadership
 * revenue trends showed "a line with a dot": no value axis, and a lone bucket
 * pinned to the left edge with no value beside it.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Chart } from '../Chart';

const texts = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('svg text')).map((t) => t.textContent ?? '');

describe('Chart line/area value axis', () => {
  it('labels the value axis from 0 to the largest value', () => {
    const { container } = render(
      <Chart look="line" data={[{ label: 'Jul', value: 1200 }, { label: 'Aug', value: 400 }, { label: 'Sep', value: 800 }]} />,
    );
    const all = texts(container);
    expect(all).toContain('0');
    expect(all).toContain('1,200');
  });

  it('a single point sits in the middle of the plot and shows its value', () => {
    const { container } = render(<Chart look="area" data={[{ label: 'Sep', value: 799 }]} />);
    const circle = container.querySelector('svg circle');
    // width 400, left padding 40, right 20: the plot's middle is 40 + 340 / 2.
    expect(Number(circle?.getAttribute('cx'))).toBe(210);
    expect(texts(container).filter((t) => t === '799')).toHaveLength(2);
  });

  it('control: several points show values only on the axis unless showValues is on', () => {
    const data = [{ label: 'Jul', value: 1200 }, { label: 'Aug', value: 400 }];
    const off = texts(render(<Chart look="line" data={data} />).container);
    expect(off.filter((t) => t === '400')).toHaveLength(0);
    const on = texts(render(<Chart look="line" data={data} showValues />).container);
    expect(on.filter((t) => t === '400')).toHaveLength(1);
  });

  it('edge: all-zero data still labels the axis', () => {
    const { container } = render(<Chart look="line" data={[{ label: 'Jul', value: 0 }, { label: 'Aug', value: 0 }]} />);
    expect(texts(container)).toContain('0');
  });
});
