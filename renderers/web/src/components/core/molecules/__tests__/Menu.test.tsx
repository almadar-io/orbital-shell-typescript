/**
 * Menu Molecule Tests
 *
 * Covers the disabled + title (tooltip) affordance items rely on to explain
 * why an action is unavailable.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Menu, type MenuItem } from '../Menu';
import { EventBusProvider } from '../../../../core';
import { NavStackProvider } from '../../../../core';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <EventBusProvider debug={false}>{children}</EventBusProvider>
);

describe('Menu', () => {
  it('renders a disabled item with its title as a tooltip and aria-disabled', async () => {
    const items: MenuItem[] = [
      {
        id: 'native',
        label: 'Native',
        disabled: true,
        title: 'Native build is blocked',
      },
    ];

    render(
      <TestWrapper>
        <Menu trigger="Build" items={items} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Build'));

    const item = await waitFor(() => screen.getByText('Native').closest('button'));
    expect(item).not.toBeNull();
    expect(item).toHaveAttribute('title', 'Native build is blocked');
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });

  it('an item with an href follows it through the nav stack', async () => {
    const navigate = vi.fn();
    render(
      <MemoryRouter>
        <NavStackProvider pages={[]} currentPath="/" navigate={navigate}>
          <TestWrapper>
            <Menu trigger="EN" items={[{ id: 'sl', label: 'Slovenščina', href: '/sl/vision' }]} />
          </TestWrapper>
        </NavStackProvider>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('EN'));
    fireEvent.click(await waitFor(() => screen.getByText('Slovenščina')));
    expect(navigate).toHaveBeenCalledWith('/sl/vision');
  });

  it('control: an item without an href does not navigate', async () => {
    const navigate = vi.fn();
    render(
      <MemoryRouter>
        <NavStackProvider pages={[]} currentPath="/" navigate={navigate}>
          <TestWrapper>
            <Menu trigger="Actions" items={[{ id: 'x', label: 'Archive', event: 'ARCHIVE' }]} />
          </TestWrapper>
        </NavStackProvider>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('Actions'));
    fireEvent.click(await waitFor(() => screen.getByText('Archive')));
    expect(navigate).not.toHaveBeenCalled();
  });
});
