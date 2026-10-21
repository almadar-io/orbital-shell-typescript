'use client';
/**
 * useCamera Hook
 *
 * Manages camera pan/zoom state for canvas rendering.
 * Provides mouse event handlers and coordinate conversion.
 *
 * @packageDocumentation
 */

import { useRef, useCallback } from 'react';
import type { CameraState } from '../lib/isometricTypes';

/** Zoom bounds. The floor must sit below any auto-fit zoom (~0.1 on large boards)
 *  or wheel/pinch zoom-out snaps IN to the floor once and then stalls dead. */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 10;

interface CameraResult {
    /** Mutable camera state ref (x, y, zoom) */
    cameraRef: React.MutableRefObject<CameraState>;
    /** Target camera position for smooth lerp centering. Set to null when reached. */
    targetCameraRef: React.MutableRefObject<{ x: number; y: number } | null>;
    /** Whether the user is currently dragging */
    isDragging: () => boolean;
    /** Total drag distance — used to distinguish click from pan (threshold: 5px) */
    dragDistance: () => number;
    /** Mouse down handler — starts panning */
    handleMouseDown: (e: React.MouseEvent) => void;
    /** Mouse up handler — stops panning */
    handleMouseUp: () => void;
    /** Mouse move handler — pans camera if dragging, returns true if panning */
    handleMouseMove: (e: React.MouseEvent, drawFn?: () => void) => boolean;
    /** Mouse leave handler — cancels drag */
    handleMouseLeave: () => void;
    /** Wheel handler — zoom in/out */
    handleWheel: (e: React.WheelEvent, drawFn?: () => void) => void;
    /** Pointer down — starts panning (mouse/touch/pen via Pointer Events). */
    handlePointerDown: (e: React.PointerEvent) => void;
    /** Pointer up — stops panning. */
    handlePointerUp: () => void;
    /** Pointer move — pans camera if dragging, returns true if panning. */
    handlePointerMove: (e: React.PointerEvent, drawFn?: () => void) => boolean;
    /** Apply a two-finger pan delta (screen px) directly to the camera. */
    panBy: (dx: number, dy: number, drawFn?: () => void) => void;
    /**
     * Multiplicative zoom by `factor` keeping the world point under (centerX,centerY)
     * — screen px relative to the canvas — fixed. Used by wheel + pinch.
     */
    zoomAtPoint: (factor: number, centerX: number, centerY: number, viewportSize: { width: number; height: number }, drawFn?: () => void) => void;
    /** Convert screen coordinates to world coordinates (inverse camera transform) */
    screenToWorld: (clientX: number, clientY: number, canvas: HTMLCanvasElement, viewportSize: { width: number; height: number }) => { x: number; y: number };
    /** Lerp camera toward target. Call in animation loop. Returns true if still animating. */
    lerpToTarget: (t?: number) => boolean;
}

/**
 * Camera hook for pan/zoom canvas rendering.
 *
 * @returns Camera state, event handlers, and coordinate conversion
 */
export function useCamera(initial?: Partial<CameraState>): CameraResult {
    const cameraRef = useRef<CameraState>({
        x: initial?.x ?? 0,
        y: initial?.y ?? 0,
        zoom: initial?.zoom ?? 1,
    });
    const targetCameraRef = useRef<{ x: number; y: number } | null>(null);
    const isDraggingRef = useRef(false);
    const dragDistanceRef = useRef(0);
    const lastMouseRef = useRef({ x: 0, y: 0 });

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        isDraggingRef.current = true;
        dragDistanceRef.current = 0;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        if (e.button === 1 || e.button === 2) {
            e.preventDefault();
        }
    }, []);

    const handleMouseUp = useCallback(() => {
        isDraggingRef.current = false;
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent, drawFn?: () => void): boolean => {
        if (!isDraggingRef.current) return false;

        const dx = e.clientX - lastMouseRef.current.x;
        const dy = e.clientY - lastMouseRef.current.y;
        dragDistanceRef.current += Math.abs(dx) + Math.abs(dy);
        cameraRef.current.x -= dx;
        cameraRef.current.y -= dy;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        // Cancel auto-centering while user drags
        targetCameraRef.current = null;
        drawFn?.();
        return dragDistanceRef.current > 5;
    }, []);

    const handleMouseLeave = useCallback(() => {
        isDraggingRef.current = false;
    }, []);

    const handleWheel = useCallback((e: React.WheelEvent, drawFn?: () => void) => {
        e.preventDefault();
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        cameraRef.current.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cameraRef.current.zoom * zoomDelta));
        drawFn?.();
    }, []);

    // Pointer Events are a superset of MouseEvents for the fields these handlers read
    // (clientX/clientY/button), so the pan logic is shared — no duplicate gesture code.
    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        handleMouseDown(e);
    }, [handleMouseDown]);

    const handlePointerUp = useCallback(() => {
        handleMouseUp();
    }, [handleMouseUp]);

    const handlePointerMove = useCallback((e: React.PointerEvent, drawFn?: () => void): boolean => {
        return handleMouseMove(e, drawFn);
    }, [handleMouseMove]);

    const panBy = useCallback((dx: number, dy: number, drawFn?: () => void) => {
        cameraRef.current.x -= dx;
        cameraRef.current.y -= dy;
        targetCameraRef.current = null;
        drawFn?.();
    }, []);

    const zoomAtPoint = useCallback((
        factor: number,
        centerX: number,
        centerY: number,
        viewportSize: { width: number; height: number },
        drawFn?: () => void,
    ) => {
        const cam = cameraRef.current;
        const oldZoom = cam.zoom;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor));
        if (newZoom === oldZoom) {
            drawFn?.();
            return;
        }
        // Keep the world point under (centerX,centerY) fixed across the zoom change.
        // screenToWorld: world = (screen - vp/2)/zoom + vp/2 + cam → invert for cam.
        const inv = 1 / oldZoom - 1 / newZoom;
        cam.x += (centerX - viewportSize.width / 2) * inv;
        cam.y += (centerY - viewportSize.height / 2) * inv;
        cam.zoom = newZoom;
        targetCameraRef.current = null;
        drawFn?.();
    }, []);

    const screenToWorld = useCallback((
        clientX: number,
        clientY: number,
        canvas: HTMLCanvasElement,
        viewportSize: { width: number; height: number },
    ): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        const screenX = clientX - rect.left;
        const screenY = clientY - rect.top;

        const cam = cameraRef.current;
        const worldX = (screenX - viewportSize.width / 2) / cam.zoom + viewportSize.width / 2 + cam.x;
        const worldY = (screenY - viewportSize.height / 2) / cam.zoom + viewportSize.height / 2 + cam.y;

        return { x: worldX, y: worldY };
    }, []);

    const lerpToTarget = useCallback((t = 0.08): boolean => {
        if (!targetCameraRef.current) return false;

        const cam = cameraRef.current;
        cam.x += (targetCameraRef.current.x - cam.x) * t;
        cam.y += (targetCameraRef.current.y - cam.y) * t;

        if (Math.abs(cam.x - targetCameraRef.current.x) < 0.5 &&
            Math.abs(cam.y - targetCameraRef.current.y) < 0.5) {
            cam.x = targetCameraRef.current.x;
            cam.y = targetCameraRef.current.y;
            targetCameraRef.current = null;
        }

        return true;
    }, []);

    return {
        cameraRef,
        targetCameraRef,
        isDragging: () => isDraggingRef.current,
        dragDistance: () => dragDistanceRef.current,
        handleMouseDown,
        handleMouseUp,
        handleMouseMove,
        handleMouseLeave,
        handleWheel,
        handlePointerDown,
        handlePointerUp,
        handlePointerMove,
        panBy,
        zoomAtPoint,
        screenToWorld,
        lerpToTarget,
    };
}
