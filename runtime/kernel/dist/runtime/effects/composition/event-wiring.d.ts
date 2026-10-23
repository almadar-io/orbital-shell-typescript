import { OrbitalDefinition } from '@almadar/core';

/**
 * Event Wiring
 *
 * Applies cross-orbital event wiring to orbital definitions.
 * Adds emits/listens declarations to traits so they can communicate
 * across orbital boundaries.
 *
 * @packageDocumentation
 */

/**
 * A single event wiring entry connecting two traits across orbitals.
 */
interface EventWiringEntry {
    /** Source trait name or orbital name */
    from: string;
    /** Event name (UPPER_SNAKE_CASE) */
    event: string;
    /** Target trait name or orbital name */
    to: string;
    /** Event to trigger on the listener side */
    triggers: string;
}
/**
 * Apply event wiring to orbital definitions.
 *
 * For each wiring entry:
 * 1. Find the source trait and add an external emit (if not already present)
 * 2. Find the target trait and add an external listen (if not already present)
 *
 * Returns a new array of orbitals with wiring applied (deep-cloned).
 */
declare function applyEventWiring(orbitals: OrbitalDefinition[], wiring: EventWiringEntry[]): OrbitalDefinition[];

export { type EventWiringEntry, applyEventWiring };
