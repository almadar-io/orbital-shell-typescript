'use client';
/**
 * useLongPress Hook
 *
 * Fires a callback after holding for a configurable duration.
 * Cancels on pointer move (beyond threshold) or scroll.
 * Components route the result through useEventBus().emit('UI:EVENT_NAME', payload).
 */
import { useCallback, useRef } from 'react';
import type React from 'react';

export interface LongPressOptions {
  /** Hold duration in ms before triggering (default: 500) */
  duration?: number;
  /** Movement tolerance in px before canceling (default: 10) */
  moveThreshold?: number;
}

export interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  /** Whether the long press is currently active (held down, timer running) */
  isPressed: boolean;
}

export function useLongPress(
  onLongPress: () => void,
  options: LongPressOptions = {},
): LongPressHandlers {
  const { duration = 500, moveThreshold = 10 } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const isPressedRef = useRef(false);
  const firedRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    isPressedRef.current = false;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    firedRef.current = false;
    startPos.current = { x: e.clientX, y: e.clientY };
    isPressedRef.current = true;

    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      isPressedRef.current = false;
      onLongPress();
    }, duration);
  }, [duration, onLongPress]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPressedRef.current) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > moveThreshold) {
      cancel();
    }
  }, [moveThreshold, cancel]);

  const onPointerUp = useCallback(() => {
    cancel();
  }, [cancel]);

  const onPointerCancel = useCallback(() => {
    cancel();
  }, [cancel]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    isPressed: isPressedRef.current,
  };
}
