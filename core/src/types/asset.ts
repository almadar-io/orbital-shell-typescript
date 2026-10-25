/**
 * Asset Types for Semantic Asset References
 *
 * Defines types for abstracting asset paths into semantic references.
 * Assets are resolved from SemanticAssetRef to actual paths at compile time.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ============================================================================
// Entity Roles
// ============================================================================

/**
 * Entity roles in game contexts
 */
export const ENTITY_ROLES = [
    'player',
    'enemy',
    'npc',
    'item',
    'tile',
    'projectile',
    'effect',
    'ui',
    'decoration',
    'vehicle',
] as const;

export type EntityRole = (typeof ENTITY_ROLES)[number];

export const EntityRoleSchema = z.enum(ENTITY_ROLES);

// ============================================================================
// Visual Styles
// ============================================================================

/**
 * Visual art styles for games
 */
export const VISUAL_STYLES = ['pixel', 'vector', 'hd', '1-bit', 'isometric'] as const;

export type VisualStyle = (typeof VISUAL_STYLES)[number];

export const VisualStyleSchema = z.enum(VISUAL_STYLES);

// ============================================================================
// Asset Dimension + Aspect (render metadata carried with the asset / the need)
// ============================================================================

/**
 * Whether the asset is a 2D sprite/image or a 3D model. Set by the consuming
 * canvas: the same entity role is a 2D sprite-sheet on a tile board and a 3D
 * rigged model on a 3D board.
 */
export const ASSET_DIMENSIONS = ['2d', '3d'] as const;

export type AssetDimension = (typeof ASSET_DIMENSIONS)[number];

export const AssetDimensionSchema = z.enum(ASSET_DIMENSIONS);

/**
 * Rendering aspect ratio of an asset: square (tiles/sprites/portraits/icons),
 * 16:9 (scene backdrops), 5:7 (cards), 8:1 (effect frame strips),
 * 4:1 (wide paddles/bars), 5:3 (wide scenes), 1:2 (tall banners).
 */
export const ASSET_ASPECTS = ['1:1', '16:9', '5:7', '8:1', '4:1', '5:3', '1:2'] as const;

export type AssetAspect = (typeof ASSET_ASPECTS)[number];

export const AssetAspectSchema = z.enum(ASSET_ASPECTS);

// ============================================================================
// Effect Kind
// ============================================================================

/**
 * Stage-table kind of an effect (`role: 'effect'`) asset. Absent means `burst`.
 */
export const FX_KINDS = ['slash', 'puff', 'heal', 'trap', 'burst'] as const;

export type FxKind = (typeof FX_KINDS)[number];

export const FxKindSchema = z.enum(FX_KINDS);

// ============================================================================
// Animation Name + Sheet Direction
// ============================================================================

/**
 * Animation names matching a sprite sheet's row layout. Canonical home for
 * this vocabulary — `@almadar/ui`'s `spriteAnimationTypes.ts` re-exports it
 * rather than redeclaring, so board `.lolo` config and the render library
 * agree on one enum.
 */
export const ANIMATION_NAMES = ['idle', 'walk', 'skate', 'jump', 'fall', 'attack', 'hit', 'death'] as const;

export type AnimationName = (typeof ANIMATION_NAMES)[number];

export const AnimationNameSchema = z.enum(ANIMATION_NAMES);

/**
 * Sheet file directions (physical PNG files a sprite sheet ships as).
 * Legacy hand-drawn packs ship only se/sw and mirror-flip for ne/nw (a cheat
 * that shows the face while walking away); 3D-baked sheets ship all four real
 * directions — the renderer prefers a real sheet and keeps the flip only as
 * the legacy fallback.
 */
export const SPRITE_DIRECTIONS = ['se', 'sw', 'ne', 'nw'] as const;

export type SpriteDirection = (typeof SPRITE_DIRECTIONS)[number];

export const SpriteDirectionSchema = z.enum(SPRITE_DIRECTIONS);

/**
 * Camera projections a baked sprite sheet can ship. `iso` is directional
 * (se/sw physical sheets, ne/nw by mirror); `front`/`top`/`perspective` are
 * single fixed-camera sheets (the mesh reference-sheet camera vocabulary).
 */
export const SHEET_PROJECTIONS = ['iso', 'front', 'back', 'top', 'perspective'] as const;

export type SheetProjection = (typeof SHEET_PROJECTIONS)[number];

export const SheetProjectionSchema = z.enum(SHEET_PROJECTIONS);

// ============================================================================
// Animation Definition
// ============================================================================

/**
 * Definition for a single named animation within a sprite sheet: which row
 * it occupies, how many frames it has, and its playback rate. This is the
 * shape actually consumed by `@almadar/ui`'s sprite-sheet renderer
 * (`spriteAnimation.ts`'s `frameRect`/`getCurrentFrameFromDef`) — moved here
 * verbatim rather than reconciled with a differently-shaped guess, since
 * `@almadar/ui`'s version is the one with real production consumers.
 */
export interface AnimationDef {
    /** Row index in the sprite sheet (0-based; each animation occupies one row). */
    row: number;
    /** Number of frames in this animation. */
    frames: number;
    /** Frames per second. */
    frameRate: number;
    /** Whether the animation loops. */
    loop: boolean;
}

export const AnimationDefSchema = z.object({
    row: z.number().int().nonnegative(),
    frames: z.number().int().positive(),
    frameRate: z.number().positive(),
    loop: z.boolean(),
});

// ============================================================================
// Sprite Sheet Atlas
// ============================================================================

/**
 * Parsed sprite-sheet atlas JSON — the contract a `spriteSheet`-role `Asset.url`
 * resolves to when fetched (see `Asset.url` usage in `@almadar/ui`'s
 * `useUnitSpriteAtlas`). A unit's `sprite?: Asset` stays the static single-pose
 * image; `spriteSheet?: Asset` is a SEPARATE reference whose URL points at a
 * `SpriteSheetAtlas`-shaped JSON manifest (e.g. `.../guardian-sprite-sheet.json`),
 * not a PNG. Frame-cutting geometry lives here, not inlined onto `Asset` — an
 * `Asset` traveling through `render-ui` every tick stays small.
 */
export interface SpriteSheetAtlas {
    /** Unit archetype key. */
    unit?: string;
    /** Visual type key. */
    type?: string;
    /** Width of a single frame in pixels. */
    frameWidth: number;
    /** Height of a single frame in pixels. */
    frameHeight: number;
    /** Number of columns (frames per row). */
    columns: number;
    /** Number of rows (animations). */
    rows: number;
    /** Directions present as physical PNG files. */
    directions: SpriteDirection[];
    /** Relative PNG sheet paths per direction. */
    sheets: Partial<Record<SpriteDirection, string>>;
    /** Animation row layout keyed by animation name. Unit sheets use the canonical `AnimationName` rows; one-shot fx sheets declare their own names (e.g. `burst`) — the manifest is authoritative for its rows. */
    animations: Partial<Record<string, AnimationDef>>;
    /**
     * Per-projection sheet PNGs (additive; absent on legacy atlases). `iso`
     * mirrors `sheets` (directional se/sw); the fixed cameras carry one sheet
     * each. `sheets` remains the iso back-compat alias — writers emit both.
     */
    projections?: {
        iso?: Partial<Record<SpriteDirection, string>>;
        front?: string;
        back?: string;
        top?: string;
        perspective?: string;
    };
}

export const SpriteSheetAtlasSchema = z.object({
    unit: z.string().optional(),
    type: z.string().optional(),
    frameWidth: z.number().positive(),
    frameHeight: z.number().positive(),
    columns: z.number().int().positive(),
    rows: z.number().int().positive(),
    directions: z.array(SpriteDirectionSchema),
    sheets: z.partialRecord(SpriteDirectionSchema, z.string()),
    animations: z.record(z.string(), AnimationDefSchema),
    projections: z
        .object({
            iso: z.partialRecord(SpriteDirectionSchema, z.string()).optional(),
            front: z.string().optional(),
            back: z.string().optional(),
            top: z.string().optional(),
            perspective: z.string().optional(),
        })
        .optional(),
});

// ============================================================================
// Texture Atlas — named-subrect packed sheet (the industry standard)
// ============================================================================

/**
 * One named sub-rectangle inside a packed sheet. Mirrors the ShoeBox /
 * TexturePacker `<SubTexture>` element every Kenney `Spritesheet/*.xml` ships
 * (`x`/`y`/`width`/`height` = the rect in the sheet PNG; `frameX`/`frameY`/
 * `frameWidth`/`frameHeight` = the trim/pad offsets for sprites packed with
 * transparent edges removed — optional, present only on trimmed atlases).
 */
export interface SubTexture {
    x: number;
    y: number;
    width: number;
    height: number;
    frameX?: number;
    frameY?: number;
    frameWidth?: number;
    frameHeight?: number;
}

export const SubTextureSchema = z.object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    width: z.number().positive(),
    height: z.number().positive(),
    frameX: z.number().optional(),
    frameY: z.number().optional(),
    frameWidth: z.number().positive().optional(),
    frameHeight: z.number().positive().optional(),
});

/**
 * A packed sheet + its named sub-rectangles — the canonical parse target for a
 * Kenney `Spritesheet/*.xml` atlas. A STATIC tile/prop/UI Asset references one
 * of these: `{ url: <sheet.png>, atlas: <this.json>, sprite: "grass.png" }` →
 * the renderer fetches the sheet + atlas ONCE and blits the named sub-rect,
 * instead of loading N individual PNGs. (Animated actors use `SpriteSheetAtlas`
 * instead; a uniform-grid tile page uses `Tilesheet`.)
 */
export interface TextureAtlas {
    /** Relative path to the sheet PNG the sub-rects index into (the atlas's own `imagePath`). */
    imagePath: string;
    /** Sub-rectangles keyed by their atlas name (e.g. `"grass.png"`). */
    subTextures: Record<string, SubTexture>;
}

export const TextureAtlasSchema = z.object({
    imagePath: z.string(),
    subTextures: z.record(z.string(), SubTextureSchema),
});

// ============================================================================
// Tilesheet — uniform-grid packed page (cut by index)
// ============================================================================

/**
 * A uniform-grid tile page — the shape a Kenney `Tilesheet/` sheet takes (e.g.
 * Pirate Pack: "each tile is 64×64, no margin"). Tiles are cut by `(col,row)`
 * index rather than by named rect. `names` is present only when a sibling
 * `.xml`/`.txt` supplies an index→name list; otherwise a tile is addressed by
 * its `"col,row"` (or flat index) via `Asset.sprite`.
 */
export interface Tilesheet {
    /** Relative path to the tile sheet PNG. */
    imagePath: string;
    /** Width of one tile cell in pixels. */
    tileWidth: number;
    /** Height of one tile cell in pixels. */
    tileHeight: number;
    /** Number of columns in the grid. */
    columns: number;
    /** Number of rows in the grid. */
    rows: number;
    /** Outer margin before the first tile, in pixels (default 0). */
    margin?: number;
    /** Gap between adjacent tiles, in pixels (default 0). */
    spacing?: number;
    /** Optional index→name labels when a descriptor supplies them. */
    names?: string[];
}

export const TilesheetSchema = z.object({
    imagePath: z.string(),
    tileWidth: z.number().positive(),
    tileHeight: z.number().positive(),
    columns: z.number().int().positive(),
    rows: z.number().int().positive(),
    margin: z.number().nonnegative().optional(),
    spacing: z.number().nonnegative().optional(),
    names: z.array(z.string()).optional(),
});

// ============================================================================
// Semantic Asset Reference
// ============================================================================

/**
 * Semantic reference to an asset (not a hardcoded path).
 * Resolved to actual paths at compile time via asset maps.
 */
export type SemanticAssetRef = {
    /**
     * Entity role — a free string. Core no longer constrains the vocabulary to
     * `EntityRole` (that enum stays an exported shared reference for the asset
     * tool + renderer); genre boards may use their own roles (`boss`, `tower`, …).
     */
    role: string;
    /** Sub-category within role (hero, slime, coin, etc.) */
    category: string;
    /** Required animations for this entity */
    animations?: string[];
    /** Visual style preference */
    style?: VisualStyle;
    /** Variant identifier (for multiple versions) */
    variant?: string;
    /** 2D sprite vs 3D model — the rendering dimension the consuming canvas needs. */
    dimension?: AssetDimension;
    /** Rendering aspect ratio (square sprite/portrait/tile, 16:9 backdrop, 5:7 card, 8:1 fx-strip). */
    aspect?: AssetAspect;
};

export const SemanticAssetRefSchema = z.object({
    role: z.string().min(1),
    category: z.string().min(1),
    animations: z.array(z.string()).optional(),
    style: VisualStyleSchema.optional(),
    variant: z.string().optional(),
    dimension: AssetDimensionSchema.optional(),
    aspect: AssetAspectSchema.optional(),
});

// ============================================================================
// Asset — the UNIFIED asset type
// ============================================================================

/**
 * The single asset type: a `SemanticAssetRef` (role/dimension/animations/aspect/style)
 * WITH its resolved URL folded in. Used everywhere an asset is referenced — a lolo
 * board `assetManifest` (`Map string Asset`), every `@almadar/ui` game prop, the
 * asset-workflow's resolved/pool assets, and the inspector picker. Replaces the bare
 * `AssetUrl`-string asset field so the render metadata travels WITH the asset (no
 * pixel-dimension or filename heuristics needed to know sheet-vs-frame / 2d-vs-3d).
 */
export interface Asset extends SemanticAssetRef {
    /** The resolved asset URL. When `atlas`/`sprite` are set this is the SHEET png; otherwise a standalone image. */
    url: AssetUrl;
    /**
     * Optional atlas JSON (a `TextureAtlas` or `Tilesheet`) that slices `url`.
     * When present with `sprite`, the renderer fetches sheet + atlas once and
     * blits one sub-rect instead of loading a standalone PNG. Absent → `url` is
     * a plain whole-image asset (the existing, non-atlas path).
     */
    atlas?: AssetUrl;
    /**
     * The sub-texture selector within `atlas`: a `SubTexture` name for a
     * `TextureAtlas` (e.g. `"grass.png"`), or a `"col,row"`/flat index for a
     * `Tilesheet`. Only meaningful alongside `atlas`.
     */
    sprite?: string;
    /** Optional display name (inspector picker). */
    name?: string;
    /** Optional thumbnail URL (inspector picker grid). */
    thumbnailUrl?: string;
    /** Authored generation subject (visualDNA) for asset-workflow regeneration. */
    prompt?: string;
    /** Authored per-animation frame choreography — the exact pose per frame, the only pose source for animated slots. */
    choreography?: Record<string, string[]>;
    /** Effect stage-table kind for an `effect` asset; absent → `burst`. */
    fxKind?: FxKind;
}

export const AssetSchema = SemanticAssetRefSchema.extend({
    url: z.string(),
    atlas: z.string().optional(),
    sprite: z.string().optional(),
    name: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    prompt: z.string().optional(),
    choreography: z.record(z.string(), z.array(z.string())).optional(),
    fxKind: FxKindSchema.optional(),
});

// ============================================================================
// Asset Pack Manifest
// ============================================================================

/**
 * One board's asset pack, shipped as `assets.json` beside its `board.meta.json`.
 * The board declares `assetPack` (this `pack` id); asset generation writes ONLY
 * this file, never the board `.lolo`. `assets` is keyed `<group>/<name>`
 * (`units/guardian`, `ui/panel-frame`); each entry's `url` is relative to `base`.
 */
export interface AssetPackManifest {
    /** Pack id, `<brand>/<board>` (e.g. `kflow/ui-battle-board`). */
    pack: string;
    version: number;
    /** URL prefix every entry `url`/`atlas` is relative to. */
    base: string;
    assets: Record<string, Asset>;
}

export const AssetPackManifestSchema = z.object({
    pack: z.string().min(1),
    version: z.number().int().nonnegative(),
    base: z.string(),
    assets: z.record(z.string(), AssetSchema),
});

// ============================================================================
// Asset Catalog
// ============================================================================

/**
 * Single browsable asset in the inspector picker catalog.
 * Backs the asset/icon pickers — a flat list the inspector renders for
 * the user to choose from when a config field's type is `'asset'`.
 */
export interface AssetCatalogEntry {
    /** Resolvable URL to the asset. */
    url: string;
    /** Display name for the asset. */
    name: string;
    /** Grouping category within the catalog. */
    category: string;
    /** Asset kind the picker dispatches on. */
    kind: 'image' | 'spritesheet' | 'audio' | 'scene' | 'portrait' | 'model' | 'other';
    /** Optional thumbnail URL for grid previews. */
    thumbnailUrl?: string;
    /** 2D sprite vs 3D model — the asset's actual rendering dimension. */
    dimension?: AssetDimension;
    /** The asset's actual rendering aspect ratio. */
    aspect?: AssetAspect;
}

export const AssetCatalogEntrySchema = z.object({
    url: z.string(),
    name: z.string(),
    category: z.string(),
    kind: z.enum(['image', 'spritesheet', 'audio', 'scene', 'portrait', 'model', 'other']),
    thumbnailUrl: z.string().optional(),
    dimension: AssetDimensionSchema.optional(),
    aspect: AssetAspectSchema.optional(),
});

/**
 * Flat list of browsable assets surfaced by the inspector pickers.
 */
export type AssetCatalog = AssetCatalogEntry[];

export const AssetCatalogSchema = z.array(AssetCatalogEntrySchema);

/**
 * Asset-reference URL marker. A plain alias over `string` — the value is a
 * resolvable asset URL — but the named type lets the pattern-sync tool
 * (`tools/almadar-pattern-sync/parser.ts`) detect a component prop as an asset
 * field (tagged `asset`) the same way `EventKey`/`LucideIcon` are detected by
 * type identity. Components annotate image/url props as `AssetUrl` (`src`,
 * `backgroundImage`, `avatar`, …); the generator emits a `string` config knob
 * declared as the `asset` config type, which the property inspector dispatches
 * an AssetPicker on. Not branded — asset urls originate from user data, so cast
 * friction would buy nothing; the value is the marker the tool finds.
 */
export type AssetUrl = string;

// ============================================================================
// ScenePos — neutral scene coordinate
// ============================================================================

/**
 * A neutral position in scene space: 2D (`x`,`y`) or optionally 3D (`x`,`y`,`z`).
 * The single coordinate type shared by every drawable descriptor and camera pose
 * across the 2D and 3D canvas hosts, so a scene composes from the same `{x,y,z?}`
 * regardless of projection or painter. Logical, not pixel — the host's projector
 * maps a `ScenePos` to screen space.
 */
export interface ScenePos {
    x: number;
    y: number;
    z?: number;
}

export const ScenePosSchema = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number().optional(),
});

// ============================================================================
// Camera — neutral camera pose shared by the 2D and 3D canvas hosts
// ============================================================================

/**
 * Camera behaviors, unifying the former per-host vocab (2D `camera` string +
 * 3D `cameraMode`). `isometric`/`top-down`/`front` are fixed framings (`front` =
 * the straight-on flat elevation — side-scroller / reference-sheet view);
 * `follow`/`chase` track a target; `perspective` is the 3D dramatic framing.
 */
export const CAMERA_MODES = ['isometric', 'perspective', 'top-down', 'front', 'follow', 'chase'] as const;

export type CameraMode = (typeof CAMERA_MODES)[number];

export const CameraModeSchema = z.enum(CAMERA_MODES);

/**
 * A neutral camera pose shared by the 2D and 3D canvas hosts, so `type: canvas`
 * carries one camera object regardless of painter. `pos`/`target` are `ScenePos`
 * (logical scene space, not pixels); `zoom` scales the view (the former `scale`);
 * `fov` is the 3D field of view; `mode` selects the framing/tracking behavior.
 * Every field is optional — an omitted camera means the host's default framing.
 */
export interface Camera {
    pos?: ScenePos;
    target?: ScenePos;
    zoom?: number;
    fov?: number;
    mode?: CameraMode;
    /** Orbit the mode's framing position around the vertical axis through the target, in radians (3D hosts only). */
    azimuth?: number;
    /** Orbit height angle above the ground plane, in radians (3D hosts only). */
    elevation?: number;
    /** Whether the viewer may orbit, pan or zoom the camera. `false` holds the authored framing: a decorative backdrop the page scrolls through. Default true. */
    controls?: boolean;
}

export const CameraSchema = z.object({
    pos: ScenePosSchema.optional(),
    target: ScenePosSchema.optional(),
    zoom: z.number().optional(),
    fov: z.number().optional(),
    mode: CameraModeSchema.optional(),
    azimuth: z.number().optional(),
    elevation: z.number().optional(),
    controls: z.boolean().optional(),
});

// ============================================================================
// Type Exports
// ============================================================================

export type SemanticAssetRefInput = z.input<typeof SemanticAssetRefSchema>;
export type AnimationDefInput = z.input<typeof AnimationDefSchema>;
export type AssetCatalogEntryInput = z.input<typeof AssetCatalogEntrySchema>;
export type SpriteSheetAtlasInput = z.input<typeof SpriteSheetAtlasSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a semantic asset key from role and category.
 * 
 * Generates a unique asset identifier by combining role and category
 * with a colon separator. Used for asset management and lookup.
 * 
 * @param {EntityRole} role - Entity role (e.g., 'player', 'enemy')
 * @param {string} category - Asset category (e.g., 'sprite', 'animation')
 * @returns {string} Asset key in format 'role:category'
 * 
 * @example
 * createAssetKey('player', 'sprite'); // returns 'player:sprite'
 * createAssetKey('enemy', 'animation'); // returns 'enemy:animation'
 */
export function createAssetKey(role: EntityRole, category: string): string {
    return `${role}:${category}`;
}

/**
 * Parses an asset key into role and category components.
 * 
 * Deconstructs an asset key string (format 'role:category') into its
 * constituent parts. Returns null if the key format is invalid.
 * 
 * @param {string} key - Asset key in format 'role:category'
 * @returns {{ role: string; category: string } | null} Parsed components or null
 * 
 * @example
 * parseAssetKey('player:sprite'); // returns { role: 'player', category: 'sprite' }
 * parseAssetKey('enemy:animation'); // returns { role: 'enemy', category: 'animation' }
 * parseAssetKey('invalid'); // returns null
 */
export function parseAssetKey(key: string): { role: string; category: string } | null {
    const parts = key.split(':');
    if (parts.length !== 2) return null;
    return { role: parts[0], category: parts[1] };
}

/**
 * Gets common animations for an entity role.
 * 
 * Returns an array of default animation names appropriate for the
 * specified entity role. Used for asset configuration and validation.
 * 
 * @param {EntityRole} role - Entity role
 * @returns {string[]} Array of default animation names
 * 
 * @example
 * getDefaultAnimationsForRole('player'); // returns ['idle', 'run', 'jump', 'fall', 'attack', 'hurt', 'die']
 * getDefaultAnimationsForRole('enemy'); // returns ['idle', 'walk', 'attack', 'hurt', 'die']
 */
export function getDefaultAnimationsForRole(role: EntityRole): string[] {
    switch (role) {
        case 'player':
            return ['idle', 'run', 'jump', 'fall', 'attack', 'hurt', 'die'];
        case 'enemy':
            return ['idle', 'walk', 'attack', 'hurt', 'die'];
        case 'npc':
            return ['idle', 'walk', 'talk'];
        case 'item':
            return ['idle', 'collected'];
        case 'tile':
            return ['static'];
        case 'projectile':
            return ['fly', 'hit', 'expire'];
        case 'effect':
            return ['play'];
        case 'ui':
            return ['normal', 'hover', 'pressed', 'disabled'];
        case 'decoration':
            return ['idle'];
        case 'vehicle':
            return ['idle', 'move', 'brake'];
        default:
            return ['idle'];
    }
}

/**
 * Validates that an asset reference has required animations.
 * 
 * Checks if an asset reference contains all required animations.
 * Returns an error message if validation fails, or null if valid.
 * 
 * @param {SemanticAssetRef} assetRef - Asset reference to validate
 * @param {string[]} requiredAnimations - Required animation names
 * @returns {string | null} Error message or null if valid
 * 
 * @example
 * validateAssetAnimations(assetRef, ['idle', 'run']); // returns null if valid
 * validateAssetAnimations(assetRef, ['missing-animation']); // returns error message
 */
export function validateAssetAnimations(
    assetRef: SemanticAssetRef,
    requiredAnimations: string[]
): { valid: boolean; missing: string[] } {
    const provided = assetRef.animations || [];
    const missing = requiredAnimations.filter((anim) => !provided.includes(anim));
    return { valid: missing.length === 0, missing };
}

// ============================================================================
// Sprite Sheet Layout — the canonical unit sheet convention (owner-approved
// "Sheet convergence": 8 cols x 5 rows @ 256px, dark charcoal background).
// `tools/asset-workflow`'s `spritesheet-bake.ts` (SPRITE_LAYOUT) and
// `prompt-composer.ts` derive from this; this is the single source.
// ============================================================================

export const SPRITE_SHEET_LAYOUT = {
    frameWidth: 256,
    frameHeight: 256,
    columns: 8,
    rows: 5,
    background: '#20202E',
} as const;

export type SpriteSheetLayout = typeof SPRITE_SHEET_LAYOUT;

/**
 * The canonical unit animation row table (idle/walk/attack/hit/death), one
 * row per `AnimationName`, in sheet-row order. Mirrors
 * `tools/asset-workflow/src/spritesheet-bake.ts`'s `SPRITE_LAYOUT`.
 */
export const DEFAULT_UNIT_ANIMATION_ROWS: ReadonlyArray<{ name: AnimationName } & AnimationDef> = [
    { name: 'idle', row: 0, frames: 4, loop: true, frameRate: 6 },
    { name: 'walk', row: 1, frames: 8, loop: true, frameRate: 10 },
    { name: 'attack', row: 2, frames: 6, loop: false, frameRate: 12 },
    { name: 'hit', row: 3, frames: 3, loop: false, frameRate: 8 },
    { name: 'death', row: 4, frames: 6, loop: false, frameRate: 8 },
] as const;

/**
 * Builds the canonical unit `SpriteSheetAtlas` from `SPRITE_SHEET_LAYOUT` +
 * `DEFAULT_UNIT_ANIMATION_ROWS` for a given set of direction sheets. Directions
 * default to whichever keys `sheets` actually carries (legacy se/sw-only packs
 * included), or the caller can force a specific set via `opts.directions`.
 */
export function defaultUnitAtlas(
    sheets: SpriteSheetAtlas['sheets'],
    opts?: { directions?: SpriteDirection[] }
): SpriteSheetAtlas {
    const directions = opts?.directions ?? SPRITE_DIRECTIONS.filter((direction) => sheets[direction] !== undefined);
    const animations: Partial<Record<string, AnimationDef>> = {};
    for (const { name, ...def } of DEFAULT_UNIT_ANIMATION_ROWS) {
        animations[name] = def;
    }
    return {
        frameWidth: SPRITE_SHEET_LAYOUT.frameWidth,
        frameHeight: SPRITE_SHEET_LAYOUT.frameHeight,
        columns: SPRITE_SHEET_LAYOUT.columns,
        rows: SPRITE_SHEET_LAYOUT.rows,
        directions,
        sheets,
        animations,
    };
}

// ============================================================================
// Manifest Entry — the kflow-assets `manifest.json` row shape. Core is the
// owner; `tools/asset-workflow`'s `ExtendedManifestEntry` converges onto this
// (mirrors `tools/asset-workflow/src/asset-schema.ts`'s `CanvasAffinity`,
// `FrameSpec`, `AssetLicense`, `SourceCatalog` literal unions).
// ============================================================================

export const MANIFEST_ENTRY_KINDS = ['model', 'image', 'spritesheet', 'audio', 'json'] as const;

export type ManifestEntryKind = (typeof MANIFEST_ENTRY_KINDS)[number];

export const ManifestEntryKindSchema = z.enum(MANIFEST_ENTRY_KINDS);

// ============================================================================
// Game audio
// ============================================================================

/**
 * One entry of a game's sound manifest, keyed by logical cue name. Core owns
 * the shape so both the render substrate (`useGameAudio` / the `game-audio-cue`
 * pattern) and the generated `.lolo` factories resolve the SAME declaration —
 * a hook-local interface is invisible to the pattern extractor and lowers to a
 * shapeless `object`, which the `.lolo` type system rejects outright.
 */
export interface SoundEntry {
    /** Single path, or several to pick from at random on each play. */
    path: string | string[];
    /** Volume 0-1, multiplied by the master volume. */
    volume?: number;
    /** Whether this sound loops (background music). */
    loop?: boolean;
    /** Concurrent Audio instances kept in the pool. */
    poolSize?: number;
    /** Start automatically on the first user interaction. */
    autostart?: boolean;
    /** Use crossfade transitions when played as music. */
    crossfade?: boolean;
    /** Crossfade duration in milliseconds. */
    crossfadeDurationMs?: number;
}

export const SoundEntrySchema = z.object({
    path: z.union([z.string(), z.array(z.string())]),
    volume: z.number().optional(),
    loop: z.boolean().optional(),
    poolSize: z.number().optional(),
    autostart: z.boolean().optional(),
    crossfade: z.boolean().optional(),
    crossfadeDurationMs: z.number().optional(),
});

/** A game's sound manifest: logical cue name → its definition. */
export type AudioManifest = Record<string, SoundEntry>;

export const AudioManifestSchema = z.record(z.string(), SoundEntrySchema);

export const MANIFEST_CANVAS_AFFINITIES = ['isometric', 'hex', 'flat', 'side', '3d', 'none'] as const;

export type ManifestCanvasAffinity = (typeof MANIFEST_CANVAS_AFFINITIES)[number];

export const ManifestCanvasAffinitySchema = z.enum(MANIFEST_CANVAS_AFFINITIES);

export const MANIFEST_SOURCE_CATALOGS = ['kenny', 'kekec-assets', 'iram-assets', 'trait-wars-assets', 'kflow-assets'] as const;

export type ManifestSourceCatalog = (typeof MANIFEST_SOURCE_CATALOGS)[number];

export const ManifestSourceCatalogSchema = z.enum(MANIFEST_SOURCE_CATALOGS);

export const MANIFEST_ASSET_LICENSES = ['CC0', 'proprietary'] as const;

export type ManifestAssetLicense = (typeof MANIFEST_ASSET_LICENSES)[number];

export const ManifestAssetLicenseSchema = z.enum(MANIFEST_ASSET_LICENSES);

/**
 * Path of the sheet's `atlas.json` relative to the pack's `shared/` root
 * (`riya-platformer/units/riya/atlas.json`) — the executable frame truth for
 * unit sheets whose rows are not uniform.
 */
export type ManifestAtlasRef = string;

/** Tile/sprite-sheet frame layout for a manifest row, an atlas reference, else `null`. */
export type ManifestFrameSpec =
    | { kind: 'iso-tile'; w: number; h: number }
    | { kind: 'sprite-sheet'; frame: number; cols: number; rows: number }
    | ManifestAtlasRef
    | null;

export const ManifestFrameSpecSchema = z.union([
    z.object({ kind: z.literal('iso-tile'), w: z.number(), h: z.number() }),
    z.object({ kind: z.literal('sprite-sheet'), frame: z.number(), cols: z.number(), rows: z.number() }),
    z.string().min(1),
    z.null(),
]);

/**
 * One row of `almadar-assets/kflow-assets/manifest.json`. Core owns this
 * shape; `tools/asset-workflow`'s `ExtendedManifestEntry` converges onto it.
 */
export interface ManifestEntry {
    url: string;
    name: string;
    category: string;
    kind: ManifestEntryKind;
    width: number;
    height: number;
    canvasAffinity: ManifestCanvasAffinity;
    genreAffinity: string[];
    swapClass: string;
    sourceCatalog: ManifestSourceCatalog;
    frameSpec: ManifestFrameSpec;
    /** Provenance-extended field: present on the promote/register path only. */
    license?: ManifestAssetLicense;
}

export const ManifestEntrySchema = z.object({
    url: z.string(),
    name: z.string(),
    category: z.string(),
    kind: ManifestEntryKindSchema,
    width: z.number(),
    height: z.number(),
    canvasAffinity: ManifestCanvasAffinitySchema,
    genreAffinity: z.array(z.string()),
    swapClass: z.string(),
    sourceCatalog: ManifestSourceCatalogSchema,
    frameSpec: ManifestFrameSpecSchema,
    license: ManifestAssetLicenseSchema.optional(),
});

export type ManifestEntryInput = z.input<typeof ManifestEntrySchema>;

// ============================================================================
// Manifest -> Asset Catalog adapter
// ============================================================================

const ASSET_CATALOG_ENTRY_KINDS: readonly AssetCatalogEntry['kind'][] = [
    'image',
    'spritesheet',
    'audio',
    'scene',
    'portrait',
    'model',
    'other',
];

const MODEL_URL_EXTENSIONS = ['.glb', '.gltf'];
const AUDIO_URL_EXTENSIONS = ['.mp3', '.ogg', '.wav'];

function urlEndsWithAny(url: string, extensions: readonly string[]): boolean {
    const lower = url.toLowerCase();
    return extensions.some((extension) => lower.endsWith(extension));
}

/**
 * Declared, order-sensitive rule for deriving the catalog `kind` from a
 * manifest row: `frameSpec`/`kind==='spritesheet'` beats extension, which
 * beats the manifest's own `kind`. No filename-keyword guessing.
 */
function deriveManifestAssetKind(entry: ManifestEntry): AssetCatalogEntry['kind'] {
    if (typeof entry.frameSpec === 'string' || entry.frameSpec?.kind === 'sprite-sheet' || entry.kind === 'spritesheet') return 'spritesheet';
    if (entry.kind === 'model' || urlEndsWithAny(entry.url, MODEL_URL_EXTENSIONS)) return 'model';
    if (entry.kind === 'audio' || urlEndsWithAny(entry.url, AUDIO_URL_EXTENSIONS)) return 'audio';
    if (entry.kind === 'image') return 'image';
    return 'other';
}

function parseAssetAspectRatio(aspect: AssetAspect): number {
    const [w, h] = aspect.split(':').map(Number);
    return w / h;
}

const ASSET_ASPECT_RATIO_TOLERANCE = 0.01;

/**
 * The asset's aspect only when width/height are both known (> 0) and their
 * ratio matches exactly one `ASSET_ASPECTS` entry within 1%; otherwise
 * omitted (never guessed).
 */
function deriveManifestAssetAspect(width: number, height: number): AssetAspect | undefined {
    if (width <= 0 || height <= 0) return undefined;
    const ratio = width / height;
    for (const aspect of ASSET_ASPECTS) {
        const expected = parseAssetAspectRatio(aspect);
        if (Math.abs(ratio / expected - 1) <= ASSET_ASPECT_RATIO_TOLERANCE) return aspect;
    }
    return undefined;
}

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Prefixes a relative manifest url with `cdnPrefix`; leaves an absolute url untouched. */
function resolveManifestUrl(url: string, cdnPrefix?: string): string {
    if (!cdnPrefix || ABSOLUTE_URL_PATTERN.test(url)) return url;
    const prefix = cdnPrefix.endsWith('/') ? cdnPrefix : `${cdnPrefix}/`;
    const rest = url.startsWith('/') ? url.slice(1) : url;
    return `${prefix}${rest}`;
}

/**
 * Adapts kflow-assets manifest rows into the inspector picker's
 * `AssetCatalog`. The ONE deterministic derivation the Kura assets server
 * route (`GET /api/assets/catalog`) and any other manifest consumer share.
 */
export function manifestToAssetCatalog(entries: ReadonlyArray<ManifestEntry>, opts?: { cdnPrefix?: string }): AssetCatalog {
    return entries.map((entry) => {
        const kind = deriveManifestAssetKind(entry);
        const dimension: AssetDimension = entry.canvasAffinity === '3d' ? '3d' : '2d';
        const aspect = deriveManifestAssetAspect(entry.width, entry.height);
        const url = resolveManifestUrl(entry.url, opts?.cdnPrefix);
        const catalogEntry: AssetCatalogEntry = {
            url,
            name: entry.name,
            category: entry.category,
            kind,
            dimension,
        };
        if (aspect !== undefined) catalogEntry.aspect = aspect;
        if (kind === 'image' || kind === 'spritesheet') catalogEntry.thumbnailUrl = url;
        return catalogEntry;
    });
}

// ============================================================================
// Asset query grammar — Unity-style `t:<kind>` / `l:<label>` + free text.
// The ONE grammar `parseAssetQuery`/`matchAssetQuery` implement; every
// consumer (the Kura assets server route, the client's `asset-query.ts`)
// imports these instead of re-parsing.
// ============================================================================

const ASSET_QUERY_TYPE_PREFIX = 't:';
const ASSET_QUERY_LABEL_PREFIX = 'l:';

function isAssetCatalogEntryKind(value: string): value is AssetCatalogEntry['kind'] {
    return ASSET_CATALOG_ENTRY_KINDS.some((kind) => kind === value);
}

interface ParsedAssetQuery {
    text: string;
    kind?: AssetCatalogEntry['kind'];
    labels: string[];
    /** A `t:` token whose value is not a known `AssetCatalogEntry['kind']` — the query matches nothing. */
    unknownKind: boolean;
}

function parseAssetQueryTokens(q: string): ParsedAssetQuery {
    const tokens = q.trim().length > 0 ? q.trim().split(/\s+/) : [];
    const textParts: string[] = [];
    const labels: string[] = [];
    let kind: AssetCatalogEntry['kind'] | undefined;
    let unknownKind = false;
    for (const token of tokens) {
        if (token.startsWith(ASSET_QUERY_TYPE_PREFIX)) {
            const value = token.slice(ASSET_QUERY_TYPE_PREFIX.length);
            if (isAssetCatalogEntryKind(value)) kind = value;
            else unknownKind = true;
        } else if (token.startsWith(ASSET_QUERY_LABEL_PREFIX)) {
            const value = token.slice(ASSET_QUERY_LABEL_PREFIX.length);
            if (value.length > 0) labels.push(value);
        } else {
            textParts.push(token);
        }
    }
    return { text: textParts.join(' '), kind, labels, unknownKind };
}

/**
 * Parses a `t:<kind>` / `l:<label>` / free-text asset search query. An
 * unrecognized `t:` value is dropped from the returned `kind` (there is no
 * value of `AssetCatalogEntry['kind']` to report) — `matchAssetQuery`, which
 * shares this same tokenizer internally, is the authority that turns it into
 * "matches nothing".
 */
export function parseAssetQuery(q: string): { text: string; kind?: AssetCatalogEntry['kind']; labels: string[] } {
    const parsed = parseAssetQueryTokens(q);
    return parsed.kind === undefined ? { text: parsed.text, labels: parsed.labels } : { text: parsed.text, kind: parsed.kind, labels: parsed.labels };
}

/**
 * Matches one catalog entry against a `t:`/`l:`/free-text query. `l:` labels
 * are ANDed against `entry.category` (exact, case-insensitive); free text is
 * an ANDed case-insensitive substring over `name`+`category`. An unrecognized
 * `t:` kind matches nothing.
 */
export function matchAssetQuery(entry: AssetCatalogEntry, q: string): boolean {
    const parsed = parseAssetQueryTokens(q);
    if (parsed.unknownKind) return false;
    if (parsed.kind !== undefined && entry.kind !== parsed.kind) return false;
    for (const label of parsed.labels) {
        if (entry.category.toLowerCase() !== label.toLowerCase()) return false;
    }
    if (parsed.text.length > 0) {
        const haystack = `${entry.name} ${entry.category}`.toLowerCase();
        if (!haystack.includes(parsed.text.toLowerCase())) return false;
    }
    return true;
}
