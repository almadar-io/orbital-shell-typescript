/**
 * Element entry — the one mechanism behind a render-ui node's `enter` and a
 * slot's theme-default entry. Pure CSS (`themes/_base.css`): the classes name
 * keyframes whose shape, timing and default are theme tokens. Both execution
 * paths call these helpers — the runtime renderer per node, and the compiled
 * emitter's generated JSX — so the two never diverge.
 *
 * Off when the theme sets `--motion-enable: off`; the OS reduced-motion
 * setting collapses the keyframes in `_base.css`.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { ENTER_ANIMATIONS, ENTER_DELAY_STEPS, type EnterAnimation } from "@almadar/core";
import { isMotionEnabled } from '../core';

/** Plays the theme's `--motion-enter-default` keyframe on a slot's content box. */
export const ENTER_SLOT_CLASS = "almadar-enter-slot";

/** Narrows a prop value to the entry vocabulary (anything else is not an entry). */
export function asEnterAnimation(value: string | undefined): EnterAnimation | undefined {
  return ENTER_ANIMATIONS.find((e) => e === value);
}

/** Highest `enterDelay` step (`almadar-enter-delay-1` … `-8` in `_base.css`). */
export const MAX_ENTER_DELAY = ENTER_DELAY_STEPS.length;

/**
 * The class a node's declared `enter` (+ optional stagger step `enterDelay`)
 * adds to its element. `none` and an unset `enter` add nothing.
 */
export function enterClassName(enter: EnterAnimation | undefined, enterDelay?: number): string | undefined {
  if (enter === undefined || enter === "none" || !isMotionEnabled()) return undefined;
  const base = `almadar-enter-${enter}`;
  if (enterDelay === undefined || !Number.isInteger(enterDelay) || enterDelay < 1 || enterDelay > MAX_ENTER_DELAY) return base;
  return `${base} almadar-enter-delay-${enterDelay}`;
}

/** Whether a slot plays the theme's default entry: not when its root node declares its own. */
export function slotPlaysDefaultEnter(rootEnter: EnterAnimation | undefined): boolean {
  return rootEnter === undefined && isMotionEnabled();
}

/**
 * Restarts the slot entry on `el` whenever `contentKey` changes (a different
 * trait or root pattern took the slot) without remounting the content — a
 * data refresh of the same content keeps the same key and does not replay.
 */
export function useSlotEnterRestart(ref: RefObject<HTMLElement | null>, contentKey: string, active: boolean): void {
  const lastKey = useRef(contentKey);
  useLayoutEffect(() => {
    if (lastKey.current === contentKey) return;
    lastKey.current = contentKey;
    const el = ref.current;
    if (!el || !active) return;
    el.classList.remove(ENTER_SLOT_CLASS);
    void el.offsetWidth;
    el.classList.add(ENTER_SLOT_CLASS);
  }, [contentKey, active, ref]);
}
