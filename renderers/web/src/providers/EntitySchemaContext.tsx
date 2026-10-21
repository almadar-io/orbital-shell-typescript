/**
 * EntitySchemaContext
 *
 * Minimal context providing entity schema definitions (field metadata).
 * This is NOT a data store — actual entity rows flow through the state
 * machine's `@payload.data` binding on the emitting trait's fetch-success
 * transition and land on the rendering component's `entity` prop.
 *
 * Replaces EntityStore's schema functionality without the mock data generation.
 *
 * @packageDocumentation
 */

import React, { createContext, useContext, useMemo } from 'react';
import type { ResolvedEntity } from '@almadar/core';

// ============================================================================
// Types
// ============================================================================

export interface EntitySchemaContextValue {
    /** Entity definitions (schema metadata only) */
    entities: Map<string, ResolvedEntity>;
    /**
     * Per-trait linkedEntity name. `ResolvedTrait` itself doesn't carry
     * linkedEntity (it lives on `ResolvedTraitBinding` at the page-binding
     * level), so OrbPreview pre-projects every page's trait bindings into
     * a flat `traitName → entityName` map for the slot renderer.
     *
     * Used by SlotContentRenderer to resolve `entityDef` via
     * `traitLinkedEntities.get(sourceTrait) → entities.get(...)` when the
     * rendered pattern's `entity:` prop is a resolved value (V2 path)
     * rather than a string entity-name. Without this lookup, form-section
     * can't enrich its fields with entity field metadata (values enum,
     * etc.) and an enum field renders as a plain text input. Closes VR3.
     */
    traitLinkedEntities: ReadonlyMap<string, string>;
    /**
     * Per-trait owning-orbital name. Same shape as `traitLinkedEntities`,
     * built from `schema.orbitals[].traits[]`. UISlotRenderer uses this
     * to wrap each slot's rendered subtree in `TraitScopeProvider` so
     * descendant pure components (Button, etc.) emit qualified
     * `UI:Orbital.Trait.EVENT` keys via the scoped useEventBus.
     */
    orbitalsByTrait: ReadonlyMap<string, string>;
}

// ============================================================================
// Context
// ============================================================================

const EntitySchemaContext = createContext<EntitySchemaContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export interface EntitySchemaProviderProps {
    /** Entity definitions from resolved schema */
    entities: ResolvedEntity[];
    /**
     * Per-trait linkedEntity name, projected from every page's
     * ResolvedTraitBinding. Optional for back-compat; when omitted,
     * SlotContentRenderer's enrichment path can only follow the
     * legacy V1 string-entity-name lookup.
     */
    traitLinkedEntities?: ReadonlyMap<string, string>;
    /**
     * Per-trait owning-orbital name. Required for the runtime path's
     * trait-scoped event qualification (Button etc. emit qualified keys
     * via TraitScopeProvider). Optional for back-compat with consumers
     * that don't yet thread the orbital map through.
     */
    orbitalsByTrait?: ReadonlyMap<string, string>;
    /** Children */
    children: React.ReactNode;
}

/**
 * Provides entity schema definitions to the component tree.
 *
 * This is a lightweight provider that only holds schema metadata (field definitions).
 * Actual entity rows arrive via `@payload.data` on the rendering trait's
 * success transition — they do NOT live in this context.
 */
export function EntitySchemaProvider({
    entities,
    traitLinkedEntities,
    orbitalsByTrait,
    children,
}: EntitySchemaProviderProps): React.ReactElement {
    // Build entities map from array
    const entitiesMap = useMemo(() => {
        const map = new Map<string, ResolvedEntity>();
        for (const entity of entities) {
            map.set(entity.name, entity);
        }
        return map;
    }, [entities]);

    const linkedMap = useMemo(() => {
        return traitLinkedEntities ?? new Map<string, string>();
    }, [traitLinkedEntities]);

    const orbitalsMap = useMemo(() => {
        return orbitalsByTrait ?? new Map<string, string>();
    }, [orbitalsByTrait]);

    const contextValue = useMemo<EntitySchemaContextValue>(
        () => ({
            entities: entitiesMap,
            traitLinkedEntities: linkedMap,
            orbitalsByTrait: orbitalsMap,
        }),
        [entitiesMap, linkedMap, orbitalsMap]
    );

    return (
        <EntitySchemaContext.Provider value={contextValue}>
            {children}
        </EntitySchemaContext.Provider>
    );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Access entity schema definitions.
 * Use this for field metadata (form building, filter enrichment).
 * Actual entity rows flow via `@payload.data` on the state machine's
 * success transition — never read them from a context.
 */
export function useEntitySchema(): EntitySchemaContextValue {
    const context = useContext(EntitySchemaContext);
    if (!context) {
        throw new Error('useEntitySchema must be used within an EntitySchemaProvider');
    }
    return context;
}

/**
 * Safe version of useEntitySchema that returns null when no provider is present.
 * Used by UISlotRenderer which may render outside an EntitySchemaProvider (compiled mode).
 */
export function useEntitySchemaOptional(): EntitySchemaContextValue | null {
    return useContext(EntitySchemaContext);
}

export default EntitySchemaProvider;
