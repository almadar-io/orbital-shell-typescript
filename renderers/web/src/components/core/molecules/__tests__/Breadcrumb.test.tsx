import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Breadcrumb } from '../Breadcrumb';
import { EventBusProvider } from '../../../../core';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);
const ITEMS = [
  { label: 'Home', href: '/' },
  { label: 'Accounts', href: '/accounts' },
  { label: 'Region', href: '/accounts/r' },
  { label: 'Acme Holdings International', href: '/accounts/r/acme' },
];

describe('Breadcrumb', () => {
  it('collapses middle crumbs into a decorative ellipsis', () => {
    wrap(<Breadcrumb items={ITEMS} maxItems={3} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Home', '…', 'Region', 'Acme Holdings International']);
    expect(screen.getByText('…').getAttribute('aria-hidden')).toBe('true');
  });

  it('control: a real crumb labelled "..." is still a crumb', () => {
    wrap(<Breadcrumb items={[{ label: 'Home', href: '/' }, { label: '...', href: '/more' }, { label: 'Leaf' }]} />);
    expect(screen.getByRole('link', { name: '...' }).getAttribute('href')).toBe('/more');
  });

  it('wraps and truncates long labels instead of overflowing', () => {
    wrap(<Breadcrumb items={ITEMS} />);
    const list = screen.getByRole('list');
    expect(list.className).toContain('flex-wrap');
    expect(screen.getByText('Acme Holdings International').className).toContain('truncate');
  });

  it('separators are decorative and mirror in RTL', () => {
    const { container } = wrap(<Breadcrumb items={ITEMS} />);
    const seps = container.querySelectorAll('[data-breadcrumb-separator]');
    expect(seps.length).toBe(3);
    for (const s of seps) {
      expect(s.getAttribute('aria-hidden')).toBe('true');
      expect(s.getAttribute('class')).toContain('rtl:-scale-x-100');
    }
  });
});
