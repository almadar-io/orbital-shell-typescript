/**
 * The three.js VESSEL — the 3D painter backend of the drawable substrate.
 *
 * three.js is a rasterizer behind the neutral `draw-*` descriptors (the exact 3D
 * analogue of the 2D `Painter2D` seam), NOT a parallel React component tree. This
 * barrel is the SOLE entry into the R3F module graph: it is the tsup `three` entry
 * and is published behind the `@almadar/shell-web/three`
 * subpath (a STABLE alias). It is NEVER re-exported from the main `components/index.ts`
 * / `lib/index.ts` / `hooks/index.ts` barrels — that would statically pull
 * @react-three/fiber into every app's bundle. `Canvas.tsx` (the `canvas` host) lazy
 * imports this subpath for `mode:"3d"`; a 2D-only app never loads it.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// The 3D draw-host (the `canvas` host's 3D backend). `GameCanvas3D` is a
// back-compat alias for the historical published symbol name.
// ---------------------------------------------------------------------------
export { Canvas3DHost, Canvas3DHost as GameCanvas3D } from './Canvas3DHost';
export type { Canvas3DHostProps, Canvas3DHostHandle } from './Canvas3DHost';

// ---------------------------------------------------------------------------
// Scene primitives (the R3F rendering internals the host composes)
// ---------------------------------------------------------------------------
export { Lighting3D, type Lighting3DProps } from './Lighting3D';
export {
    Canvas3DLoadingState,
    type Canvas3DLoadingStateProps,
} from './Canvas3DLoadingState';
export {
    Canvas3DErrorBoundary,
    type Canvas3DErrorBoundaryProps,
    type Canvas3DErrorBoundaryState,
} from './Canvas3DErrorBoundary';
export {
    ModelLoader,
    type ModelLoaderProps,
} from './ModelLoader';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
export {
    useGameCanvas3DEvents,
    type UseGameCanvas3DEventsOptions,
    type UseGameCanvas3DEventsReturn,
    type GameCanvas3DEventConfig,
} from './hooks/useGameCanvas3DEvents';

// ---------------------------------------------------------------------------
// Scene math
// ---------------------------------------------------------------------------
export type { UnitAnimationState } from '../../spriteAnimationTypes';
export {
    gridToWorld,
    worldToGrid,
    raycastToPlane,
    raycastToObjects,
    gridDistance,
    gridManhattanDistance,
    getNeighbors,
    isInBounds,
    getCellsInRadius,
    createGridHighlight,
    normalizeMouseCoordinates,
    type Grid3DConfig,
    type GridCoordinate,
} from './lib/grid3D';
