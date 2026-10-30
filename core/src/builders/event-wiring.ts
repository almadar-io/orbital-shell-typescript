/**
 * A single event wiring entry connecting two traits across orbitals (the plan's `wiring`).
 * Applying a wiring is the Rust composer's (`orb compose`).
 *
 * @packageDocumentation
 */

export interface EventWiringEntry {
  /** Source trait name or orbital name */
  from: string;
  /** Event name (UPPER_SNAKE_CASE) */
  event: string;
  /** Target trait name or orbital name */
  to: string;
  /** Event to trigger on the listener side */
  triggers: string;
}
