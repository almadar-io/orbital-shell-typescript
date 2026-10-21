'use client';
/**
 * `draw-text-layer` — batch of text labels in one descriptor for O(layers) perf.
 *
 * Composes the `draw-text` atom; drawable-by-composition (its `items` are
 * `draw-text` descriptors, each grounded in core `ScenePos`). Covers the batched
 * world-space text pass — fx messages, damage numbers, unit labels — that a
 * board maps from an entity array (`items: (array/map @entity.fx (fn ...))`),
 * which a literal `children` array can't express. The React component renders
 * `null` (a drawable is painted by the host, not the DOM).
 */
import type React from 'react';
import type { DrawableBase, PaintFn } from '../../../lib/drawable/contract';
import { type DrawTextProps, paintText } from '../atoms/DrawText';

export interface DrawTextLayerProps extends DrawableBase {
    type: 'draw-text-layer';
    items: DrawTextProps[];
}

/** Paint a {@link DrawTextLayerProps}. */
export const paintTextLayer: PaintFn<DrawTextLayerProps> = (painter, node, dctx) => {
    for (const item of node.items) {
        paintText(painter, item, dctx);
    }
};

/** Registry/standalone stub — the host paints this molecule; the DOM renders nothing. */
export function DrawTextLayer(_props: DrawTextLayerProps): React.JSX.Element | null {
    return null;
}

export default DrawTextLayer;
