'use client';
/**
 * useInfiniteScroll Hook
 *
 * Uses IntersectionObserver on a sentinel element to detect when
 * the user has scrolled near the end of a list.
 * Components route the result through useEventBus().emit('UI:EVENT_NAME', payload).
 */
import { useCallback, useEffect, useRef } from 'react';

export interface InfiniteScrollOptions {
  /** Root margin for IntersectionObserver (default: "200px") */
  rootMargin?: string;
  /** Whether more items are available to load */
  hasMore?: boolean;
  /** Whether a load is currently in progress */
  isLoading?: boolean;
}

export interface InfiniteScrollResult {
  /** Ref to attach to the sentinel element */
  sentinelRef: React.RefCallback<HTMLElement>;
}

export function useInfiniteScroll(
  onLoadMore: () => void,
  options: InfiniteScrollOptions = {},
): InfiniteScrollResult {
  const { rootMargin = '200px', hasMore = true, isLoading = false } = options;

  const observerRef = useRef<IntersectionObserver | null>(null);
  const callbackRef = useRef(onLoadMore);
  callbackRef.current = onLoadMore;

  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;

  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    // Disconnect previous observer
    observerRef.current?.disconnect();

    if (!node) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && hasMoreRef.current && !isLoadingRef.current) {
          callbackRef.current();
        }
      },
      { rootMargin },
    );

    observerRef.current.observe(node);
  }, [rootMargin]);

  return { sentinelRef };
}
