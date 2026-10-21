'use client';
/**
 * `draw-group` — the drawable CONTAINER atom (dimension-agnostic).
 *
 * Multi-shape art (a hero token = cloak + head + sword shapes) travels as ONE
 * node: the host paints the group by translating to its projected position,
 * applying `scale`/`rotate`/`opacity`, then painting each `items` descriptor
 * through the normal dispatch. `items` is a plain data prop (NOT `children`,
 * which UISlotRenderer special-cases) — same convention as the `draw-*-layer`
 * molecules. The React component renders `null`; it exists so the pattern
 * pipeline registers a `draw-group` pattern and standalone pages stay
 * inspectable. Both backends paint it: 2D as a canvas transform, 3D as a three
 * `<group>` — with `rotation` + `animation` a nested group chain is a skeleton
 * bone chain (rotate the shoulder group and the forearm group follows).
 */
import type React from 'react';
import { useContext } from 'react';
import type { ScenePos } from '@almadar/core';
import type { DrawableBase } from '../../../lib/drawable/contract';
import type { DrawableNode } from '../../../lib/drawable/paintDispatch';
import type { DrawMeshAnimation } from './DrawMesh';
import { DrawableRegistryContext } from '../../../lib/drawable/registry';

export interface DrawGroupProps extends DrawableBase {
    type: 'draw-group';
    /** Logical scene position; the projector maps it to pixels / world. */
    position: ScenePos;
    /** Uniform scale applied to the whole group. */
    scale?: number;
    /** Rotation in radians (painter units). */
    rotate?: number;
    /** Euler rotation `[x, y, z]` in radians (world axes) — per-axis joint rotation for the 3D backend; a group placed at a joint with children authored joint-local IS a bone. The 2D painter applies only the in-plane `z` component, after `rotate`. */
    rotation?: [number, number, number];
    /** Skeleton bone name. A named group is addressable by a `draw-mesh` `skin`
     *  block (smooth skinning): the skinned mesh deforms with this group's
     *  animated transform. Names resolve within the nearest enclosing
     *  `skeleton: true` group (falling back to the canvas), so multiple
     *  instances of one rig never collide. Distinct from `id` (the hit-test
     *  handle). */
    bone?: string;
    /** Marks this group as a skeleton SCOPE: `bone` names and `skin` bindings in
     *  its subtree resolve against each other only — one scope per rig instance. */
    skeleton?: boolean;
    /** Keyframe animation over the group TRANSFORM tracks (`offsetX/Y/Z` in cells, `rotateX/Y/Z` in radians, `scale`; the 2D painter also honors `opacity`) — children inherit it, so nested animated groups form a joint chain. Material tracks belong on leaf meshes. */
    animation?: DrawMeshAnimation;
    /** 0..1 opacity. */
    opacity?: number;
    /** Clip the group's items to an SVG path (`d` syntax) in world units relative to the group origin — masked reveals, meters, portraits. */
    clip?: string;
    /** The grouped drawables, painted through the normal dispatch. */
    items: DrawableNode[];
}

/** True when this group declares a playable keyframe animation of its own. */
export function isAnimatedGroup(node: DrawGroupProps): boolean {
    return Boolean(node.animation && node.animation.durationMs > 0 && node.animation.keyframes.length > 0);
}

/** Registry/standalone stub — the host paints this atom; the DOM renders nothing.
 *  When composed as a React child of a draw-host (Canvas2D), registers its
 *  descriptor via context so the host paints it — same path as DrawShape. */
export function DrawGroup(props: DrawGroupProps): React.JSX.Element | null {
    const register = useContext(DrawableRegistryContext);
    if (register) register({ ...props, type: 'draw-group' });
    return null;
}

export default DrawGroup;
