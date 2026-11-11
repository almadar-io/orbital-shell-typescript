/**
 * The camera an AVL graph opens with. Fitting the whole graph is right while its chips stay readable; a graph
 * too large for that opens at the smallest readable scale, framed on its start, and the viewer pans or zooms out.
 */

/** The smallest scale an automatic fit may settle at: below it a chip's label cannot be read. */
export const LEGIBLE_FIT_ZOOM = 0.4;

export interface FitBounds { x: number; y: number; width: number; height: number }
export interface FitFrame { width: number; height: number }
export interface FitViewport { x: number; y: number; zoom: number }

/**
 * The viewport for a graph that cannot be fitted whole at a readable scale, or `null` when fitting it whole is fine.
 * An axis the graph fits on is centred; an axis it overflows starts at the graph's start edge, inset by the padding.
 */
export function legibleFitViewport(bounds: FitBounds, frame: FitFrame, padding: number): FitViewport | null {
  if (bounds.width <= 0 || bounds.height <= 0 || frame.width <= 0 || frame.height <= 0) return null;
  const whole = Math.min(frame.width / (bounds.width * (1 + padding)), frame.height / (bounds.height * (1 + padding)));
  if (whole >= LEGIBLE_FIT_ZOOM) return null;
  const zoom = LEGIBLE_FIT_ZOOM;
  const along = (start: number, size: number, room: number): number => {
    const scaled = size * zoom;
    const inset = (room * padding) / 2;
    return scaled + 2 * inset <= room ? (room - scaled) / 2 - start * zoom : inset - start * zoom;
  };
  return { x: along(bounds.x, bounds.width, frame.width), y: along(bounds.y, bounds.height, frame.height), zoom };
}
