'use client';
/**
 * PageTransition Molecule — animates routed content in on navigation.
 *
 * Each change of `locationKey` restarts the `animate-page-in` keyframes on the
 * wrapper WITHOUT remounting its children, so component state survives. The
 * motion shape is the `--motion-page-enter-*` token (a theme's
 * `motion.shapes.pageEnter`); `--motion-enable: off` / reduced motion disable it.
 *
 * Nesting: the innermost transition owns the animation. A layout's content
 * region (DashboardLayout's `<main>`) wraps its children in a PageTransition,
 * which claims the enclosing one (the preview host) — so the sidebar and top
 * bar never re-animate, only the page content does. A page with no such layout
 * is animated by the host.
 *
 * Router-agnostic: the consumer supplies the key (a page path).
 *
 * @packageDocumentation
 */

import type { A11yProps } from '@almadar/core';
import React, { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from "react";
import { cn } from '../../../core';
import { Box } from '../../../core';
import { isMotionEnabled } from '../../../core';

import { domPassthrough } from '../../../core';
const PAGE_IN = "animate-page-in";

/** Registers a nested PageTransition with its enclosing one; returns the release. */
type ClaimPageTransition = () => () => void;

const PageTransitionScopeContext = createContext<ClaimPageTransition | null>(null);

export interface PageTransitionProps extends A11yProps {
  /** Value that changes on navigation (a page path). */
  locationKey: string;
  children: React.ReactNode;
  className?: string;
}

export const PageTransition: React.FC<PageTransitionProps> = ({ locationKey, children, className, ...rest }) => {
  const claimEnclosing = useContext(PageTransitionScopeContext);
  const [claims, setClaims] = useState(0);
  const claim = useCallback<ClaimPageTransition>(() => {
    setClaims((c) => c + 1);
    return () => setClaims((c) => c - 1);
  }, []);
  // Layout effect: the claim lands before first paint, so a claimed host
  // never paints its own enter animation.
  useLayoutEffect(() => claimEnclosing?.(), [claimEnclosing]);

  const owns = claims === 0 && isMotionEnabled();
  const ref = useRef<HTMLDivElement>(null);
  const lastKey = useRef(locationKey);
  useLayoutEffect(() => {
    if (lastKey.current === locationKey) return;
    lastKey.current = locationKey;
    const el = ref.current;
    if (!el || !owns) return;
    el.classList.remove(PAGE_IN);
    void el.offsetWidth;
    el.classList.add(PAGE_IN);
  }, [locationKey, owns]);

  return (
    <PageTransitionScopeContext.Provider value={claim}>
      <Box ref={ref} {...domPassthrough(rest)} data-page-transition={owns ? "owner" : "claimed"} className={cn(owns && PAGE_IN, className)}>
        {children}
      </Box>
    </PageTransitionScopeContext.Provider>
  );
};

PageTransition.displayName = "PageTransition";
