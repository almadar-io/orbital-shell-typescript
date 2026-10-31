/**
 * Universal element-entry props. Every pattern whose component forwards
 * `className` can animate in: `enter` names the entry (core's vocabulary),
 * `enterDelay` its stagger step. `kind: "entry"` tells both execution paths
 * to turn them into the element's entry class (`@almadar/shell-web` lib/enter)
 * rather than pass them to the component.
 */
import { ENTER_ANIMATIONS, ENTER_DELAY_STEPS } from "@almadar/core";
import type { PatternEntry } from "./types.js";

type PropsSchema = PatternEntry["propsSchema"];

export function withEntryProps(propsSchema: PropsSchema): PropsSchema {
  if (!("className" in propsSchema)) return propsSchema;
  return {
    ...propsSchema,
    enter: {
      types: ["string"],
      description: "How this element animates in when it mounts (theme-styled); overrides the theme's default slot entry. `none` opts out.",
      enumValues: [...ENTER_ANIMATIONS],
      kind: "entry",
    },
    enterDelay: {
      types: ["number"],
      description: "Stagger step for the entry: waits this many `--motion-enter-stagger` steps before animating.",
      numericEnumValues: [...ENTER_DELAY_STEPS],
      kind: "entry",
    },
  };
}
