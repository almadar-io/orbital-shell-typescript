/**
 * 3D projector — maps a core `ScenePos` to an R3F world position, mirroring the
 * `gridToWorld` convention in `grid3D.ts` (grid X → world X, grid Y → world Z on
 * the ground plane, scene Z → world Y as height). The 3D twin of `create2DProjector`;
 * the SAME drawable descriptors flow to both, only the renderer differs (mesh vs paint).
 */
import type { ScenePos } from '@almadar/core';

export interface Projector3D {
    /** Scene position → `[x, y, z]` world position (y is up). */
    toWorld(pos: ScenePos): [number, number, number];
    /** World units per grid cell. */
    readonly cellSize: number;
}

export interface Projector3DOptions {
    cellSize?: number;
    offsetX?: number;
    offsetZ?: number;
}

/** Build a {@link Projector3D}. */
export function create3DProjector(opts: Projector3DOptions = {}): Projector3D {
    const cellSize = opts.cellSize ?? 1;
    const offsetX = opts.offsetX ?? 0;
    const offsetZ = opts.offsetZ ?? 0;
    return {
        cellSize,
        toWorld: (pos) => [pos.x * cellSize + offsetX, pos.z ?? 0, pos.y * cellSize + offsetZ],
    };
}
