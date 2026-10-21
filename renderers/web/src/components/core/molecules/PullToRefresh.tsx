'use client';
/**
 * PullToRefresh Molecule Component
 *
 * Wrapper that adds pull-to-refresh gesture to children.
 * Shows a spinner indicator as the user pulls down, and emits
 * a refresh event via the event bus when the threshold is met.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import type { EventKey, EventPayload, A11yProps } from "@almadar/core";
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { usePullToRefresh } from '../../../hooks/usePullToRefresh';
import { Box } from '../../../core';
import { Spinner } from '../../../core';

import { domPassthrough } from '../../../core';
/**
 * Safe event bus hook that works outside EventBusProvider context.
 * Returns a no-op emit function if not in EventBusProvider context.
 */
function useSafeEventBus() {
  try {
    return useEventBus();
  } catch {
    return { emit: () => {}, on: () => () => {}, once: () => {} };
  }
}

export interface PullToRefreshProps extends A11yProps {
  /** Event name to emit on refresh (emitted as UI:{refreshEvent}) */
  refreshEvent: EventKey;
  /** Payload to include with the refresh event
   *  @payloadFor refreshEvent
   */
  refreshPayload?: EventPayload;
  /** Pull distance threshold to trigger refresh in px (default: 60) */
  threshold?: number;
  /** Content to wrap */
  children: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}

const SAFETY_TIMEOUT_MS = 5000;

export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  refreshEvent,
  refreshPayload,
  threshold = 60,
  children,
  className,
  ...rest
}) => {
  const eventBus = useSafeEventBus();
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRefresh = useCallback(() => {
    eventBus.emit(`UI:${refreshEvent}`, refreshPayload ?? {});
  }, [eventBus, refreshEvent, refreshPayload]);

  const { pullDistance, isPulling, isRefreshing, containerProps, endRefresh } =
    usePullToRefresh(handleRefresh, { threshold });

  // Safety timeout: auto-end refresh after SAFETY_TIMEOUT_MS
  useEffect(() => {
    if (isRefreshing) {
      safetyTimerRef.current = setTimeout(() => {
        endRefresh();
      }, SAFETY_TIMEOUT_MS);

      return () => {
        if (safetyTimerRef.current) {
          clearTimeout(safetyTimerRef.current);
          safetyTimerRef.current = null;
        }
      };
    }
  }, [isRefreshing, endRefresh]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
      }
    };
  }, []);

  // Scale the spinner from 0 to 1 based on pull progress
  const pullProgress = Math.min(pullDistance / threshold, 1);
  const showIndicator = pullDistance > 0 || isRefreshing;

  return (
    <Box {...domPassthrough(rest)} position="relative" overflow="hidden" className={cn('w-full', className)}>
      {/* Refresh indicator */}
      <Box
        position="absolute"
        display="flex"
        className={cn(
          'top-0 left-0 right-0 z-10',
          'items-center justify-center',
          'transition-opacity duration-fast',
          showIndicator ? 'opacity-100' : 'opacity-0',
        )}
        style={{
          height: threshold,
          transform: `translateY(${showIndicator ? 0 : -threshold}px)`,
          pointerEvents: 'none',
        }}
      >
        <Box
          className="transition-transform duration-fast"
          style={{
            transform: `scale(${isRefreshing ? 1 : pullProgress})`,
            opacity: isRefreshing ? 1 : pullProgress,
          }}
        >
          <Spinner
            size={pullProgress >= 0.5 ? 'md' : 'sm'}
            className={cn(
              'text-primary',
              isRefreshing && 'animate-spin',
            )}
          />
        </Box>
      </Box>

      {/* Children container with pull-to-refresh touch handlers */}
      <Box
        fullWidth
        className={cn(
          'min-h-0',
          isPulling && 'select-none',
        )}
        {...containerProps}
      >
        {children}
      </Box>
    </Box>
  );
};

PullToRefresh.displayName = 'PullToRefresh';
