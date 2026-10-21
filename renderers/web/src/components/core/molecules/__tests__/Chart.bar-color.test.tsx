import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Chart } from '../Chart';
import { EventBusProvider } from '../../../../core';

const single = [{ label: 'Cities', value: 3 }, { label: 'Work', value: 7 }, { label: 'Climate', value: 2 }];
const series = [
  { name: 'Revenue', data: [{ label: 'Jan', value: 10 }, { label: 'Feb', value: 20 }] },
  { name: 'Cost', data: [{ label: 'Jan', value: 5 }, { label: 'Feb', value: 8 }] },
];

const fill = (title: string): string => {
  const el = screen.getByTitle(title);
  return el.getAttribute('fill') ?? el.style.backgroundColor;
};

const renderChart = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('Chart bar colour', () => {
  for (const look of ['bar-vertical', 'bar-horizontal'] as const) {
    it(`${look}: one series encodes no identity, so every bar shares the series colour`, () => {
      renderChart(<Chart data={single} look={look} />);
      const colours = new Set(['Cities: 3', 'Work: 7', 'Climate: 2'].map(fill));
      expect(colours.size).toBe(1);
      expect([...colours][0]).toBe('var(--color-primary)');
    });
  }

  it('control: multi-series keeps one colour per series, shared across categories', () => {
    renderChart(<Chart series={series} look="bar-vertical" />);
    expect(fill('Jan, Revenue: 10')).toBe(fill('Feb, Revenue: 20'));
    expect(fill('Jan, Cost: 5')).toBe(fill('Feb, Cost: 8'));
    expect(fill('Jan, Revenue: 10')).not.toBe(fill('Jan, Cost: 5'));
  });

  it('edge: an explicit series colour wins for a single series', () => {
    renderChart(<Chart series={[{ name: 'default', color: 'var(--color-accent)', data: single }]} look="bar-vertical" />);
    expect(fill('Cities: 3')).toBe('var(--color-accent)');
    expect(fill('Work: 7')).toBe('var(--color-accent)');
  });

  it('control: pie still gives each category its own colour', () => {
    const { container } = renderChart(<Chart data={single} look="pie" />);
    const fills = new Set(Array.from(container.querySelectorAll('path[fill]')).map((p) => p.getAttribute('fill')));
    expect(fills.size).toBe(3);
  });
});
