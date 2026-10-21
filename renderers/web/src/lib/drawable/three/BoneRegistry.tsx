'use client';
/**
 * BoneRegistry — canvas-scoped name → THREE.Bone lookup for smooth skinning.
 *
 * A `draw-group` with `bone:` mounts a real `THREE.Bone` (identity local
 * transform, so it rides the group's animated world matrix) and registers it
 * here; a skinned `draw-mesh` resolves its `skin.bones` names against this
 * store and binds once every name is present. Registration order is free —
 * subscribers re-check on every change.
 */
import { createContext } from 'react';
import type * as THREE from 'three';

export class BoneStore {
    private bones = new Map<string, THREE.Bone>();
    private listeners = new Set<() => void>();

    register(name: string, bone: THREE.Bone): () => void {
        this.bones.set(name, bone);
        this.notify();
        return () => {
            if (this.bones.get(name) === bone) {
                this.bones.delete(name);
                this.notify();
            }
        };
    }

    get(name: string): THREE.Bone | undefined {
        return this.bones.get(name);
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        for (const l of this.listeners) l();
    }
}

export const BoneRegistryContext = createContext<BoneStore | null>(null);
