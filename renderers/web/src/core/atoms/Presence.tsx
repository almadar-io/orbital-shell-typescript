'use client';
/**
 * Presence Atom — the single enter/leave animation mechanism.
 *
 * React unmounts children synchronously, so an exit animation is impossible
 * unless a wrapper keeps the child mounted for one more frame. `usePresence`
 * extracts Modal's `closing` + `onAnimationEnd` pattern into one reusable
 * hook; the `<Presence>` component is a thin wrapper for the arbitrary case.
 *
 * Every animated surface converges on this: Overlay/Drawer/SidePanel/Popover/
 * Toast call `usePresence` and spread the result onto their own element (no
 * extra wrapper div — important for fixed/absolute positioning). Token-driven:
 * the `animation` prop maps to the `animate-<name>-in/out` utilities, which
 * read `--motion-*` / `--duration-*` / `--easing-*`. Toggle off per-instance
 * (`animate={false}`), globally (`--motion-enable: off`), or via the OS
 * (`prefers-reduced-motion`, collapsed in `_base.css`).
 *
 * @packageDocumentation
 */

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../lib/domPassthrough';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";

export type PresenceAnimation =
  | "modal"
  | "overlay"
  | "slide-up"
  | "drawer"
  | "popover"
  | "toast"
  | "fade"
  | "page";

/** Fallback unmount if `onAnimationEnd` is missed (e.g. tab hidden). Covers up to `--duration-dramatic`. */
const SAFE_EXIT_MS = 1000;

let motionEnabledCache: boolean | null = null;
/** Whether token-driven motion is on (`--motion-enable` is not `off`). */
export function isMotionEnabled(): boolean {
  if (typeof document === "undefined") return true;
  if (motionEnabledCache !== null) return motionEnabledCache;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--motion-enable")
    .trim()
    .toLowerCase();
  motionEnabledCache = v !== "off";
  return motionEnabledCache;
}

export interface UsePresenceOptions {
  /** Which motion preset to use (maps to `animate-<name>-in/out`). */
  animation: PresenceAnimation;
  /** Per-instance opt-out. Global opt-out is `--motion-enable` / reduced-motion. @default true */
  animate?: boolean;
  /**
   * Fired after the exit animation completes (before unmount).
   * @notification
   */
  onExited?: () => void;
}

export interface PresenceResult {
  /** Whether the element should be in the tree (enter or exit phase). */
  mounted: boolean;
  /** True during the exit animation. */
  exiting: boolean;
  /** Class to merge onto the animated element: `animate-<name>-in` or `-out` (empty if disabled). */
  className: string;
  /** Attach to the animated element's `onAnimationEnd`. */
  onAnimationEnd: (e: React.AnimationEvent) => void;
}

/**
 * The single enter/leave mechanism. Call from a molecule, spread `className`
 * (via `cn`) and `onAnimationEnd` onto the element that carries the animation.
 */
export function usePresence(show: boolean, opts: UsePresenceOptions): PresenceResult {
  const { animation, animate = true, onExited } = opts;
  const [mounted, setMounted] = useState(show);
  const [exiting, setExiting] = useState(false);
  const prev = useRef(show);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  const safeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSafe = useCallback(() => {
    if (safeTimer.current) {
      clearTimeout(safeTimer.current);
      safeTimer.current = null;
    }
  }, []);

  const finishExit = useCallback(() => {
    clearSafe();
    setExiting(false);
    setMounted(false);
    onExitedRef.current?.();
  }, [clearSafe]);

  // useLayoutEffect (not useEffect) so mounted/exiting flip BEFORE paint —
  // otherwise the first render of a transition returns null and the element
  // vanishes with no animation (the Modal null-frame bug).
  useLayoutEffect(() => {
    const moving = animate && isMotionEnabled();
    if (show && !prev.current) {
      setExiting(false);
      setMounted(true);
    } else if (!show && prev.current) {
      if (moving) {
        setExiting(true);
        clearSafe();
        safeTimer.current = setTimeout(finishExit, SAFE_EXIT_MS);
      } else {
        setMounted(false);
        setExiting(false);
        onExitedRef.current?.();
      }
    }
    prev.current = show;
  }, [show, animate, clearSafe, finishExit]);

  useEffect(() => () => clearSafe(), [clearSafe]);

  const disabled = !animate || !isMotionEnabled();
  // Base the direction on `show`, NOT `exiting`. `finishExit` calls
  // setExiting(false) + setMounted(false); if those ever land in separate
  // renders there is a frame where mounted=true && exiting=false, which an
  // `exiting ? out : in` derivation would misread as enter (re-playing the
  // in-animation → flicker). `show` is already false throughout exit, so
  // `show ? in : out` can never flip back to "in" once closing begins.
  const className = disabled
    ? ""
    : show
      ? `animate-${animation}-in`
      : `animate-${animation}-out`;

  const onAnimationEnd = useCallback(
    (e: React.AnimationEvent) => {
      if (e.target !== e.currentTarget) return;
      if (exiting) finishExit();
    },
    [exiting, finishExit],
  );

  return { mounted, exiting, className, onAnimationEnd };
}

export interface PresenceProps extends UsePresenceOptions, A11yProps {
  /** When false, the exit animation runs, then children unmount. */
  show: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Wrapper form of `usePresence` for arbitrary content that doesn't already
 * own its animated element. Renders a `<div>` carrying the animation class.
 */
export const Presence: React.FC<PresenceProps> = ({ show, className, children, ...rest }) => {
  const { mounted, className: animClass, onAnimationEnd } = usePresence(show, rest);
  if (!mounted) return null;
  return (
    <div className={cn(animClass, className)} onAnimationEnd={onAnimationEnd} {...domPassthrough(rest)}>
      {children}
    </div>
  );
};

Presence.displayName = "Presence";
