'use client';
/**
 * `draw-text` — the neutral text drawable atom (dimension-agnostic).
 *
 * ONE descriptor (`DrawTextProps`, grounded in core `ScenePos`) with TWO backends:
 * `paintText` (2D, here) and an R3F billboarded `<Text>` (`Text3D` in
 * `lib/drawable/mesh3d`, kept OUT of this file so the 2D path never pulls R3F).
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
