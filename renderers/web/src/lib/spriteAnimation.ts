/**
 * Sprite Animation Engine
 *
 * Pure functions for sprite sheet animation: direction inference,
 * frame computation, sheet resolution, and animation state management.
 * No React dependencies — usable in any context.
 *
 * @packageDocumentation
 */

import type {
    AnimationDef,
    AnimationName,
    FacingDirection,
    SpriteDirection,
    ResolvedFrame,
    UnitAnimationState,
    SpriteFrameDims,
    SpriteSheetUrls,
} from './spriteAnimationTypes';
import { ANIMATION_NAMES } from '@almadar/core';
import { SPRITE_SHEET_LAYOUT, SHEET_COLUMNS } from './spriteSheetConstants';

/** Narrow an arbitrary string (e.g. a descriptor's `animation` prop) to the canonical row vocabulary. */
export function isAnimationName(name: string): name is AnimationName {
    return (ANIMATION_NAMES as readonly string[]).includes(name);
}

// =============================================================================
// Direction Logic
// =============================================================================

/**
 * Infer facing direction from a movement delta on the isometric grid.
 * dx/dy are tile coordinate deltas (not screen pixels).
 *
 * Isometric grid:
 *   NW ← (-x)    NE ← (-y)
 *   SW ← (+y)    SE ← (+x)
 */
export function inferDirection(dx: number, dy: number): FacingDirection {
    if (dx === 0 && dy === 0) return 'se'; // No movement, default

    if (dx >= 0 && dy >= 0) return 'se';
    if (dx <= 0 && dy >= 0) return 'sw';
    if (dx >= 0 && dy <= 0) return 'ne';
    return 'nw';
}

/**
 * Map a 4-direction facing to the actual sheet file direction + flipX flag.
 * We only have SE and SW sheet images. NE/NW are rendered by flipping:
 *   SE → SE sheet, no flip
 *   SW → SW sheet, no flip
 *   NE → SW sheet, flipX (mirror of SW gives NE)
 *   NW → SE sheet, flipX (mirror of SE gives NW)
 */
export function resolveSheetDirection(facing: FacingDirection): { sheetDir: SpriteDirection; flipX: boolean } {
    switch (facing) {
        case 'se': return { sheetDir: 'se', flipX: false };
        case 'sw': return { sheetDir: 'sw', flipX: false };
        case 'ne': return { sheetDir: 'sw', flipX: true };
        case 'nw': return { sheetDir: 'se', flipX: true };
    }
}

// =============================================================================
// Frame Rect
// =============================================================================

/** A source rectangle into a sprite sheet for a single frame. */
export interface FrameRect {
    /** Source X in the sheet (pixel offset). */
    sx: number;
    /** Source Y in the sheet (pixel offset). */
    sy: number;
    /** Source width (frame width). */
    sw: number;
    /** Source height (frame height). */
    sh: number;
}

/**
 * Compute the source rect for a single frame within a grid sprite sheet.
 * Single home for the `sx = (frame % columns) * frameWidth`, `sy = row * frameHeight`
 * math shared by `Sprite.tsx`, `useUnitSpriteAtlas.ts`, and `resolveFrame`.
 *
 * Pass `row` explicitly for atlas-driven layouts (each animation occupies a row);
 * pass `row = Math.floor(frame / columns)` for flat frame-index sheets.
 */
export function frameRect(
    frame: number,
    row: number,
    columns: number,
    frameWidth: number,
    frameHeight: number,
): FrameRect {
    return {
        sx: (frame % columns) * frameWidth,
        sy: row * frameHeight,
        sw: frameWidth,
        sh: frameHeight,
    };
}

// =============================================================================
// Frame Computation
// =============================================================================

/**
 * Compute the current frame index from an animation definition.
 * Atlas-driven and constant-driven callers share this one timing core.
 */
export function getCurrentFrameFromDef(
    def: AnimationDef,
    elapsed: number,
): { frame: number; finished: boolean } {
    const frameDuration = 1000 / def.frameRate;
    const totalDuration = def.frames * frameDuration;

    if (def.loop) {
        const frame = Math.floor((elapsed % totalDuration) / frameDuration);
        return { frame, finished: false };
    }

    // One-shot: clamp to last frame
    if (elapsed >= totalDuration) {
        return { frame: def.frames - 1, finished: true };
    }
    const frame = Math.floor(elapsed / frameDuration);
    return { frame, finished: false };
}

/**
 * Compute the current frame index and whether the animation has finished.
 */
export function getCurrentFrame(
    animName: AnimationName,
    elapsed: number,
): { frame: number; finished: boolean } {
    const def = SPRITE_SHEET_LAYOUT[animName] ?? { row: 0, frames: 4, frameRate: 6, loop: true };
    return getCurrentFrameFromDef(def, elapsed);
}

/**
 * Resolve a complete frame descriptor for canvas drawing.
 * Returns null if no sprite sheet URLs are available for this unit.
 */
export function resolveFrame(
    sheetUrls: SpriteSheetUrls | null,
    frameDims: SpriteFrameDims,
    animState: UnitAnimationState,
): ResolvedFrame | null {
    if (!sheetUrls) return null;

    // A real sheet for the facing wins; the mirror-flip cheat is the legacy
    // fallback for 2-sheet packs with no ne/nw art.
    const real = sheetUrls[animState.direction];
    const { sheetUrl, flipX } = real
        ? { sheetUrl: real, flipX: false }
        : (() => {
              const legacy = resolveSheetDirection(animState.direction);
              return { sheetUrl: sheetUrls[legacy.sheetDir], flipX: legacy.flipX };
          })();
    if (!sheetUrl) return null;

    const def = SPRITE_SHEET_LAYOUT[animState.animation] ?? { row: 0, frames: 4, frameRate: 6, loop: true };
    const { frame } = getCurrentFrame(animState.animation, animState.elapsed);

    // Flat frame-index sheet: one row, frame advances horizontally (columns = frames).
    const rect = frameRect(frame, def.row, def.frames, frameDims.width, frameDims.height);

    return {
        sheetUrl,
        sx: rect.sx,
        sy: rect.sy,
        sw: rect.sw,
        sh: rect.sh,
        flipX,
    };
}

// =============================================================================
// Animation State Management
// =============================================================================

/**
 * Create initial animation state for a unit (idle, facing SE).
 */
export function createUnitAnimationState(unitId: string): UnitAnimationState {
    return {
        unitId,
        animation: 'idle',
        direction: 'se',
        frame: 0,
        elapsed: 0,
        queuedAnimation: null,
        finished: false,
    };
}

/**
 * Transition to a new animation. Resets elapsed time.
 * Optionally updates direction. Death cannot be overridden.
 */
export function transitionAnimation(
    state: UnitAnimationState,
    newAnim: AnimationName,
    direction?: FacingDirection,
): UnitAnimationState {
    // Death is terminal — cannot transition out
    if (state.animation === 'death' && state.finished) return state;

    // Don't restart the same looping animation
    if (state.animation === newAnim && SPRITE_SHEET_LAYOUT[newAnim]?.loop) {
        return direction ? { ...state, direction } : state;
    }

    return {
        ...state,
        animation: newAnim,
        direction: direction ?? state.direction,
        frame: 0,
        elapsed: 0,
        queuedAnimation: null,
        finished: false,
    };
}

/**
 * Advance animation state by deltaMs.
 * Handles one-shot → queued/idle transitions automatically.
 */
export function tickAnimationState(
    state: UnitAnimationState,
    deltaMs: number,
): UnitAnimationState {
    const newElapsed = state.elapsed + deltaMs;
    const { frame, finished } = getCurrentFrame(state.animation, newElapsed);
    const def = SPRITE_SHEET_LAYOUT[state.animation];

    // One-shot animation just finished — transition to queued or idle
    if (finished && !def?.loop && !state.finished) {
        // Death is terminal
        if (state.animation === 'death') {
            return { ...state, elapsed: newElapsed, frame, finished: true };
        }

        const nextAnim = state.queuedAnimation ?? 'idle';
        return {
            ...state,
            animation: nextAnim,
            elapsed: 0,
            frame: 0,
            queuedAnimation: null,
            finished: false,
        };
    }

    return { ...state, elapsed: newElapsed, frame, finished };
}
