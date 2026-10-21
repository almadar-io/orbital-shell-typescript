'use client';
/**
 * `draw-fx-layer` — the batched transient-effects pass in one descriptor.
 *
 * Collapses the fx triple every board used to hand-roll (message text layer +
 * sprite fallback layer + vector-art group per fx entry) into ONE node:
 * `{ type: draw-fx-layer, items: @entity.fx, presets: @config.fxPresets, … }`.
 * NAME-BLIND: each item's look comes from its resolved typed fields via the
 * consumer-declared `FxPreset[]` table — never a kind→look table in here.
 * Render priority per item: vector `art[type].idle` (draw-group) → sprite
 * `sprites[type]` (draw-sprite) → a procedural seeded recipe
 * (spark/ring/puff/streak draw-shapes); a `message` always adds a rising,
 * fading draw-text. Expansion is PURE (descriptors → descriptors, routed
 * through the normal paint dispatch); per-frame smoothness comes from the host
 * paint clock against each item's `bornAt`, while the fx mechanic's ttl decay
 * stays the authoritative removal clock. `space: "screen"` entries are skipped
 * — the `fx-overlay` core molecule owns those. The React component renders
 * `null` (a drawable is painted by the host, not the DOM).
 */
import type React from 'react';
import type { Asset, ScenePos } from '@almadar/core';
import type { DrawableBase, Projector } from '../../../lib/drawable/contract';
import type { DrawableNode } from '../../../lib/drawable/paintDispatch';
import type { DrawShapeProps } from '../atoms/DrawShape';
import type { DrawTextProps } from '../atoms/DrawText';
import { resolveFxView, fxLifecycle, fxHash01, type FxItem, type FxPreset, type FxView } from '../../../core';



/** Which canvas dimension the expansion targets (axis mapping differs). */
export type FxDimension = '2d' | '3d';

export interface DrawFxLayerProps extends DrawableBase {
    type: 'draw-fx-layer';
    /** The live fx entries — the mechanic's `@entity.fx` list passed whole; `space: "screen"` entries are skipped (the overlay owns those). */
    items: FxItem[];
    /** Consumer-declared effect vocabulary — one row per fx `type` (look + recipe). Unknown types fall back to a neutral spark burst. */
    presets?: FxPreset[];
    /** Vector art per fx type (an asset-art map: type → anim-state → drawables); a type's `idle` state wins over sprites/procedural. */
    art?: Record<string, Record<string, DrawableNode[]>>;
    /** Sprite asset per fx type (an asset-manifest effects map) — used when no vector art matches. */
    sprites?: Record<string, Asset>;
    /** The fx mechanic's decay tick period in ms; lifetime = maxTtl × tickMs. Default 500. */
    tickMs?: number;
    /** Floating-message text color when an item declares none. Default `#ffe066`. */
    textColor?: string;
}

const DEFAULT_TICK_MS = 500;
const DEFAULT_TEXT_COLOR = '#ffe066';
const DEFAULT_SPARK_COLOR = '#ffffff';

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/**
 * The item's drifted scene position at `ageSec`. Base: explicit `position`,
 * else `x`/`z`/`y` mapped by dimension — 2D paints the ground-plane row (`z`)
 * as screen y; 3D keeps `y` as ScenePos.y (row) and puts height in ScenePos.z.
 * Drift: `vx` along x, `vz` along the row, `vy` along the vertical; `gravity`
 * accelerates downward (screen-y down in 2D, height down in 3D).
 */
function fxPosition(view: FxView, dim: FxDimension, ageSec: number): ScenePos | undefined {
    const g = view.gravity ?? 0;
    const fall = 0.5 * g * ageSec * ageSec;
    if (dim === '2d') {
        const base = view.position ?? { x: view.x, y: view.z ?? view.y ?? 0 };
        if (!Number.isFinite(base.x) || !Number.isFinite(base.y)) return undefined;
        return {
            x: base.x + (view.vx ?? 0) * ageSec,
            y: base.y + (view.vz ?? 0) * ageSec + fall,
        };
    }
    const base = view.position ?? { x: view.x, y: view.z ?? 0, z: view.y };
    if (!Number.isFinite(base.x) || !Number.isFinite(base.y)) return undefined;
    return {
        x: base.x + (view.vx ?? 0) * ageSec,
        y: base.y + (view.vz ?? 0) * ageSec,
        ...(base.z !== undefined || view.vy !== undefined || g !== 0
            ? { z: (base.z ?? 0) + (view.vy ?? 0) * ageSec - fall }
            : {}),
    };
}

/** One seeded procedural particle ellipse. */
function sparkShape(
    view: FxView,
    pos: ScenePos,
    i: number,
    fade: number,
    progress: number,
): DrawShapeProps {
    const size = view.size ?? 0.5;
    const angle = fxHash01(view.id, i * 3) * Math.PI * 2;
    const dist = size * (0.4 + 0.6 * fxHash01(view.id, i * 3 + 1)) * easeOut(progress);
    const r = size * (0.06 + 0.06 * fxHash01(view.id, i * 3 + 2));
    const color = view.color ?? DEFAULT_SPARK_COLOR;
    return {
        type: 'draw-shape',
        shape: 'ellipse',
        position: { ...pos, x: pos.x + Math.cos(angle) * dist, y: pos.y + Math.sin(angle) * dist },
        anchor: 'center',
        radiusX: r,
        fill: color,
        blendMode: 'lighter',
        opacity: fade,
        ...(view.glow ? { shadow: { color, blur: view.glow } } : {}),
    };
}

/** The procedural recipe for one item — spark (default) / ring / puff / streak. */
function proceduralShapes(view: FxView, pos: ScenePos, fade: number, progress: number): DrawShapeProps[] {
    const size = view.size ?? 0.5;
    const color = view.color ?? DEFAULT_SPARK_COLOR;
    switch (view.shape ?? 'spark') {
        case 'ring': {
            return [
                {
                    type: 'draw-shape',
                    shape: 'ellipse',
                    position: pos,
                    anchor: 'center',
                    radiusX: size * easeOut(progress),
                    stroke: view.color2 ?? color,
                    strokeWidth: 2,
                    blendMode: 'lighter',
                    opacity: fade,
                    ...(view.glow ? { shadow: { color, blur: view.glow } } : {}),
                },
            ];
        }
        case 'puff': {
            const count = view.count ?? 3;
            return Array.from({ length: count }, (_, i) => {
                const angle = fxHash01(view.id, i * 5) * Math.PI * 2;
                const drift = size * 0.3 * fxHash01(view.id, i * 5 + 1) * easeOut(progress);
                return {
                    type: 'draw-shape' as const,
                    shape: 'ellipse' as const,
                    position: { ...pos, x: pos.x + Math.cos(angle) * drift, y: pos.y + Math.sin(angle) * drift },
                    anchor: 'center' as const,
                    radiusX: size * (0.15 + 0.35 * progress) * (0.7 + 0.6 * fxHash01(view.id, i * 5 + 2)),
                    fill: i === 0 && view.color2 ? view.color2 : color,
                    opacity: fade * 0.6,
                    ...(view.glow ? { shadow: { color, blur: view.glow } } : {}),
                };
            });
        }
        case 'streak': {
            const count = view.count ?? 5;
            return Array.from({ length: count }, (_, i) => {
                const angle = fxHash01(view.id, i * 3) * Math.PI * 2;
                const inner = size * (0.2 + 0.8 * easeOut(progress)) * (0.6 + 0.4 * fxHash01(view.id, i * 3 + 1));
                const len = size * 0.35;
                return {
                    type: 'draw-shape' as const,
                    shape: 'ellipse' as const,
                    position: pos,
                    anchor: 'center' as const,
                    offsetX: inner + len / 2,
                    offsetY: 0,
                    radiusX: len / 2,
                    radiusY: size * 0.04,
                    rotate: angle,
                    fill: color,
                    blendMode: 'lighter' as const,
                    opacity: fade,
                    ...(view.glow ? { shadow: { color, blur: view.glow } } : {}),
                };
            });
        }
        default: {
            const count = view.count ?? 6;
            return Array.from({ length: count }, (_, i) => sparkShape(view, pos, i, fade, progress));
        }
    }
}

/**
 * Expand ONE resolved fx entry into drawables at the given instant. Empty when
 * the entry is screen-space, expired, or has no usable position.
 */
export function expandFxItem(
    view: FxView,
    node: DrawFxLayerProps,
    epochNowMs: number,
    dim: FxDimension,
    projector?: Projector,
    fontFamily?: string,
): DrawableNode[] {
    if (view.space === 'screen') return [];
    const tickMs = node.tickMs ?? DEFAULT_TICK_MS;
    const { ageMs, progress, fade } = fxLifecycle(view, epochNowMs, tickMs);
    if (progress >= 1) return [];
    const pos = fxPosition(view, dim, ageMs / 1000);
    if (!pos) return [];

    const out: DrawableNode[] = [];
    const artItems = node.art?.[view.type]?.['idle'];
    const sprite = node.sprites?.[view.type];
    if (Array.isArray(artItems)) {
        out.push({
            type: 'draw-group',
            position: pos,
            opacity: fade,
            ...(view.size !== undefined ? { scale: view.size } : {}),
            items: artItems,
        });
    } else if (sprite?.url) {
        const spriteSize = view.size ?? 0.6;
        out.push({
            type: 'draw-sprite',
            position: pos,
            asset: sprite,
            anchor: 'center',
            width: spriteSize,
            height: spriteSize,
            opacity: fade,
            animation: view.animation ?? sprite.animations?.[0],
            // One-shot fx rows (burst) play from the item's birth, not wall-time.
            clockMs: ageMs,
        });
    } else {
        out.push(...proceduralShapes(view, pos, fade, progress));
    }
    if (view.message) {
        // `size` is documented in world units for canvas-space fx; convert to
        // pixel font size when a projector is available. A fixed minimum keeps
        // unpreset text readable. The host supplies the resolved theme body font
        // so FX messages match the rest of the UI instead of hard-coding system-ui.
        const pxSize = projector && view.size !== undefined
            ? Math.max(10, Math.round(view.size * projector.tileWidth))
            : undefined;
        const family = fontFamily ?? 'system-ui, sans-serif';
        const text: DrawTextProps = {
            type: 'draw-text',
            text: view.message,
            position: pos,
            offsetY: -(0.15 + 0.55 * progress),
            color: view.color ?? node.textColor ?? DEFAULT_TEXT_COLOR,
            opacity: fade,
            font: `bold ${pxSize ?? 14}px ${family}`,
        };
        out.push(text);
    }
    return out;
}

/** Expand the whole layer — pure; the caller routes the result through the normal paint dispatch. */
export function expandFxLayer(
    node: DrawFxLayerProps,
    epochNowMs: number,
    dim: FxDimension,
    projector?: Projector,
    fontFamily?: string,
): DrawableNode[] {
    if (!Array.isArray(node.items)) return [];
    const out: DrawableNode[] = [];
    for (const item of node.items) {
        // A malformed entry must never blank a board (unresolvable-asset contract).
        if (!item || typeof item.id !== 'string') continue;
        out.push(...expandFxItem(resolveFxView(item, node.presets), node, epochNowMs, dim, projector, fontFamily));
    }
    return out;
}

/** Registry/standalone stub — the host paints this molecule; the DOM renders nothing. */
export function DrawFxLayer(_props: DrawFxLayerProps): React.JSX.Element | null {
    return null;
}

export default DrawFxLayer;
