import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Navigation } from '../Navigation';
import { EventBusProvider } from '../../../../core';

const items = [{ id: 'home', label: 'Home', href: '/' }];
const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('Navigation', () => {
  it('shows the shared loading state while items are loading', () => {
    wrap(<Navigation items={items} isLoading />);
    expect(screen.getByRole('navigation').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows the shared error state instead of stale items', () => {
    wrap(<Navigation items={items} error={{ message: 'Navigation unavailable' }} />);
    expect(screen.getByRole('alert').textContent).toContain('Navigation unavailable');
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull();
  });

  it('renders items when neither state is set', () => {
    wrap(<Navigation items={items} />);
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('navigation').getAttribute('aria-busy')).toBeNull();
  });
});
