/**
 * Isometric Coordinate Utilities
 *
 * Pure functions for 2:1 diamond isometric coordinate conversion.
 * No React dependencies — usable in any context.
 *
 * @packageDocumentation
 */

// =============================================================================
// Constants
// =============================================================================

/** Base tile width in pixels (before scale) */
export const TILE_WIDTH = 256;

/** Base tile height in pixels (before scale) — full sprite image height (Kenney 256×512) */
export const TILE_HEIGHT = 512;

/** Floor diamond height — the "walkable surface" portion of the tile (TILE_WIDTH / 2 for 2:1 ratio) */
export const FLOOR_HEIGHT = 128;

/**
 * Measured Y offset from sprite top to the diamond top vertex within a Kenney
 * 256×512 tile sprite.  The code previously assumed `TILE_HEIGHT - FLOOR_HEIGHT = 384`,
 * but the actual diamond (dirt_E.png) begins at y = 374 because the 3D side walls
 * occupy 10 extra pixels above the pure 128 px diamond.
 *
 * Use `DIAMOND_TOP_Y * scale` for highlight positioning, unit groundY, feature
 * placement, and hit-testing — NOT `(TILE_HEIGHT - FLOOR_HEIGHT) * scale`.
 * `FLOOR_HEIGHT` remains 128 for the isoToScreen spacing formula (2:1 ratio).
 */
export const DIAMOND_TOP_Y = 374;

/**
 * Feature type → fallback color mapping (when sprites not loaded).
 */
export const FEATURE_COLORS: Record<string, string> = {
    goldMine: '#fbbf24',
    resonanceCrystal: '#a78bfa',
    traitCache: '#60a5fa',
    salvageYard: '#6b7280',
    portal: '#c084fc',
    castle: '#f59e0b',
    mountain: '#78716c',
    default: '#9ca3af',
};

// =============================================================================
// Game-vocab palettes — single source of truth for the 2D renderer's DEFAULT
// colors. These were baked (and duplicated 2–3×) inside `Canvas2D.tsx`. The
// decomposed canvas reads them as DEFAULTS so it stays "dumb": every color is
// overridable per-item via descriptor data (`tile.color`, `unit.tint`, …) or a
// `theme` prop that `.lolo` computes. Values are the exact prior inline
// literals so a board supplying no overrides renders identically.
// =============================================================================

/** Tile fallback color by terrain (Canvas2D 973–975 / 983–985). */
export const TERRAIN_COLORS: Record<string, string> = {
    water: '#3b82f6',
    mountain: '#78716c',
    stone: '#9ca3af',
    default: '#4ade80',
};

/** Unit fallback + movement-ghost color by team (Canvas2D 1155–1156 / 1220–1221). */
export const TEAM_COLORS: Record<string, string> = {
    player: '#3b82f6',
    enemy: '#ef4444',
    neutral: '#6b7280',
    default: '#6b7280',
};

/** Unit drop-shadow color by team (Canvas2D 1188 / 1212). */
export const TEAM_SHADOW_COLORS: Record<string, string> = {
    player: 'rgba(0,150,255,0.6)',
    default: 'rgba(255,50,50,0.6)',
};

/** Cell highlight fill by intent (Canvas2D 1016 / 1019–1020). */
export const HIGHLIGHT_COLORS = {
    hover: 'rgba(255,255,255,0.15)',
    validMove: 'rgba(74,222,128,0.25)',
    attack: 'rgba(239,68,68,0.35)',
};

/** Selection ring stroke (Canvas2D 1168). */
export const SELECTION_RING_COLOR = 'rgba(0,200,255,0.8)';

/** Tile grid stroke (Canvas2D 977 / 993). */
export const GRID_STROKE_COLOR = 'rgba(0,0,0,0.2)';

/** Solid background fallback (Canvas2D 929). */
export const BACKGROUND_FALLBACK_COLOR = '#1a1a2e';

/** Minimap tile color by terrain (Canvas2D 873). */
export const MINIMAP_TERRAIN_COLORS: Record<string, string> = {
    water: '#3b82f6',
    mountain: '#78716c',
    default: '#4ade80',
};

/** Minimap unit color by team (Canvas2D 882). */
export const MINIMAP_UNIT_COLORS: Record<string, string> = {
    player: '#60a5fa',
    enemy: '#f87171',
    neutral: '#9ca3af',
    default: '#9ca3af',
};

/** Unit DOM name-label background by team (Canvas2D 1609). */
export const UNIT_LABEL_BG_COLORS: Record<string, string> = {
    player: 'rgba(59,130,246,0.9)',
    enemy: 'rgba(239,68,68,0.9)',
    neutral: 'rgba(107,114,128,0.9)',
    default: 'rgba(107,114,128,0.9)',
};

/** Side-scroller palette (Canvas2D SideView 229–259). */
export const SIDE_PLATFORM_COLORS: Record<string, string> = {
    ground: '#4a7c59',
    platform: '#7c6b4a',
    hazard: '#c0392b',
    goal: '#f1c40f',
};
export const SIDE_PLAYER_COLOR = '#3498db';
export const SIDE_PLAYER_EYE_COLOR = '#ffffff';
export const SIDE_SKY_GRADIENT_TOP = '#1a1a2e';
export const SIDE_SKY_GRADIENT_BOTTOM = '#16213e';
export const SIDE_GRID_COLOR = 'rgba(255, 255, 255, 0.03)';
export const SIDE_FX_COLOR = '#ffe066';
export const SIDE_PLATFORM_BEVEL_COLOR = 'rgba(255,255,255,0.15)';
export const SIDE_PLATFORM_SHADOW_COLOR = 'rgba(0,0,0,0.3)';
export const SIDE_HAZARD_STRIPE_COLOR = '#e74c3c';
export const SIDE_GOAL_GLOW_COLOR = 'rgba(241, 196, 15, 0.5)';
/** Default grid-path board background (Canvas2D bgColor default 634). */
export const DEFAULT_BG_COLOR = '#5c94fc';

// =============================================================================
// Layout
// =============================================================================

/**
 * Tile layout mode. 'isometric' = 2:1 diamond projection (default).
 * 'hex' = pointy-top offset-row hex grid.
 * 'flat' = orthographic top-down square grid (sokoban/tanks/sports/etc.).
 *
 * Hex constants (at scale=1):
 *   w = TILE_WIDTH (256)   — horizontal cell width
 *   h = FLOOR_HEIGHT (128) — vertical row stride (= w/2; hex row-to-row = h*0.75 = 96)
 * Forward:  screenX = col*w + (row&1)*(w/2) + baseOffsetX
 *           screenY = row * (h * 0.75)
 * Inverse: row = round(screenY / (h*0.75)); col = round((screenX - (row&1)*(w/2) - baseOffsetX) / w)
 *
 * Flat constants (at scale=1):
 *   cellW = TILE_WIDTH (256) — horizontal cell pitch
 *   cellH = FLOOR_HEIGHT (128) — vertical cell pitch (= cellW/2; keeps same visual scale as hex rows)
 * Forward:  screenX = col*cellW + baseOffsetX
 *           screenY = row * cellH
 * Inverse:  col = round((screenX - baseOffsetX) / cellW); row = round(screenY / cellH)
 */
export type TileLayout = 'isometric' | 'hex' | 'flat';

// =============================================================================
// Coordinate Conversion
// =============================================================================

/**
 * Convert tile grid coordinates to screen pixel coordinates.
 *
 * For 'isometric' (default): 2:1 diamond projection.
 * For 'hex': pointy-top offset-row projection (odd rows shifted right by w/2).
 * For 'flat': orthographic top-down square grid; col maps to X, row maps to Y.
 *
 * @param tileX - Grid X (col) coordinate
 * @param tileY - Grid Y (row) coordinate
 * @param cellWidth - Cell width in the caller's coordinate space (tile-space for
 *   forward projection, on-screen px for inverse hit-testing). The 2:1 diamond / hex
 *   row stride derive from it (`floorHeight = cellWidth / 2`).
 * @param baseOffsetX - Horizontal offset to center the grid
 * @param layout - Tile layout mode (default: 'isometric')
 * @returns Screen position { x, y } of the tile's top-left corner
 */
export function isoToScreen(
    tileX: number,
    tileY: number,
    cellWidth: number,
    baseOffsetX: number,
    layout: TileLayout = 'isometric',
): { x: number; y: number } {
    const w = cellWidth;
    const fh = cellWidth / 2; // 2:1 diamond height / hex row base

    if (layout === 'hex') {
        const screenX = tileX * w + (tileY & 1) * (w / 2) + baseOffsetX;
        const screenY = tileY * (fh * 0.75);
        return { x: screenX, y: screenY };
    }

    if (layout === 'flat') {
        // True top-down square grid: vertical pitch == horizontal pitch.
        const screenX = tileX * w + baseOffsetX;
        const screenY = tileY * w;
        return { x: screenX, y: screenY };
    }

    const screenX = (tileX - tileY) * (w / 2) + baseOffsetX;
    const screenY = (tileX + tileY) * (fh / 2);

    return { x: screenX, y: screenY };
}

/**
 * Convert screen pixel coordinates back to tile grid coordinates.
 *
 * Inverse of isoToScreen. Snaps to nearest integer tile position.
 *
 * @param screenX - Screen X in pixels
 * @param screenY - Screen Y in pixels
 * @param cellWidth - On-screen cell width in px (must match the forward projection's
 *   `cellWidth × zoom` so the inverse is consistent).
 * @param baseOffsetX - Horizontal offset used in isoToScreen
 * @param layout - Tile layout mode (default: 'isometric')
 * @returns Snapped grid position { x, y }
 */
export function screenToIso(
    screenX: number,
    screenY: number,
    cellWidth: number,
    baseOffsetX: number,
    layout: TileLayout = 'isometric',
): { x: number; y: number } {
    const w = cellWidth;
    const fh = cellWidth / 2;

    if (layout === 'hex') {
        const row = Math.round(screenY / (fh * 0.75));
        const col = Math.round((screenX - (row & 1) * (w / 2) - baseOffsetX) / w);
        return { x: col, y: row };
    }

    if (layout === 'flat') {
        const col = Math.round((screenX - baseOffsetX) / w);
        const row = Math.round(screenY / w);
        return { x: col, y: row };
    }

    const adjustedX = screenX - baseOffsetX;

    const tileX = (adjustedX / (w / 2) + screenY / (fh / 2)) / 2;
    const tileY = (screenY / (fh / 2) - adjustedX / (w / 2)) / 2;

    return { x: Math.round(tileX), y: Math.round(tileY) };
}
