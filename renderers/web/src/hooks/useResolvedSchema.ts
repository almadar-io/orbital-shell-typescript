/**
 * useResolvedSchema Hook
 *
 * Resolves OrbitalSchema to IR for the OrbitalRuntime.
 * Uses the shared resolver to ensure consistency with the compiler.
 *
 * TRAIT-DRIVEN ARCHITECTURE:
 * - Pages have traits, NOT sections
 * - UI is produced by trait effects (render_ui)
 * - No backwards compatibility with legacy formats
 *
 * @packageDocumentation
 */

import { useState, useEffect, useMemo } from 'react';
import type { OrbitalSchema, Orbital, TraitEventListener } from '@almadar/core';

// Import shared resolver and types from main orbital export
import {
    schemaToIR as sharedSchemaToIR,
    clearSchemaCache as sharedClearSchemaCache,
    getPage,
} from '@almadar/core';

import type {
    ResolvedIR,
    ResolvedPage,
    ResolvedTrait,
    ResolvedEntity,
    ResolvedTraitBinding,
    ResolvedTraitListener,
} from '../types/runtime-types';

import { createLogger } from '@almadar/logger';

const resolvedSchemaLog = createLogger('almadar:ui:resolved-schema');

export interface ResolvedSchemaResult {
    /** The resolved page (or undefined if not found) */
    page: ResolvedPage | undefined;
    /** Trait bindings for this page */
    traits: ResolvedTraitBinding[];
    /** Entities used by this page */
    entities: Map<string, ResolvedEntity>;
    /** All entities from schema */
    allEntities: Map<string, ResolvedEntity>;
    /** All resolved traits */
    allTraits: Map<string, ResolvedTrait>;
    /** Loading state */
    loading: boolean;
    /** Error message if resolution failed */
    error: string | null;
    /** Full IR (for debugging) */
    ir: ResolvedIR | null;
}

/**
 * Hook to resolve an OrbitalSchema to IR.
 *
 * @param schema - The OrbitalSchema to resolve
 * @param pageName - Optional page name (defaults to first page or initial page)
 * @returns Resolved schema data including page, traits, and entities
 */
export function useResolvedSchema(
    schema: OrbitalSchema | null | undefined,
    pageName?: string
): ResolvedSchemaResult {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Resolve schema synchronously using shared resolver, then restore each
    // trait's `listens` array from the call-site schema.
    //
    // Two problems the resolver leaves behind:
    // 1. `ResolvedTraitListener` predates Phase-4: `source` is stripped.
    // 2. For ref-based traits the resolver picks up the atom's `listens`
    //    (e.g. ModalRecordModal has 0 listens) instead of the call-site
    //    override, so the cross-trait subscription is never set up.
    //
    // Fix: after resolution, replace every resolved trait's `listens` with
    // the call-site listens verbatim (source included). Call-site listens are
    // authoritative — they "replace the trait's listens array entirely" per
    // the override spec.
    const ir = useMemo<ResolvedIR | null>(() => {
        if (!schema) return null;
        try {
            // `schemaToIR`'s cache is identity-keyed on the schema object
            // ref (WeakMap, @almadar/core ≥ the version that ships this
            // resolver fix). Same ref → cached IR → stable trait refs
            // across re-renders → state-machine listeners survive.
            // Immutable mutation (palette drop, agent edit) hands us a
            // fresh ref → cache miss → fresh IR → downstream slot-reset
            // comparators see new trait refs and refire INIT against the
            // updated render-ui SExpr.
            const resolved = sharedSchemaToIR(schema);
            // Build call-site listens map. TraitRef union underspecifies the
            // ref-object variant (no `listens` field declared), so cast to the
            // common shape after the string-ref guard.
            //
            // For inline traits, listens live at the wrapper level. For
            // ref-based traits preprocessed by @almadar/runtime, the call-site
            // override gets applied to `_resolved.listens` (runtime ≥ 5.6.1)
            // and the wrapper has no top-level `listens`. Read both paths.
            const callSiteListensByTrait = new Map<string, TraitEventListener[]>();
            for (const orb of (schema.orbitals as Orbital[])) {
                for (const traitRef of (orb.traits ?? [])) {
                    if (typeof traitRef === 'string') continue;
                    const t = traitRef as {
                        name?: string;
                        listens?: TraitEventListener[];
                        _resolved?: { name?: string; listens?: TraitEventListener[] };
                    };
                    const inlineListens = t.listens?.length ? t.listens : undefined;
                    const resolvedListens = t._resolved?.listens?.length ? t._resolved.listens : undefined;
                    const listens = inlineListens ?? resolvedListens;
                    const traitName = t.name ?? t._resolved?.name;
                    if (typeof traitName !== 'string' || !listens) continue;
                    callSiteListensByTrait.set(traitName, listens);
                }
            }
            for (const [traitName, trait] of resolved.traits) {
                const callSiteListens = callSiteListensByTrait.get(traitName);
                if (!callSiteListens) continue;
                const beforeCount = trait.listens.length;
                trait.listens = callSiteListens.map((l): ResolvedTraitListener => ({
                    event: l.event,
                    triggers: l.triggers,
                    source: l.source,
                    guard: l.guard,
                    payloadMapping: l.payloadMapping,
                }));
                resolvedSchemaLog.info('listens:restored', {
                    trait: traitName,
                    beforeCount,
                    afterCount: trait.listens.length,
                    listens: callSiteListens.map((l) => {
                        const src = l.source;
                        const label = !src
                            ? '(no-source)'
                            : src.kind === 'any'
                                ? '*'
                                : src.trait;
                        return `${label}.${l.event}->${l.triggers}`;
                    }).join(','),
                });
            }
            return resolved;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Schema resolution failed');
            return null;
        }
    }, [schema]);

    useEffect(() => {
        setLoading(false);
    }, [ir]);

    // Derive page, traits, and entities from IR
    const result = useMemo<ResolvedSchemaResult>(() => {
        if (!ir) {
            return {
                page: undefined,
                traits: [],
                entities: new Map(),
                allEntities: new Map(),
                allTraits: new Map(),
                loading,
                error: error || (schema ? null : 'No schema provided'),
                ir: null,
            };
        }

        // Find the requested page using shared helper
        const page = getPage(ir, pageName);

        resolvedSchemaLog.debug('Resolved page', () => ({
            name: page?.name,
            path: page?.path,
            traits: page?.traits.length,
        }));

        // Get trait bindings for this page
        const traits = page?.traits || [];

        // Collect entities
        const entities = new Map<string, ResolvedEntity>();
        if (page) {
            for (const binding of page.entityBindings) {
                entities.set(binding.entity.name, binding.entity);
            }
        }

        return {
            page,
            traits,
            entities,
            allEntities: ir.entities,
            allTraits: ir.traits,
            loading,
            error,
            ir,
        };
    }, [ir, pageName, loading, error, schema]);

    return result;
}

/**
 * Clear the schema resolution cache
 */
export function clearSchemaCache(): void {
    sharedClearSchemaCache();
}
