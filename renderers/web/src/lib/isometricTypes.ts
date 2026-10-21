import type { Asset } from '@almadar/core';
import type { AnimationName } from './spriteAnimationTypes';
import type { UnitTrait } from './game';

/**
 * Isometric Game Types
 *
 * Type definitions for isometric grid rendering: tiles, units, features.
 * Used by IsometricCanvas and game hooks.
 *
 * @packageDocumentation
 */

/** An active visual effect on the board. x,y are grid tile coords; ttl = remaining ticks. */
export interface ActiveEffect {
    /** Unique key — matched against assetManifest.effects for sprite lookup */
    key: string;
    /** Grid x coordinate */
    x: number;
    /** Grid y coordinate */
    y: number;
    /** Remaining ticks — used as a fade/scale hint (alpha = min(1, ttl/4)) */
    ttl: number;
}

// =============================================================================
// Tile Types
// =============================================================================

/** A single isometric tile on the grid */
export interface IsometricTile {
    /** Optional unique identifier (required for 3D rendering) */
    id?: string;
    /** Grid x coordinate */
    x: number;
    /** Grid y coordinate (2D) */
    y: number;
    /** Grid z coordinate (3D alternative to y) */
    z?: number;
    /** Terrain type key (e.g., 'grass', 'stone', 'water') - 2D */
    terrain?: string;
    /** Tile type for visual rendering (3D) */
    type?: string;
    /** Direct sprite URL override (bypasses getTerrainSprite resolver) */
    terrainSprite?: Asset;
    /** Fallback/override fill color (2D + 3D) — bypasses the terrain color map. `.lolo`-computed. */
    color?: string;
    /** Whether units can traverse this tile (default true) */
    passable?: boolean;
    /** Movement cost for pathfinding (default 1) */
    movementCost?: number;
    /** Optional tile type for visual variants */
    tileType?: string;
    /** Elevation offset for 3D rendering */
    elevation?: number;
    /** 3D model URL (GLB format) for GameCanvas3D — rendered via ModelLoader with box fallback */
    modelUrl?: Asset;
    /** Y-axis rotation in degrees (3D) — orients directional pieces (track corners, road bends) */
    rotation?: number;
}

// =============================================================================
// Unit Types
// =============================================================================

/** A unit positioned on the isometric grid */
export type IsometricUnit = {
    /** Unique unit identifier */
    id: string;
    /** Current grid position (2D format) */
    position?: { x: number; y: number };
    /** Grid x coordinate (3D format) */
    x?: number;
    /** Grid y coordinate (3D format) */
    y?: number;
    /** Grid z coordinate (3D format) */
    z?: number;
    /** Static sprite URL (used when no sprite sheet animation) */
    sprite?: Asset;
    /** Sprite-sheet atlas JSON URL (e.g. `.../guardian-sprite-sheet.json`).
     *  When set, the canvas loads the atlas and crops/animates a single frame
     *  by animation state instead of drawing the whole sheet. */
    spriteSheet?: Asset;
    /** 3D model URL (GLB format) for GameCanvas3D — rendered via ModelLoader with box fallback */
    modelUrl?: Asset;
    /** Unit archetype key for sprite resolution */
    unitType?: string;
    /** Hero identifier for sprite sheet lookup */
    heroId?: string;
    /** Display name rendered below the unit */
    name?: string;
    /** Team affiliation for coloring */
    team?: 'player' | 'enemy' | 'neutral';
    /** Faction for 3D rendering (player/enemy/neutral) */
    faction?: 'player' | 'enemy' | 'neutral';
    /** Fallback/override tint color (2D + 3D) — bypasses the team/faction color map. `.lolo`-computed. */
    tint?: string;
    /** Current health */
    health?: number;
    /** Maximum health */
    maxHealth?: number;
    /** Trait attachments for state display */
    traits?: UnitTrait[];
    /** Previous position for movement trail ghost */
    previousPosition?: { x: number; y: number };
    /** Elevation offset for 3D rendering */
    elevation?: number;
    /** Animation name — driven by the LOLO state machine; renderer defaults to 'idle' */
    animation?: AnimationName;
    /** Frame index within the animation — driven by the LOLO state machine; renderer defaults to 0 */
    frame?: number;
    /** Y-axis heading in radians (3D) — travel/facing direction. Orients the unit model and
     *  drives the `chase` camera (behind + above, looking along heading). Driving boards set this. */
    heading?: number;
};

// =============================================================================
// Feature Types
// =============================================================================

/** A map feature (resource, building, portal, etc.) */
export type IsometricFeature = {
    /** Optional unique identifier (required for 3D rendering) */
    id?: string;
    /** Grid x coordinate */
    x: number;
    /** Grid y coordinate (2D) */
    y: number;
    /** Grid z coordinate (3D alternative to y) */
    z?: number;
    /** Feature type key (e.g., 'goldMine', 'castle', 'portal') */
    type: string;
    /** Direct sprite URL override (bypasses getFeatureSprite resolver) */
    sprite?: Asset;
    /** 3D model URL (GLB format) for GameCanvas3D */
    assetUrl?: Asset;
    /** Color override for 3D rendering */
    color?: string;
    /** Elevation offset for 3D rendering */
    elevation?: number;
    /** Y-axis rotation in radians (3D) — orients directional features (arches, signs, docks). */
    rotation?: number;
};

// =============================================================================
// Camera Types
// =============================================================================

/** Camera state for pan/zoom */
export interface CameraState {
    /** Camera X offset in pixels */
    x: number;
    /** Camera Y offset in pixels */
    y: number;
    /** Zoom level (1.0 = 100%) */
    zoom: number;
}
