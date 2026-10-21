'use client';
/**
 * `draw-skinned-mesh` — the skeletal-mesh drawable atom: a bind-pose triangle
 * mesh deformed by linear blend skinning and painted per-triangle from a texture.
 *
 * The general-purpose primitive for animated 2D characters (puppet rigs): a pose
 * rotates each bone about its pivot (degrees, relative to bind), `lib/skinning`
 * computes the deformed vertices, and each triangle is blit through the affine
 * mapping its UV tri → its painted tri (clipped to the tri, so seams don't bleed).
 * Mesh + bones + UVs come from the bundle exporter (inline `mesh` or a fetched
 * `meshUrl`); animation is `clip.frames[frame % len]`, driven by the host like
 * any other drawable frame counter. `weightsOverlay` swaps the texture for a
 * per-bone categorical fill (rig inspection); `ghost` paints an onion-skin pass
 * of another clip frame underneath. The React component renders `null` (the host
 * paints it); it exists so the pattern pipeline registers a `draw-skinned-mesh`
 * pattern and JSX children register through the drawable registry.
 */
import type React from 'react';
import { useContext } from 'react';
import type { Asset, ScenePos } from '@almadar/core';
import { createLogger } from '@almadar/logger';
import type { Painter2D, TextureHandle } from '../../../lib/painter2d';
import { getImageStatus } from '../../../lib/imageCache';
import type { DrawableBase, DrawContext, PaintFn } from '../../../lib/drawable/contract';
import { isValidScenePos } from '../../../lib/drawable/contract';
import { DrawableRegistryContext } from '../../../lib/drawable/registry';
import type { BoneDef, Pose, RigBundle, SkinMesh, SkinVertex } from '../../../lib/skinning';
import { computeWorldMatrices, getRigBundle, isRigBundle, skinMeshFailed, skinVertices, triangleAffine } from '../../../lib/skinning';

const skinnedLog = createLogger('almadar:ui:draw-skinned-mesh');
const loggedMissing = new Set<string>();

function warnMissingOnce(reason: 'texture-failed' | 'mesh-failed' | 'mesh-missing', node: DrawSkinnedMeshProps): void {
    const key = `${reason}:${node.asset.url}:${String(node.meshUrl)}`;
    if (loggedMissing.has(key)) return;
    loggedMissing.add(key);
    skinnedLog.warn('draw-skinned-mesh unresolvable — painting fallback', { reason, url: node.asset.url, meshUrl: node.meshUrl });
}

/** Categorical per-bone palette for `weightsOverlay` (dominant bone index → hue). */
const WEIGHT_PALETTE = Array.from({ length: 10 }, (_, i) => `hsl(${(i * 36) % 360}, 70%, 55%)`);

/** Dominant bone of a vertex (its largest weight); -1 when unweighted. */
function dominantBone(v: SkinVertex): number {
    let best = -1;
    let bestW = 0;
    for (const { bone, w } of v.weights) {
        if (w > bestW) {
            bestW = w;
            best = bone;
        }
    }
    return best;
}

/** Resolve the effective pose: an explicit clip frame wins, then `pose`, else bind. */
export function resolveSkinPose(node: DrawSkinnedMeshProps, clip?: { frames: Pose[] }): Pose {
    const effectiveClip = clip ?? node.clip;
    if (effectiveClip && node.frame !== undefined && effectiveClip.frames.length > 0) {
        return effectiveClip.frames[node.frame % effectiveClip.frames.length];
    }
    return node.pose ?? {};
}

export interface DrawSkinnedMeshProps extends DrawableBase {
    type: 'draw-skinned-mesh';
    /** Logical scene position; mesh local coords are world units relative to its projected top-left. */
    position: ScenePos;
    /** The texture the mesh UVs cut into. */
    asset: Asset;
    /** Inline bind mesh; wins over `meshUrl`. */
    mesh?: SkinMesh;
    /** URL of a JSON `SkinMesh` (fetched + cached); used when `mesh` is absent. */
    meshUrl?: string;
    /** The skeleton (bind pose; FK chain via `parent` names). Falls back to the rigbundle's `bones` when empty. */
    bones: BoneDef[];
    /** Static pose (bone name → degrees relative to bind). Overridden by `clip` + `frame`. */
    pose?: Pose;
    /** Pose animation clip; with `frame`, pose = `frames[frame % frames.length]`. */
    clip?: { frames: Pose[] };
    /** Named clip inside the rigbundle at `meshUrl` (`clips[clipName].frames`); used when `clip` is absent. Empty/unknown = no clip. */
    clipName?: string;
    /** Clip frame counter (host-driven paint clock frame). */
    frame?: number;
    /** 0..1 opacity. */
    opacity?: number;
    /** Paint per-triangle dominant-bone colors instead of the texture (rig inspection). */
    weightsOverlay?: boolean;
    /** Onion skin: render the mesh at this clip frame underneath, at this opacity. */
    ghost?: { frame: number; opacity: number };
}

/** The drawable's effective rig: mesh + skeleton + clip, with the rigbundle at `meshUrl` as fallback source. */
interface ResolvedRig {
    mesh: SkinMesh;
    bones: BoneDef[];
    clip?: { frames: Pose[] };
}

/** Resolve the descriptor's rig (inline props win; a rigbundle at `meshUrl` supplies `mesh`/`bones`/`clips[clipName]`). Undefined while a fetch is in-flight. */
function resolveRig(node: DrawSkinnedMeshProps, dctx: DrawContext): ResolvedRig | undefined {
    const fetched = node.meshUrl ? getRigBundle(node.meshUrl, dctx.invalidate) : undefined;
    if (node.meshUrl && fetched === undefined) return undefined; // in-flight (failure surfaced by the caller)
    const rb: RigBundle | undefined = fetched && isRigBundle(fetched) ? fetched : undefined;
    const mesh = node.mesh ?? rb?.mesh ?? (!rb ? (fetched as SkinMesh | undefined) : undefined);
    if (!mesh) return undefined;
    const bones = node.bones.length > 0 ? node.bones : rb?.bones ?? [];
    if (bones.length === 0) return undefined;
    const clip = node.clip ?? (node.clipName ? rb?.clips?.[node.clipName] : undefined);
    return { mesh, bones, clip };
}

/** Per-mesh UV-space memo: true when the mesh's u/v are texture PIXELS (exporter
 * bundles) rather than the SkinVertex contract's normalized 0..1. */
const pixelUVByMesh = new WeakMap<SkinMesh, boolean>();

/** Detect pixel-space UVs: any coordinate outside 0..1 means the mesh is authored in texture px. */
function meshHasPixelUVs(mesh: SkinMesh): boolean {
    const cached = pixelUVByMesh.get(mesh);
    if (cached !== undefined) return cached;
    let pixel = false;
    for (const v of mesh.vertices) {
        if (v.u < 0 || v.u > 1 || v.v < 0 || v.v > 1) { pixel = true; break; }
    }
    pixelUVByMesh.set(mesh, pixel);
    return pixel;
}

/** Paint one posed pass of the mesh. Never throws. */
function paintMeshPass(
    painter: Painter2D,
    node: DrawSkinnedMeshProps,
    bones: BoneDef[],
    mesh: SkinMesh,
    tex: TextureHandle | null,
    dctx: DrawContext,
    pose: Pose,
    opacity: number,
): void {
    const bindWorld = computeWorldMatrices(bones, {});
    const curWorld = computeWorldMatrices(bones, pose);
    const skinned = skinVertices(mesh, bindWorld, curWorld);
    const origin = dctx.projector.project(node.position);
    const tw = dctx.projector.tileWidth;

    painter.save();
    if (opacity !== 1) painter.setAlpha(opacity);
    for (const [i0, i1, i2] of mesh.triangles) {
        const v0 = mesh.vertices[i0];
        const v1 = mesh.vertices[i1];
        const v2 = mesh.vertices[i2];
        const p0 = skinned[i0];
        const p1 = skinned[i1];
        const p2 = skinned[i2];
        if (!v0 || !v1 || !v2 || !p0 || !p1 || !p2) continue;
        const dst: [[number, number], [number, number], [number, number]] = [
            [origin.x + p0[0] * tw, origin.y + p0[1] * tw],
            [origin.x + p1[0] * tw, origin.y + p1[1] * tw],
            [origin.x + p2[0] * tw, origin.y + p2[1] * tw],
        ];
        if (node.weightsOverlay || !tex) {
            if (!node.weightsOverlay) continue;
            const bone = dominantBone(v0);
            painter.fillPoly(
                dst.map(([x, y]) => ({ x, y })),
                WEIGHT_PALETTE[((bone % WEIGHT_PALETTE.length) + WEIGHT_PALETTE.length) % WEIGHT_PALETTE.length],
            );
            continue;
        }
        const pixelUV = meshHasPixelUVs(mesh);
        const uv: [[number, number], [number, number], [number, number]] = pixelUV
            ? [[v0.u, v0.v], [v1.u, v1.v], [v2.u, v2.v]]
            : [
                [v0.u * tex.width, v0.v * tex.height],
                [v1.u * tex.width, v1.v * tex.height],
                [v2.u * tex.width, v2.v * tex.height],
            ];
        const affine = triangleAffine(uv, dst);
        if (!affine) continue; // degenerate UV tri — no unique map
        painter.save();
        painter.clipPath(`M ${dst[0][0]} ${dst[0][1]} L ${dst[1][0]} ${dst[1][1]} L ${dst[2][0]} ${dst[2][1]} Z`);
        painter.blitTransformed(tex, { x: 0, y: 0, w: tex.width, h: tex.height }, affine);
        painter.restore();
    }
    painter.restore();
}

/** Paint a {@link DrawSkinnedMeshProps}: ghost pass first (underneath), then the
 *  live pose. Renders nothing while a resource is in-flight; warns + paints
 *  nothing-but-logged on definitive failure — never throws. */
export const paintSkinnedMesh: PaintFn<DrawSkinnedMeshProps> = (painter, node, dctx) => {
    if (!isValidScenePos(node.position)) return;
    const rig = resolveRig(node, dctx);
    if (!rig) {
        if (node.meshUrl && skinMeshFailed(node.meshUrl)) warnMissingOnce('mesh-failed', node);
        else if (!node.mesh && !node.meshUrl) warnMissingOnce('mesh-missing', node);
        return; // mesh in-flight or absent
    }
    const tex = node.weightsOverlay ? null : painter.resolveTexture(node.asset.url);
    if (!node.weightsOverlay && !tex) {
        if (getImageStatus(node.asset.url) === 'failed') warnMissingOnce('texture-failed', node);
        return; // texture in-flight
    }
    if (node.ghost && rig.clip && rig.clip.frames.length > 0) {
        paintMeshPass(painter, node, rig.bones, rig.mesh, tex, dctx, rig.clip.frames[node.ghost.frame % rig.clip.frames.length], node.ghost.opacity);
    }
    paintMeshPass(painter, node, rig.bones, rig.mesh, tex, dctx, resolveSkinPose(node, rig.clip), node.opacity ?? 1);
};

/** Registry/standalone stub — the host paints this atom; the DOM renders nothing.
 *  When composed as a React child of a draw-host (Canvas2D), registers its
 *  descriptor via context so the host paints it. */
export function DrawSkinnedMesh(props: DrawSkinnedMeshProps): React.JSX.Element | null {
    const register = useContext(DrawableRegistryContext);
    if (register) register({ ...props, type: 'draw-skinned-mesh' });
    return null;
}

export default DrawSkinnedMesh;
