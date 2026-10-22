/**
 * Page Types for Orbital Units
 *
 * Defines OrbitalPage type for pages within an Orbital Unit.
 *
 * IMPORTANT: Trait-driven UI architecture requires pages to have traits.
 * Static sections are NO LONGER SUPPORTED.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { PageId, TraitId, EntityId } from './identity.js';
import { PageIdSchema, TraitIdSchema, EntityIdSchema } from './identity.js';
import { TraitConfigSchema, type TraitConfig } from './trait.js';

// ============================================================================
// View Type
// ============================================================================

/**
 * Page view types.
 * Note: viewType may be deprecated in favor of trait-driven UI.
 */
export type ViewType = 'list' | 'detail' | 'create' | 'edit' | 'dashboard' | 'custom';

export const ViewTypeSchema = z.enum([
    'list',
    'detail',
    'create',
    'edit',
    'dashboard',
    'custom',
]);

// ============================================================================
// Trait Reference
// ============================================================================

/**
 * Trait reference on a page.
 */
export type PageTraitRef = {
    /** Trait name from library */
    ref: string;
    /** V4 dual-carry id sibling of `ref` — optional until the Phase-7 flip. */
    refId?: TraitId;
    /** Entity this trait operates on */
    linkedEntity?: string;
    /** V4 dual-carry id sibling of `linkedEntity` — optional until the Phase-7 flip. */
    linkedEntityId?: EntityId;
    /** Additional trait configuration */
    config?: TraitConfig;
};

export const PageTraitRefSchema = z.object({
    ref: z.string().min(1, 'Trait ref is required'),
    refId: TraitIdSchema.optional(),
    linkedEntity: z.string().optional(),
    linkedEntityId: EntityIdSchema.optional(),
    config: TraitConfigSchema.optional(),
});

// ============================================================================
// Page modifiers (access, indexing, metadata)
// ============================================================================

/** `access:` — `public` admits anonymous viewers; `authenticated` mounts the
 * page circuit only for a resolved signed-in viewer. Absent = no gate. */
export type PageAccess = 'public' | 'authenticated';
export const PageAccessSchema = z.enum(['public', 'authenticated']);

/** `indexing:` — a search-engine directive, never access control. */
export type PageIndexing = 'index' | 'noindex';
export const PageIndexingSchema = z.enum(['index', 'noindex']);

/** `title:` / `description:` — a literal, or `["i18n/t", key]` resolved
 * against the route's locale. No entity/config/viewer bindings. */
export type PageMeta = string | ['i18n/t', string];
export const PageMetaSchema = z.union([
    z.string(),
    z.tuple([z.literal('i18n/t'), z.string().min(1)]),
]);

/** Resolve a {@link PageMeta} through a message lookup. */
export function resolvePageMeta(
    meta: PageMeta | undefined,
    lookup: (key: string) => string | undefined,
): string | undefined {
    if (meta === undefined) return undefined;
    return typeof meta === 'string' ? meta : lookup(meta[1]);
}

// ============================================================================
// Orbital Page
// ============================================================================

/**
 * OrbitalPage - a page definition within an Orbital Unit.
 *
 * TRAIT-DRIVEN: Pages must have traits array. Sections are NOT supported.
 */
export type OrbitalPage = {
    /** V4 dual-carry id sibling of `name` — optional until the Phase-7 flip. */
    id?: PageId;

    /** Page name (PascalCase, e.g., "TasksPage") */
    name: string;

    /** URL path (e.g., "/tasks", "/tasks/:id") */
    path: string;

    /** View type (optional in trait-driven mode) */
    viewType?: ViewType;

    /** `title:` page modifier — the document title. */
    title?: PageMeta;

    /** `description:` page modifier — the document meta description. */
    description?: PageMeta;

    /** `access:` page modifier. */
    access?: PageAccess;

    /** `indexing:` page modifier. */
    indexing?: PageIndexing;

    /**
     * The upstream page this one was imported from (its id, kept through nested
     * imports). Imports of one page in different locales are language
     * alternates. Set by import resolution, never authored.
     */
    sourcePage?: string;

    /** `translationOf:` page modifier — pages sharing it in different locales are language alternates (ahead of `sourcePage`). */
    translationOf?: string;

    /** Primary entity for this page */
    primaryEntity?: string;

    /**
     * Traits that drive UI for this page.
     * REQUIRED in trait-driven architecture.
     */
    traits?: PageTraitRef[];

    /** Is this the initial page for navigation? */
    isInitial?: boolean;

    /** Nav icon name — `@icon "..."` annotation on the page declaration. */
    icon?: string;

    /** Nav label — `@label "..."` annotation. Only a page that declares one is a `@pages` nav entry. */
    label?: string;

    /** Roles the nav entry shows for — `@roles "a, b"` annotation. Absent = everyone. */
    roles?: string[];
};

/**
 * Strict Zod schema for trait-driven pages.
 * Rejects unknown properties like 'sections'.
 */
/** The page modifiers a `pages {}` remap entry declares for one imported page. */
export interface PageModifiers {
    access?: PageAccess;
    indexing?: PageIndexing;
    title?: PageMeta;
    description?: PageMeta;
    translationOf?: string;
    /** The page's nav entry, declared on a `pages {}` remap entry. */
    label?: string;
    icon?: string;
    roles?: string[];
}

export const PageModifiersSchema = z.object({
    access: PageAccessSchema.optional(),
    indexing: PageIndexingSchema.optional(),
    title: PageMetaSchema.optional(),
    description: PageMetaSchema.optional(),
    translationOf: z.string().min(1).optional(),
    label: z.string().optional(),
    icon: z.string().optional(),
    roles: z.array(z.string().min(1)).min(1).optional(),
}).strict();

export const OrbitalPageStrictSchema = z.object({
    id: PageIdSchema.optional(),
    name: z.string().min(1, 'Page name is required'),
    path: z.string().min(1, 'Page path is required').startsWith('/', 'Path must start with /'),
    primaryEntity: z.string().min(1, 'Primary entity is required'),
    traits: z.array(PageTraitRefSchema).min(1, 'Page must have at least one trait'),
    title: PageMetaSchema.optional(),
    description: PageMetaSchema.optional(),
    access: PageAccessSchema.optional(),
    indexing: PageIndexingSchema.optional(),
    sourcePage: z.string().min(1).optional(),
    translationOf: z.string().min(1).optional(),
    icon: z.string().optional(),
    label: z.string().optional(),
    roles: z.array(z.string().min(1)).min(1).optional(),
}).strict(); // Reject unknown keys like 'sections'

/**
 * Zod schema for OrbitalPage.
 * Trait-driven: pages have traits instead of static sections/patterns.
 * Uses .strict() to reject unknown keys like 'sections'.
 */
export const OrbitalPageSchema = z.object({
    id: PageIdSchema.optional(),
    name: z.string().min(1, 'Page name is required'),
    path: z.string().min(1, 'Page path is required').startsWith('/', 'Path must start with /'),
    viewType: ViewTypeSchema.optional(),
    title: PageMetaSchema.optional(),
    description: PageMetaSchema.optional(),
    access: PageAccessSchema.optional(),
    indexing: PageIndexingSchema.optional(),
    sourcePage: z.string().min(1).optional(),
    translationOf: z.string().min(1).optional(),
    primaryEntity: z.string().optional(),
    traits: z.array(PageTraitRefSchema).optional(),
    isInitial: z.boolean().optional(),
    icon: z.string().optional(),
    label: z.string().optional(),
    roles: z.array(z.string().min(1)).min(1).optional(),
}).strict(); // Reject unknown keys like 'sections' - use traits with render_ui effects

export type OrbitalPageInput = z.input<typeof OrbitalPageSchema>;
export type OrbitalPageStrictInput = z.input<typeof OrbitalPageStrictSchema>;

// ============================================================================
// Type Aliases (for cleaner imports)
// ============================================================================

/** Alias for OrbitalPage - preferred name */
export type Page = OrbitalPage;

/** Alias for OrbitalPageSchema - preferred name */
export const PageSchema = OrbitalPageSchema;
