/**
 * EntitySchemaContext
 *
 * Provides the kernel's answer for which orbital owns each trait on the page.
 * Not a data store: entity rows flow through the state machine's `@payload.data`
 * binding and land on the rendering component's `entity` prop.
 *
 * @packageDocumentation
 */

import React, { createContext, useContext } from 'react';

export interface EntitySchemaContextValue {
    /** Per-trait owning-orbital name, as the kernel's page circuit answers it; scopes each slot's events. */
    orbitalsByTrait: ReadonlyMap<string, string>;
}

const EntitySchemaContext = createContext<EntitySchemaContextValue | null>(null);

export interface EntitySchemaProviderProps {
    orbitalsByTrait: ReadonlyMap<string, string>;
    children: React.ReactNode;
}

export function EntitySchemaProvider({
    orbitalsByTrait,
    children,
}: EntitySchemaProviderProps): React.ReactElement {
    const contextValue = React.useMemo<EntitySchemaContextValue>(() => ({ orbitalsByTrait }), [orbitalsByTrait]);

    return (
        <EntitySchemaContext.Provider value={contextValue}>
            {children}
        </EntitySchemaContext.Provider>
    );
}

export function useEntitySchema(): EntitySchemaContextValue {
    const context = useContext(EntitySchemaContext);
    if (!context) {
        throw new Error('useEntitySchema must be used within an EntitySchemaProvider');
    }
    return context;
}

/** Null when no provider is present (UISlotRenderer may render outside one in compiled mode). */
export function useEntitySchemaOptional(): EntitySchemaContextValue | null {
    return useContext(EntitySchemaContext);
}

export default EntitySchemaProvider;
