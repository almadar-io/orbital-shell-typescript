// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Meter } from '../Meter';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

describe('Meter accessibility', () => {
  it.each(['linear', 'radial', 'segmented'] as const)('%s exposes a named meter with its range', async (variant) => {
    const { container } = render(<Meter value={40} min={10} max={90} label="Storage" variant={variant} />);
    const meter = screen.getByRole('meter', { name: 'Storage' });
    expect(meter.getAttribute('aria-valuenow')).toBe('40');
    expect(meter.getAttribute('aria-valuemin')).toBe('10');
    expect(meter.getAttribute('aria-valuemax')).toBe('90');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('uses aria-label from props when there is no visible label', () => {
    render(<Meter value={5} aria-label="CPU load" />);
    expect(screen.getByRole('meter', { name: 'CPU load' })).toBeTruthy();
  });

  it('control: value text includes the unit', () => {
    render(<Meter value={5} unit="MB" label="Disk" />);
    expect(screen.getByRole('meter', { name: 'Disk' }).getAttribute('aria-valuetext')).toBe('5MB');
  });

  it('clamps an out-of-range value into the declared range', () => {
    render(<Meter value={500} max={100} label="Over" />);
    expect(screen.getByRole('meter', { name: 'Over' }).getAttribute('aria-valuenow')).toBe('100');
  });

  it('renders no meter while loading', () => {
    render(<Meter value={5} label="X" isLoading />);
    expect(screen.queryByRole('meter')).toBeNull();
  });
});
