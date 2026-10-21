'use client';
/**
 * `draw-sprite` — the neutral image/atlas-frame drawable atom (dimension-agnostic).
 *
 * ONE descriptor (`DrawSpriteProps`, grounded in core `ScenePos` + `Asset`) with
 * TWO backends: `paintSprite` (2D, here — via the portable `Painter2D` seam) and
 * an R3F mesh (`Sprite3D` in `lib/drawable/mesh3d`, kept OUT of this file so the
 * 2D paint path never pulls `three`/`drei` into an app bundle — the codebase
 * code-splits R3F). The canvas host picks the backend by `mode`; that is what
 * makes canvas-2d and canvas-3d the same `children` interface. Genre uses (tile,
 * unit body, feature, effect, movement ghost, background cover) are all this atom
 * with different `anchor`/`size`/`frame`/`flip`/`shadow` — composed in `.lolo`,
 * not here. The React component renders `null` (a drawable is painted by the host,
 * not the DOM); it exists so the pattern pipeline registers a `draw-sprite`
 * pattern and standalone pages stay inspectable.
 */
import type React from 'react';
import type { Asset, ScenePos } from '@almadar/core';
import { createLogger } from '@almadar/logger';
import type { Painter2D } from '../../../lib/painter2d';
import { getAtlas, atlasFailed, atlasUrlOf, isAtlasAsset, isSpriteSheetAtlas, subRectFor } from '../../../core';
import { frameRect, getCurrentFrameFromDef } from '../../../lib/spriteAnimation';
import { getImageStatus } from '../../../lib/imageCache';
import type { DrawableAnchor, DrawableBase, DrawContext, PaintFn } from '../../../lib/drawable/contract';
import { SPRITE_FALLBACK_FILL, SPRITE_FALLBACK_STROKE, spriteAssetState, spriteRect } from '../../../lib/drawable/contract';
import type { Rect } from '../../../core';
import type { DrawShapeShadow } from './DrawShape';

const spriteLog = createLogger('almadar:ui:draw-sprite');
const loggedMissing = new Set<string>();

/** World-px size of the fallback square on `free`/`side` (world-pixel-direct)
 *  boards when the descriptor carries no explicit width/height. */
const FALLBACK_WORLD_PX = 32;

type MissingReason = 'asset-unset' | 'texture-failed' | 'atlas-failed' | 'sprite-missing';

function warnMissingOnce(reason: MissingReason, node: DrawSpriteProps): void {
    const asset: Partial<Asset> = node.asset ?? {};
    const key = `${reason}:${String(asset.url)}:${String(asset.atlas)}:${String(asset.sprite)}`;
    if (loggedMissing.has(key)) return;
    loggedMissing.add(key);
    spriteLog.warn('draw-sprite asset unresolvable — painting fallback square', { reason, url: asset.url, atlas: asset.atlas, sprite: asset.sprite });
}

/** A missing/broken asset must never render as an invisible hole: paint a
 *  cell-sized flat square (honoring explicit width/height) so the board stays
 *  readable and the bad ref is visible on the canvas, not just in a log. */
function paintFallbackSquare(painter: Painter2D, node: DrawSpriteProps, dctx: DrawContext, reason: MissingReason): void {
    warnMissingOnce(reason, node);
    const tw = dctx.projector.tileWidth;
    const natural = dctx.projector.worldPixelDirect ? FALLBACK_WORLD_PX : tw;
    const rect = spriteRect(dctx.projector, node, { w: natural, h: natural });
    painter.save();
    if (node.opacity !== undefined && node.opacity !== 1) painter.setAlpha(node.opacity);
    painter.fillRect(rect.x, rect.y, rect.w, rect.h, SPRITE_FALLBACK_FILL);
    painter.strokeRect(rect.x, rect.y, rect.w, rect.h, SPRITE_FALLBACK_STROKE, Math.max(1, tw / 32));
    painter.restore();
}

export interface DrawSpriteProps extends DrawableBase {
    type: 'draw-sprite';
    /** Logical scene position; the projector maps it to pixels / world. */
    position: ScenePos;
    /** The image / atlas reference to blit. */
    asset: Asset;
    /** How the sprite aligns to its projected position. Default `'top-left'`. */
    anchor?: DrawableAnchor;
    /** Draw width in world units (fractions of `projector.tileWidth`). Omitted → one cell on tile grids (`flat`/`iso`/`hex`); native source px on `free`/`side`. */
    width?: number;
    /** Draw height in world units (fractions of `projector.tileWidth`). Omitted → one cell on tile grids (`flat`/`iso`/`hex`); native source px on `free`/`side`. */
    height?: number;
    /** Explicit atlas sub-rect override (px); omitted → resolved from `asset.atlas`/`asset.sprite`. */
    frame?: Rect;
    /** Animation to play. 3D backend: a named GLB clip (matched case-insensitively). 2D painter: when `asset.atlas` resolves to a `SpriteSheetAtlas` manifest, the canonical row of that name (idle/walk/attack/hit/death) plays off the host paint clock; an explicit `frame` rect overrides. */
    animation?: string;
    /** Override the sheet row's loop flag. The paint clock is wall-time, so one-shot rows hold their final frame — preview pages set `true` to cycle attack/hit/death continuously. */
    loop?: boolean;
    /** Animation clock override in ms (e.g. an fx entry's age since spawn). Omitted → the host paint clock; one-shot rows anchored to wall-time would otherwise sit on their final frame. */
    clockMs?: number;
    /** Mirror horizontally (facing). */
    flipX?: boolean;
    /** Rotation in radians about the sprite's center. */
    rotation?: number;
    /** 0..1 opacity. */
    opacity?: number;
    /** Drop shadow (e.g. a team-colored glow). */
    shadow?: DrawShapeShadow;
}

/** Paint a {@link DrawSpriteProps}. Paints a fallback square when a resource is
 *  definitively broken (no asset url, texture/atlas fetch failed, sprite name
 *  unresolvable); renders nothing while a resource is still in-flight or the
 *  position is invalid — never throws. */
export const paintSprite: PaintFn<DrawSpriteProps> = (painter, node, dctx) => {
    const state = spriteAssetState(node);
    if (state === 'invalid-position') return;
    if (state === 'asset-unset') {
        paintFallbackSquare(painter, node, dctx, 'asset-unset');
        return;
    }
    const tex = painter.resolveTexture(node.asset.url);
    if (!tex) {
        if (getImageStatus(node.asset.url) === 'failed') paintFallbackSquare(painter, node, dctx, 'texture-failed');
        return; // image in-flight
    }

    // `frame` is an explicit source rect. A bare number (an animation frame
    // INDEX) carries no rect and would blank the blit — ignore it so the
    // atlas-sprite / whole-image source still draws.
    let src = typeof node.frame === 'object' ? node.frame : undefined;
    // Sheet playback: `animation` + a SpriteSheetAtlas manifest → the current
    // row frame at the host clock. Non-sheet atlases fall through to the
    // named-sprite path (the `animation` prop there is 3D-clip semantics).
    const sheetAtlasUrl = atlasUrlOf(node.asset);
    if (!src && node.animation !== undefined && sheetAtlasUrl !== undefined) {
        const atlas = getAtlas(sheetAtlasUrl, dctx.invalidate);
        if (!atlas) {
            if (atlasFailed(sheetAtlasUrl)) paintFallbackSquare(painter, node, dctx, 'atlas-failed');
            return; // atlas JSON in-flight
        }
        if (isSpriteSheetAtlas(atlas)) {
            // The atlas manifest is authoritative for its rows: unit sheets use the
            // canonical names, fx sheets declare their own (e.g. `burst`).
            const def = atlas.animations[node.animation];
            if (!def) {
                paintFallbackSquare(painter, node, dctx, 'sprite-missing');
                return;
            }
            const { frame } = getCurrentFrameFromDef(node.loop === undefined ? def : { ...def, loop: node.loop }, node.clockMs ?? dctx.time);
            const r = frameRect(frame, def.row, atlas.columns, atlas.frameWidth, atlas.frameHeight);
            // A malformed atlas def (e.g. `fps` instead of `frameRate`) yields a
            // NaN frame → NaN blit rect → canvas silently paints nothing. Fail loud.
            if (![r.sx, r.sy, r.sw, r.sh].every(Number.isFinite)) {
                paintFallbackSquare(painter, node, dctx, 'sprite-missing');
                return;
            }
            src = { x: r.sx, y: r.sy, w: r.sw, h: r.sh };
        }
    }
    if (!src && isAtlasAsset(node.asset)) {
        const atlas = getAtlas(node.asset.atlas as string, dctx.invalidate);
        if (!atlas) {
            if (atlasFailed(node.asset.atlas as string)) paintFallbackSquare(painter, node, dctx, 'atlas-failed');
            return; // atlas JSON in-flight
        }
        const r = subRectFor(atlas, node.asset.sprite as string);
        if (!r) {
            paintFallbackSquare(painter, node, dctx, 'sprite-missing');
            return;
        }
        src = { x: r.sx, y: r.sy, w: r.sw, h: r.sh };
    }

    // Tile grids (flat/iso/hex) size a sprite to one cell by default; `free`/`side`
    // are world-pixel-direct, so they fall back to the texture's native source size.
    const rect = spriteRect(dctx.projector, node, src ? { w: src.w, h: src.h } : { w: tex.width, h: tex.height });
    const { w, h } = rect;
    const dx = rect.x;
    const dy = rect.y;

    painter.save();
    if (node.opacity !== undefined && node.opacity !== 1) painter.setAlpha(node.opacity);
    if (node.shadow) painter.setShadow(node.shadow);
    if (node.rotation) {
        const cx = dx + w / 2;
        const cy = dy + h / 2;
        painter.translate(cx, cy);
        painter.rotate(node.rotation);
        painter.translate(-cx, -cy);
    }
    if (node.flipX) {
        const cx = dx + w / 2;
        painter.translate(cx, 0);
        painter.scale(-1, 1);
        painter.translate(-cx, 0);
    }
    painter.blit(tex, { x: dx, y: dy, w, h }, src);
    painter.restore();
};

/** True when this descriptor declares sheet playback (the host must run the paint clock). */
export function isAnimatedSprite(node: DrawSpriteProps): boolean {
    return node.animation !== undefined && typeof node.asset?.atlas === 'string';
}

/** Registry/standalone stub — the host paints this atom; the DOM renders nothing. */
export function DrawSprite(_props: DrawSpriteProps): React.JSX.Element | null {
    return null;
}

export default DrawSprite;
