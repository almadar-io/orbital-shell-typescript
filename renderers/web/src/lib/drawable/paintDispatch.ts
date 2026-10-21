/**
 * Drawable paint dispatch (2D) + the `DrawableNode` union.
 *
 * `paintDrawable` routes ONE descriptor to its 2D painter; the host walks its
 * `children` through it. The "drawable" designation itself is NOT recorded here —
 * it is DERIVED from the core `ScenePos` type each descriptor's `position` uses
 * and stamped into `patterns-registry.json` by pattern-sync (mirroring how `Asset`
 * is tagged), then read by the orbital-rust validator. So this module is pure
 * paint routing; the capability is the registry's, not a hand-list.
 */
import type { Painter2D } from '../painter2d';
import type { DrawContext } from './contract';
import { isValidScenePos } from './contract';
import { paintSprite, type DrawSpriteProps } from '../../components/game/atoms/DrawSprite';
import { paintShape, type DrawShapeProps } from '../../components/game/atoms/DrawShape';
import { paintText, type DrawTextProps } from '../../components/game/atoms/DrawText';
import { isAnimatedGroup, type DrawGroupProps } from '../../components/game/atoms/DrawGroup';
import { paintSkinnedMesh, type DrawSkinnedMeshProps } from '../../components/game/atoms/DrawSkinnedMesh';
import { applyMeshAnimation, type DrawMeshProps } from '../../components/game/atoms/DrawMesh';
import { paintSpriteLayer, type DrawSpriteLayerProps } from '../../components/game/molecules/DrawSpriteLayer';
import { paintShapeLayer, type DrawShapeLayerProps } from '../../components/game/molecules/DrawShapeLayer';
import { paintTextLayer, type DrawTextLayerProps } from '../../components/game/molecules/DrawTextLayer';
import { expandFxLayer, type DrawFxLayerProps } from '../../components/game/molecules/DrawFxLayer';
import { createLogger } from '@almadar/logger';

/** Every drawable descriptor. The host's `children` are a `DrawableNode[]`. */
export type DrawableNode =
    | DrawSpriteProps
    | DrawShapeProps
    | DrawTextProps
    | DrawGroupProps
    | DrawMeshProps
    | DrawSkinnedMeshProps
    | DrawSpriteLayerProps
    | DrawShapeLayerProps
    | DrawTextLayerProps
    | DrawFxLayerProps;

const paint2dLog = createLogger('almadar:ui:drawable-2d');
const warnedUnsupported2d = new Set<string>();

/** 3D-canvas-only drawable kinds reach here when a board is viewed in 2D — skip with one warn per kind. */
const warnUnsupported2d = (kind: string): void => {
    if (warnedUnsupported2d.has(kind)) return;
    warnedUnsupported2d.add(kind);
    paint2dLog.warn('unsupported drawable kind on the 2D painter — skipped', { kind });
};

/** Dispatch a drawable descriptor to its 2D painter. Unknown types are skipped — never throws. */
export function paintDrawable(painter: Painter2D, node: DrawableNode, dctx: DrawContext): void {
    switch (node.type) {
        case 'draw-sprite':
            paintSprite(painter, node, dctx);
            break;
        case 'draw-shape':
            paintShape(painter, node, dctx);
            break;
        case 'draw-text':
            paintText(painter, node, dctx);
            break;
        case 'draw-group': {
            if (!isValidScenePos(node.position)) break;
            // items can be transiently undefined when the descriptor graph
            // reads entity data an atom has not seeded yet (first paint); the
            // reactive repaint fills it in. Contract: never throws.
            if (!Array.isArray(node.items)) break;
            const p = dctx.projector.project(node.position);
            // Group animation shares the mesh track engine; the 2D painter maps
            // offsets to screen cells and takes the in-plane rotateZ component.
            const anim = dctx.time > 0 && isAnimatedGroup(node) ? applyMeshAnimation(node, dctx.time) : null;
            const tw = dctx.projector.tileWidth;
            painter.save();
            painter.translate(p.x + (anim ? anim.offset[0] * tw : 0), p.y + (anim ? anim.offset[1] * tw : 0));
            const scale = (node.scale ?? 1) * (anim?.scale ?? 1);
            if (scale !== 1) painter.scale(scale, scale);
            const rotate = (node.rotate ?? 0) + (node.rotation?.[2] ?? 0) + (anim?.rotate[2] ?? 0);
            if (rotate !== 0) painter.rotate(rotate);
            const opacity = (node.opacity ?? 1) * (anim?.opacity ?? 1);
            if (opacity !== 1) painter.setAlpha(opacity);
            if (node.clip) {
                // Clip is authored in world units; scope the scale to the clip so items paint unchanged.
                painter.scale(tw, tw);
                painter.clipPath(node.clip);
                painter.scale(1 / tw, 1 / tw);
            }
            const childCtx: DrawContext =
                scale !== 1 ? { ...dctx, groupScale: (dctx.groupScale ?? 1) * scale } : dctx;
            for (const item of node.items) paintDrawable(painter, item, childCtx);
            painter.restore();
            break;
        }
        case 'draw-mesh':
            // Volumetric — no faithful 2D projection; a footprint blob would mislead.
            warnUnsupported2d('draw-mesh');
            break;
        case 'draw-skinned-mesh':
            paintSkinnedMesh(painter, node, dctx);
            break;
        case 'draw-sprite-layer':
            paintSpriteLayer(painter, node, dctx);
            break;
        case 'draw-shape-layer':
            paintShapeLayer(painter, node, dctx);
            break;
        case 'draw-text-layer':
            paintTextLayer(painter, node, dctx);
            break;
        case 'draw-fx-layer': {
            // Expansion is pure descriptors→descriptors; smoothness comes from the
            // paint clock (epoch-anchored against each item's bornAt), removal from
            // the fx mechanic's ttl decay.
            const epochNow =
                dctx.time > 0 && typeof performance !== 'undefined' ? performance.timeOrigin + dctx.time : 0;
            for (const child of expandFxLayer(node, epochNow, '2d', dctx.projector, dctx.fontFamily)) paintDrawable(painter, child, dctx);
            break;
        }
    }
}
