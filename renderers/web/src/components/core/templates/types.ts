/**
 * Base template types for Almadar UI.
 *
 * All templates MUST extend `TemplateProps<E>` to enforce entity-only data flow
 * and JSON round-trip compatibility with the flattener pipeline.
 *
 * The compiler passes `entity` as `E[]` (array from data store), so
 * TemplateProps accepts the same union as EntityDisplayProps.
 *
 * @see docs/Almadar_Templates.md
 */

import type { EntityRow } from "@almadar/core";

/** Base props for all templates — enforces entity-only data flow.
 *
 * The constraint is `{ id?: string }` (optional id) so the canonical
 * `EntityRow` from `@almadar/core` — whose `id` is optional — satisfies it. */
export interface TemplateProps<E extends { id?: string } = EntityRow> {
    /**
     * Entity data — single object or array (pre-resolved by the compiler
     * from `@payload.data` on the calling trait). The legacy `string`
     * entity-name branch was removed in V2 Phase 6 along with the
     * EntityStore resolver.
     *
     * The inlet always also accepts the canonical `EntityRow` (and arrays of
     * it), because the compiler binds the generic data-store row regardless of
     * a template's curated read-shape `E`. A template that reads specific
     * fields narrows `entity` to `E` internally (a valid union-narrow) — no
     * `as unknown` cast and no per-template inlet widening required.
     */
    entity?: E | EntityRow | readonly (E | EntityRow)[];
    /** External styling override */
    className?: string;
}
