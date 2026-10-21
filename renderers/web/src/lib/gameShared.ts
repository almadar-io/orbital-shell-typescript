/**
 * Game Shared (dimension-agnostic)
 *
 * Render DTO types, pure projection/animation utils, and the shared image cache hook.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type {
    IsometricTile,
    IsometricUnit,
    IsometricFeature,
    CameraState,
} from './isometricTypes';
export type {
    AnimationName,
    FacingDirection,
    SpriteDirection,
    ResolvedFrame,
    UnitAnimationState,
    SpriteFrameDims,
    SpriteSheetUrls,
    AnimationDef,
} from './spriteAnimationTypes';
export {
    createInitialGameState,
    calculateValidMoves,
    calculateAttackTargets,
} from './game';
export type {
    Position,
    GameUnit,
    UnitTrait,
    BoardTile,
    GamePhase,
    GameState,
    GameAction,
} from './game';

// ---------------------------------------------------------------------------
// Effects DTO types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Board entity helpers
// ---------------------------------------------------------------------------
export * from './boardEntity';

// ---------------------------------------------------------------------------
// Asset helpers
// ---------------------------------------------------------------------------
export * from './makeAsset';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
export { useImageCache } from '../hooks/useImageCache';

// ---------------------------------------------------------------------------
// Utils (pure functions)
// ---------------------------------------------------------------------------
export {
    isoToScreen,
    screenToIso,
    TILE_WIDTH,
    TILE_HEIGHT,
    FLOOR_HEIGHT,
    DIAMOND_TOP_Y,
    FEATURE_COLORS,
} from './isometric';
export type { TileLayout } from './isometric';
export {
    inferDirection,
    resolveSheetDirection,
    getCurrentFrame,
    resolveFrame,
    createUnitAnimationState,
    transitionAnimation,
    tickAnimationState,
} from './spriteAnimation';
export { SPRITE_SHEET_LAYOUT, SHEET_COLUMNS } from './spriteSheetConstants';
