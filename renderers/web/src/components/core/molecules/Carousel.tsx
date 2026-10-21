'use client';
/**
 * Carousel Molecule Component
 *
 * Scrolling container with snap points, swipe gestures, keyboard paging,
 * prev/next arrow buttons and dot indicators. `orientation: vertical` with
 * `fullHeight` makes a full-screen feed; `loadMoreEvent` asks for the next page
 * a few slides before the end.
 * Pure UI molecule with no entity binding.
 */

import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import type { A11yProps, AssetUrl, EventEmit, JsonObject } from '@almadar/core';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { cn } from '../../../core';
import { pressableProps } from '../../../core';
import { domPassthrough } from '../../../core';
import { useEventBus } from '../../../core';
import { useSwipeGesture } from '../../../hooks/useSwipeGesture';
import { useTranslate } from '../../../core';
import { Box } from '../../../core';
import { HStack } from '../../../core';
import { Button } from '../../../core';

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

/** Default shape for carousel slide items when no generic is provided. */
export interface CarouselItem {
  id?: string;
  title?: string;
  image?: AssetUrl;
}

export interface CarouselProps<T = CarouselItem> extends A11yProps {
  /** Array of items to display as slides */
  items: T[];
  /** Render function for each slide. In .lolo: renderItem: (fn item <Component …={@item.field}/>), binding per-item fields via @item.field. */
  renderItem?: (item: T, index: number) => React.ReactNode;
  /** Children-as-function fallback for renderItem (compiler compatibility) */
  children?: (item: T, index: number) => React.ReactNode;
  /** Enable auto-play rotation */
  autoPlay?: boolean;
  /** Auto-play interval in milliseconds (default: 5000) */
  autoPlayInterval?: number;
  /** Show dot indicators */
  showDots?: boolean;
  /** Show prev/next arrow buttons */
  showArrows?: boolean;
  /** Enable infinite loop */
  loop?: boolean;
  /**
   * Declarative event name for slide change
   * @notification
   */
  slideChangeEvent?: EventEmit<{ index: number }>;
  /** Payload to include with the slide change event
   *  @payloadFor slideChangeEvent
   */
  slideChangePayload?: JsonObject;
  /** Scroll direction: a row of slides, or a column (a vertical feed). */
  orientation?: 'horizontal' | 'vertical';
  /** Each slide fills the carousel's height (pair with `orientation: vertical` for one card per screen). */
  fullHeight?: boolean;
  /**
   * Emitted when the viewer is `loadMoreAhead` slides from the end and `hasMore` is set.
   * @notification
   */
  loadMoreEvent?: EventEmit<{ index: number }>;
  /** How many slides before the end to ask for more (default 2). */
  loadMoreAhead?: number;
  /** More slides can be loaded. */
  hasMore?: boolean;
  /** A load is in flight; no further request until it lands. */
  isLoadingMore?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export const Carousel = <T = CarouselItem,>({
  items,
  renderItem,
  children,
  autoPlay = false,
  autoPlayInterval = 5000,
  showDots = true,
  showArrows = true,
  loop = false,
  slideChangeEvent,
  slideChangePayload,
  orientation = 'horizontal',
  fullHeight = false,
  loadMoreEvent,
  loadMoreAhead = 2,
  hasMore = false,
  isLoadingMore = false,
  className,
  ...rest
}: CarouselProps<T>): React.ReactElement | null => {
  const vertical = orientation === 'vertical';
  const loadRequestedAt = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [topOffset, setTopOffset] = useState(0);
  const autoPlayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventBus = useSafeEventBus();
  const { t } = useTranslate();

  // `items` comes from pattern binding resolution (useEntityRef / prop passthrough).
  // In the playground/preview path data may resolve async; a crashed render here
  // blanks the whole page, which masks upstream issues. Default to an empty list
  // so the empty-state branch handles it cleanly.
  const safeItems: T[] = items ?? [];
  const totalSlides = safeItems.length;

  const announcedIndex = useRef(0);
  const emitSlideChange = useCallback(
    (newIndex: number) => {
      announcedIndex.current = newIndex;
      if (slideChangeEvent) {
        eventBus.emit(`UI:${slideChangeEvent}`, {
          index: newIndex,
          ...slideChangePayload,
        });
      }
    },
    [slideChangeEvent, slideChangePayload, eventBus],
  );

  const scrollToSlide = useCallback(
    (index: number) => {
      const container = scrollRef.current;
      if (!container) return;
      const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const behavior: ScrollBehavior = reduceMotion ? 'auto' : 'smooth';
      if (typeof container.scrollTo !== 'function') return;
      if (vertical) container.scrollTo({ top: container.offsetHeight * index, behavior });
      else container.scrollTo({ left: container.offsetWidth * index, behavior });
    },
    [vertical],
  );

  const goToSlide = useCallback(
    (index: number) => {
      let targetIndex = index;

      if (loop) {
        if (targetIndex < 0) targetIndex = totalSlides - 1;
        if (targetIndex >= totalSlides) targetIndex = 0;
      } else {
        targetIndex = Math.max(0, Math.min(totalSlides - 1, targetIndex));
      }

      setActiveIndex(targetIndex);
      scrollToSlide(targetIndex);
      emitSlideChange(targetIndex);
    },
    [loop, totalSlides, scrollToSlide, emitSlideChange],
  );

  const goNext = useCallback(() => {
    goToSlide(activeIndex + 1);
  }, [goToSlide, activeIndex]);

  const goPrev = useCallback(() => {
    goToSlide(activeIndex - 1);
  }, [goToSlide, activeIndex]);

  // Swipe gesture handlers
  const swipeHandlers = useSwipeGesture(
    vertical ? { onSwipeUp: goNext, onSwipeDown: goPrev } : { onSwipeLeft: goNext, onSwipeRight: goPrev },
    { threshold: 40 },
  );

  // Auto-play
  useEffect(() => {
    if (!autoPlay || totalSlides <= 1) return;

    autoPlayRef.current = setInterval(() => {
      setActiveIndex((prev) => {
        const next = loop ? (prev + 1) % totalSlides : Math.min(prev + 1, totalSlides - 1);
        // Scroll and emit outside the state updater via setTimeout to avoid stale closure
        setTimeout(() => {
          scrollToSlide(next);
          emitSlideChange(next);
        }, 0);
        return next;
      });
    }, autoPlayInterval);

    return () => {
      if (autoPlayRef.current) {
        clearInterval(autoPlayRef.current);
        autoPlayRef.current = null;
      }
    };
  }, [autoPlay, autoPlayInterval, loop, totalSlides, scrollToSlide, emitSlideChange]);

  // Sync activeIndex when the scroll container is scrolled manually (e.g. native snap)
  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const slideSize = vertical ? container.offsetHeight : container.offsetWidth;
    if (slideSize === 0) return;
    const position = vertical ? container.scrollTop : container.scrollLeft;
    const newIndex = Math.round(position / slideSize);
    if (newIndex < 0 || newIndex >= totalSlides) return;
    setActiveIndex(newIndex);
    // Announce only where a snap settles, so a programmatic or mid-gesture pass over a card stays silent.
    if (Math.abs(position - newIndex * slideSize) <= 1 && newIndex !== announcedIndex.current) {
      emitSlideChange(newIndex);
    }
  }, [totalSlides, vertical, emitSlideChange]);

  useEffect(() => {
    if (!loadMoreEvent || !hasMore || isLoadingMore || totalSlides === 0) return;
    if (activeIndex < totalSlides - 1 - loadMoreAhead) return;
    if (loadRequestedAt.current === totalSlides) return;
    loadRequestedAt.current = totalSlides;
    eventBus.emit(`UI:${loadMoreEvent}`, { index: activeIndex });
  }, [activeIndex, totalSlides, loadMoreEvent, hasMore, isLoadingMore, loadMoreAhead, eventBus]);

  // A vertical full-height feed lives in pages that scroll, where `100%` has no definite parent:
  // bound it to the viewport below its own top edge instead.
  const viewportBound = vertical && fullHeight;
  useLayoutEffect(() => {
    if (!viewportBound || typeof window === 'undefined') return;
    const measure = () => {
      const root = rootRef.current;
      if (root) setTopOffset(Math.max(0, Math.round(root.getBoundingClientRect().top)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [viewportBound]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const next = vertical ? ['ArrowDown', 'PageDown'] : ['ArrowRight'];
      const prev = vertical ? ['ArrowUp', 'PageUp'] : ['ArrowLeft'];
      if (next.includes(e.key)) {
        e.preventDefault();
        goNext();
      } else if (prev.includes(e.key)) {
        e.preventDefault();
        goPrev();
      }
    },
    [vertical, goNext, goPrev],
  );

  const hasPrev = loop || activeIndex > 0;
  const hasNext = loop || activeIndex < totalSlides - 1;

  if (totalSlides === 0) return null;

  return (
    <Box
      position="relative"
      overflow="hidden"
      role="region"
      aria-roledescription={t('aria.carousel')}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      {...domPassthrough(rest)}
      ref={rootRef}
      className={cn('w-full', fullHeight && !viewportBound && 'h-full', className)}
      style={viewportBound ? { height: `calc(100svh - ${topOffset}px)` } : undefined}
    >
      {/* Slide track */}
      <Box
        ref={scrollRef}
        display="flex"
        overflow="auto"
        className={cn(
          'w-full',
          'scroll-smooth',
          'scrollbar-none',
          vertical ? '[scroll-snap-type:y_mandatory]' : '[scroll-snap-type:x_mandatory]',
          '[&::-webkit-scrollbar]:hidden',
          '[-ms-overflow-style:none]',
        )}
        style={{
          flexDirection: vertical ? 'column' : 'row',
          scrollSnapType: vertical ? 'y mandatory' : 'x mandatory',
          height: fullHeight ? '100%' : undefined,
          WebkitOverflowScrolling: 'touch',
        }}
        onScroll={handleScroll}
        onPointerDown={swipeHandlers.onPointerDown}
        onPointerMove={swipeHandlers.onPointerMove}
        onPointerUp={swipeHandlers.onPointerUp}
        onPointerCancel={swipeHandlers.onPointerCancel}
      >
        {safeItems.map((item, index) => (
          <Box
            key={index}
            className={cn(
              'flex-shrink-0 w-full',
              '[scroll-snap-align:start]',
            )}
            style={{
              scrollSnapAlign: 'start',
              scrollSnapStop: vertical ? 'always' : undefined,
              height: fullHeight ? '100%' : undefined,
            }}
          >
            {(renderItem ?? children)?.(item, index)}
          </Box>
        ))}
      </Box>

      {/* Previous arrow */}
      {showArrows && hasPrev && totalSlides > 1 && (
        <Box
          position="absolute"
          className={vertical ? 'right-2 top-2 z-10' : 'left-2 top-1/2 -translate-y-1/2 z-10'}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={goPrev}
            aria-label={t('aria.previousSlide')}
            className={cn(
              'rounded-full',
              'bg-surface/80',
              'backdrop-blur-sm',
              'shadow-elevation-interactive',
              'hover:bg-surface',
            )}
          >
            {vertical ? <ChevronUp className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </Button>
        </Box>
      )}

      {/* Next arrow */}
      {showArrows && hasNext && totalSlides > 1 && (
        <Box
          position="absolute"
          className={vertical ? 'right-2 bottom-2 z-10' : 'right-2 top-1/2 -translate-y-1/2 z-10'}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={goNext}
            aria-label={t('aria.nextSlide')}
            className={cn(
              'rounded-full',
              'bg-surface/80',
              'backdrop-blur-sm',
              'shadow-elevation-interactive',
              'hover:bg-surface',
            )}
          >
            {vertical ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </Button>
        </Box>
      )}

      {/* Dot indicators */}
      {showDots && totalSlides > 1 && (
        <Box
          position="absolute"
          className="bottom-3 left-0 right-0 z-10"
        >
          <HStack gap="xs" align="center" justify="center" role="tablist" aria-label={t('aria.carouselSlides')}>
            {safeItems.map((_, index) => {
              const isActive = index === activeIndex;
              return (
                <Box
                  key={index}
                  className={cn(
                    'rounded-full cursor-pointer transition-all duration-fast',
                  )}
                  style={{
                    width: isActive ? 10 : 8,
                    height: isActive ? 10 : 8,
                    backgroundColor: isActive
                      ? 'var(--color-primary)'
                      : 'var(--color-muted, #d4d4d8)',
                    opacity: isActive ? 1 : 0.6,
                  }}
                  {...pressableProps(() => goToSlide(index))}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  aria-label={t('carousel.goToSlide', { number: index + 1 })}
                />
              );
            })}
          </HStack>
        </Box>
      )}
    </Box>
  );
};

(Carousel as React.FC).displayName = 'Carousel';