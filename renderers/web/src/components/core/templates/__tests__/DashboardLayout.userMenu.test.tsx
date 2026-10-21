/**
 * The account menu carries the app's own entries (Settings, a profile page) above
 * Sign out, declared as `userMenuItems` with the same `{icon, label, event?, navigatesTo?}`
 * shape as `topBarActions`.
 */
import React, { useEffect } from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardLayout, type TopBarAction } from '../DashboardLayout';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

function Probe({ seen }: { seen: string[] }): null {
  const bus = useEventBus();
  useEffect(() => {
    const offNav = bus.on('UI:NAVIGATE', (e) => seen.push(`NAVIGATE:${String(e.payload?.url)}`));
    const offEvt = bus.on('UI:OPEN_PROFILE', () => seen.push('OPEN_PROFILE'));
    const offSignOut = bus.on('UI:SIGN_OUT', () => seen.push('SIGN_OUT'));
    return () => { offNav(); offEvt(); offSignOut(); };
  }, [bus, seen]);
  return null;
}

function renderLayout(userMenuItems: TopBarAction[] | undefined, seen: string[] = [], onSignOut?: () => void) {
  return render(
    <EventBusProvider isolated>
      <MemoryRouter>
        <Probe seen={seen} />
        <DashboardLayout appName="Studio" user={{ name: 'Dana Designer', email: 'dana@example.com' }} userMenuItems={userMenuItems} onSignOut={onSignOut}>
          <span>content</span>
        </DashboardLayout>
      </MemoryRouter>
    </EventBusProvider>,
  );
}

function openAccountMenu(): void {
  fireEvent.click(screen.getAllByText('Dana Designer')[0]);
}

describe('DashboardLayout account menu entries', () => {
  it('lists the declared entries above Sign out and navigates on click', () => {
    const seen: string[] = [];
    renderLayout([{ icon: 'settings', label: 'Settings', navigatesTo: '/settings/account' }], seen);
    openAccountMenu();
    const settings = screen.getByText('Settings');
    const signOut = screen.getByText('Sign out');
    expect(settings.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(settings);
    expect(seen).toContain('NAVIGATE:/settings/account');
  });

  it('dispatches an entry event on the bus', () => {
    const seen: string[] = [];
    renderLayout([{ icon: 'user', label: 'Profile', event: 'OPEN_PROFILE' }], seen);
    openAccountMenu();
    fireEvent.click(screen.getByText('Profile'));
    expect(seen).toContain('OPEN_PROFILE');
  });

  it('control: without entries the menu holds only Sign out', () => {
    renderLayout(undefined);
    openAccountMenu();
    expect(screen.getByText('Sign out')).toBeTruthy();
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('Sign out asks the host to end the session with the bare UI:SIGN_OUT', () => {
    const seen: string[] = [];
    renderLayout(undefined, seen);
    openAccountMenu();
    fireEvent.click(screen.getByText('Sign out'));
    expect(seen).toEqual(['SIGN_OUT']);
  });

  it('a declared onSignOut runs too, so the trait can react', () => {
    const seen: string[] = [];
    const calls: string[] = [];
    renderLayout(undefined, seen, () => calls.push('trait'));
    openAccountMenu();
    fireEvent.click(screen.getByText('Sign out'));
    expect(calls).toEqual(['trait']);
    expect(seen).toEqual(['SIGN_OUT']);
  });
});
