import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PageHeader } from '../PageHeader';
import { EventBusProvider } from '../../../../core';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('PageHeader composes the existing molecules', () => {
  it('tabs are a real tablist (keyboard, selection, scrolling lane)', () => {
    const onTabChange = vi.fn();
    wrap(<PageHeader title="Acme" tabs={[{ label: 'Overview', value: 'o' }, { label: 'Health', value: 'h', count: 3 }]} activeTab="o" onTabChange={onTabChange} />);
    const list = screen.getByRole('tablist');
    expect(list.className).toContain('overflow-x-auto');
    expect(screen.getByRole('tab', { name: /Overview/ }).getAttribute('aria-selected')).toBe('true');
    act(() => { fireEvent.click(screen.getByRole('tab', { name: /Health/ })); });
    expect(onTabChange).toHaveBeenCalledWith('h');
  });

  it('breadcrumbs are the Breadcrumb navigation with a current page', () => {
    wrap(<PageHeader title="Acme" breadcrumbs={[{ label: 'Accounts', href: '/accounts' }, { label: 'Acme' }]} />);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Acme');
  });

  it('the back button is named', () => {
    wrap(<PageHeader title="Acme" showBack />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('control: no tabs, no tablist', () => {
    wrap(<PageHeader title="Acme" />);
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});
