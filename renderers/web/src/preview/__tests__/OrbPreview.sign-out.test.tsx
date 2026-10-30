// @vitest-environment jsdom
/**
 * Sign out is the circuit's own `(auth/sign-out)` effect: the kernel hands it back as a `host-ask`
 * client effect and the host's `onSignOut` answers it (G-ORB-589). Needs a kernel build that
 * emits the `host-ask` kind (`ALMADAR_KERNEL_DIR`).
 */
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
          effects: [['render-ui', 'main', { type: 'dashboard-layout', appName: 'Shop', onSignOut: 'SIGN_OUT', user: { name: 'Maya Buyer', email: 'maya@example.com' }, children: [{ type: 'typography', content: 'Home' }] }]],
        }, {
          from: 'idle', to: 'idle', event: 'SIGN_OUT',
          effects: [['auth/sign-out']],
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
  it('a Sign out in the circuit reaches the host through the program\'s own (auth/sign-out)', async () => {
    const onSignOut = vi.fn();
    await signOutFrom(onSignOut);
    // The click dispatches `SIGN_OUT` to the kernel; the host-ask comes back with its response, after the click returns.
    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
  });

  it('control: a host with no sign-out offers none and nothing breaks', async () => {
    await signOutFrom();
    expect(screen.getAllByText('Maya Buyer').length).toBeGreaterThan(0);
  });
});
