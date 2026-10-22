/** A content block's surface modes. */
export const SURFACE_MODES = ['auto', 'none'] as const;

/**
 * A content block's surface: `auto` paints the theme-owned content surface
 * behind the block unless it already sits on one (a card, dialog or another
 * block); `none` places it directly on the page.
 */
export type SurfaceMode = (typeof SURFACE_MODES)[number];
