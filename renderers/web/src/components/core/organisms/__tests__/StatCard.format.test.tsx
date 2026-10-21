import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from '../StatCard';
import { EventBusProvider } from '../../../../core';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);
const usd = (n: number) => new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(n);

describe('StatCard formatting', () => {
  it('applies a metric format (currency)', () => {
    wrap(<StatCard metrics={[{ label: 'Revenue', value: 1234.5, format: 'currency' }]} />);
    expect(screen.getByText(usd(1234.5))).toBeTruthy();
  });

  it('formats plain numeric values with grouping', () => {
    wrap(<StatCard label="Orders" value={12345} />);
    expect(screen.getByText('12,345')).toBeTruthy();
  });

  it('several metrics flow into auto-fit columns instead of a fixed count', () => {
    const { container } = wrap(<StatCard metrics={[{ label: 'A', value: 1 }, { label: 'B', value: 2 }, { label: 'C', value: 3 }, { label: 'D', value: 4 }]} />);
    const grid = container.querySelector('.grid') as HTMLElement;
    expect(grid.className).toContain('auto-fit');
    expect(grid.getAttribute('style') ?? '').not.toContain('repeat(4');
  });

  it('control: a string value is shown as given', () => {
    wrap(<StatCard label="Status" value="Healthy" />);
    expect(screen.getByText('Healthy')).toBeTruthy();
  });
});
