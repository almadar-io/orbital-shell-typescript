'use client';
/**
 * ModelLoader Component
 *
 * React Three Fiber component for loading and displaying GLB/GLTF models from URLs.
 * Handles loading states and errors without requiring React Suspense.
 *
 * @packageDocumentation
 */

import React, { useMemo, useState, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createLogger } from '@almadar/logger';

const log = createLogger('almadar:ui:game:model-loader');

export interface ModelLoaderProps {
    /** URL to the GLB/GLTF model */
    url: string;
    /** Position [x, y, z] */
    position?: [number, number, number];
    /** Scale - either a single number or [x, y, z] */
    scale?: number | [number, number, number];
    /** Rotation in degrees [x, y, z] */
    rotation?: [number, number, number];
    /** Whether the model is selected */
    isSelected?: boolean;
    /** Whether the model is hovered */
    isHovered?: boolean;
    /** Click handler */
    onClick?: () => void;
    /** Hover handler */
    onHover?: (hovered: boolean) => void;
    /** Fallback geometry type */
    fallbackGeometry?: 'box' | 'sphere' | 'cylinder' | 'none';
    /**
     * Named GLB animation clip to play (e.g. "idle", "walk") — the LOLO state machine
     * drives this from the unit's `animation` field. Matched case-insensitively; an
     * unknown or absent name leaves the model static (bind pose).
     */
    animation?: string;
    /** Multiply the model's material colors by this CSS color (per-instance; e.g. team tint). */
    tint?: string;
    /** Enable shadows */
    castShadow?: boolean;
    /** Receive shadows */
    receiveShadow?: boolean;
    /**
     * Base path for shared resources (textures, materials).
     * If not provided, auto-detected from the URL by looking for a `/3d/` segment.
     * E.g. "https://host/3d/" so that "Textures/colormap.png" resolves correctly.
     */
    resourceBasePath?: string;
}

interface ModelLoadState {
    model: THREE.Group | null;
    clips: THREE.AnimationClip[];
    isLoading: boolean;
    error: Error | null;
}

interface GltfCacheEntry {
    gltf?: { scene: THREE.Group; animations: THREE.AnimationClip[] };
    error?: Error;
    promise: Promise<void>;
}

/** One fetch per (resourcePath, url) — every ModelLoader instance clones from the shared scene. */
const gltfCache = new Map<string, GltfCacheEntry>();

function loadGltfCached(url: string, assetRoot: string): GltfCacheEntry {
    const key = `${assetRoot}|${url}`;
    let entry = gltfCache.get(key);
    if (!entry) {
        const pending: GltfCacheEntry = {
            promise: new Promise<void>((resolveDone) => {
                const loader = new GLTFLoader();
                // setResourcePath tells GLTFLoader where to resolve relative URIs
                // (textures, buffers) found inside the GLTF JSON — BEFORE they become
                // absolute. This is the only way to redirect "Textures/colormap.png"
                // since the LoadingManager URL modifier only sees already-resolved URLs.
                loader.setResourcePath(assetRoot);
                loader.load(
                    url,
                    (gltf) => {
                        log.debug('Loaded', { url, clips: gltf.animations.length });
                        pending.gltf = { scene: gltf.scene, animations: gltf.animations };
                        resolveDone();
                    },
                    undefined,
                    (err) => {
                        log.warn('Failed', { url, error: err instanceof Error ? err : String(err) });
                        pending.error = err instanceof Error ? err : new Error(String(err));
                        resolveDone();
                    }
                );
            }),
        };
        entry = pending;
        gltfCache.set(key, entry);
    }
    return entry;
}

/**
 * Detect the 3D asset root from a model URL.
 * Looks for "/3d/" segment and returns everything up to and including it.
 * Falls back to the model's own directory.
 */
function detectAssetRoot(modelUrl: string): string {
    const idx = modelUrl.indexOf('/3d/');
    if (idx !== -1) {
        return modelUrl.substring(0, idx + 4); // "https://host/3d/"
    }
    // Fallback: model's own directory
    return modelUrl.substring(0, modelUrl.lastIndexOf('/') + 1);
}

/**
 * Hook to load GLTF model without Suspense.
 * Resolves shared texture paths (e.g. "Textures/colormap.png") against the
 * asset root directory rather than the model's own subdirectory.
 */
function stateFromEntry(entry: GltfCacheEntry | null): ModelLoadState {
    if (!entry) return { model: null, clips: [], isLoading: false, error: null };
    if (entry.gltf) return { model: entry.gltf.scene, clips: entry.gltf.animations, isLoading: false, error: null };
    return { model: null, clips: [], isLoading: !entry.error, error: entry.error ?? null };
}

function useGLTFModel(url: string, resourceBasePath?: string): ModelLoadState {
    // Seed synchronously from the cache — a cache hit renders the model on the very
    // first frame (no loading-ring flash on remount or list reshuffle).
    const [state, setState] = useState<ModelLoadState>(() =>
        stateFromEntry(url ? loadGltfCached(url, resourceBasePath || detectAssetRoot(url)) : null)
    );

    useEffect(() => {
        if (!url) {
            setState({ model: null, clips: [], isLoading: false, error: null });
            return;
        }
        const entry = loadGltfCached(url, resourceBasePath || detectAssetRoot(url));
        setState(stateFromEntry(entry));
        if (entry.gltf || entry.error) return;
        let cancelled = false;
        void entry.promise.then(() => {
            if (!cancelled) setState(stateFromEntry(entry));
        });
        return () => {
            cancelled = true;
        };
    }, [url, resourceBasePath]);

    return state;
}

/**
 * ModelLoader component for rendering GLB models in React Three Fiber
 */
export function ModelLoader({
    url,
    position = [0, 0, 0],
    scale = 1,
    rotation = [0, 0, 0],
    isSelected = false,
    isHovered = false,
    onClick,
    onHover,
    fallbackGeometry = 'box',
    castShadow = true,
    receiveShadow = true,
    resourceBasePath,
    animation,
    tint,
}: ModelLoaderProps): React.JSX.Element {
    const { model: loadedModel, clips, isLoading, error } = useGLTFModel(url, resourceBasePath);

    // Clone and prepare the model
    const model = useMemo(() => {
        if (!loadedModel) return null;
        // SkeletonUtils.clone — plain Object3D.clone() rebinds a SkinnedMesh's bones to the
        // ORIGINAL skeleton, which collapses the clone's geometry to the bind pose at the
        // origin. That degenerate bounding box then drives normFactor → 1/≈0 and the model
        // renders gigantic. SkeletonUtils.clone deep-copies the skeleton so skinned character
        // GLBs keep their real extent.
        const cloned = cloneSkeleton(loadedModel) as THREE.Group;
        cloned.updateMatrixWorld(true);

        const tintColor = tint ? new THREE.Color(tint) : null;
        cloned.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = castShadow;
                child.receiveShadow = receiveShadow;
                // Materials are shared with the cached scene — clone before tinting so
                // one instance's tint never leaks into siblings.
                if (tintColor && child.material instanceof THREE.MeshStandardMaterial) {
                    const mat = child.material.clone();
                    mat.color.multiply(tintColor);
                    child.material = mat;
                }
            }
        });

        return cloned;
    }, [loadedModel, castShadow, receiveShadow, tint]);

    // Clip playback — the LOLO state machine drives `animation` (a named GLB clip);
    // clip tracks bind by node NAME so they play on the SkeletonUtils clone as-is.
    const mixer = useMemo(() => (model ? new THREE.AnimationMixer(model) : null), [model]);
    useEffect(() => {
        if (!mixer || !animation || clips.length === 0) return;
        const wanted = animation.toLowerCase();
        const clip = clips.find((c) => c.name === animation)
            ?? clips.find((c) => c.name.toLowerCase() === wanted);
        if (!clip) return;
        const action = mixer.clipAction(clip);
        action.reset().fadeIn(0.15).play();
        return () => {
            action.fadeOut(0.15);
        };
    }, [mixer, clips, animation]);
    useFrame((_, delta) => {
        mixer?.update(delta);
    });

    // Normalize the model to a unit cube (max dimension = 1) so a GLB's intrinsic export
    // size doesn't blow it up. The `scale` prop then means the model's world-size in cells
    // (consistent across every asset regardless of how it was exported), instead of a raw
    // multiplier on whatever arbitrary size the GLB happened to ship with.
    const normFactor = useMemo(() => {
        if (!model) return 1;
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        // Guard a degenerate bounding box (a model that loaded with no measurable extent):
        // 1/≈0 would blow the model up to fill the canvas. Below this floor we decline to
        // normalize (factor 1) rather than upscale by a wild factor.
        if (!Number.isFinite(maxDim) || maxDim < 0.05) return 1;
        return 1 / maxDim;
    }, [model]);

    // Calculate scale array (world-size in cells × the unit-cube normalization factor).
    const scaleArray: [number, number, number] = useMemo(() => {
        const base: [number, number, number] = typeof scale === 'number' ? [scale, scale, scale] : scale;
        return [base[0] * normFactor, base[1] * normFactor, base[2] * normFactor];
    }, [scale, normFactor]);

    // Calculate rotation in radians
    const rotationRad: [number, number, number] = useMemo(() => {
        return [
            (rotation[0] * Math.PI) / 180,
            (rotation[1] * Math.PI) / 180,
            (rotation[2] * Math.PI) / 180,
        ];
    }, [rotation]);

    // Show loading spinner
    if (isLoading) {
        return (
            <group position={position}>
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.3, 0.35, 16]} />
                    <meshBasicMaterial color="#4a90d9" transparent opacity={0.8} />
                </mesh>
            </group>
        );
    }

    // Show error fallback
    if (error || !model) {
        if (fallbackGeometry === 'none') {
            return <group position={position} />;
        }

        const fallbackProps = {
            onClick,
            onPointerOver: () => onHover?.(true),
            onPointerOut: () => onHover?.(false),
        };

        return (
            <group position={position}>
                {(isSelected || isHovered) && (
                    <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <ringGeometry args={[0.6, 0.7, 32]} />
                        <meshBasicMaterial
                            color={isSelected ? 0xffaa00 : 0xffffff}
                            transparent
                            opacity={0.5}
                        />
                    </mesh>
                )}
                {fallbackGeometry === 'box' && (
                    <mesh {...fallbackProps} position={[0, 0.5, 0]}>
                        <boxGeometry args={[0.8, 0.8, 0.8]} />
                        <meshStandardMaterial color={error ? 0xff4444 : 0x888888} />
                    </mesh>
                )}
                {fallbackGeometry === 'sphere' && (
                    <mesh {...fallbackProps} position={[0, 0.5, 0]}>
                        <sphereGeometry args={[0.4, 16, 16]} />
                        <meshStandardMaterial color={error ? 0xff4444 : 0x888888} />
                    </mesh>
                )}
                {fallbackGeometry === 'cylinder' && (
                    <mesh {...fallbackProps} position={[0, 0.5, 0]}>
                        <cylinderGeometry args={[0.3, 0.3, 0.8, 16]} />
                        <meshStandardMaterial color={error ? 0xff4444 : 0x888888} />
                    </mesh>
                )}
            </group>
        );
    }

    return (
        <group
            position={position}
            rotation={rotationRad}
            onClick={onClick}
            onPointerOver={() => onHover?.(true)}
            onPointerOut={() => onHover?.(false)}
        >
            {/* Selection/hover ring */}
            {(isSelected || isHovered) && (
                <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.6, 0.7, 32]} />
                    <meshBasicMaterial
                        color={isSelected ? 0xffaa00 : 0xffffff}
                        transparent
                        opacity={0.5}
                    />
                </mesh>
            )}

            {/* The loaded model */}
            <primitive object={model} scale={scaleArray} />
        </group>
    );
}

export default ModelLoader;
