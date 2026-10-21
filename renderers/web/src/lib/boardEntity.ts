/**
 * boardEntity — tiny coercion helpers for reading `EntityRow` data inside game
 * boards.
 *
 * The single entity type is `@almadar/core`'s `EntityRow`
 * (`{ id?: string } & Record<string, FieldValue | undefined>`). Boards read
 * deeply-nested, weakly-typed fields off it; these helpers narrow scalars,
 * arrays, and small positional objects without reintroducing private entity
 * interfaces. None of these are entity types — they are pure value coercers.
 *
 * @packageDocumentation
 */

import type { EntityRow, FieldValue } from '@almadar/core';

/** A 2D grid position read off an entity row. */
export interface Vec2 {
    x: number;
    y: number;
}

/** Lightweight trait-display shape carried on unit-like rows (UI value DTO). */
export interface TeamUnitTraits {
    name: string;
    currentState: string;
    states: string[];
    cooldown?: number;
}

/** Resolve the single board-state entity row from a prop that may be a row,
 *  an array of rows, or undefined. Boards operate on one board state. */
export function boardEntity(
    entity: EntityRow | readonly EntityRow[] | undefined,
): EntityRow | undefined {
    if (!entity) return undefined;
    return Array.isArray(entity) ? entity[0] : (entity as EntityRow);
}

/** Coerce a field value to a string (empty string when absent). */
export function str(v: FieldValue | undefined): string {
    return v == null ? '' : String(v);
}

/** Coerce a field value to a number (0 when absent / non-numeric). */
export function num(v: FieldValue | undefined, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/** Coerce a field value to a boolean. */
export function bool(v: FieldValue | undefined): boolean {
    return Boolean(v);
}

/** Coerce a nested array field to a readonly array of entity rows. */
export function rows(v: FieldValue | undefined): readonly EntityRow[] {
    return Array.isArray(v) ? (v as readonly EntityRow[]) : [];
}

/** Read an `{ x, y }` position off an entity row's named field. */
export function vec2(v: FieldValue | undefined): Vec2 {
    const o = (v ?? {}) as { x?: FieldValue; y?: FieldValue };
    return { x: num(o.x), y: num(o.y) };
}

// ── Unit-row field accessors (shared by battle / castle / world-map) ──────────

/** Read a unit row's `position` as a `Vec2`. */
export function unitPosition(u: EntityRow): Vec2 {
    return vec2(u.position);
}

/** Read a unit row's `team` ('player' | 'enemy' | string). */
export function unitTeam(u: EntityRow): string {
    return str(u.team);
}

/** Read a unit row's `health`. */
export function unitHealth(u: EntityRow): number {
    return num(u.health);
}
