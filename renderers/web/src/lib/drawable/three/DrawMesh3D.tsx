'use client';
/**
 * Mesh3D — the R3F backend for `draw-mesh`, the volumetric twin of `Shape3D`.
 *
 * Geometry: one parametric primitive per `shape`, sized in cells × `cellSize`;
 * `polyhedron` builds an indexed BufferGeometry from raw `vertices`/`faces`.
 * `pivot: 'bottom'` (default) lifts the mesh by its half-height so it rests on
 * the ground plane of `position` (whose `z` is height in cells).
 * Material: data-driven kind → three material (standard/physical/toon/basic);
 * effective opacity = material × node × enclosing-group multiplier.
 * Outline: inverted hull — same geometry scaled out, unlit back-face shell.
 * Animation: per-mesh `useFrame` resolves `applyMeshAnimation` and mutates the
 * group/mesh/material refs directly — no React re-render, no host clock.
 */
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
    applyMeshAnimation,
    clampSegments,
    isAnimatedMesh,
    polyhedronBounds,
    type DrawMeshProps,
    type DrawMeshSkin,
    type MeshMaterial,
    type MeshMaterialSide,
} from '../../../components/game/atoms/DrawMesh';
import type { Projector3D } from '../projector3d';
import { isValidScenePos } from '../contract';
import { BoneRegistryContext } from './BoneRegistry';

interface MeshGeometry {
    /** Parametric geometry element (centered at the origin, three convention). */
    element?: React.JSX.Element;
    /** Imperative geometry (`polyhedron`) — owned here, disposed on replacement. */
    geometry?: THREE.BufferGeometry;
    /** World-Y offset used for `pivot: 'bottom'` grounding. */
    lift: number;
    /** Representative world size, used to scale the outline shell. */
    size: number;
    /** Shape-intrinsic orientation, composed under the descriptor's `rotation`. */
    baseRotation?: [number, number, number];
}

/** `plane`/`circle` are scene ground-plane shapes (X/Y extents in cells, 2D-path
 *  parity); three builds them in its vertical XY plane, so tip them flat, facing up. */
const GROUND_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];

/** Shared albedo-texture cache keyed by URL/`data:` URI — one GPU texture per
 *  distinct image across every mesh, mount, and canvas; never disposed (bounded
 *  by the session's distinct catalog textures). `flipY: false` honors the glTF
 *  top-left UV convention `uvs` are authored in; `RepeatWrapping` matches the
 *  glTF default sampler. */
const textureCache = new Map<string, THREE.Texture>();

function getMeshTexture(url: string): THREE.Texture {
    const cached = textureCache.get(url);
    if (cached) return cached;
    const texture = new THREE.TextureLoader().load(url);
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    textureCache.set(url, texture);
    return texture;
}

/**
 * Raw-geometry `polyhedron`: `vertices` are scene-frame `[x,y,z]` (z = up),
 * `faces` are index triples wound CCW-outward in the SCENE frame. The scene→
 * three map [x,z,y] (same axis swap as `projector3d.toWorld`) has det −1 and
 * reverses winding, so each triangle is emitted as [a,c,b]. The importer's
 * gltf→scene swap reverses once too — the two reversals cancel and glTF
 * winding reaches the GPU unchanged. Do not "simplify" either reversal away.
 */
function polyhedronGeometry(node: DrawMeshProps, cellSize: number): MeshGeometry | null {
    const verts = node.vertices;
    const faces = node.faces;
    const bounds = polyhedronBounds(verts);
    if (!verts || !bounds || !faces || faces.length === 0) return null;
    const positions = new Float32Array(verts.length * 3);
    for (let i = 0; i < verts.length; i++) {
        positions[i * 3] = verts[i][0] * cellSize;
        positions[i * 3 + 1] = verts[i][2] * cellSize;
        positions[i * 3 + 2] = verts[i][1] * cellSize;
    }
    const index: number[] = [];
    for (const face of faces) {
        if (face.length < 3) continue;
        const [a, b, c] = face;
        if (a === b || b === c || a === c) continue;
        if (![a, b, c].every((i) => Number.isInteger(i) && i >= 0 && i < verts.length)) continue;
        index.push(a, c, b);
    }
    if (index.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (node.uvs && node.uvs.length === verts.length) {
        const uv = new Float32Array(verts.length * 2);
        for (let i = 0; i < verts.length; i++) {
            uv[i * 2] = node.uvs[i][0];
            uv[i * 2 + 1] = node.uvs[i][1];
        }
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const skin = node.skin;
    if (skin && skin.indices.length === verts.length && skin.weights.length === verts.length) {
        const skinIndex = new Uint16Array(verts.length * 4);
        const skinWeight = new Float32Array(verts.length * 4);
        for (let i = 0; i < verts.length; i++) {
            for (let k = 0; k < 4; k++) {
                skinIndex[i * 4 + k] = skin.indices[i][k] ?? 0;
                skinWeight[i * 4 + k] = skin.weights[i][k] ?? 0;
            }
        }
        geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
        geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    }
    const size = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) * cellSize;
    return { geometry, lift: -bounds.min[2] * cellSize, size };
}

/** Build the primitive geometry for a mesh descriptor. Sizes are cells × `cellSize`. */
function meshGeometry(node: DrawMeshProps, cellSize: number): MeshGeometry | null {
    const seg = clampSegments(node.segments);
    const r = (node.radius ?? 0.4) * cellSize;
    const w = (node.width ?? 1) * cellSize;
    const h = (node.height ?? 1) * cellSize;
    const d = (node.depth ?? node.width ?? 1) * cellSize;
    switch (node.shape) {
        case 'box':
            return { element: <boxGeometry args={[w, h, d]} />, lift: h / 2, size: Math.max(w, h, d) };
        case 'sphere':
            return { element: <sphereGeometry args={[r, seg, seg]} />, lift: r, size: r * 2 };
        case 'capsule':
            return { element: <capsuleGeometry args={[r, h, Math.max(2, Math.round(seg / 2)), seg]} />, lift: h / 2 + r, size: h + r * 2 };
        case 'cylinder':
            return {
                element: <cylinderGeometry args={[(node.radiusTop ?? node.radius ?? 0.4) * cellSize, (node.radiusBottom ?? node.radius ?? 0.4) * cellSize, h, seg]} />,
                lift: h / 2,
                size: Math.max(h, r * 2),
            };
        case 'cone':
            return { element: <coneGeometry args={[r, h, seg]} />, lift: h / 2, size: Math.max(h, r * 2) };
        case 'torus': {
            const tube = (node.tube ?? (node.radius ?? 0.4) / 3) * cellSize;
            return { element: <torusGeometry args={[r, tube, Math.max(3, Math.round(seg / 2)), seg]} />, lift: r + tube, size: (r + tube) * 2 };
        }
        case 'plane':
            return { element: <planeGeometry args={[w, d]} />, lift: 0, size: Math.max(w, d), baseRotation: GROUND_ROTATION };
        case 'circle':
            return { element: <circleGeometry args={[r, seg]} />, lift: 0, size: r * 2, baseRotation: GROUND_ROTATION };
        case 'polyhedron':
            return polyhedronGeometry(node, cellSize);
        default:
            return null;
    }
}

let warnedPolyhedronOutline = false;

const SIDE_MAP: Record<MeshMaterialSide, THREE.Side> = {
    front: THREE.FrontSide,
    back: THREE.BackSide,
    double: THREE.DoubleSide,
};

type MeshMaterialRef = React.Ref<THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number }>;

/** Material element for a mesh descriptor; `opacity` is the pre-multiplied effective value. */
function meshMaterial(mat: MeshMaterial | undefined, opacity: number, ref?: MeshMaterialRef): React.JSX.Element {
    const m = mat ?? {};
    const common = {
        ref,
        color: m.color ?? '#ffffff',
        transparent: opacity < 1,
        opacity,
        side: SIDE_MAP[m.side ?? 'front'],
        ...(m.map ? { map: getMeshTexture(m.map) } : {}),
    };
    const emissive = m.emissive
        ? { emissive: m.emissive, emissiveIntensity: m.emissiveIntensity ?? 1 }
        : {};
    switch (m.kind ?? 'standard') {
        case 'basic':
            return <meshBasicMaterial {...common} />;
        case 'toon':
            return <meshToonMaterial {...common} {...emissive} />;
        case 'physical':
            return (
                <meshPhysicalMaterial
                    {...common}
                    {...emissive}
                    metalness={m.metalness ?? 0}
                    roughness={m.roughness ?? 0.5}
                    transmission={m.transmission ?? 0}
                    ior={m.ior ?? 1.5}
                    flatShading={m.flatShading ?? false}
                />
            );
        case 'standard':
        default:
            return (
                <meshStandardMaterial
                    {...common}
                    {...emissive}
                    metalness={m.metalness ?? 0}
                    roughness={m.roughness ?? 0.5}
                    flatShading={m.flatShading ?? false}
                />
            );
    }
}

/**
 * Skinned polyhedron backend: a `THREE.SkinnedMesh` bound with an IDENTITY bind
 * matrix to the named bone groups — in 'attached' bind mode the mesh's own
 * transform cancels, so the bones alone place every vertex and the unit's
 * root-group motion carries the surface automatically. Binds once all
 * `skin.bones` names are registered; re-checks on every registry change.
 */
function SkinnedPolyhedron3D({
    node,
    skin,
    geometry,
    cellSize,
    opacity,
}: {
    node: DrawMeshProps;
    skin: DrawMeshSkin;
    geometry: THREE.BufferGeometry;
    cellSize: number;
    opacity: number;
}): React.JSX.Element {
    const boneStore = useContext(BoneRegistryContext);
    const meshRef = useRef<THREE.SkinnedMesh>(null);
    const [registryTick, setRegistryTick] = useState(0);

    useEffect(() => boneStore?.subscribe(() => setRegistryTick((t) => t + 1)), [boneStore]);

    useEffect(() => {
        const mesh = meshRef.current;
        if (!mesh || !boneStore) return;
        const bones: THREE.Bone[] = [];
        for (const name of skin.bones) {
            const bone = boneStore.get(name);
            if (!bone) return;
            bones.push(bone);
        }
        if (mesh.skeleton && mesh.skeleton.bones.length === bones.length && mesh.skeleton.bones.every((b, i) => b === bones[i])) return;
        if (skin.inverseBindMatrices.length !== bones.length) return;
        const inverses = skin.inverseBindMatrices.map((m) => {
            const mat = new THREE.Matrix4().fromArray(m);
            // IBM translations are authored in cells, like vertices — scale to world.
            mat.elements[12] *= cellSize;
            mat.elements[13] *= cellSize;
            mat.elements[14] *= cellSize;
            return mat;
        });
        mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
    }, [registryTick, skin, boneStore, geometry, cellSize]);

    useEffect(() => {
        const mesh = meshRef.current;
        return () => mesh?.skeleton?.dispose();
    }, []);

    return (
        <skinnedMesh
            ref={meshRef}
            geometry={geometry}
            frustumCulled={false}
            castShadow={node.castShadow ?? true}
            receiveShadow={node.receiveShadow ?? true}
        >
            {meshMaterial(node.material, opacity)}
        </skinnedMesh>
    );
}

/** R3F mesh backend for `draw-mesh`: a lit parametric primitive at a scene position. */
export function Mesh3D({
    node,
    projector,
    groupOpacity = 1,
}: {
    node: DrawMeshProps;
    projector: Projector3D;
    groupOpacity?: number;
}): React.JSX.Element | null {
    const groupRef = useRef<THREE.Group>(null);
    const meshRef = useRef<THREE.Mesh>(null);
    const materialRef = useRef<THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number }>(null);
    const animated = isAnimatedMesh(node);
    const validPos = isValidScenePos(node.position);
    const baseWorld: [number, number, number] = validPos ? projector.toWorld(node.position) : [0, 0, 0];

    const geo = useMemo(() => meshGeometry(node, projector.cellSize), [node, projector.cellSize]);

    // R3F only auto-disposes JSX-created objects; the imperative polyhedron
    // geometry is rebuilt whenever the descriptor identity changes and must be
    // released by hand or its GPU buffers accumulate.
    useEffect(() => {
        const g = geo?.geometry;
        return () => g?.dispose();
    }, [geo]);

    useFrame(({ clock }) => {
        if (!animated || !groupRef.current) return;
        const state = applyMeshAnimation(node, clock.elapsedTime * 1000);
        if (!state) return;
        const [wx, wy, wz] = baseWorld;
        // Scene-axis offsets project like ScenePos: x → world X, y → world Z, z → world Y.
        groupRef.current.position.set(
            wx + state.offset[0] * projector.cellSize,
            wy + state.offset[2] * projector.cellSize,
            wz + state.offset[1] * projector.cellSize,
        );
        groupRef.current.scale.setScalar(state.scale);
        if (meshRef.current) {
            const shapeRot = geo?.baseRotation ?? [0, 0, 0];
            const base = node.rotation ?? [0, 0, 0];
            meshRef.current.rotation.set(
                shapeRot[0] + base[0] + state.rotate[0],
                shapeRot[1] + base[1] + state.rotate[1],
                shapeRot[2] + base[2] + state.rotate[2],
            );
        }
        const mat = materialRef.current;
        if (mat) {
            const effective =
                (state.opacity ?? node.opacity ?? 1) * (node.material?.opacity ?? 1) * groupOpacity;
            mat.opacity = effective;
            mat.transparent = effective < 1;
            if (state.color && mat.color) mat.color.set(state.color);
            if (state.emissive && mat.emissive) mat.emissive.set(state.emissive);
            if (state.emissiveIntensity !== undefined && mat.emissiveIntensity !== undefined) {
                mat.emissiveIntensity = state.emissiveIntensity;
            }
        }
    });

    if (!validPos || !geo) return null;
    const lift = (node.pivot ?? 'bottom') === 'bottom' ? geo.lift : 0;
    const opacity = (node.opacity ?? 1) * (node.material?.opacity ?? 1) * groupOpacity;
    if (node.skin && geo.geometry) {
        return (
            <group position={baseWorld}>
                <SkinnedPolyhedron3D node={node} skin={node.skin} geometry={geo.geometry} cellSize={projector.cellSize} opacity={opacity} />
            </group>
        );
    }
    const nodeRotation = node.rotation ?? [0, 0, 0];
    const shapeRotation = geo.baseRotation ?? [0, 0, 0];
    const rotation: [number, number, number] = [
        shapeRotation[0] + nodeRotation[0],
        shapeRotation[1] + nodeRotation[1],
        shapeRotation[2] + nodeRotation[2],
    ];
    const outlineScale = geo.size > 0 ? 1 + ((node.outline?.width ?? 0.05) * projector.cellSize) / geo.size : 1;
    // The uniform-scale hull assumes origin-centered geometry; a polyhedron's
    // hull would drift. The faithful mechanism is a normal-displacement shell.
    if (node.outline && geo.geometry && !warnedPolyhedronOutline) {
        warnedPolyhedronOutline = true;
        console.warn('[draw-mesh] outline is not yet supported on shape "polyhedron" — skipped');
    }
    const geometryProp = geo.geometry ? { geometry: geo.geometry } : {};

    return (
        <group ref={groupRef} position={baseWorld}>
            <mesh
                ref={meshRef}
                {...geometryProp}
                position={[0, lift, 0]}
                rotation={rotation}
                castShadow={node.castShadow ?? true}
                receiveShadow={node.receiveShadow ?? true}
            >
                {geo.element}
                {meshMaterial(node.material, opacity, materialRef)}
            </mesh>
            {node.outline && !geo.geometry && (
                <mesh position={[0, lift, 0]} rotation={rotation} scale={outlineScale}>
                    {geo.element}
                    <meshBasicMaterial
                        color={node.outline.color ?? '#101014'}
                        side={THREE.BackSide}
                        transparent={opacity < 1}
                        opacity={opacity}
                    />
                </mesh>
            )}
        </group>
    );
}

export default Mesh3D;
