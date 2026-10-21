/**
 * ThemedPortal — the one way UI leaves the tree (modals, menus, tooltips,
 * slots). The portaled content is wrapped in the theme scope of the place it
 * was rendered from, so it resolves the same CSS variables it would in place.
 */
import React, { type CSSProperties, type ReactNode, type ReactPortal } from 'react';
import { createPortal } from 'react-dom';
import { useThemeScope } from '../core';
import { Box } from '../core';
import { getOrCreatePortalRoot } from './portalRoot';

export interface ThemedPortalProps {
  children: ReactNode;
  /** Defaults to the shared portal root. */
  container?: HTMLElement;
}

export function ThemedPortal({ children, container }: ThemedPortalProps): ReactPortal {
  const { theme, mode, vars } = useThemeScope();
  const scoped = theme !== undefined || vars !== undefined;
  return createPortal(
    scoped ? (
      <Box data-theme={theme} className={mode ? `contents ${mode}` : 'contents'} style={vars as CSSProperties | undefined}>
        {children}
      </Box>
    ) : children,
    container ?? getOrCreatePortalRoot(),
  );
}
