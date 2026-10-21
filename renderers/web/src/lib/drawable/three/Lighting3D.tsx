/**
 * Lighting3D
 *
 * Default lighting setup for 3D game scenes.
 * Includes ambient, directional, and optional point lights.
 *
 * @packageDocumentation
 */

import React from 'react';
import * as THREE from 'three';
import type { CanvasPointLightConfig } from './Canvas3DHost';

export interface Lighting3DProps {
    /** Ambient light intensity */
    ambientIntensity?: number;
    /** Ambient light color */
    ambientColor?: string;
    /** Directional light intensity */
    directionalIntensity?: number;
    /** Directional light color */
    directionalColor?: string;
    /** Directional light position */
    directionalPosition?: [number, number, number];
    /** Hemisphere (sky/ground) light intensity */
    hemisphereIntensity?: number;
    /** Hemisphere sky color */
    hemisphereColor?: string;
    /** Hemisphere ground color */
    hemisphereGroundColor?: string;
    /** Additional point lights, authored as data */
    points?: CanvasPointLightConfig[];
    /** Enable shadows */
    shadows?: boolean;
    /** Shadow map size */
    shadowMapSize?: number;
    /** Shadow camera size (orthographic half-extent) */
    shadowCameraSize?: number;
    /** Shadow depth bias — reduces shadow acne */
    shadowBias?: number;
    /** Shadow normal bias — reduces acne on angled faces (undefined = three.js default 0) */
    shadowNormalBias?: number;
    /** Shadow camera near plane */
    shadowCameraNear?: number;
    /** Shadow camera far plane */
    shadowCameraFar?: number;
    /** Show helper for directional light */
    showHelpers?: boolean;
}

/**
 * Lighting3D Component
 *
 * Pre-configured lighting setup for game scenes.
 *
 * @example
 * ```tsx
 * <Canvas>
 *     <Lighting3D
 *         ambientIntensity={0.6}
 *         directionalIntensity={1.0}
 *         shadows={true}
 *     />
 * </Canvas>
 * ```
 */
export function Lighting3D({
    ambientIntensity = 0.6,
    ambientColor = '#ffffff',
    directionalIntensity = 0.8,
    directionalColor = '#ffffff',
    directionalPosition = [10, 20, 10],
    hemisphereIntensity = 0.3,
    hemisphereColor = '#87ceeb',
    hemisphereGroundColor = '#362d1d',
    points,
    shadows = true,
    shadowMapSize = 2048,
    shadowCameraSize = 20,
    shadowBias = -0.001,
    shadowNormalBias,
    shadowCameraNear = 0.1,
    shadowCameraFar = 100,
    showHelpers = false,
}: Lighting3DProps): React.JSX.Element {
    return (
        <>
            {/* Ambient Light */}
            <ambientLight intensity={ambientIntensity} color={ambientColor} />

            {/* Directional Light (Sun) */}
            <directionalLight
                position={directionalPosition}
                intensity={directionalIntensity}
                color={directionalColor}
                castShadow={shadows}
                shadow-mapSize={[shadowMapSize, shadowMapSize]}
                shadow-camera-left={-shadowCameraSize}
                shadow-camera-right={shadowCameraSize}
                shadow-camera-top={shadowCameraSize}
                shadow-camera-bottom={-shadowCameraSize}
                shadow-camera-near={shadowCameraNear}
                shadow-camera-far={shadowCameraFar}
                shadow-bias={shadowBias}
                shadow-normalBias={shadowNormalBias}
            />

            {/* Hemisphere Light for natural outdoor feel */}
            <hemisphereLight
                intensity={hemisphereIntensity}
                color={hemisphereColor}
                groundColor={hemisphereGroundColor}
            />

            {/* Additional point lights, authored as data */}
            {points?.map((p, i) => (
                <pointLight
                    key={i}
                    position={p.position}
                    intensity={p.intensity}
                    color={p.color}
                    distance={p.distance}
                    decay={p.decay}
                />
            ))}

            {/* Light Helpers (debug) */}
            {showHelpers && (
                <>
                    <directionalLightHelper
                        args={[
                            new THREE.DirectionalLight(directionalColor, directionalIntensity) as never,
                            5,
                        ]}
                    />
                </>
            )}
        </>
    );
}

export default Lighting3D;
