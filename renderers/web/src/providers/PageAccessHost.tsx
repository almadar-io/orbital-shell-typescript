/**
 * The page's declared `access`, enforced at the page boundary on both
 * execution paths: an `access: authenticated` page's subtree (its whole trait
 * circuit) mounts only once the host's auth provider has resolved an
 * authenticated viewer, and is keyed by that viewer so a different user never
 * inherits the previous user's circuit. Any other resolved authority sends the
 * viewer to the app's declared `signIn` route. Public and undeclared pages pass
 * straight through — no auth wait, no gate.
 *
 * @packageDocumentation
 */

import React, { useEffect } from 'react';
import type { PageAccess, ViewerAuthority } from '@almadar/core';

export interface PageAccessHostProps {
  /** The page's declared `access:` modifier; absent = no gate. */
  access?: PageAccess;
  /** What the host's auth provider has resolved the viewer to be. */
  authority: ViewerAuthority;
  /** The admitted viewer's identity; a change remounts the page subtree. */
  viewerId?: string;
  /** The app's `signIn:` route. */
  signIn?: string;
  /** The concrete path being opened — handed to `onDenied` as the return path. */
  path: string;
  /** Navigate a non-admitted viewer to `signIn`, carrying `returnTo`. */
  onDenied: (signIn: string, returnTo: string) => void;
  children: React.ReactNode;
}

export function PageAccessHost({
  access,
  authority,
  viewerId,
  signIn,
  path,
  onDenied,
  children,
}: PageAccessHostProps): React.ReactElement | null {
  const gated = access === 'authenticated';
  const denied = gated && authority !== 'pending' && authority !== 'authenticated';

  useEffect(() => {
    if (denied && signIn !== undefined) onDenied(signIn, path);
  }, [denied, signIn, path, onDenied]);

  if (!gated) return <>{children}</>;
  if (authority !== 'authenticated') return null;
  return <React.Fragment key={viewerId}>{children}</React.Fragment>;
}

PageAccessHost.displayName = 'PageAccessHost';
