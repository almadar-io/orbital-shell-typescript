/**
 * skinning — pure 2D skeletal mesh deformation (linear blend skinning).
 *
 * A skinned mesh is a bind-pose triangle mesh whose vertices carry bone weights;
 * a pose rotates each bone about its own pivot (degrees, relative to bind) and
 * every vertex follows as a weighted blend of its bones' transforms. Bones form
 * an FK chain by `parent` name: a child's world transform composes its parent's,
 * so rotating a limb root swings the whole chain while a child still rotates
 * about its own pivot. The pure math lives in orbital-core-base; this module
 * crosses the installed kernel bridge for the painter and hit tests.
 *
 * Convention: all coordinates (pivots, tips, vertex x/y) live in ONE shared
 * local space (the drawable's world-unit space); `u`/`v` are normalized 0..1
 * texture coordinates. The bind pose is `pose = {}` (every angle 0).
 */

import { kernelEvaluator } from '@almadar/core';

/** Column-major-free 2D affine: maps `(x,y)` → `(a·x + c·y + e, b·x + d·y + f)`. */
export type Affine2D = [number, number, number, number, number, number];

export interface SkinWeight {
    /** Index into the drawable's `bones` array. */
    bone: number;
    w: number;
}

export interface SkinVertex {
    x: number;
    y: number;
    /** Normalized 0..1 texture coordinates. */
    u: number;
    v: number;
    weights: SkinWeight[];
}

export interface SkinMesh {
    vertices: SkinVertex[];
    triangles: [number, number, number][];
}

export interface BoneDef {
    name: string;
    parent: string | null;
    /** Rotation pivot in local space (the joint the bone turns about). */
    pivot: [number, number];
    /** Bone end point in local space (render/inspect hint; no skinning role). */
    tip: [number, number];
}

/** Bone name → rotation in degrees relative to the bind pose. */
export type Pose = Record<string, number>;

/** Pure rig math is owned by orbital-core-base and crossed through the installed kernel. */
export function composeAffine(a: Affine2D, b: Affine2D): Affine2D {
    return JSON.parse(kernelEvaluator().skinComposeAffine(JSON.stringify(a), JSON.stringify(b))) as Affine2D;
}

export function invertAffine(m: Affine2D): Affine2D {
    return JSON.parse(kernelEvaluator().skinInvertAffine(JSON.stringify(m))) as Affine2D;
}

export function applyAffine(m: Affine2D, x: number, y: number): [number, number] {
    return JSON.parse(kernelEvaluator().skinApplyAffine(JSON.stringify(m), x, y)) as [number, number];
}

export function computeWorldMatrices(bones: BoneDef[], pose: Pose): Affine2D[] {
    return JSON.parse(kernelEvaluator().skinWorldMatrices(JSON.stringify(bones), JSON.stringify(pose))) as Affine2D[];
}

export function skinVertices(mesh: SkinMesh, bindWorld: Affine2D[], curWorld: Affine2D[]): [number, number][] {
    return JSON.parse(kernelEvaluator().skinVertices(JSON.stringify(mesh), JSON.stringify(bindWorld), JSON.stringify(curWorld))) as [number, number][];
}

export function triangleAffine(
    src: [[number, number], [number, number], [number, number]],
    dst: [[number, number], [number, number], [number, number]],
): Affine2D | null {
    return JSON.parse(kernelEvaluator().skinTriangleAffine(JSON.stringify(src), JSON.stringify(dst))) as Affine2D | null;
}

/** url → parsed mesh (undefined while in-flight; null on failure — both mean "not ready"). */
const meshCache = new Map<string, SkinMesh | null | undefined>();

/** One named clip inside a rigbundle (`clips[name]`): fps metadata + pose frames. */
export interface RigBundleClip {
    fps?: number;
    frames: Pose[];
}

/** The exporter's full rig payload: mesh + skeleton + named clips in one JSON. */
export interface RigBundle {
    mesh?: SkinMesh;
    bones?: BoneDef[];
    clips?: Record<string, RigBundleClip>;
}

/** True when fetched JSON is a rigbundle (nested `mesh`/`bones`/`clips`) rather than a bare SkinMesh. */
export function isRigBundle(json: RigBundle | SkinMesh): json is RigBundle {
    return (json as RigBundle).mesh !== undefined || (json as RigBundle).bones !== undefined;
}

/**
 * Get a parsed rigbundle (or bare SkinMesh) by URL, fetching+caching on first
 * request. Returns undefined until loaded; `onReady` fires once when the fetch
 * resolves so the caller can trigger a re-render. Accepts BOTH shapes: a bare
 * `{vertices, triangles}` mesh and a full `{mesh, bones, clips}` rigbundle.
 */
export function getRigBundle(url: string, onReady: () => void): RigBundle | SkinMesh | undefined {
    if (meshCache.has(url)) return (meshCache.get(url) as RigBundle | SkinMesh | null) ?? undefined;
    meshCache.set(url, undefined); // mark in-flight so we fetch once
    fetch(url)
        .then((r) => {
            if (!r.ok) throw new Error(`rigbundle fetch failed: HTTP ${r.status}`);
            return r.json();
        })
        .then((json: RigBundle | SkinMesh) => {
            // Shape-guard: a bare mesh has vertices; a rigbundle has mesh/bones. An error
            // payload from a non-OK-but-JSON route (or a wrong-URL 200) must not be cached
            // as a mesh — the painter reads `vertices`/`triangles` unconditionally.
            const ok = isRigBundle(json) || Array.isArray((json as SkinMesh).vertices);
            if (!ok) throw new Error('rigbundle payload is neither a SkinMesh nor a rigbundle');
            meshCache.set(url, json as SkinMesh);
            onReady();
        })
        .catch(() => { meshCache.set(url, null); onReady(); }); // failed → repaint so fallback art shows
    return undefined;
}

/**
 * Get a parsed skin mesh by URL, fetching+caching on first request. Returns
 * undefined until loaded; `onReady` fires once when the fetch resolves so the
 * caller can trigger a re-render. Mirrors the atlas manifest cache in `atlasSlice`.
 */
export function getSkinMesh(url: string, onReady: () => void): SkinMesh | undefined {
    if (meshCache.has(url)) return meshCache.get(url) ?? undefined;
    meshCache.set(url, undefined); // mark in-flight so we fetch once
    fetch(url)
        .then((r) => r.json())
        .then((json: SkinMesh) => { meshCache.set(url, json); onReady(); })
        .catch(() => { meshCache.set(url, null); onReady(); }); // failed → repaint so fallback art shows
    return undefined;
}

/** True when the mesh fetch for `url` has failed (cached null). */
export function skinMeshFailed(url: string): boolean {
    return meshCache.get(url) === null;
}

/** Axis-aligned bounds of skinned (or bind) vertices; null when empty. */
export function vertexBounds(points: [number, number][]): { minX: number; minY: number; maxX: number; maxY: number } | null {
    return JSON.parse(kernelEvaluator().skinVertexBounds(JSON.stringify(points))) as { minX: number; minY: number; maxX: number; maxY: number } | null;
}
