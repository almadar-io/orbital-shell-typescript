/**
 * The layout strategies `orb compose --layout` accepts (orbital-compiler `composition`).
 * Choosing one from the wiring is the Rust composer's.
 *
 * @packageDocumentation
 */

export type LayoutStrategy =
  | 'sidebar'
  | 'tabs'
  | 'dashboard'
  | 'wizard-flow'
  | 'single';
