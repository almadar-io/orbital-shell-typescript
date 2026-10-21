import { useCallback, useRef } from 'react';

/**
 * Unified pointer/touch gesture detection for canvas surfaces (graph, isometric, etc.).
 *
 * It owns the hard part — pointer tracking + two-finger pinch (scale factor + centroid) —
 * and DELEGATES application to the consumer via callbacks, so each canvas applies pan/zoom
 * in its own coordinate convention (screen-offset vs world-camera). A single pointer is
 * passed straight through to the consumer's domain handlers (pan / node-drag / tile-select);
 * a second pointer takes over as a pinch and cancels any in-flight single-pointer action.
 *
 * Pointer Events cover mouse, touch and pen, so this REPLACES mouse handlers — no dual paths.
 */

export interface CanvasGestureCallbacks {
  /** Single-pointer down — start the consumer's pan / drag / select (domain-specific). */
  onPointerDown?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  /** Single-pointer move. */
  onPointerMove?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  /** Single-pointer up. */
  onPointerUp?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  /**
   * Multiplicative zoom around a canvas-local point. Fired by wheel and by pinch.
   * Consumer applies `newZoom = clamp(oldZoom * factor)` keeping (centerX,centerY) fixed.
   */
  onZoom?: (factor: number, centerX: number, centerY: number) => void;
  /** Two-finger pan delta in canvas-local px (fired alongside pinch). */
  onPanDelta?: (dx: number, dy: number) => void;
  /** A second pointer arrived — cancel any single-pointer pan/drag the consumer started. */
  onMultiTouchStart?: () => void;
}

export interface UseCanvasGesturesOptions extends CanvasGestureCallbacks {
  /** The canvas being gestured on (for coordinate translation). */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** When false, all gestures are inert. Default true. */
  enabled?: boolean;
  /** Wheel zoom step per notch (>1). Default 1.1. */
  wheelStep?: number;
}

export interface CanvasGestureHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onWheel: (e: WheelEvent) => void;
}

interface PinchState {
  distance: number;
  centroid: { x: number; y: number };
}

function localPoint(
  canvas: HTMLCanvasElement | null,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (!canvas) return { x: clientX, y: clientY };
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export function useCanvasGestures(options: UseCanvasGesturesOptions): CanvasGestureHandlers {
  const {
    canvasRef,
    enabled = true,
    wheelStep = 1.1,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onZoom,
    onPanDelta,
    onMultiTouchStart,
  } = options;

  // Active pointers by id, and the running pinch baseline. Refs (not state) so a
  // gesture never triggers a re-render mid-drag.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<PinchState | null>(null);

  const computePinch = useCallback((): PinchState => {
    const pts = [...pointers.current.values()];
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    return {
      distance: Math.hypot(dx, dy) || 1,
      centroid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!enabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, localPoint(canvasRef.current, e.clientX, e.clientY));

      if (pointers.current.size === 2) {
        // Transition single → pinch: drop any single-pointer action first.
        onMultiTouchStart?.();
        pinch.current = computePinch();
      } else if (pointers.current.size === 1) {
        onPointerDown?.(e);
      }
    },
    [enabled, canvasRef, onMultiTouchStart, computePinch, onPointerDown],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!enabled) return;
      if (pointers.current.has(e.pointerId)) {
        pointers.current.set(e.pointerId, localPoint(canvasRef.current, e.clientX, e.clientY));
      }

      if (pointers.current.size >= 2 && pinch.current) {
        const next = computePinch();
        const prev = pinch.current;
        if (next.distance !== prev.distance) {
          onZoom?.(next.distance / prev.distance, next.centroid.x, next.centroid.y);
        }
        onPanDelta?.(next.centroid.x - prev.centroid.x, next.centroid.y - prev.centroid.y);
        pinch.current = next;
        return;
      }

      // Forward every non-pinch move: 0 pointers down = bare-mouse hover hit-test,
      // 1 pointer down = pan/drag. The consumer decides based on its own mode.
      onPointerMove?.(e);
    },
    [enabled, canvasRef, computePinch, onZoom, onPanDelta, onPointerMove],
  );

  const endPointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>, fireUp: boolean) => {
      const wasMulti = pointers.current.size >= 2;
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      // Re-baseline if dropping from a pinch back to a single finger still down,
      // so the surviving finger doesn't jump.
      if (wasMulti && pointers.current.size === 1) return;
      if (pointers.current.size === 0 && fireUp) onPointerUp?.(e);
    },
    [onPointerUp],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!enabled) return;
      endPointer(e, true);
    },
    [enabled, endPointer],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!enabled) return;
      endPointer(e, false);
    },
    [enabled, endPointer],
  );

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!enabled) return;
      e.preventDefault();
      const { x, y } = localPoint(canvasRef.current, e.clientX, e.clientY);
      onZoom?.(e.deltaY < 0 ? wheelStep : 1 / wheelStep, x, y);
    },
    [enabled, canvasRef, wheelStep, onZoom],
  );

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onWheel: handleWheel,
  };
}
