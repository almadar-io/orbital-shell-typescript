'use client';

import type { A11yProps, EventKey } from '@almadar/core';
import React, { useEffect, useRef, useState, useCallback, useId } from 'react';
import { cn } from '../lib/cn';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { useEventBus } from '../hooks/useEventBus';
import { createLogger } from '@almadar/logger';

const revealLog = createLogger('almadar:ui:animated-reveal');

export type RevealTrigger = 'scroll' | 'hover' | 'manual';
export type RevealAnimation =
  | 'fade-up'
  | 'fade-down'
  | 'fade-in'
  | 'fade-left'
  | 'fade-right'
  | 'scale'
  | 'scale-up'
  | 'none';

export interface AnimatedRevealProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | keyof A11yProps>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  /** What triggers the animation */
  trigger?: RevealTrigger;
  /** Built-in animation preset */
  animation?: RevealAnimation;
  /** Animation duration in ms (default: 600) */
  duration?: number;
  /** Delay before animation starts in ms (default: 0) */
  delay?: number;
  /** How much of the element must be visible before triggering, 0-1 (default: 0.15) */
  threshold?: number;
  /**
   * scroll trigger: event emitted once (as UI:{revealEvent}) the first time the element scrolls into view; never under reduced motion
   * @notification
   */
  revealEvent?: EventKey;
  /**
   * scroll trigger: event emitted (as UI:{enterEvent}) every time the element enters the view
   * @notification
   */
  enterEvent?: EventKey;
  /**
   * scroll trigger: event emitted (as UI:{leaveEvent}) every time the element leaves the view after having entered it
   * @notification
   */
  leaveEvent?: EventKey;
  /** Animate only the first time the element enters the viewport (default: true) */
  once?: boolean;
  /** Manual control: when trigger='manual', set this to true to animate */
  animate?: boolean;
  /** Easing function (default: cubic-bezier(0.16, 1, 0.3, 1)) */
  easing?: string;
  /** Children: ReactNode or render function receiving animated state */
  children: React.ReactNode | ((animated: boolean) => React.ReactNode);
}

/** Steps up to `threshold`, so a band taller than the viewport reports as it scrolls in. */
function revealThresholds(threshold: number): number[] {
  const steps = Array.from({ length: 20 }, (_, i) => (i * threshold) / 20);
  return [...steps, threshold];
}

const initialStyles: Record<RevealAnimation, React.CSSProperties> = {
  'fade-up': { opacity: 0, transform: 'translateY(24px)' },
  'fade-down': { opacity: 0, transform: 'translateY(-24px)' },
  'fade-in': { opacity: 0 },
  'fade-left': { opacity: 0, transform: 'translateX(24px)' },
  'fade-right': { opacity: 0, transform: 'translateX(-24px)' },
  'scale': { opacity: 0, transform: 'scale(0.92)' },
  'scale-up': { opacity: 0, transform: 'scale(0.92) translateY(16px)' },
  'none': {},
};

const animatedStyles: Record<RevealAnimation, React.CSSProperties> = {
  'fade-up': { opacity: 1, transform: 'translateY(0)' },
  'fade-down': { opacity: 1, transform: 'translateY(0)' },
  'fade-in': { opacity: 1 },
  'fade-left': { opacity: 1, transform: 'translateX(0)' },
  'fade-right': { opacity: 1, transform: 'translateX(0)' },
  'scale': { opacity: 1, transform: 'scale(1)' },
  'scale-up': { opacity: 1, transform: 'scale(1) translateY(0)' },
  'none': {},
};

export const AnimatedReveal = React.forwardRef<HTMLDivElement, AnimatedRevealProps>(
  (
    {
      trigger = 'scroll',
      animation = 'fade-up',
      duration = 600,
      delay = 0,
      threshold = 0.15,
      once = true,
      revealEvent,
      enterEvent,
      leaveEvent,
      animate: manualAnimate,
      easing = 'cubic-bezier(0.16, 1, 0.3, 1)',
      children,
      className,
      style,
      ...props
    },
    forwardedRef,
  ) => {
    const [isAnimated, setIsAnimated] = useState(false);
    const reducedMotion = usePrefersReducedMotion();
    const eventBus = useEventBus();
    const revealEmitted = useRef(false);
    const internalRef = useRef<HTMLDivElement>(null);
    const hasAnimated = useRef(false);
    const inView = useRef(false);
    const revealId = useId();

    // Merge forwarded ref with internal ref
    const setRef = useCallback(
      (node: HTMLDivElement | null) => {
        (internalRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [forwardedRef],
    );

    // Scroll trigger via IntersectionObserver
    useEffect(() => {
      if (trigger !== 'scroll') return;
      const el = internalRef.current;
      if (!el) return;

      // The section's own heading names it in the log; ids alone cannot be matched to a section.
      const section = (): string | null => el.querySelector('h1, h2, h3')?.textContent ?? null;
      revealLog.debug('observe', () => ({ id: revealId, section: section(), threshold, once, animated: hasAnimated.current }));
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting !== inView.current) {
            const event = entry.isIntersecting ? enterEvent : leaveEvent;
            inView.current = entry.isIntersecting;
            if (event) eventBus.emit(`UI:${event}`, {});
          }
          // `threshold` of the element visible, or — for a band taller than the viewport,
          // which can never show that much of itself — `threshold` of the viewport filled.
          const seenEnough = entry.isIntersecting && (
            entry.intersectionRatio >= threshold
            || (entry.rootBounds !== null && entry.intersectionRect.height >= threshold * entry.rootBounds.height)
          );
          revealLog.debug('entry', () => ({
            id: revealId,
            section: section(),
            seenEnough,
            animated: hasAnimated.current,
            intersecting: entry.isIntersecting,
            ratio: entry.intersectionRatio,
            visibleHeight: entry.intersectionRect.height,
            rootHeight: entry.rootBounds?.height ?? null,
          }));
          if (seenEnough) {
            // Independent of `once`: the event may arrive on a later render than the first reveal.
            if (revealEvent && !reducedMotion && !revealEmitted.current) {
              revealEmitted.current = true;
              revealLog.debug('reveal event', { event: revealEvent });
              eventBus.emit(`UI:${revealEvent}`, {});
            }
            if (once && hasAnimated.current) return;
            hasAnimated.current = true;
            revealLog.debug('revealed', () => ({ id: revealId, section: section() }));
            setIsAnimated(true);
          } else if (!entry.isIntersecting && !once) {
            setIsAnimated(false);
          }
        },
        { threshold: revealThresholds(threshold) },
      );

      observer.observe(el);
      return () => {
        revealLog.debug('disconnect', () => ({ id: revealId, section: section(), animated: hasAnimated.current }));
        observer.disconnect();
      };
    }, [trigger, threshold, once, revealEvent, enterEvent, leaveEvent, reducedMotion, eventBus, revealId]);

    // Off-screen bands pause their CSS animations (tailwind preset); written to the DOM so scrolling re-renders nothing.
    useEffect(() => {
      const el = internalRef.current;
      if (!el || typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver(
        ([entry]) => { el.dataset.onScreen = entry.isIntersecting ? 'true' : 'false'; },
        { rootMargin: '200px' },
      );
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    // Hover trigger
    const handleMouseEnter = trigger === 'hover' ? () => setIsAnimated(true) : undefined;
    const handleMouseLeave = trigger === 'hover' ? () => { if (!once || !hasAnimated.current) { hasAnimated.current = true; setIsAnimated(false); } } : undefined;

    // Manual trigger
    useEffect(() => {
      if (trigger === 'manual' && manualAnimate !== undefined) {
        setIsAnimated(manualAnimate);
      }
    }, [trigger, manualAnimate]);

    const active = isAnimated || reducedMotion;
    const currentStyle = active ? animatedStyles[animation] : initialStyles[animation];

    return (
      <div
        ref={setRef}
        className={cn(className)}
        style={{
          ...currentStyle,
          // A revealed band is page-sized: keeping the layer hint after the reveal holds a huge GPU layer.
          willChange: active ? 'auto' : 'opacity, transform',
          transitionProperty: 'opacity, transform',
          transitionDuration: reducedMotion ? '0ms' : `${duration}ms`,
          transitionDelay: `${delay}ms`,
          transitionTimingFunction: easing,
          ...style,
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        {typeof children === 'function' ? children(active) : children}
      </div>
    );
  },
);

AnimatedReveal.displayName = 'AnimatedReveal';
