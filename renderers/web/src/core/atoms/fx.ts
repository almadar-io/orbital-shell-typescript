/**
 * fx — the shared transient-effect contract (type-only module + pure helpers).
 *
 * One `FxItem` descriptor feeds BOTH render substrates: `draw-fx-layer` (game
 * molecules — world-space, painted on the canvas) and `fx-overlay` (core
 * molecules — screen-space, DOM/CSS). The substrate is NAME-BLIND: an item's
 * look comes entirely from its resolved typed fields (color/size/shape/…),
 * never from a kind→look table inside a component. The effect-kind vocabulary
 * (`hit`, `explosion`, `correct-burst`, …) is declared by the CONSUMER — a
 * board, lab, or themed organism — as an `FxPreset[]` table in its own `.lolo`
 * config; `resolveFxView` merges the matching row under the item's own fields.
 *
 * Lifetime is owned by the fx mechanic (`std-fx-particles`): `ttl` decays every
 * `tickMs` and removal is authoritative. Renderers derive smooth per-frame
 * progress from `bornAt` (epoch ms, stamped at spawn) against the paint clock,
 * falling back to the stepped `1 − ttl/maxTtl` fraction when `bornAt` is absent
 * or no clock is running. Sub-particle scatter is seeded from the item `id` —
 * deterministic, no `Math.random` at paint time.
 */
import type { ScenePos } from '@almadar/core';

/** Which render substrate an fx entry belongs to. */
export type FxSpace = 'world' | 'screen';

/** The screen-space render kinds `fx-overlay` can play — component capability, not domain vocabulary. */
export type FxOverlayKind = 'confetti' | 'flash' | 'shake' | 'sparkle' | 'float-text' | 'streak-glow';

/** The procedural world-space recipes `draw-fx-layer` can paint — component capability, not domain vocabulary. */
export type FxProceduralShape = 'spark' | 'ring' | 'puff' | 'streak';

/**
 * One live transient effect — a row of the fx mechanic's `fx` entity list.
 * Only `id`/`type`/`x`/`ttl` are guaranteed; everything else is optional so the
 * 13 pre-existing producer emit sites keep compiling unchanged.
 */
export interface FxItem {
    /** Stable identity — the render key and the deterministic scatter seed. */
    id: string;
    /** Effect-kind key into the consumer-declared `FxPreset[]` table. */
    type: string;
    /** Canonical scene position; when absent the renderer derives it from `x`/`z`/`y`. */
    position?: ScenePos;
    /** Scene x in world units. */
    x: number;
    /** Ground-plane row in world units (2D boards paint it as screen y). */
    z?: number;
    /** Vertical axis in world units (3D height; 2D fallback row). */
    y?: number;
    /** Floating text painted with the effect (damage numbers, "+1", …). */
    message?: string;
    /** Remaining lifetime in mechanic ticks — the authoritative removal clock. */
    ttl: number;
    /** Spawn-time ttl (stamped by the mechanic when absent); grounds the fade fraction. */
    maxTtl?: number;
    /** Spawn timestamp in epoch ms (stamped by the mechanic) — enables smooth paint-clock progress. */
    bornAt?: number;
    /** Render substrate routing; default `world`. */
    space?: FxSpace;
    /** Screen-space render kind (`fx-overlay` vocabulary); ignored by the world layer. */
    effect?: FxOverlayKind;
    /** Primary color; renderer defaults apply when absent. */
    color?: string;
    /** Size in world units (canvas) / relative scale (overlay). */
    size?: number;
    /** Drift velocity along scene x, world-units/sec (render hint — the mechanic never integrates). */
    vx?: number;
    /** Drift velocity along the vertical axis, world-units/sec. */
    vy?: number;
    /** Drift velocity along the ground-plane row, world-units/sec. */
    vz?: number;
    /** Sub-particle count override (procedural burst / confetti). */
    particleCount?: number;
    /** Sprite-sheet animation name (e.g. "burst") — used when the resolved look is a sprite atlas. */
    animation?: string;
}

/**
 * One row of a consumer-declared effect vocabulary: the look + recipe for one
 * fx `type`. Item fields always win over the preset row (`resolveFxView`).
 */
export interface FxPreset {
    /** The effect-kind key this row styles. */
    type: string;
    /** Primary color. */
    color?: string;
    /** Secondary color (ring stroke / puff core accents). */
    color2?: string;
    /** Size in world units (canvas) / relative scale (overlay). */
    size?: number;
    /** Procedural recipe when no vector art or sprite matches. Default `spark`. */
    shape?: FxProceduralShape;
    /** Sub-particle count for the procedural recipe. */
    count?: number;
    /** Glow strength — soft shadow blur in world units around procedural particles. */
    glow?: number;
    /** Downward acceleration in world-units/sec² applied to the drift. */
    gravity?: number;
    /** Default drift velocities, world-units/sec. */
    vx?: number;
    vy?: number;
    vz?: number;
    /** Render substrate routing for this kind. */
    space?: FxSpace;
    /** Screen-space render kind for this kind. */
    effect?: FxOverlayKind;
    /** Sub-particle count for screen-space kinds (confetti/sparkle). */
    particleCount?: number;
    /** Sprite-sheet animation name to play when this preset resolves to a sprite atlas. */
    animation?: string;
}

/**
 * A screen-space fx entry as `fx-overlay` consumes it — the same mechanic rows,
 * filtered to `space == "screen"`. Deliberately carries NO `ScenePos`: overlay
 * coordinates are viewport fractions, and the absence of a core `ScenePos` is
 * what keeps `fx-overlay` out of the canvas-drawable capability.
 */
export interface FxOverlayItem {
    /** Stable identity — the mount key that starts the CSS animation, and the scatter seed. */
    id: string;
    /** Effect-kind key (consumer vocabulary); display comes from `effect` + style fields. */
    type: string;
    /** Overlay render kind; default `sparkle`. */
    effect?: FxOverlayKind;
    /** Floating text (`float-text`). */
    message?: string;
    /** Primary color. */
    color?: string;
    /** Relative scale multiplier. */
    size?: number;
    /** Horizontal viewport fraction 0..1; default 0.5. */
    x?: number;
    /** Vertical viewport fraction 0..1 (`z` wins, then `y`); default 0.4. */
    z?: number;
    y?: number;
    /** Remaining lifetime in mechanic ticks — removal unmounts the node. */
    ttl: number;
    /** Spawn-time ttl; animation duration = maxTtl × tickMs. */
    maxTtl?: number;
    /** Spawn timestamp in epoch ms. */
    bornAt?: number;
    /** Render substrate routing; `world` entries are skipped defensively. */
    space?: FxSpace;
    /** Particle count for confetti/sparkle. */
    particleCount?: number;
    /** Drift velocities (unused by the DOM overlay; present so mechanic rows pass through untouched). */
    vx?: number;
    vy?: number;
    vz?: number;
}

/** An `FxItem` with its preset row merged in — what the expanders consume. */
export interface FxView extends FxItem {
    /** Procedural recipe (preset-only field). */
    shape?: FxProceduralShape;
    /** Sub-particle count (preset-only field). */
    count?: number;
    /** Glow strength (preset-only field). */
    glow?: number;
    /** Downward acceleration (preset-only field). */
    gravity?: number;
    /** Secondary color (preset-only field). */
    color2?: string;
}

/** Merge the matching preset row UNDER the item's own fields (item wins). Unknown `type` → the item as-is. */
export function resolveFxView(item: FxItem, presets?: FxPreset[]): FxView {
    const row = presets?.find((p) => p.type === item.type);
    if (!row) return item;
    return {
        ...item,
        space: item.space ?? row.space,
        effect: item.effect ?? row.effect,
        color: item.color ?? row.color,
        size: item.size ?? row.size,
        vx: item.vx ?? row.vx,
        vy: item.vy ?? row.vy,
        vz: item.vz ?? row.vz,
        particleCount: item.particleCount ?? row.particleCount,
        animation: item.animation ?? row.animation,
        shape: row.shape,
        count: row.count,
        glow: row.glow,
        gravity: row.gravity,
        color2: row.color2,
    };
}

/** The derived lifetime view of one fx entry at one instant. */
export interface FxLifecycle {
    /** Total lifetime in ms (`maxTtl × tickMs`). */
    lifeMs: number;
    /** Elapsed ms since spawn (smooth via `bornAt`, else stepped from ttl). */
    ageMs: number;
    /** 0..1 elapsed fraction, clamped. */
    progress: number;
    /** 1..0 remaining fraction — the fade envelope. */
    fade: number;
}

/**
 * Derive per-frame progress. `epochNowMs > 0` + `bornAt` → smooth wall-clock
 * age; otherwise the stepped `1 − ttl/maxTtl` fraction (correct at every
 * mechanic tick, coarse between them).
 */
export function fxLifecycle(
    item: { ttl: number; maxTtl?: number; bornAt?: number },
    epochNowMs: number,
    tickMs: number,
): FxLifecycle {
    const maxTtl = Math.max(item.maxTtl ?? item.ttl, item.ttl, 1);
    const lifeMs = maxTtl * tickMs;
    const ageMs =
        item.bornAt !== undefined && epochNowMs > 0
            ? Math.max(0, epochNowMs - item.bornAt)
            : (1 - item.ttl / maxTtl) * lifeMs;
    const progress = Math.min(1, Math.max(0, ageMs / lifeMs));
    return { lifeMs, ageMs, progress, fade: 1 - progress };
}

/** Deterministic 0..1 hash of `seed` + `salt` — the scatter randomness (FNV-1a + avalanche; no `Math.random`). */
export function fxHash01(seed: string, salt: number): number {
    let h = 2166136261 ^ salt;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 13;
    h = Math.imul(h, 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

// ============================================================================
// Confetti model — shared by `ConfettiEffect` (trigger adapter) and `fx-overlay`
// ============================================================================

/** One confetti particle's CSS-animation parameters. */
export interface ConfettiParticle {
    id: number;
    color: string;
    /** Origin as % of container width. */
    left: number;
    /** Animation delay ms. */
    delay: number;
    /** Launch angle in degrees. */
    angle: number;
    /** Travel distance in px. */
    distance: number;
    /** Total rotation in degrees. */
    rotation: number;
    /** Particle size in px. */
    size: number;
}

export const CONFETTI_COLORS = [
    'var(--color-primary)',
    'var(--color-success)',
    'var(--color-warning)',
    'var(--color-error)',
    'gold',
    'dodgerblue',
];

/** Build a deterministic burst — same `seed` → same particles. */
export function createConfettiParticles(count: number, seed: string): ConfettiParticle[] {
    return Array.from({ length: count }, (_, i) => ({
        id: i,
        color: CONFETTI_COLORS[Math.floor(fxHash01(seed, i * 7 + 1) * CONFETTI_COLORS.length)],
        left: 30 + fxHash01(seed, i * 7 + 2) * 40,
        delay: fxHash01(seed, i * 7 + 3) * 300,
        angle: fxHash01(seed, i * 7 + 4) * 360,
        distance: 40 + fxHash01(seed, i * 7 + 5) * 80,
        rotation: fxHash01(seed, i * 7 + 6) * 720 - 360,
        size: 4 + fxHash01(seed, i * 7 + 7) * 6,
    }));
}

/** The confetti burst keyframes (per-particle travel via CSS custom props). */
export const CONFETTI_BURST_KEYFRAMES = `
@keyframes confetti-burst {
  0% {
    opacity: 1;
    transform: translate(0, 0) rotate(0deg) scale(1);
  }
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(var(--confetti-tx), var(--confetti-ty)) rotate(var(--confetti-rotate)) scale(0.5);
  }
}
`;
