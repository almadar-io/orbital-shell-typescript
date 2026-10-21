'use client';
/**
 * Content surfaces: the background box behind a content block (table,
 * calendar, list, chart …). Every block paints the theme-owned `.surface-content`
 * by default, so a patterned page never shows through one block and not the
 * next; the THEME decides what that surface looks like via `--surface-content-*`.
 *
 * Anything that already is a surface (a Card, a dialog, a panel, or a block that
 * painted one) marks its subtree, and a block inside that subtree stays flat —
 * declared ancestry, so a surface never nests inside another.
 */
import React from 'react';
import type { SurfaceMode } from '@almadar/core';

export type { SurfaceMode };

const SurfaceContext = React.createContext(false);

/** Marks its subtree as already sitting on a surface. */
export function SurfaceBoundary({ children }: { children?: React.ReactNode }): React.ReactElement {
  return <SurfaceContext.Provider value>{children}</SurfaceContext.Provider>;
}

export interface ContentSurface {
  /** `surface-content` when this block paints the surface, otherwise undefined. */
  className: string | undefined;
  /** Wraps the block's content so nested blocks know they already sit on a surface. */
  provide: (node: React.ReactNode) => React.ReactElement;
}

export function useContentSurface(surface: SurfaceMode = 'auto'): ContentSurface {
  const onSurface = React.useContext(SurfaceContext);
  const paints = surface === 'auto' && !onSurface;
  return {
    className: paints ? 'surface-content' : undefined,
    provide: (node) => (paints ? <SurfaceBoundary>{node}</SurfaceBoundary> : <>{node}</>),
  };
}

/** True when an ancestor already painted a surface. */
export function useOnSurface(): boolean {
  return React.useContext(SurfaceContext);
}
