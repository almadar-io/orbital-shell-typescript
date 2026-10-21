'use client';
/**
 * `draw-mesh` — the volumetric 3D drawable atom (3D-canvas backend).
 *
 * ONE descriptor (`DrawMeshProps`, grounded in core `ScenePos`) with the R3F
 * backend `Mesh3D` in `lib/drawable/three/DrawMesh3D` (kept OUT of this file so
 * the 2D path never pulls three). A parametric primitive (box, sphere, capsule,
 * cylinder, cone, torus, plane, circle — `plane`/`circle` lie flat in the
 * scene ground plane facing up, matching the 2D painter) or a raw-geometry `polyhedron`
 * (`vertices` + `faces` as plain data) at a scene position — `position.z` is
 * height in cells — with a data-driven material (`standard`/`physical`/`toon`/
 * `basic`), an optional inverted-hull outline, and keyframe animation over
 * transform/material tracks. Low-poly is a knob, not a geometry rewrite:
 * `segments` 4–8 + `material.flatShading`. Composed in `.lolo` like every
 * drawable; the 2D painter skips it with a one-time warn. The React component
 * renders `null`; it exists so the pattern pipeline registers a `draw-mesh`
 * pattern and standalone pages stay inspectable.
 */
import type React from 'react';
import { useContext } from 'react';
import type { ScenePos } from '@almadar/core';
import type { DrawableBase } from '../../../lib/drawable/contract';
import { DrawableRegistryContext } from '../../../lib/drawable/registry';

export type MeshShapeKind = 'box' | 'sphere' | 'capsule' | 'cylinder' | 'cone' | 'torus' | 'plane' | 'circle' | 'polyhedron';

export type MeshMaterialKind = 'standard' | 'physical' | 'toon' | 'basic';

export type MeshMaterialSide = 'front' | 'back' | 'double';

/**
 * Data-driven surface description — the 3D analog of the 2D fill/gradient knobs.
 * `standard`/`physical` are lit PBR (physical adds `transmission`/`ior` for glass
 * and crystal), `toon` is cel-banded, `basic` is unlit flat color.
 */
export interface MeshMaterial {
    kind?: MeshMaterialKind;
    /** Albedo color (CSS color string). */
    color?: string;
    /** 0..1 — how metallic the surface reads (PBR kinds). */
    metalness?: number;
    /** 0..1 — microfacet roughness; low = glossy (PBR kinds). */
    roughness?: number;
    /** Emissive color; pairs with the canvas `post.bloom` for neon/glow. */
    emissive?: string;
    /** Emissive strength multiplier (default 1 when `emissive` is set). */
    emissiveIntensity?: number;
    /** 0..1 material opacity; multiplies the node/group opacity. */
    opacity?: number;
    /** 0..1 light transmission — glass/crystal (`physical` only). */
    transmission?: number;
    /** Index of refraction (`physical` only, default 1.5). */
    ior?: number;
    /** Faceted shading — the low-poly look (pairs with low `segments`). */
    flatShading?: boolean;
    /** Which faces render (default `front`). */
    side?: MeshMaterialSide;
    /** Albedo texture: an image URL or `data:` URI, sampled through the polyhedron's `uvs`. Multiplied by `color` — keep `color` white (or unset) to show the texture unmodified. */
    map?: string;
}

/** Inverted-hull toon outline: a back-face shell of the same geometry, scaled out by `width`. */
export interface MeshOutline {
    /** Outline color (default near-black). */
    color?: string;
    /** Shell expansion as a fraction of the mesh size (default 0.05). */
    width?: number;
}

/**
 * One keyframe of a {@link DrawMeshAnimation}: `at` is the 0..1 position in the
 * cycle. Transform tracks are DELTAS from the base props (offsets in cells,
 * rotations in radians, `scale` a multiplier); material tracks override.
 */
export interface DrawMeshKeyframe {
    at: number;
    offsetX?: number;
    offsetY?: number;
    offsetZ?: number;
    rotateX?: number;
    rotateY?: number;
    rotateZ?: number;
    scale?: number;
    opacity?: number;
    emissiveIntensity?: number;
    color?: string;
    emissive?: string;
}

/**
 * Declarative keyframe animation for a mesh; the 3D host advances it per frame.
 * Numeric tracks lerp between keyframes, color tracks hold the previous
 * keyframe's value. A track rests at its identity until its first keyframe.
 */
export interface DrawMeshAnimation {
    /** One cycle length in ms. */
    durationMs: number;
    /** Loop the cycle (default true); false plays once and holds the final keyframes. */
    loop?: boolean;
    /** Keyframes ordered by `at` (0..1). */
    keyframes: DrawMeshKeyframe[];
}

/**
 * Smooth-skinning data for a `polyhedron` — plain declarative data, no runtime
 * objects. Vertices carry blended bone weights (a neck-base vertex can be 60%
 * neck / 40% spine), so the surface stretches continuously across joints
 * instead of cracking at rigid chunk boundaries.
 */
export interface DrawMeshSkin {
    /** Bone names, resolved against sibling `draw-group` `bone:` names in the same canvas. */
    bones: string[];
    /** One 16-float column-major inverse bind matrix per bone (model space → bone bind-local; translations in cells). */
    inverseBindMatrices: number[][];
    /** Per-vertex bone indices into `bones`, up to 4 each (pad with 0). */
    indices: number[][];
    /** Per-vertex blend weights matching `indices`, normalized to sum 1 (pad with 0). */
    weights: number[][];
}

export interface DrawMeshProps extends DrawableBase {
    type: 'draw-mesh';
    shape: MeshShapeKind;
    /** Logical scene position; `z` is height in cells (projected to world Y). */
    position: ScenePos;
    /** Box/plane X extent in cells (default 1). */
    width?: number;
    /** Box Y (height) extent / capsule-cylinder-cone length in cells (default 1). */
    height?: number;
    /** Box/plane Z extent in cells (default `width`). */
    depth?: number;
    /** Sphere/capsule/cone/torus/circle radius in cells (default 0.4). */
    radius?: number;
    /** Cylinder top radius (default `radius`). */
    radiusTop?: number;
    /** Cylinder bottom radius (default `radius`). */
    radiusBottom?: number;
    /** Torus tube radius in cells (default `radius` / 3). */
    tube?: number;
    /** Curved-surface tessellation, clamped 3..64 (default 24). 4–8 + `flatShading` = low-poly. */
    segments?: number;
    /** `polyhedron` only: raw vertices as scene-frame `[x, y, z]` triples in cells, `z` = up. */
    vertices?: number[][];
    /** `polyhedron` only: triangle index triples into `vertices`, wound counter-clockwise seen from OUTSIDE in the scene frame. */
    faces?: number[][];
    /** `polyhedron` only: per-vertex `[u, v]` texture coordinates parallel to `vertices`, glTF convention (`v` grows DOWN from the image's top-left). Pairs with `material.map`. */
    uvs?: number[][];
    /** `polyhedron` only: smooth-skinning weights binding the vertices to named bone groups. Vertices must then be authored in BIND POSE model space; the bones' animated transforms deform them. */
    skin?: DrawMeshSkin;
    /** Euler rotation `[x, y, z]` in radians. */
    rotation?: [number, number, number];
    /** `bottom` (default) rests the mesh on its position's ground plane; `center` centers it there. For `polyhedron`, `bottom` lifts by −min(z) and `center` applies no offset — the vertices are authoritative. */
    pivot?: 'bottom' | 'center';
    material?: MeshMaterial;
    outline?: MeshOutline;
    castShadow?: boolean;
    receiveShadow?: boolean;
    /** Keyframe animation over transform/material tracks; the 3D host runs it per frame. */
    animation?: DrawMeshAnimation;
    /** 0..1 opacity; multiplies the material and enclosing group opacity. */
    opacity?: number;
}

export const MESH_SEGMENTS_DEFAULT = 24;

/** Scene-frame AABB of a polyhedron's vertices; null when the data can't form a surface. */
export function polyhedronBounds(vertices: number[][] | undefined): { min: [number, number, number]; max: [number, number, number] } | null {
    if (!vertices || vertices.length < 3) return null;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const v of vertices) {
        if (v.length < 3 || !v.every((c) => Number.isFinite(c))) return null;
        for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis], v[axis]);
            max[axis] = Math.max(max[axis], v[axis]);
        }
    }
    return { min, max };
}

/** Clamp the tessellation knob to the supported 3..64 band. */
export function clampSegments(segments: number | undefined): number {
    const s = segments ?? MESH_SEGMENTS_DEFAULT;
    return Math.min(64, Math.max(3, Math.round(s)));
}

/**
 * The per-frame resolved view of a mesh animation — transform deltas plus
 * material overrides, applied by the 3D backend via ref mutation (no re-render).
 */
export interface MeshAnimationState {
    /** Position delta in cells `[x, y, z]` (scene axes; the backend projects). */
    offset: [number, number, number];
    /** Euler rotation delta in radians `[x, y, z]`. */
    rotate: [number, number, number];
    /** Uniform scale multiplier. */
    scale: number;
    opacity?: number;
    emissiveIntensity?: number;
    color?: string;
    emissive?: string;
}

/** True when this animation has something to play. */
export function isAnimatedMesh(node: DrawMeshProps): boolean {
    return Boolean(node.animation && node.animation.durationMs > 0 && node.animation.keyframes.length > 0);
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

const NUMERIC_TRACKS = [
    'offsetX',
    'offsetY',
    'offsetZ',
    'rotateX',
    'rotateY',
    'rotateZ',
    'scale',
    'opacity',
    'emissiveIntensity',
] as const;

/**
 * Resolve the animated state at wall-clock `timeMs`. Pure. Returns `null` when
 * there is no playable animation. Same track semantics as `applyShapeAnimation`:
 * each track interpolates between the keyframes that define it; before its first
 * defining keyframe the identity holds.
 */
export function applyMeshAnimation(node: { animation?: DrawMeshAnimation }, timeMs: number): MeshAnimationState | null {
    const anim = node.animation;
    if (!anim || !(anim.durationMs > 0) || anim.keyframes.length === 0) return null;
    const frames = [...anim.keyframes].sort((a, b) => a.at - b.at);
    const cycle = timeMs / anim.durationMs;
    const t = anim.loop === false ? Math.min(cycle, 1) : cycle - Math.floor(cycle);

    const trackValue = <K extends keyof DrawMeshKeyframe>(key: K): DrawMeshKeyframe[K] | undefined => {
        const defined = frames.filter((f) => f[key] !== undefined);
        if (defined.length === 0) return undefined;
        let prev: DrawMeshKeyframe | undefined;
        let next: DrawMeshKeyframe | undefined;
        for (const f of defined) {
            if (f.at <= t) prev = f;
            else if (!next) next = f;
        }
        if (!prev) return defined[0][key];
        if (!next) return prev[key];
        const span = next.at - prev.at;
        const k = span > 0 ? (t - prev.at) / span : 1;
        const a = prev[key];
        const b = next[key];
        if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, k) as DrawMeshKeyframe[K];
        return a;
    };

    const num: Partial<Record<(typeof NUMERIC_TRACKS)[number], number>> = {};
    for (const key of NUMERIC_TRACKS) {
        const v = trackValue(key);
        if (v !== undefined) num[key] = v as number;
    }
    return {
        offset: [num.offsetX ?? 0, num.offsetY ?? 0, num.offsetZ ?? 0],
        rotate: [num.rotateX ?? 0, num.rotateY ?? 0, num.rotateZ ?? 0],
        scale: num.scale ?? 1,
        opacity: num.opacity,
        emissiveIntensity: num.emissiveIntensity,
        color: trackValue('color'),
        emissive: trackValue('emissive'),
    };
}

/** Registry/standalone stub — the 3D host renders this atom; the DOM renders nothing.
 *  When composed as a React child of a draw-host, registers its descriptor via
 *  context so the host paints it — same path as DrawShape. */
export function DrawMesh(props: DrawMeshProps): React.JSX.Element | null {
    const register = useContext(DrawableRegistryContext);
    if (register) register({ ...props, type: 'draw-mesh' });
    return null;
}

export default DrawMesh;
