/**
 * Sprite Sheet Animation Types
 *
 * Type definitions for frame-based sprite sheet animation system.
 * Supports standard 8-column × 5-row character sheets.
 *
 * `AnimationName`, `AnimationDef`, and `SpriteDirection` are canonically owned
 * by `@almadar/core` (they travel with a `spriteSheet`-role `Asset.url`'s
 * resolved atlas contract) — re-exported here so existing call sites in this
 * package don't need to change their import path.
 *
 * @packageDocumentation
 */

import type { AnimationName } from '@almadar/core';

export type { AnimationName, AnimationDef, SpriteDirection } from '@almadar/core';

/** Unit facing direction on screen (4 isometric directions) */
export type FacingDirection = 'se' | 'sw' | 'ne' | 'nw';

/** A resolved frame ready to draw on canvas */
export interface ResolvedFrame {
    /** URL of the sprite sheet image */
    sheetUrl: string;
    /** Source X in the sheet (pixel offset) */
    sx: number;
    /** Source Y in the sheet (pixel offset) */
    sy: number;
    /** Source width (frame width) */
    sw: number;
    /** Source height (frame height) */
    sh: number;
    /** Whether to flip horizontally when drawing (for NE/NW directions) */
    flipX: boolean;
    /** When true, canvas should apply sine-bob breathing offset (frozen idle frame) */
    applyBreathing?: boolean;
}

/** Per-unit animation state tracked in the animation system */
export interface UnitAnimationState {
    /** Unit identifier */
    unitId: string;
    /** Current animation playing */
    animation: AnimationName;
    /** Current facing direction */
    direction: FacingDirection;
    /** Current frame index within the animation */
    frame: number;
    /** Elapsed time in current animation (ms) */
    elapsed: number;
    /** Animation to play after current one-shot completes (null = idle) */
    queuedAnimation: AnimationName | null;
    /** Whether the current one-shot animation has finished its last frame */
    finished: boolean;
}

/** Frame dimensions for a sprite sheet */
export interface SpriteFrameDims {
    /** Width of a single frame in pixels */
    width: number;
    /** Height of a single frame in pixels */
    height: number;
}

/**
 * Sheet URLs per facing. Legacy hand-drawn packs ship only se/sw (ne/nw are
 * mirror-flipped — a cheat that shows the face while walking away); 3D-baked
 * sheets also ship real ne/nw, which `resolveFrame` prefers when present.
 */
export interface SpriteSheetUrls {
    /** Southeast-facing sheet URL */
    se: string;
    /** Southwest-facing sheet URL */
    sw: string;
    /** Northeast-facing sheet URL (real back view; omitted → mirror of sw) */
    ne?: string;
    /** Northwest-facing sheet URL (real back view; omitted → mirror of se) */
    nw?: string;
}

/**
 * Parsed sprite-sheet atlas JSON (e.g. `guardian-sprite-sheet.json`).
 * Sits next to the `.png` sheets and drives the frame rect deterministically.
 * Canonically `@almadar/core`'s `SpriteSheetAtlas` — re-exported under this
 * package's existing name so call sites don't need to change.
 */
export type { SpriteSheetAtlas as SpriteAtlas } from '@almadar/core';
