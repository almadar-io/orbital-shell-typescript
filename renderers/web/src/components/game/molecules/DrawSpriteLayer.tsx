'use client';
/**
 * `draw-sprite-layer` — batch multiple sprites in one descriptor for O(layers) rendering.
 *
 * Composes the `draw-sprite` atom; the layer itself carries no `position` — each
 * item does. It is drawable-by-composition: its `items` are `draw-sprite`
 * descriptors (each grounded in core `ScenePos`), which is what stamps the layer
 * `drawable` at pattern-sync time.
 */
import type React from 'react';
import type { DrawableBase, PaintFn } from '../../../lib/drawable/contract';
import { type DrawSpriteProps, paintSprite } from '../atoms/DrawSprite';

export interface DrawSpriteLayerProps extends DrawableBase {
    type: 'draw-sprite-layer';
    /** Sprites painted in array order; z-ordering is the caller's responsibility. */
    items: DrawSpriteProps[];
}

/** Paint a {@link DrawSpriteLayerProps}. Renders all sprites in order; never throws. */
export const paintSpriteLayer: PaintFn<DrawSpriteLayerProps> = (painter, node, dctx) => {
    for (const item of node.items) {
        paintSprite(painter, item, dctx);
    }
};

/** Registry/standalone stub — the host paints this molecule; the DOM renders nothing. */
export function DrawSpriteLayer(_props: DrawSpriteLayerProps): React.JSX.Element | null {
    return null;
}

export default DrawSpriteLayer;
