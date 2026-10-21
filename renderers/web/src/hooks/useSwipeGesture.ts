'use client';
/**
 * useSwipeGesture Hook
 *
 * Detects horizontal/vertical swipe gestures on a container element.
 * Returns pointer event handlers to bind to the target element.
 * All gesture results are communicated via callbacks that components
 * route through useEventBus().emit('UI:EVENT_NAME', payload).
 */
import { useCallback, useRef } from 'react';

export interface SwipeGestureOptions {
  /** Minimum distance in px to trigger a swipe (default: 50) */
  threshold?: number;
  /** Minimum velocity in px/ms to qualify (default: 0.3) */
  velocityThreshold?: number;
  /** Prevent default touch behavior during swipe (default: false) */
  preventDefault?: boolean;
}

export interface SwipeGestureResult {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

export interface SwipeHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  /** Current horizontal offset during swipe (for animation) */
  offsetX: number;
  /** Whether a swipe gesture is in progress */
  isSwiping: boolean;
}

import type React from 'react';

export function useSwipeGesture(
  callbacks: SwipeGestureResult,
  options: SwipeGestureOptions = {},
): SwipeHandlers {
  const { threshold = 50, velocityThreshold = 0.3, preventDefault = false } = options;

  const startX = useRef(0);
  const startY = useRef(0);
  const startTime = useRef(0);
  const currentX = useRef(0);
  const tracking = useRef(false);
  const offsetXRef = useRef(0);
  const isSwipingRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    startX.current = e.clientX;
    startY.current = e.clientY;
    currentX.current = e.clientX;
    startTime.current = Date.now();
    tracking.current = true;
    isSwipingRef.current = false;
    offsetXRef.current = 0;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!tracking.current) return;
    if (preventDefault) e.preventDefault();

    currentX.current = e.clientX;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;

    // Only track as swipe if horizontal movement dominates
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      isSwipingRef.current = true;
      offsetXRef.current = dx;
    }
  }, [preventDefault]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!tracking.current) return;
    tracking.current = false;

    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    const elapsed = Date.now() - startTime.current;
    const velocity = Math.abs(dx) / Math.max(elapsed, 1);

    offsetXRef.current = 0;
    isSwipingRef.current = false;

    // Check if swipe meets threshold and velocity requirements
    if (Math.abs(dx) < threshold && velocity < velocityThreshold) return;

    // Determine primary direction
    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal swipe
      if (dx < -threshold) callbacks.onSwipeLeft?.();
      else if (dx > threshold) callbacks.onSwipeRight?.();
    } else {
      // Vertical swipe
      if (dy < -threshold) callbacks.onSwipeUp?.();
      else if (dy > threshold) callbacks.onSwipeDown?.();
    }
  }, [threshold, velocityThreshold, callbacks]);

  const onPointerCancel = useCallback(() => {
    tracking.current = false;
    offsetXRef.current = 0;
    isSwipingRef.current = false;
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    offsetX: offsetXRef.current,
    isSwiping: isSwipingRef.current,
  };
}
