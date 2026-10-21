/**
 * avl-3d-context.ts
 *
 * React context for AVL 3D model overrides and configuration.
 * Allows replacing primitive geometry with custom GLB/GLTF models.
 *
 * @packageDocumentation
 */

import { createContext, useContext } from 'react';
import { AVL_3D_COLORS } from '../lib/avl-3d-layout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Avl3DModelOverrides {
  /** GLB URL for orbital nodes (replaces sphere) */
  orbital?: string;
  /** GLB URL for entity core (replaces icosahedron) */
  entity?: string;
  /** GLB URL for state nodes (replaces sphere) */
  state?: string;
  /** GLB URL for guard gates (replaces octahedron) */
  guard?: string;
  /** GLB URL for page portals (replaces plane) */
  page?: string;
}

export interface Avl3DConfig {
  /** Custom 3D model URLs to replace default primitive geometry */
  modelOverrides: Avl3DModelOverrides;
  /** Whether postprocessing effects are enabled */
  effectsEnabled: boolean;
  /**
   * AVL_3D_COLORS resolved against the active theme, for three.js materials
   * and lights (which cannot evaluate `var()`/`color-mix()` themselves).
   * Null until the viewer has resolved every token — descendants render only
   * once the Canvas that provides this context is mounted, so they can treat
   * a non-null palette as guaranteed.
   */
  palette: Readonly<Record<keyof typeof AVL_3D_COLORS, string>> | null;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Avl3DConfig = {
  modelOverrides: {},
  effectsEnabled: true,
  palette: null,
};

export const Avl3DContext = createContext<Avl3DConfig>(DEFAULT_CONFIG);

/**
 * Access the current AVL 3D configuration.
 * Returns model overrides and effect settings.
 */
export function useAvl3DConfig(): Avl3DConfig {
  return useContext(Avl3DContext);
}

/** The theme-resolved AVL_3D_COLORS palette for three.js materials and lights. */
export function useAvl3DPalette(): Readonly<Record<keyof typeof AVL_3D_COLORS, string>> | null {
  return useContext(Avl3DContext).palette;
}
