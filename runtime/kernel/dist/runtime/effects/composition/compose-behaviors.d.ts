import { OrbitalDefinition, OrbitalSchema } from '@almadar/core';
import { EventWiringEntry } from './event-wiring.js';
import { LayoutStrategy } from './layout-strategy.js';

/**
 * Compose Behaviors
 *
 * Main entry point for composing multiple orbital definitions into
 * a single OrbitalSchema application. Handles event wiring, layout
 * strategy detection, and page generation.
 *
 * @packageDocumentation
 */

/**
 * Input for composing behaviors into an application.
 */
interface ComposeBehaviorsInput {
    /** Application name */
    appName: string;
    /** Orbital definitions (or schemas) to compose */
    orbitals: (OrbitalDefinition | OrbitalSchema)[];
    /** Layout strategy override, or 'auto' to detect */
    layoutStrategy?: LayoutStrategy | 'auto';
    /** Cross-orbital event wiring */
    eventWiring?: EventWiringEntry[];
    /** Optional entity name mappings (original -> renamed) */
    entityMappings?: Record<string, string>;
}
/**
 * Result of composing behaviors.
 */
interface ComposeBehaviorsResult {
    /** The composed OrbitalSchema */
    schema: OrbitalSchema;
    /** Layout metadata */
    layout: {
        strategy: LayoutStrategy;
        pageCount: number;
    };
    /** Wiring metadata */
    wiring: {
        connections: number;
    };
}
/**
 * Compose multiple orbital definitions into a single application schema.
 *
 * Steps:
 * 1. Apply event wiring (adds emits/listens to traits)
 * 2. Detect or use provided layout strategy
 * 3. Generate pages based on the strategy
 * 4. Build the final OrbitalSchema
 */
declare function composeBehaviors(input: ComposeBehaviorsInput): ComposeBehaviorsResult;

export { type ComposeBehaviorsInput, type ComposeBehaviorsResult, composeBehaviors };
