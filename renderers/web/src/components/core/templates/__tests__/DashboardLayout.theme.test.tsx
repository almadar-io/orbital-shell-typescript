import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardLayout } from '../DashboardLayout';

function renderLayout(props: Partial<React.ComponentProps<typeof DashboardLayout>> = {}) {
  return render(
    <MemoryRouter>
      <DashboardLayout
        appName="Ledger"
        navItems={[{ label: 'Invoices', href: '/', icon: 'file-text' }, { label: 'Clients', href: '/clients', icon: 'users' }]}
        user={{ name: 'Ada Lovelace', email: 'ada@example.com' }}
        {...props}
      >
        <span>content</span>
      </DashboardLayout>
    </MemoryRouter>,
  );
}

describe('DashboardLayout follows the theme', () => {
  it('the sidebar uses the theme surface material and border width, like the header', () => {
    const { container } = renderLayout();
    const aside = container.querySelector('aside');
    expect(aside?.className).toContain('surface-material');
    expect(aside?.className).toContain('border-e-[length:var(--border-width)]');
    expect(screen.getByRole('banner').className).toContain('border-b-[length:var(--border-width)]');
  });

  it('nav items take the theme radius, not a fixed one', () => {
    renderLayout();
    const link = screen.getAllByRole('link', { name: /Invoices/ }).find((a) => a.getAttribute('href') === '/');
    expect(link?.className).toContain('rounded-interactive');
    expect(link?.className).not.toMatch(/rounded-(lg|md|full)\b/);
  });

  it('the app name speaks in the theme heading voice', () => {
    renderLayout();
    const names = screen.getAllByText('Ledger');
    expect(names.some((n) => n.className.includes('heading-voice'))).toBe(true);
  });

  it('no fixed radius or dark: overrides anywhere in the shell', () => {
    const { container } = renderLayout();
    const shell = container.innerHTML;
    expect(shell).not.toMatch(/\bdark:/);
    expect(shell).not.toMatch(/\brounded-(lg|md)\b/);
  });

  it('the user menu is a real menu with the sign-out item', () => {
    const onSignOut = vi.fn();
    renderLayout({ onSignOut });
    const trigger = screen.getByRole('button', { name: /Ada Lovelace/ });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    act(() => { fireEvent.click(trigger); });
    act(() => { fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ })); });
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
