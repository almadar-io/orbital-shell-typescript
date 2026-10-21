'use client';
/**
 * Drawable3D — the R3F dispatcher for neutral drawable descriptors.
 *
 * The 3D twin of `paintDrawable`: given ONE descriptor, it renders the matching
 * R3F element (mesh/billboard). ⚠ R3F throws if a plain descriptor object reaches
 * `<group>{children}` — the host must ALWAYS map descriptors through THIS
 * component first, never pass raw `DrawableNode`s as children. Consumes the same
 * `DrawSpriteProps`/`DrawShapeProps`/`DrawTextProps`/`DrawMeshProps` descriptors
 * as the 2D paint dispatch — that is what makes canvas-2d and canvas-3d the same
 * `children` interface.
 *
 * `draw-group` maps to a three `<group>`: items are group-LOCAL (their positions
 * project through an origin-anchored projector so the host's bounds anchor is not
 * applied twice), `rotate` is ground-plane yaw (negated — 2D screen rotation is
 * clockwise-positive under y-down, world-Y yaw is CCW-positive) while `rotation`
 * is a raw per-axis Euler (same convention as `draw-mesh`), and `opacity`
 * accumulates down into every leaf material. A group placed at a joint with
 * `rotation` + `animation` (transform tracks, `useFrame` ref mutation — same
 * engine as `draw-mesh`) is a skeleton BONE: children inherit the rotation, so
 * nested groups form joint chains. The opacity track is 2D-only at group level
 * (leaf materials would need a re-render); animate leaf mesh opacity instead.
 * `clip` has no faithful three mapping (SVG-path masks) — skipped with a
 * one-time warn.
 */
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { create3DProjector, type Projector3D } from '../projector3d';
import { BoneRegistryContext, BoneStore } from './BoneRegistry';
import type { DrawableNode } from '../paintDispatch';
import { isValidScenePos } from '../contract';
import { isAnimatedGroup, type DrawGroupProps } from '../../../components/game/atoms/DrawGroup';
import { applyMeshAnimation } from '../../../components/game/atoms/DrawMesh';
import { expandFxLayer, type DrawFxLayerProps } from '../../../components/game/molecules/DrawFxLayer';
import { Sprite3D, Shape3D, Text3D, warnUnsupported3d } from './mesh3d';
import { Mesh3D } from './DrawMesh3D';

export interface Drawable3DProps {
    node: DrawableNode;
    projector: Projector3D;
    /** Accumulated enclosing `draw-group` opacity, multiplied into leaf materials. */
    groupOpacity?: number;
}

export function Drawable3D({ node, projector, groupOpacity = 1 }: Drawable3DProps): React.JSX.Element | null {
    const rendered = ((): React.JSX.Element | null => {
        switch (node.type) {
            case 'draw-sprite':
                return <Sprite3D node={node} projector={projector} groupOpacity={groupOpacity} />;
            case 'draw-shape':
                return <Shape3D node={node} projector={projector} groupOpacity={groupOpacity} />;
            case 'draw-text':
                return <Text3D node={node} projector={projector} groupOpacity={groupOpacity} />;
            case 'draw-mesh':
                return <Mesh3D node={node} projector={projector} groupOpacity={groupOpacity} />;
            case 'draw-sprite-layer':
                return (
                    <>
                        {node.items.map((item, i) => (
                            <Sprite3D key={i} node={item} projector={projector} groupOpacity={groupOpacity} />
                        ))}
                    </>
                );
            case 'draw-shape-layer':
                return (
                    <>
                        {node.items.map((item, i) => (
                            <Shape3D key={i} node={item} projector={projector} groupOpacity={groupOpacity} />
                        ))}
                    </>
                );
            case 'draw-text-layer':
                return (
                    <>
                        {node.items.map((item, i) => (
                            <Text3D key={i} node={item} projector={projector} groupOpacity={groupOpacity} />
                        ))}
                    </>
                );
            case 'draw-group': {
                if (!isValidScenePos(node.position) || !Array.isArray(node.items)) return null;
                if (node.clip) warnUnsupported3d('draw-group:clip');
                return <Group3D node={node} projector={projector} groupOpacity={groupOpacity} />;
            }
            case 'draw-fx-layer':
                return <FxLayer3D node={node} projector={projector} groupOpacity={groupOpacity} />;
            case 'draw-skinned-mesh':
                // CPU-posed 2D drawable; 3D skinning is `draw-mesh` + `skin` (DrawMesh3D).
                warnUnsupported3d('draw-skinned-mesh');
                return null;
        }
    })();
    // A tagged descriptor stamps its id on the scene graph so the host's mesh
    // raycast resolves a click to this drawable (nearest tagged ancestor wins).
    return node.id ? <group userData={{ drawableId: node.id }}>{rendered}</group> : rendered;
}

/** Three `<group>` backend for `draw-group` — the skeleton bone. `rotation` is
 *  a raw Euler; without it, `rotate` keeps its negated ground-plane-yaw meaning.
 *  Animation mutates the group ref per frame (transform tracks only). */
function Group3D({
    node,
    projector,
    groupOpacity,
}: {
    node: DrawGroupProps;
    projector: Projector3D;
    groupOpacity: number;
}): React.JSX.Element {
    const ref = useRef<THREE.Group>(null);
    const animated = isAnimatedGroup(node);
    const world = projector.toWorld(node.position);
    const inner = create3DProjector({ cellSize: projector.cellSize });
    const opacity = (node.opacity ?? 1) * groupOpacity;
    const s = node.scale ?? 1;
    const baseRotation: [number, number, number] = node.rotation ?? [0, -(node.rotate ?? 0), 0];

    // A named group is a skeleton bone: mount a real THREE.Bone with identity
    // local transform (it rides this group's world matrix) and register it so
    // skinned meshes can bind to it by name. A `skeleton: true` group opens a
    // fresh scope, so multiple instances of one rig never collide.
    const parentStore = useContext(BoneRegistryContext);
    const scopedStore = useMemo(() => (node.skeleton ? new BoneStore() : null), [node.skeleton]);
    const boneStore = scopedStore ?? parentStore;
    const boneObject = useMemo(() => (node.bone ? new THREE.Bone() : null), [node.bone]);
    useEffect(() => {
        if (!node.bone || !boneStore || !boneObject) return;
        return boneStore.register(node.bone, boneObject);
    }, [node.bone, boneStore, boneObject]);

    useFrame(({ clock }) => {
        if (!animated || !ref.current) return;
        const state = applyMeshAnimation(node, clock.elapsedTime * 1000);
        if (!state) return;
        const cell = projector.cellSize;
        // Scene-axis offsets project like ScenePos: x → world X, y → world Z, z → world Y.
        ref.current.position.set(
            world[0] + state.offset[0] * cell,
            world[1] + state.offset[2] * cell,
            world[2] + state.offset[1] * cell,
        );
        ref.current.rotation.set(
            baseRotation[0] + state.rotate[0],
            baseRotation[1] + state.rotate[1],
            baseRotation[2] + state.rotate[2],
        );
        ref.current.scale.setScalar(s * state.scale);
    });

    const children = (
        <group ref={ref} position={world} rotation={baseRotation} scale={[s, s, s]}>
            {boneObject && <primitive object={boneObject} />}
            {node.items.map((item, i) => (
                <Drawable3D key={i} node={item} projector={inner} groupOpacity={opacity} />
            ))}
        </group>
    );
    return scopedStore ? <BoneRegistryContext.Provider value={scopedStore}>{children}</BoneRegistryContext.Provider> : children;
}

/** R3F backend for `draw-fx-layer` — re-expands each frame while fx are live.
 *  Fx entries are few and short-lived, so a state-driven per-frame re-render is
 *  the honest MVP; the expanded descriptors ride the normal Drawable3D dispatch
 *  (Text3D billboards for messages, Shape3D ellipses whose `lighter`-bright
 *  colors glow under an authored `post: {bloom}` with zero extra passes). */
function FxLayer3D({
    node,
    projector,
    groupOpacity,
}: {
    node: DrawFxLayerProps;
    projector: Projector3D;
    groupOpacity: number;
}): React.JSX.Element | null {
    const [, setFrame] = useState(0);
    const live = Array.isArray(node.items) && node.items.length > 0;
    useFrame(() => {
        if (live) setFrame((f) => (f + 1) % 1000000);
    });
    if (!live) return null;
    const epochNow = typeof performance !== 'undefined' ? performance.timeOrigin + performance.now() : 0;
    const children = expandFxLayer(node, epochNow, '3d', undefined, undefined);
    return (
        <>
            {children.map((c, i) => (
                <Drawable3D key={i} node={c} projector={projector} groupOpacity={groupOpacity} />
            ))}
        </>
    );
}

export default Drawable3D;
