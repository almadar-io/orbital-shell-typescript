'use client';
/**
 * Effects3D — canvas-level post-processing stack (bloom + vignette) for the 3D
 * draw-host. Mirrors `Avl3DEffects`' composer shape; mounted only when `post` is
 * authored, so the default (omitted) scene renders with no composer pass.
 *
 * @packageDocumentation
 */

import React from 'react';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import type { CanvasPost } from './Canvas3DHost';

export interface Effects3DProps {
    /** Post-processing config; each key mounts only when authored. */
    post?: CanvasPost;
}

/**
 * Effects3D — mounts an `EffectComposer` with the authored bloom/vignette passes.
 */
export function Effects3D({ post }: Effects3DProps): React.JSX.Element | null {
    if (!post || (!post.bloom && !post.vignette)) return null;

    const passes: React.JSX.Element[] = [];
    if (post.bloom) {
        passes.push(
            <Bloom
                key="bloom"
                intensity={post.bloom.intensity ?? 1}
                luminanceThreshold={post.bloom.threshold ?? 0.9}
                luminanceSmoothing={post.bloom.smoothing ?? 0.3}
            />
        );
    }
    if (post.vignette) {
        passes.push(
            <Vignette
                key="vignette"
                offset={post.vignette.offset ?? 0.3}
                darkness={post.vignette.darkness ?? 0.6}
            />
        );
    }

    return <EffectComposer>{passes}</EffectComposer>;
}

export default Effects3D;
