/**
 * Pattern props as the plain JSON `PatternConfig` orbital-canvas reads, and the click payloads its scenes deliver.
 *
 * @packageDocumentation
 */
import type { Camera, EventPayload, GpuBuffer } from '@almadar/core';

export function cameraConfig(camera: Camera | undefined) {
    if (!camera) return undefined;
    return {
        ...camera,
        pos: camera.pos && { ...camera.pos },
        target: camera.target && { ...camera.target },
    };
}

export function gpuBufferConfig(buffer: GpuBuffer | undefined) {
    return buffer && { ...buffer };
}

/** A clicked learning shape, as the web `onShapeClick` callbacks take it. */
export interface ShapeClickPayload {
    id?: string;
    type?: string;
    index: number;
}

/** A clicked graph node, as `onNodeClick` takes it. */
export interface NodeClickPayload {
    id: string;
    label?: string;
    index: number;
}

function payloadArg(delivered: EventPayload): EventPayload | null {
    const arg = delivered.payload;
    return typeof arg === 'object' && arg !== null && !Array.isArray(arg) ? arg : null;
}

/** The `{ payload: { id?, type, index } }` a scene delivers for `onShapeClick`. */
export function shapeClickPayload(delivered: EventPayload): ShapeClickPayload | null {
    const p = payloadArg(delivered);
    if (!p || typeof p.index !== 'number') return null;
    return {
        ...(typeof p.id === 'string' ? { id: p.id } : {}),
        ...(typeof p.type === 'string' ? { type: p.type } : {}),
        index: p.index,
    };
}

/** The `{ payload: { id, label?, index } }` a scene delivers for `onNodeClick`. */
export function nodeClickPayload(delivered: EventPayload): NodeClickPayload | null {
    const p = payloadArg(delivered);
    if (!p || typeof p.id !== 'string' || typeof p.index !== 'number') return null;
    return { id: p.id, ...(typeof p.label === 'string' ? { label: p.label } : {}), index: p.index };
}
