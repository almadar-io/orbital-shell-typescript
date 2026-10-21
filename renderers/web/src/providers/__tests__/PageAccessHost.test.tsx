// @vitest-environment jsdom
/**
 * `access: authenticated` mounts the page subtree only for a resolved
 * authenticated viewer (zero mounts while pending, anonymous, failed or
 * unavailable), sends a denied viewer to the declared `signIn` route, and
 * remounts for a different viewer. Public and undeclared pages never wait.
 */
import React, { useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { PageAccess, ViewerAuthority } from '@almadar/core';
import { PageAccessHost } from '../PageAccessHost';

function harness() {
  const mounts: string[] = [];
  const unmounts: string[] = [];
  function Page({ label }: { label: string }): React.ReactElement {
    useEffect(() => {
      mounts.push(label);
      return () => {
        unmounts.push(label);
      };
    }, [label]);
    return <>{label}</>;
  }
  const onDenied = vi.fn<(signIn: string, returnTo: string) => void>();
  const host = (access: PageAccess | undefined, authority: ViewerAuthority, viewerId?: string) => (
    <PageAccessHost access={access} authority={authority} viewerId={viewerId} signIn="/login" path="/account/42" onDenied={onDenied}>
      <Page label="circuit" />
    </PageAccessHost>
  );
  return { mounts, unmounts, onDenied, host };
}

describe('PageAccessHost', () => {
  it('mounts nothing for an authenticated page until the viewer is authenticated', () => {
    for (const authority of ['pending', 'anonymous', 'failed', 'unavailable'] as const) {
      const h = harness();
      const view = render(h.host('authenticated', authority));
      expect(h.mounts).toEqual([]);
      expect(view.container.textContent).toBe('');
      view.unmount();
    }
  });

  it('mounts exactly once when the viewer is authenticated', () => {
    const h = harness();
    render(h.host('authenticated', 'authenticated', 'u1'));
    expect(h.mounts).toEqual(['circuit']);
    expect(h.onDenied).not.toHaveBeenCalled();
  });

  it('sends a denied viewer to the sign-in route with the return path, but never while pending', () => {
    const h = harness();
    const view = render(h.host('authenticated', 'pending'));
    expect(h.onDenied).not.toHaveBeenCalled();
    view.rerender(h.host('authenticated', 'anonymous'));
    expect(h.onDenied).toHaveBeenCalledWith('/login', '/account/42');
  });

  it('unmounts on sign-out and remounts fresh for a different viewer', () => {
    const h = harness();
    const view = render(h.host('authenticated', 'authenticated', 'u1'));
    view.rerender(h.host('authenticated', 'authenticated', 'u2'));
    expect(h.mounts).toEqual(['circuit', 'circuit']);
    expect(h.unmounts).toEqual(['circuit']);
    view.rerender(h.host('authenticated', 'anonymous'));
    expect(h.unmounts).toEqual(['circuit', 'circuit']);
  });

  it('control: the same viewer re-rendering keeps the circuit mounted', () => {
    const h = harness();
    const view = render(h.host('authenticated', 'authenticated', 'u1'));
    view.rerender(h.host('authenticated', 'authenticated', 'u1'));
    expect(h.mounts).toEqual(['circuit']);
    expect(h.unmounts).toEqual([]);
  });

  it('control: public and undeclared pages render immediately whatever the authority', () => {
    for (const access of ['public', undefined] as const) {
      for (const authority of ['pending', 'unavailable', 'anonymous'] as const) {
        const h = harness();
        const view = render(h.host(access, authority));
        expect(h.mounts).toEqual(['circuit']);
        expect(h.onDenied).not.toHaveBeenCalled();
        view.unmount();
      }
    }
  });
});
