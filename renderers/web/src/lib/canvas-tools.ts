/**
 * Canvas editing tools a studio host can turn on for its canvas (a persona's
 * shell manifest declares its list; the canvas never branches on persona).
 */
export const CANVAS_TOOLS = [
  /** Shift-click and drag-a-box selection. */
  'multiSelect',
  /** Copy / cut / paste elements. */
  'clipboard',
  /** Double-click text to edit it in place. */
  'inlineText',
  /** ⇧2 zoom to selection, ⇧1 fit all. */
  'zoomToSelection',
  /** Resize and spacing handles on the selection. */
  'designHandles',
  /** Auto-layout direction, alignment, space-between and wrap. */
  'autoLayout',
  /** Min / max width and height. */
  'sizeLimits',
  /** Absolute position and constraints. */
  'absolute',
  /** Smart guides while moving or resizing. */
  'guides',
  /** ⌥-hover distances between elements. */
  'measure',
] as const;

export type CanvasTool = (typeof CANVAS_TOOLS)[number];

export function hasCanvasTool(tools: readonly CanvasTool[], tool: CanvasTool): boolean {
  return tools.includes(tool);
}
