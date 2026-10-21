'use client';
/**
 * `draw-shape-layer` — batch of shapes in one descriptor for O(layers) perf.
 *
 * Composes the `draw-shape` atom; drawable-by-composition (its `items` are
 * `draw-shape` descriptors, each grounded in core `ScenePos`). The React
 * component renders `null` (a drawable is painted by the host, not the DOM).
 */
import type React from 'react';
import type { DrawableBase, PaintFn } from '../../../lib/drawable/contract';
import { type DrawShapeProps, paintShape } from '../atoms/DrawShape';

export interface DrawShapeLayerProps extends DrawableBase {
    type: 'draw-shape-layer';
    items: DrawShapeProps[];
}

/** Paint a {@link DrawShapeLayerProps}. */
export const paintShapeLayer: PaintFn<DrawShapeLayerProps> = (painter, node, dctx) => {
    for (const item of node.items) {
        paintShape(painter, item, dctx);
    }
};

/** Registry/standalone stub — the host paints this molecule; the DOM renders nothing. */
export function DrawShapeLayer(_props: DrawShapeLayerProps): React.JSX.Element | null {
    return null;
}

export default DrawShapeLayer;
