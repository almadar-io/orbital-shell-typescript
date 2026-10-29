// @vitest-environment jsdom
/**
 * `UI:SIGN_OUT` is a host-level event: a Sign out inside the circuit reaches the
 * host's `onSignOut` (G-PATTERN-SYNC-031), as `UI:NAVIGATE` reaches its router.
 */
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { TEST_TYPE_CONTRACT_VERSION } from '../../test-support/kernel-engine';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const app: OrbitalSchema = {
  typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
  name: 'shop',
  orbitals: [{
    name: 'Home',
    entity: { name: 'HomeState', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [{
      name: 'HomeView',
      linkedEntity: 'HomeState',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [],
        transitions: [{
          from: 'idle', to: 'idle', event: 'INIT',
          effects: [['render-ui', 'main', { type: 'dashboard-layout', appName: 'Shop', user: { name: 'Maya Buyer', email: 'maya@example.com' }, children: [{ type: 'typography', content: 'Home' }] }]],
        }],
      },
    }],
    pages: [{ name: 'HomePage', path: '/', traits: [{ ref: 'HomeView' }] }],
  }] as OrbitalSchema['orbitals'],
};

async function signOutFrom(onSignOut?: () => void): Promise<void> {
  render(
    <MemoryRouter>
      <OrbPreview schema={app} isolated {...(onSignOut ? { onSignOut } : {})} />
    </MemoryRouter>,
  );
  fireEvent.click((await screen.findAllByText('Maya Buyer'))[0]);
  fireEvent.click(await screen.findByText('Sign out'));
}

describe('sign-out on the interpreter', () => {
  it('a Sign out in the circuit reaches the host', async () => {
    const onSignOut = vi.fn();
    await signOutFrom(onSignOut);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('control: a host with no sign-out offers none and nothing breaks', async () => {
    await signOutFrom();
    expect(screen.getAllByText('Maya Buyer').length).toBeGreaterThan(0);
  });
});
