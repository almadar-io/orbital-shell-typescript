'use client';
/**
 * GameCamera3D
 *
 * Camera-tracking helpers for the 3D draw-host (`Canvas3DHost`): an
 * imperative-handle position reporter and a smooth-follow camera for
 * `follow`/`chase` modes.
 *
 * @packageDocumentation
 */

import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** Reports the live camera position on every change (imperative handle integration). */
export function CameraController3D({
    onCameraChange,
}: {
    onCameraChange?: (pos: { x: number; y: number; z: number }) => void;
}): null {
    const { camera } = useThree();

    useEffect(() => {
        if (onCameraChange) {
            onCameraChange({
                x: camera.position.x,
                y: camera.position.y,
                z: camera.position.z,
            });
        }
    }, [camera.position, onCameraChange]);

    return null;
}

/**
 * Camera that smooth-tracks a world-space target (side-view player or selected unit).
 * OrbitControls is disabled while following — the camera is authoritative.
 */
export function FollowCamera3D({
    target,
    offset,
}: {
    target: [number, number, number];
    offset: [number, number, number];
}): null {
    const { camera } = useThree();
    const look = useRef(new THREE.Vector3(target[0], target[1], target[2]));
    const goal = useRef(new THREE.Vector3());
    useFrame((_, delta) => {
        const t = Math.min(1, delta * 5);
        goal.current.set(target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]);
        camera.position.lerp(goal.current, t);
        look.current.lerp(goal.current.set(target[0], target[1], target[2]), t);
        camera.lookAt(look.current);
    });
    return null;
}
