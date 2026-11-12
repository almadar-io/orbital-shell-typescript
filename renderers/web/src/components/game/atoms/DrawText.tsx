'use client';
/**
 * `draw-text` — the neutral text drawable atom (dimension-agnostic).
 *
 * ONE descriptor (`DrawTextProps`, grounded in core `ScenePos`) with TWO backends:
 * `paintText` (2D, here) and billboarded text in orbital-canvas's 3D scene.
 * Paints a string at a scene position with font/color/alignment. The React
 * component renders `null` (a drawable is painted by the host, not the DOM).
 */
import type React from 'react';
import type { ScenePos } from '@almadar/core';
import type { DrawableAnchor, DrawableBase, PaintFn } from '../../../lib/drawable/contract';
import { isValidScenePos } from '../../../lib/drawable/contract';

/**
 * Mirrors DOM lib.dom.d.ts `CanvasTextAlign` by value (used directly instead
 * of the ambient global so the pattern-sync scanner — which only indexes
 * `components/**` and can't see ambient TS-lib types — resolves this to a
 * concrete enum instead of `json`). Structurally identical; `node.align`
 * still flows straight into `Painter2D.text`'s `TextStyle.align`.
 */
export type DrawTextAlign = 'center' | 'end' | 'left' | 'right' | 'start';
/** Mirrors DOM `CanvasTextBaseline` by value — see {@link DrawTextAlign}. */
export type DrawTextBaseline = 'alphabetic' | 'bottom' | 'hanging' | 'ideographic' | 'middle' | 'top';

/** One keyframe of a {@link DrawTextAnimation}: the fields it names lerp; the others keep their base value. */
export interface DrawTextKeyframe {
    /** Position in the cycle, 0..1. */
    at: number;
    opacity?: number;
    /** Offset in px, replacing `offsetX` while the animation plays. */
    offsetX?: number;
    /** Offset in px, replacing `offsetY` while the animation plays. */
    offsetY?: number;
}

/**
 * Keyframe animation over a text's `opacity`, `offsetX` and `offsetY`, the same contract as a shape's. Orbital
 * painter only: the host runs a paint clock while one is present.
 */
export interface DrawTextAnimation {
    /** One cycle length in ms. */
    durationMs: number;
    /** Loop the cycle (default true); false plays once and holds the final keyframe. */
    loop?: boolean;
    /** Keyframes ordered by `at` (0..1). */
    keyframes: DrawTextKeyframe[];
}

export interface DrawTextProps extends DrawableBase {
    type: 'draw-text';
    text: string;
    /** Logical scene position; the projector maps it to pixels / world. */
    position: ScenePos;
    anchor?: DrawableAnchor;
    offsetX?: number;
    offsetY?: number;
    color: string;
    font?: string;
    align?: DrawTextAlign;
    baseline?: DrawTextBaseline;
    opacity?: number;
    /** Line width in px; with it the text lays out as a paragraph from `position` (top-left anchor). Orbital painter. */
    width?: number;
    /** Break at line opportunities within `width` (default true when `width` is set). */
    wrap?: boolean;
    /** Maximum number of lines; the last kept line ends in an ellipsis when `truncate` is true. */
    maxLines?: number;
    /** Ellipsis instead of overflow. */
    truncate?: boolean;
    /** Line height as a multiple of the font size (default 1.3). */
    lineHeight?: number;
    /** Report this text's size in `measureEvent` (needs `id`). */
    measure?: boolean;
    /** Keyframe animation over `opacity`, `offsetX` and `offsetY` (orbital painter; the TS painter ignores it). */
    animation?: DrawTextAnimation;
}

/** Paint a {@link DrawTextProps}. */
export const paintText: PaintFn<DrawTextProps> = (painter, node, dctx) => {
    if (!isValidScenePos(node.position)) return;
    const p = dctx.projector.anchorPoint(node.position, node.anchor ?? 'center');
    const x = p.x + (node.offsetX ?? 0);
    const y = p.y + (node.offsetY ?? 0);

    painter.save();
    if (node.opacity !== undefined && node.opacity !== 1) painter.setAlpha(node.opacity);
    painter.text(node.text, x, y, { color: node.color, font: node.font, align: node.align, baseline: node.baseline });
    painter.restore();
};

/** Registry/standalone stub — the host paints this atom; the DOM renders nothing. */
export function DrawText(_props: DrawTextProps): React.JSX.Element | null {
    return null;
}

export default DrawText;
