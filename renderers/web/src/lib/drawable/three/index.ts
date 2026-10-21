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
// Scene primitives (the R3F rendering internals the host + AVL viewer compose)
// ---------------------------------------------------------------------------
export { Scene3D, type Scene3DProps } from './Scene3D';
export { Camera3D, type Camera3DProps, type Camera3DHandle, type CameraMode } from './Camera3D';
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
    useThree,
    type UseThreeOptions,
    type UseThreeReturn,
} from './hooks/useThree';
export {
    useAssetLoader,
    type UseAssetLoaderOptions,
    type UseAssetLoaderReturn,
    type AssetLoadingState,
} from './hooks/useAssetLoader';
export {
    useSceneGraph,
    type UseSceneGraphReturn,
    type SceneGraphNode,
    type NodeType,
} from './hooks/useSceneGraph';
export {
    useRaycaster,
    type UseRaycasterOptions,
    type UseRaycasterReturn,
    type RaycastHit,
    type GridHit,
} from './hooks/useRaycaster';
export {
    useGameCanvas3DEvents,
    type UseGameCanvas3DEventsOptions,
    type UseGameCanvas3DEventsReturn,
    type GameCanvas3DEventConfig,
} from './hooks/useGameCanvas3DEvents';

// ---------------------------------------------------------------------------
// Loaders + scene math
// ---------------------------------------------------------------------------
export {
    AssetLoader,
    assetLoader,
    type LoadedModel,
} from './lib/AssetLoader';
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
export {
    isInFrustum,
    filterByFrustum,
    getVisibleIndices,
    calculateLODLevel,
    updateInstanceLOD,
    cullInstancedMesh,
    SpatialHashGrid,
    type CullingOptions,
    type LODLevel,
    type LODConfig,
} from './lib/culling';

// ---------------------------------------------------------------------------
// AVL 3D organisms — R3F-dependent, so they ride THIS lazy chunk (never the
// avl/index.ts main entry). They import the scene primitives above as leaf
// modules; this barrel re-exports them (acyclic — no leaf re-enters here).
// ---------------------------------------------------------------------------
export { Avl3DViewer, type Avl3DViewerProps } from '../../../components/avl/organisms/Avl3DViewer';
export { Avl3DApplicationScene, type Avl3DApplicationSceneProps } from '../../../components/avl/organisms/Avl3DApplicationScene';
export { Avl3DOrbitalScene, type Avl3DOrbitalSceneProps } from '../../../components/avl/organisms/Avl3DOrbitalScene';
export { Avl3DTraitScene, type Avl3DTraitSceneProps } from '../../../components/avl/organisms/Avl3DTraitScene';
export { Avl3DTransitionScene, type Avl3DTransitionSceneProps } from '../../../components/avl/organisms/Avl3DTransitionScene';
export { Avl3DEffects, type Avl3DEffectsProps } from '../../../components/avl/organisms/Avl3DEffects';
export { Avl3DContext, useAvl3DConfig, type Avl3DModelOverrides, type Avl3DConfig } from '../../../providers/avl-3d-context';
export {
    AVL_3D_COLORS,
    CAMERA_POSITIONS,
    goldenSpiralPositions,
    fibonacciSpherePositions,
    orbitRingPositions,
    arcCurve3D,
    selfLoopCurve3D,
    treeLayout3D,
    type Position3D,
} from '../../avl-3d-layout';
