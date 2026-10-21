/**
 * AVL Zoom Band
 *
 * Continuous semantic zoom for the unified AVL canvas.
 * React Flow nodes read the current zoom band from context
 * and switch their rendering accordingly.
 */

import { createContext, useContext } from 'react';

/** The four zoom bands of the unified AVL canvas. */
export type ZoomBand = 'system' | 'module' | 'behavior' | 'detail';

/** Thresholds for zoom band transitions (React Flow viewport zoom). */
export const ZOOM_BAND_THRESHOLDS = {
  system:   [0.1, 0.4],
  module:   [0.4, 1.0],
  behavior: [1.0, 2.5],
  detail:   [2.5, 5.0],
} as const;

// ---------------------------------------------------------------------------
// Band computation
// ---------------------------------------------------------------------------

/** Determine which zoom band the current viewport zoom falls into. */
export function computeZoomBand(zoom: number): ZoomBand {
  if (zoom < ZOOM_BAND_THRESHOLDS.module[0]) return 'system';
  if (zoom < ZOOM_BAND_THRESHOLDS.behavior[0]) return 'module';
  if (zoom < ZOOM_BAND_THRESHOLDS.detail[0]) return 'behavior';
  return 'detail';
}

/**
 * Compute progress (0..1) within a zoom band.
 * Useful for crossfade transitions between bands.
 */
export function zoomProgress(zoom: number, band: ZoomBand): number {
  const [min, max] = ZOOM_BAND_THRESHOLDS[band];
  const clamped = Math.max(min, Math.min(max, zoom));
  const range = max - min;
  if (range === 0) return 1;
  return (clamped - min) / range;
}

// ---------------------------------------------------------------------------
// React context
// ---------------------------------------------------------------------------

/** Context providing the current zoom band to all node components. */
export const ZoomBandContext = createContext<ZoomBand>('module');

/** Hook to read the current zoom band. */
export function useZoomBand(): ZoomBand {
  return useContext(ZoomBandContext);
}
