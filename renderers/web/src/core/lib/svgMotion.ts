/**
 * SVG atom motion. The keyframes and their timing live in `themes/_base.css`;
 * these are the only class names the svg atoms put on an element.
 */
import { isMotionEnabled } from "../atoms/Presence";

export const SVG_MOTION_CLASSES = {
  flowDash: "almadar-svg-flow-dash",
  pulseRing: "almadar-svg-pulse-ring",
  pulseExpand: "almadar-svg-pulse-expand",
} as const;

export type SvgMotion = keyof typeof SVG_MOTION_CLASSES;

/** The class for `motion` when the element animates and theme motion is on. */
export function svgMotionClass(motion: SvgMotion, animated: boolean): string | undefined {
  if (!animated || !isMotionEnabled()) return undefined;
  return SVG_MOTION_CLASSES[motion];
}
