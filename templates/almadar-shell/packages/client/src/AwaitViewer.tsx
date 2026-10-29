import type { ReactElement, ReactNode } from 'react';
import type { ViewerAuthority } from '@almadar/core';

/** Mounts its children once the viewer is known (signed in, signed out or unavailable), never while a stored sign-in is still restoring. */
export function AwaitViewer({ authority, children }: { authority: ViewerAuthority; children: ReactNode }): ReactElement | null {
  return authority === 'pending' ? null : <>{children}</>;
}
