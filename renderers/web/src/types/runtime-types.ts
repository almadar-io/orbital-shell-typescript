/**
 * OrbitalRuntime Types
 *
 * Re-exports IR types from @almadar/core.
 * This ensures runtime uses the same types as the compiler.
 *
 * @packageDocumentation
 */

// Re-export all IR types from @almadar/core
export type {
    TransitionFrom,
    ResolvedField,
    ResolvedEntity,
    ResolvedEntityBinding,
    ResolvedTraitState,
    ResolvedTraitEvent,
    ResolvedTraitTransition,
    ResolvedTraitGuard,
    ResolvedTraitTick,
    ResolvedTraitDataEntity,
    ResolvedTraitUIBinding,
    ResolvedTrait,
    ResolvedTraitBinding,
    ResolvedPattern,
    ResolvedSectionEvent,
    ResolvedSection,
    ResolvedNavigation,
    ResolvedPage,
    ResolvedIR,
} from '@almadar/core';

import type { ResolvedTraitListener as CoreResolvedTraitListener, ListenSource } from '@almadar/core';

export type { ListenSource };

/**
 * Extended `ResolvedTraitListener` carrying the runtime `source` scope
 * descriptor. Core's `ResolvedTraitListener` includes `source?: ListenSource`
 * starting with the version that shipped `ListenSource`; this intersection
 * keeps the field visible even if older core builds omit it.
 */
export type ResolvedTraitListener = CoreResolvedTraitListener & {
    source?: ListenSource;
};

// Re-export factory functions
export {
    createEmptyResolvedTrait,
    createEmptyResolvedPage,
    createResolvedField,
    inferTsType,
    isResolvedIR,
} from '@almadar/core';
