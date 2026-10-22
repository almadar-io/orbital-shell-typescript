/**
 * Interaction Model Types
 *
 * Defines how users interact with entities in the application.
 * Used to drive trait selection and UI slot usage.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ============================================================================
// Flow Types
// ============================================================================

/**
 * Create flow - how new items are created
 */
export type CreateFlow = 'modal' | 'page' | 'inline' | 'none';

/**
 * Edit flow - how items are edited
 */
export type EditFlow = 'modal' | 'page' | 'inline' | 'none';

/**
 * View flow - how item details are viewed
 */
export type ViewFlow = 'drawer' | 'page' | 'modal' | 'inline' | 'none';

/**
 * Delete flow - how items are deleted
 */
export type DeleteFlow = 'confirm' | 'instant' | 'none';

/**
 * List interaction - what happens when clicking list items
 */
export type ListInteraction = 'click-to-view' | 'click-to-edit' | 'inline-edit';

// ============================================================================
// Interaction Model
// ============================================================================

/**
 * InteractionModel - defines how users interact with entities.
 *
 * This drives:
 * - Which traits to attach (EntityManagement, ModalEdit, etc.)
 * - How render_ui effects target slots (modal, drawer, page)
 * - What UI patterns to use
 */
export interface InteractionModel {
    /** How new items are created */
    createFlow: CreateFlow;

    /** How items are edited */
    editFlow: EditFlow;

    /** How item details are viewed */
    viewFlow: ViewFlow;

    /** How items are deleted */
    deleteFlow: DeleteFlow;

    /** What happens when clicking list items */
    listInteraction?: ListInteraction;

    /** Enable bulk actions (select multiple, delete all) */
    bulkActions?: boolean;

    /** Enable real-time updates */
    realtime?: boolean;
}

export const InteractionModelSchema = z.object({
    createFlow: z.enum(['modal', 'page', 'inline', 'none']),
    editFlow: z.enum(['modal', 'page', 'inline', 'none']),
    viewFlow: z.enum(['drawer', 'page', 'modal', 'inline', 'none']),
    deleteFlow: z.enum(['confirm', 'instant', 'none']),
    listInteraction: z.enum(['click-to-view', 'click-to-edit', 'inline-edit']).optional(),
    bulkActions: z.boolean().optional(),
    realtime: z.boolean().optional(),
});

// ============================================================================
// Default Models per Domain
// ============================================================================

/**
 * Default interaction models for each domain type
 */
export const DEFAULT_INTERACTION_MODELS: Record<string, InteractionModel> = {
    business: {
        createFlow: 'modal',
        editFlow: 'modal',
        viewFlow: 'drawer',
        deleteFlow: 'confirm',
        listInteraction: 'click-to-view',
        bulkActions: true,
    },
    game: {
        createFlow: 'none',
        editFlow: 'none',
        viewFlow: 'none',
        deleteFlow: 'none',
        realtime: true,
    },
    form: {
        createFlow: 'inline',
        editFlow: 'inline',
        viewFlow: 'none',
        deleteFlow: 'none',
    },
    dashboard: {
        createFlow: 'modal',
        editFlow: 'modal',
        viewFlow: 'drawer',
        deleteFlow: 'confirm',
        listInteraction: 'click-to-view',
    },
    content: {
        createFlow: 'page',
        editFlow: 'page',
        viewFlow: 'page',
        deleteFlow: 'confirm',
        listInteraction: 'click-to-view',
    },
};

/**
 * Gets the interaction model for a domain.
 * 
 * Retrieves the appropriate interaction model configuration based on the
 * specified domain. Falls back to the business model if no specific
 * domain match is found.
 * 
 * @param {string} domain - Domain name (e.g., 'healthcare', 'education')
 * @returns {InteractionModel} Interaction model configuration
 * 
 * @example
 * getInteractionModelForDomain('healthcare'); // returns healthcare-specific model
 * getInteractionModelForDomain('unknown'); // returns business fallback model
 */
export function getInteractionModelForDomain(domain: string): InteractionModel {
    return DEFAULT_INTERACTION_MODELS[domain] ?? DEFAULT_INTERACTION_MODELS.business;
}

// ============================================================================
// Type exports
// ============================================================================

export type InteractionModelInput = z.input<typeof InteractionModelSchema>;
