import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { FilterPill } from '../../src/core/atoms/FilterPill';
import { Chart } from '../../src/components/core/molecules/Chart';
import { GraphView } from '../../src/components/core/molecules/GraphView';
import { DocPagination } from '../../src/components/core/molecules/DocPagination';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('G-ORBITAL-SHELL-TYPESCRIPT-062: default names without a caller aria-label', () => {
  it('Chart is a named group', () => {
    wrap(<Chart data={[{ label: 'A', value: 1 }]} />);
    expect(screen.getByRole('group', { name: 'Chart' })).toBeTruthy();
  });

  it('control: a caller aria-label wins', () => {
    wrap(<Chart data={[{ label: 'A', value: 1 }]} aria-label="Revenue" />);
    expect(screen.getByRole('group', { name: 'Revenue' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Chart' })).toBeNull();
  });

  it('GraphView is a named image', () => {
    wrap(<GraphView nodes={[{ id: 'a', label: 'A' }]} edges={[]} layout="flow" />);
    expect(screen.getByRole('img', { name: 'Graph' })).toBeTruthy();
  });

  it('DocPagination is a navigation landmark', () => {
    wrap(<DocPagination next={{ label: 'Next page', href: '/next' }} />);
    expect(screen.getByRole('navigation', { name: 'Page navigation' })).toBeTruthy();
  });
});

describe('G-ORBITAL-SHELL-TYPESCRIPT-063: FilterPill expresses pressed state with its own prop', () => {
  it('selected sets aria-pressed true on the pressable body', () => {
    wrap(<FilterPill label="Open" clickEvent="FILTER" selected />);
    expect(screen.getByRole('button', { name: 'Open' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('control: not selected is aria-pressed false, and a non-pressable pill carries none', () => {
    const first = wrap(<FilterPill label="Open" clickEvent="FILTER" selected={false} />);
    expect(screen.getByRole('button', { name: 'Open' }).getAttribute('aria-pressed')).toBe('false');
    first.unmount();
    const { container } = wrap(<FilterPill label="Open" selected />);
    expect(container.querySelector('[aria-pressed]')).toBeNull();
  });
});
