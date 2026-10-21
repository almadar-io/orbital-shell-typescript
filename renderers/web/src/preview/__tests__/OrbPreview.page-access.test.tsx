// @vitest-environment jsdom
/**
 * `access: authenticated` on the interpreter path: the page's circuit runs
 * only for an authenticated viewer; any other authority lands on the app's
 * declared `signIn` page with `returnTo` in its INIT payload, or — when
 * `signIn` is the host's own route — is handed to the host's sign-in. A public
 * page never waits for auth.
 */
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OrbitalSchema, ViewerAuthority } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

function orbital(name: string, path: string, content: string | string[], access?: 'public' | 'authenticated'): OrbitalSchema['orbitals'][number] {
  return {
    name,
    entity: { name: `${name}State`, persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [{
      name: `${name}View`,
      scope: 'instance',
      linkedEntity: `${name}State`,
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [],
        transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content }]] }],
      },
    }],
    pages: [{ name: `${name}Page`, path, traits: [{ ref: `${name}View` }], ...(access ? { access } : {}) }],
  } as OrbitalSchema['orbitals'][number];
}

const app: OrbitalSchema = {
  name: 'shop',
  site: { signIn: '/welcome' },
  orbitals: [
    orbital('Home', '/', 'Public home', 'public'),
    orbital('Account', '/account', 'Private account', 'authenticated'),
    orbital('Login', '/welcome', ['str/concat', 'Sign in, then back to ', '@payload.returnTo'], 'public'),
  ],
};

function open(path: string, authority: ViewerAuthority, onPageChange = vi.fn()) {
  render(
    <MemoryRouter>
      <OrbPreview
        schema={app}
        initialPagePath={path}
        authority={authority}
        {...(authority === 'authenticated' ? { user: { id: 'maya' } } : {})}
        onPageChange={onPageChange}
        isolated
      />
    </MemoryRouter>,
  );
  return onPageChange;
}

describe('page access on the interpreter', () => {
  it('runs an authenticated page for an authenticated viewer', async () => {
    open('/account', 'authenticated');
    expect(await screen.findByText('Private account')).toBeTruthy();
  });

  it('never runs an authenticated page for an anonymous viewer and lands on sign-in with the return path', async () => {
    const onPageChange = open('/account', 'anonymous');
    expect(await screen.findByText('Sign in, then back to /account')).toBeTruthy();
    expect(screen.queryByText('Private account')).toBeNull();
    expect(onPageChange).toHaveBeenCalledWith('/welcome');
  });

  it('treats a host with no sign-in (no authority given) as unavailable', async () => {
    render(
      <MemoryRouter>
        <OrbPreview schema={app} initialPagePath="/account" isolated />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Sign in, then back to /account')).toBeTruthy();
    expect(screen.queryByText('Private account')).toBeNull();
  });

  it('renders nothing of an authenticated page while authority is pending', async () => {
    const onPageChange = open('/account', 'pending');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Private account')).toBeNull();
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('control: a public page renders while authority is pending', async () => {
    open('/', 'pending');
    expect(await screen.findByText('Public home')).toBeTruthy();
  });

  it('hands a viewer to the host sign-in when signIn is the host route, with no page of its own', async () => {
    const onSignIn = vi.fn();
    const onPageChange = vi.fn();
    const hosted: OrbitalSchema = { ...app, site: { signIn: '/login' }, orbitals: app.orbitals.slice(0, 2) };
    render(
      <MemoryRouter>
        <OrbPreview schema={hosted} initialPagePath="/account" authority="anonymous" onSignIn={onSignIn} onPageChange={onPageChange} isolated />
      </MemoryRouter>,
    );
    await vi.waitFor(() => expect(onSignIn).toHaveBeenCalledWith('/account'));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Private account')).toBeNull();
    expect(onPageChange).not.toHaveBeenCalledWith('/login');
  });

  it('edge: a host offering no sign-in leaves the authenticated page unmounted', async () => {
    const hosted: OrbitalSchema = { ...app, site: { signIn: '/login' }, orbitals: app.orbitals.slice(0, 2) };
    render(
      <MemoryRouter>
        <OrbPreview schema={hosted} initialPagePath="/account" authority="unavailable" isolated />
      </MemoryRouter>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Private account')).toBeNull();
  });
});
