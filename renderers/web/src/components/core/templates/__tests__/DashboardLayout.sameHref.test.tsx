/**
 * Two menu entries may link to the same page (a demo shell, an alias). Each still renders once,
 * with no duplicate-key reconciliation (React drops or duplicates children on a key clash).
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardLayout } from '../DashboardLayout';

class StubObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function renderWith(navItems: React.ComponentProps<typeof DashboardLayout>['navItems']) {
  vi.stubGlobal('ResizeObserver', StubObserver);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(<MemoryRouter><DashboardLayout appName="Stock" navItems={navItems}><span>content</span></DashboardLayout></MemoryRouter>);
  return errors.mock.calls.map((c) => String(c[0]));
}

describe('DashboardLayout nav entries that share a page', () => {
  it('renders every entry and raises no duplicate-key error', () => {
    const errors = renderWith([
      { label: 'Overview', href: '/stock', icon: 'layout-dashboard' },
      { label: 'Inventory', href: '/stock', icon: 'package' },
    ]);
    expect(screen.getAllByText('Overview').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inventory').length).toBeGreaterThan(0);
    expect(errors.filter((e) => e.includes('same key'))).toEqual([]);
  });

  it('control: distinct pages render as before', () => {
    const errors = renderWith([
      { label: 'Overview', href: '/a', icon: 'layout-dashboard' },
      { label: 'Inventory', href: '/b', icon: 'package' },
    ]);
    expect(screen.getAllByText('Inventory').length).toBeGreaterThan(0);
    expect(errors.filter((e) => e.includes('same key'))).toEqual([]);
  });
});
