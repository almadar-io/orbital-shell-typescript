'use client';
/**
 * InfiniteScrollSentinel Atom Component
 *
 * Invisible element placed at the end of a list. Uses IntersectionObserver
 * via useInfiniteScroll to detect when the user scrolls near the bottom,
 * then fires a load-more event through the event bus.
 */
import { domPassthrough } from '../lib/domPassthrough';
import React, { useCallback } from "react";
import type { A11yProps, EventKey, EventPayload } from "@almadar/core";
import { cn } from "../lib/cn";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import { useEventBus } from "../hooks/useEventBus";
import { Box } from "./Box";
import { Spinner } from "./Spinner";

export interface InfiniteScrollSentinelProps extends A11yProps {
  /** Event name to emit when load-more is triggered (emitted as UI:{loadMoreEvent}) */
  loadMoreEvent: EventKey;
  /** Optional payload to include with the load-more event
   *  @payloadFor loadMoreEvent
   */
  loadMorePayload?: EventPayload;
  /** Whether a load operation is currently in progress */
  isLoading?: boolean;
  /** Whether there are more items to load */
  hasMore?: boolean;
  /** IntersectionObserver rootMargin for early trigger */
  threshold?: string;
  /** Additional class names */
  className?: string;
}

export const InfiniteScrollSentinel: React.FC<InfiniteScrollSentinelProps> = ({
  loadMoreEvent,
  loadMorePayload,
  isLoading = false,
  hasMore = true,
  threshold = "200px",
  className,
  ...rest
}) => {
  const eventBus = useEventBus();

  const onLoadMore = useCallback(() => {
    eventBus.emit(`UI:${loadMoreEvent}`, loadMorePayload ?? {});
  }, [eventBus, loadMoreEvent, loadMorePayload]);

  const { sentinelRef } = useInfiniteScroll(onLoadMore, {
    rootMargin: threshold,
    hasMore,
    isLoading,
  });

  return (
    <Box
      className={cn("flex items-center justify-center py-4", className)}
      {...domPassthrough(rest)}
    >
      <Box ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />
      {isLoading && <Spinner size="sm" />}
    </Box>
  );
};

InfiniteScrollSentinel.displayName = "InfiniteScrollSentinel";
