/**
 * TraitProvider Component
 *
 * Provides trait state machines to child components via React context.
 *
 * @packageDocumentation
 */

import React, { createContext, useContext, useMemo } from 'react';
import { createLogger } from '@almadar/logger';
import type { EventPayload } from '@almadar/core';
import type {
    ResolvedTrait,
    ResolvedTraitBinding,
    ResolvedEntity,
} from '../types/runtime-types';

const log = createLogger('almadar:ui:trait-provider');

// ============================================================================
// Types
// ============================================================================

export interface TraitInstance {
    /** Trait name */
    name: string;
    /** Current state */
    currentState: string;
    /** Available events (can be triggered) */
    availableEvents: string[];
    /** Dispatch an event to the state machine */
    dispatch: (eventKey: string, payload?: EventPayload) => void;
    /** Check if an event can be dispatched */
    canDispatch: (eventKey: string) => boolean;
    /** Get the full trait definition */
    trait: ResolvedTrait;
}

export interface TraitContextValue {
    /** All trait instances on this page */
    traits: Map<string, TraitInstance>;
    /** Get a trait instance by name */
    getTrait: (name: string) => TraitInstance | undefined;
    /** Dispatch an event to a specific trait */
    dispatchToTrait: (traitName: string, eventKey: string, payload?: EventPayload) => void;
    /** Check if an event can be dispatched to a trait */
    canDispatch: (traitName: string, eventKey: string) => boolean;
}

// ============================================================================
// Context
// ============================================================================

export const TraitContext = createContext<TraitContextValue | null>(null);

// ============================================================================
// Provider Component
// ============================================================================

export interface TraitProviderProps {
    /** Trait bindings for this page */
    traits: ResolvedTraitBinding[];
    /** Entity map for context */
    entities: Map<string, ResolvedEntity>;
    /** Children to render */
    children: React.ReactNode;
}

export function TraitProvider({
    traits: traitBindings,
    children,
}: TraitProviderProps): React.ReactElement {
    // Create trait instances
    const traitInstances = useMemo(() => {
        const map = new Map<string, TraitInstance>();

        for (const binding of traitBindings) {
            const trait = binding.trait;
            const initialState = trait.states.find((s) => s.isInitial);
            const stateName = initialState?.name || trait.states[0]?.name || 'idle';

            const instance: TraitInstance = {
                name: trait.name,
                currentState: stateName,
                availableEvents: trait.transitions
                    .filter((t) => t.from === stateName)
                    .map((t) => t.event),
                dispatch: (eventKey, payload) => {
                    log.debug('Dispatch', () => ({
                        trait: trait.name,
                        event: eventKey,
                        payloadKeys: payload ? Object.keys(payload) : [],
                    }));
                },
                canDispatch: (eventKey) => {
                    return trait.transitions.some(
                        (t) => t.from === stateName && t.event === eventKey
                    );
                },
                trait,
            };

            map.set(trait.name, instance);
        }

        return map;
    }, [traitBindings]);

    // Build context value
    const contextValue = useMemo<TraitContextValue>(() => {
        return {
            traits: traitInstances,
            getTrait: (name) => traitInstances.get(name),
            dispatchToTrait: (traitName, eventKey, payload) => {
                const instance = traitInstances.get(traitName);
                if (instance) {
                    instance.dispatch(eventKey, payload);
                }
            },
            canDispatch: (traitName, eventKey) => {
                const instance = traitInstances.get(traitName);
                return instance?.canDispatch(eventKey) || false;
            },
        };
    }, [traitInstances]);

    return (
        <TraitContext.Provider value={contextValue}>
            {children}
        </TraitContext.Provider>
    );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Access the trait context from within the TraitProvider.
 */
export function useTraitContext(): TraitContextValue {
    const context = useContext(TraitContext);
    if (!context) {
        throw new Error('useTraitContext must be used within a TraitProvider');
    }
    return context;
}

/**
 * Access a specific trait instance.
 */
export function useTrait(traitName: string): TraitInstance | undefined {
    const context = useTraitContext();
    return context.getTrait(traitName);
}

export default TraitProvider;
