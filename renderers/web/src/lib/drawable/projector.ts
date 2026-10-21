/**
 * 2D projector — builds a {@link Projector} for a projection (iso/hex/flat/free),
 * grounded in the canonical pure math in `isometric.ts` (the one source of the
 * iso/hex/flat transforms). Owns every projection formula so the drawable
 * primitives stay projection-agnostic.
 */
import type { ScenePos } from '@almadar/core';
import type { PainterPoint } from '../painter2d';
import type { DrawableAnchor, Projector } from './contract';
import { TILE_WIDTH, DIAMOND_TOP_Y, isoToScreen, type TileLayout } from '../isometric';

/** Projection modes the 2D host supports. `side` is handled by the side host, not here. */
export type Projection2D = TileLayout | 'free';

export interface Projector2DOptions {
    /** Native tile/cell width in source px for this board's asset (e.g. 16 for
     *  tiny-dungeon, ~128 for Kenney iso blocks). Defaults to `TILE_WIDTH` (256).
     *  The projector works in this tile-space; the host's camera zoom is the only
     *  on-screen scaler, so a tile texture maps 1:1 to its cell at `zoom`x (crisp). */
    tileWidth?: number;
    /** Horizontal offset that centers the grid (0 for `flat`/`free`). */
    baseOffsetX: number;
    layout: Projection2D;
    /** Override the diamond-top offset in source px (default derives from `tileWidth`). */
    diamondTopY?: number;
}

/** Build a {@link Projector} for a 2D projection. */
export function create2DProjector(opts: Projector2DOptions): Projector {
    const { baseOffsetX, layout } = opts;
    // `free`/`side` project identity (world-pixel-direct): cell metrics collapse
    // to 1 so `draw-sprite` width/height are literal px. Grid layouts use the
    // board's native tile width in tile-space (the camera applies zoom once).
    const tw = opts.tileWidth ?? TILE_WIDTH;
    const tileWidth = layout === 'free' ? 1 : tw;
    const floorHeight = layout === 'free' ? 1 : tw / 2; // 2:1 diamond / hex row base
    // Diamond-top scales proportionally with the native tile width (the canonical
    // 374px offset was measured on a 256px-wide Kenney iso block).
    const diamondTopY = layout === 'free' ? 0 : (opts.diamondTopY ?? tw * (DIAMOND_TOP_Y / TILE_WIDTH));
    const squareGrid = layout === 'flat' || layout === 'free';

    const project = (pos: ScenePos): PainterPoint =>
        layout === 'free' ? { x: pos.x, y: pos.y } : isoToScreen(pos.x, pos.y, tw, baseOffsetX, layout);

    const anchorPoint = (pos: ScenePos, anchor: DrawableAnchor): PainterPoint => {
        const base = project(pos);
        if (anchor === 'top-left') return base;
        const cx = base.x + tileWidth / 2;
        if (anchor === 'ground') {
            const gy = squareGrid ? base.y + tileWidth * 0.92 : base.y + diamondTopY + floorHeight * 0.5;
            return { x: cx, y: gy };
        }
        const cy = squareGrid ? base.y + tileWidth / 2 : base.y + diamondTopY + floorHeight * 0.5;
        return { x: cx, y: cy };
    };

    const cellPath = (pos: ScenePos): PainterPoint[] => {
        const base = project(pos);
        if (squareGrid) {
            return [
                { x: base.x, y: base.y },
                { x: base.x + tileWidth, y: base.y },
                { x: base.x + tileWidth, y: base.y + tileWidth },
                { x: base.x, y: base.y + tileWidth },
            ];
        }
        const cx = base.x + tileWidth / 2;
        const topY = base.y + diamondTopY;
        return [
            { x: cx, y: topY },
            { x: base.x + tileWidth, y: topY + floorHeight / 2 },
            { x: cx, y: topY + floorHeight },
            { x: base.x, y: topY + floorHeight / 2 },
        ];
    };

    return { project, anchorPoint, cellPath, tileWidth, floorHeight, diamondTopY, squareGrid, worldPixelDirect: layout === 'free' };
}
