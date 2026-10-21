/** The theme's motion tokens, read at the moment a script-driven animation starts. */
import { isMotionEnabled } from "../atoms/Presence";

/** A CSS `<time>` (`400ms`, `.4s`) in milliseconds; NaN when it is not one. */
export function cssTimeMs(value: string): number {
  const v = value.trim();
  if (v.endsWith("ms")) return Number.parseFloat(v);
  if (v.endsWith("s")) return Number.parseFloat(v) * 1000;
  return Number.NaN;
}

/** A custom property's value as it resolves at `el`: the nearest element (itself first) that resolves it. */
function tokenAt(el: Element, name: string): string {
  for (let at: Element | null = el; at !== null; at = at.parentElement) {
    const value = getComputedStyle(at).getPropertyValue(name).trim();
    if (value !== "") return value;
  }
  return "";
}

/**
 * Duration + easing from the named tokens as they resolve at `scope` (default: the page root),
 * or undefined when motion is off (theme, OS reduced motion, or tokens absent).
 */
export function motionTiming(durationToken: string, easingToken: string, scope?: Element): { duration: number; easing: string } | undefined {
  const duration = cssTimeMs(tokenAt(scope ?? document.documentElement, durationToken));
  const easing = tokenAt(scope ?? document.documentElement, easingToken);
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!isMotionEnabled() || reduced || !Number.isFinite(duration) || easing === "") return undefined;
  return { duration, easing };
}

/**
 * How much `el` is scaled on screen by transforms above it (a desktop-size demo scaled to fit):
 * its on-screen width over its layout width; 1 when it is not laid out. Script-driven motion
 * measures on screen and animates in layout pixels, so it divides by this.
 */
export function layoutScale(el: Element): number {
  const layoutWidth = el instanceof HTMLElement ? el.offsetWidth : 0;
  const screenWidth = el.getBoundingClientRect().width;
  return layoutWidth > 0 && screenWidth > 0 ? screenWidth / layoutWidth : 1;
}
