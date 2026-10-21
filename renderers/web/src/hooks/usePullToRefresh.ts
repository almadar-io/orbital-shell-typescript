'use client';
/**
 * usePullToRefresh Hook
 *
 * Detects overscroll pull-down gesture at scroll top.
 * Returns container props and pull state for rendering the refresh indicator.
 * Components route the result through useEventBus().emit('UI:EVENT_NAME', payload).
 */
import { useCallback, useRef, useState } from 'react';
import type React from 'react';

export interface PullToRefreshOptions {
  /** Distance in px to pull before triggering refresh (default: 60) */
  threshold?: number;
  /** Maximum pull distance in px (default: 120) */
  maxPull?: number;
}

export interface PullToRefreshResult {
  /** Current pull distance in px */
  pullDistance: number;
  /** Whether the user is actively pulling */
  isPulling: boolean;
  /** Whether a refresh was triggered and is in progress */
  isRefreshing: boolean;
  /** Props to spread on the scrollable container */
  containerProps: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    style: React.CSSProperties;
  };
  /** Call this when the refresh operation completes */
  endRefresh: () => void;
}

export function usePullToRefresh(
  onRefresh: () => void,
  options: PullToRefreshOptions = {},
): PullToRefreshResult {
  const { threshold = 60, maxPull = 120 } = options;

  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startY = useRef(0);
  const scrollTopRef = useRef(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const container = e.currentTarget;
    scrollTopRef.current = container.scrollTop;
    if (scrollTopRef.current <= 0) {
      startY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling || isRefreshing) return;
    const container = e.currentTarget;
    if (container.scrollTop > 0) {
      setPullDistance(0);
      return;
    }

    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) {
      // Apply resistance: actual pull = dy * 0.5, capped at maxPull
      const distance = Math.min(dy * 0.5, maxPull);
      setPullDistance(distance);
    }
  }, [isPulling, isRefreshing, maxPull]);

  const onTouchEnd = useCallback(() => {
    if (!isPulling) return;
    setIsPulling(false);

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(threshold); // Hold at threshold during refresh
      onRefresh();
    } else {
      setPullDistance(0);
    }
  }, [isPulling, pullDistance, threshold, isRefreshing, onRefresh]);

  const endRefresh = useCallback(() => {
    setIsRefreshing(false);
    setPullDistance(0);
  }, []);

  const containerProps = {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    style: {
      transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
      transition: isPulling ? 'none' : 'transform 300ms ease-out',
    } as React.CSSProperties,
  };

  return {
    pullDistance,
    isPulling,
    isRefreshing,
    containerProps,
    endRefresh,
  };
}
