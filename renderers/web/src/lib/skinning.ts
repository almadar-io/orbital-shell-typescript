/**
 * skinning — pure 2D skeletal mesh deformation (linear blend skinning).
 *
 * A skinned mesh is a bind-pose triangle mesh whose vertices carry bone weights;
 * a pose rotates each bone about its own pivot (degrees, relative to bind) and
 * every vertex follows as a weighted blend of its bones' transforms. Bones form
 * an FK chain by `parent` name: a child's world transform composes its parent's,
 * so rotating a limb root swings the whole chain while a child still rotates
 * about its own pivot. DOM-free, React-free — the drawables that paint a skinned
 * mesh (and their hit tests) import the math from here.
 *
 * Convention: all coordinates (pivots, tips, vertex x/y) live in ONE shared
 * local space (the drawable's world-unit space); `u`/`v` are normalized 0..1
 * texture coordinates. The bind pose is `pose = {}` (every angle 0).
 */

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

const IDENTITY: Affine2D = [1, 0, 0, 1, 0, 0];

/** `a ∘ b` — apply `b` first, then `a`. */
export function composeAffine(a: Affine2D, b: Affine2D): Affine2D {
    return [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
    ];
}

export function invertAffine(m: Affine2D): Affine2D {
    const det = m[0] * m[3] - m[1] * m[2];
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return IDENTITY;
    const inv = 1 / det;
    return [
        m[3] * inv,
        -m[1] * inv,
        -m[2] * inv,
        m[0] * inv,
        (m[2] * m[5] - m[3] * m[4]) * inv,
        (m[1] * m[4] - m[0] * m[5]) * inv,
    ];
}

export function applyAffine(m: Affine2D, x: number, y: number): [number, number] {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Rotation of `degrees` about `pivot`. */
function rotationAbout(pivot: [number, number], degrees: number): Affine2D {
    const r = (degrees * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const [px, py] = pivot;
    return [cos, sin, -sin, cos, px - cos * px + sin * py, py - sin * px - cos * py];
}

/**
 * World matrix per bone (index-aligned with `bones`), FK-composed down the
 * parent chain: `world(b) = world(parent) ∘ rotationAbout(pivot_b, pose[b])`.
 * Roots compose onto the identity, so `computeWorldMatrices(bones, {})` yields
 * the bind pose (identity per bone). An unknown parent name is treated as a
 * root — a malformed hierarchy degrades to a detached bone, never a throw.
 */
export function computeWorldMatrices(bones: BoneDef[], pose: Pose): Affine2D[] {
    const indexByName = new Map<string, number>();
    bones.forEach((b, i) => indexByName.set(b.name, i));
    const world: (Affine2D | undefined)[] = new Array<Affine2D | undefined>(bones.length);
    const visiting = new Set<number>();
    const resolve = (i: number): Affine2D => {
        const cached = world[i];
        if (cached) return cached;
        if (visiting.has(i)) return IDENTITY; // parent cycle — detach, never recurse forever
        visiting.add(i);
        const b = bones[i];
        const parentIndex = b.parent === null ? undefined : indexByName.get(b.parent);
        const parentWorld = parentIndex === undefined ? IDENTITY : resolve(parentIndex);
        const local = rotationAbout(b.pivot, pose[b.name] ?? 0);
        const m = composeAffine(parentWorld, local);
        visiting.delete(i);
        world[i] = m;
        return m;
    };
    return bones.map((_, i) => resolve(i));
}

/**
 * Linear blend skinning: `v' = Σ wᵢ · (curWorldᵢ ∘ bindWorldᵢ⁻¹) · v`. Weights
 * are used as authored (exporters normalize); a vertex with no weights stays put.
 */
export function skinVertices(mesh: SkinMesh, bindWorld: Affine2D[], curWorld: Affine2D[]): [number, number][] {
    const skinMats = new Map<number, Affine2D>();
    const skinMat = (bone: number): Affine2D => {
        let m = skinMats.get(bone);
        if (!m) {
            m = composeAffine(curWorld[bone] ?? IDENTITY, invertAffine(bindWorld[bone] ?? IDENTITY));
            skinMats.set(bone, m);
        }
        return m;
    };
    return mesh.vertices.map((v) => {
        if (v.weights.length === 0) return [v.x, v.y];
        let x = 0;
        let y = 0;
        for (const { bone, w } of v.weights) {
            const [bx, by] = applyAffine(skinMat(bone), v.x, v.y);
            x += w * bx;
            y += w * by;
        }
        return [x, y];
    });
}

/**
 * Affine mapping one triangle onto another: returns the `Affine2D` with
 * `dstᵢ = M · srcᵢ`, or `null` when the source triangle is degenerate
 * (zero area — no unique map). Used to map a UV triangle to its painted
 * destination for textured triangle blits.
 */
export function triangleAffine(
    src: [[number, number], [number, number], [number, number]],
    dst: [[number, number], [number, number], [number, number]],
): Affine2D | null {
    const [s0, s1, s2] = src;
    const det = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
    const [d0, d1, d2] = dst;
    const a = (d0[0] * (s1[1] - s2[1]) + d1[0] * (s2[1] - s0[1]) + d2[0] * (s0[1] - s1[1])) / det;
    const c = (d0[0] * (s2[0] - s1[0]) + d1[0] * (s0[0] - s2[0]) + d2[0] * (s1[0] - s0[0])) / det;
    const e =
        (d0[0] * (s1[0] * s2[1] - s2[0] * s1[1]) +
            d1[0] * (s2[0] * s0[1] - s0[0] * s2[1]) +
            d2[0] * (s0[0] * s1[1] - s1[0] * s0[1])) /
        det;
    const b = (d0[1] * (s1[1] - s2[1]) + d1[1] * (s2[1] - s0[1]) + d2[1] * (s0[1] - s1[1])) / det;
    const d = (d0[1] * (s2[0] - s1[0]) + d1[1] * (s0[0] - s2[0]) + d2[1] * (s1[0] - s0[0])) / det;
    const f =
        (d0[1] * (s1[0] * s2[1] - s2[0] * s1[1]) +
            d1[1] * (s2[0] * s0[1] - s0[0] * s2[1]) +
            d2[1] * (s0[0] * s1[1] - s1[0] * s0[1])) /
        det;
    return [a, b, c, d, e, f];
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
    if (points.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of points) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
}
