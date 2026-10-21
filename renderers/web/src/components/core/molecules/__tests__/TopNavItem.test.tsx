/**
 * TopNavItem: the one top-navigation item shared by Header and DashboardLayout's
 * top nav. A plain item follows its href; an item with children opens a
 * dropdown whose entries follow theirs.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TopNavItem, type TopNavItemData } from '../TopNavItem';
import { NavStackProvider } from '../../../../core';

function mount(item: TopNavItemData, activeHref?: string) {
  const navigate = vi.fn();
  render(
    <MemoryRouter>
      <NavStackProvider pages={[]} currentPath="/" navigate={navigate}>
        <TopNavItem item={item} activeHref={activeHref} />
      </NavStackProvider>
    </MemoryRouter>,
  );
  return navigate;
}

const products: TopNavItemData = {
  label: 'Products',
  href: '/products',
  children: [
    { label: 'Studio', href: '/studio' },
    { label: 'Orb', href: '/orb' },
  ],
};

describe('TopNavItem', () => {
  it('a plain item is a real link that follows its href through the nav stack', () => {
    const navigate = mount({ label: 'Pricing', href: '/pricing' });
    const link = screen.getByRole('link', { name: /pricing/i });
    expect(link.getAttribute('href')).toBe('/pricing');
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/pricing');
  });

  it('control: a plain item has no dropdown affordance', () => {
    mount({ label: 'Pricing', href: '/pricing' });
    expect(screen.getByRole('link', { name: /pricing/i }).getAttribute('aria-expanded')).toBeNull();
  });

  it('the active plain item is marked aria-current="page"', () => {
    mount({ label: 'Pricing', href: '/pricing' }, '/pricing');
    expect(screen.getByRole('link', { name: /pricing/i }).getAttribute('aria-current')).toBe('page');
  });

  it('control: an inactive plain item carries no aria-current', () => {
    mount({ label: 'Pricing', href: '/pricing' }, '/about');
    expect(screen.getByRole('link', { name: /pricing/i }).hasAttribute('aria-current')).toBe(false);
  });

  it('edge: an onClick-only item stays a button and still marks current', () => {
    mount({ label: 'Help', onClick: vi.fn(), active: true });
    expect(screen.getByRole('button', { name: /help/i }).getAttribute('aria-current')).toBe('page');
  });

  it('the active child in an open dropdown is marked aria-current="page"', () => {
    mount(products, '/orb');
    fireEvent.click(screen.getByRole('button', { name: /products/i }));
    expect(screen.getByRole('menuitem', { name: /orb/i }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('menuitem', { name: /studio/i }).hasAttribute('aria-current')).toBe(false);
  });

  it('an item with children opens a dropdown instead of navigating', () => {
    const navigate = mount(products);
    const trigger = screen.getByRole('button', { name: /products/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menuitem', { name: /studio/i })).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menuitem', { name: /studio/i })).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('choosing a child follows its href and closes the dropdown', () => {
    const navigate = mount(products);
    fireEvent.click(screen.getByRole('button', { name: /products/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /orb/i }));
    expect(navigate).toHaveBeenCalledWith('/orb');
    expect(screen.queryByRole('menuitem', { name: /orb/i })).toBeNull();
  });

  it('a child with an absolute URL leaves the app instead of using the nav stack', () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } });
    const navigate = mount({ label: 'More', href: '#', children: [{ label: 'Docs', href: 'https://orb.almadar.io' }] });
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /docs/i }));
    expect(assign).toHaveBeenCalledWith('https://orb.almadar.io');
    expect(navigate).not.toHaveBeenCalled();
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  it('the parent reads as active when one of its children is the active page', () => {
    mount(products, '/orb');
    expect(screen.getByRole('button', { name: /products/i }).getAttribute('data-active')).toBe('true');
  });

  it('control: the parent is not active when no child matches', () => {
    mount(products, '/pricing');
    expect(screen.getByRole('button', { name: /products/i }).getAttribute('data-active')).toBe('false');
  });
});
