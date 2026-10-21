/**
 * Author-supplied explanations for AVL diagrams: a note per state, per
 * transition event and per effect type, shown in a popover on hover/focus.
 */

export interface AvlNote {
  /** Short heading. */
  title?: string;
  /** The explanation. */
  body: string;
}

export interface AvlAnnotations {
  /** Keyed by state name. */
  states?: Record<string, AvlNote>;
  /** Keyed by transition event. */
  transitions?: Record<string, AvlNote>;
  /** Keyed by effect type (e.g. `persist`). */
  effects?: Record<string, AvlNote>;
}
