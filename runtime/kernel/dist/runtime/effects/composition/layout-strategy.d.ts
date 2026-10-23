import { OrbitalDefinition } from '@almadar/core';
import { EventWiringEntry } from './event-wiring.js';

/**
 * Layout Strategy Detection
 *
 * Auto-detects the best layout strategy for a composed application
 * based on the number of orbitals and their event wiring topology.
 *
 * @packageDocumentation
 */

/**
 * Layout strategy for the composed application.
 *
 * - 'single': One orbital, one page
 * - 'tabs': 2-4 orbitals with no sequential chain
 * - 'sidebar': 5+ orbitals (navigation-heavy)
 * - 'dashboard': Single page with all orbitals visible
 * - 'wizard-flow': Sequential event chain detected (A -> B -> C)
 */
type LayoutStrategy = 'sidebar' | 'tabs' | 'dashboard' | 'wizard-flow' | 'single';
/**
 * Detect the best layout strategy based on orbital count and event wiring.
 *
 * Heuristic:
 * 1. Sequential event chain detected -> 'wizard-flow'
 * 2. 1 orbital -> 'single'
 * 3. 2-4 orbitals -> 'tabs'
 * 4. 5+ orbitals -> 'sidebar'
 */
declare function detectLayoutStrategy(orbitals: OrbitalDefinition[], eventWiring?: EventWiringEntry[]): LayoutStrategy;

export { type LayoutStrategy, detectLayoutStrategy };
