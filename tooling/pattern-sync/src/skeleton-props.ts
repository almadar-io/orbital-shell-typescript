/**
 * Universal awaiting-skeleton prop. A data component declares `skeleton`
 * (core `SkeletonSpec`) with its natural shape as the TS prop default and
 * draws it in its own loading state; orbital-compiler folds the same values
 * into the skeleton an empty slot shows while the server renders. Every
 * other pattern forwarding `className` gets it injected with no default and
 * `kind: "skeleton"`, so a `.lolo` element can give any leaf a shape (or
 * `none`) — both execution paths strip the injected one before the component.
 */
import { SKELETON_VARIANTS } from "@almadar/core";
import type { PatternEntry } from "./types.js";

type PropsSchema = PatternEntry["propsSchema"];

const DESCRIPTION =
  "Skeleton shown while this element's server render is in flight: a shape (`table`, `list`, …), `{ variant, rows?, columns?, fields? }`, or `none`.";

export function withSkeletonProps(propsSchema: PropsSchema, declaresSpec: boolean): PropsSchema {
  const declared = propsSchema.skeleton;
  // A declared `skeleton` of another type is that pattern's own vocabulary (draw-group's boolean rig scope).
  if (declared !== undefined && !declaresSpec) return propsSchema;
  if (declared === undefined && !("className" in propsSchema)) return propsSchema;
  return {
    ...propsSchema,
    skeleton: {
      types: ["string", "object"],
      description: declared?.description || DESCRIPTION,
      enumValues: [...SKELETON_VARIANTS, "none"],
      properties: {
        variant: { types: ["string"], enumValues: [...SKELETON_VARIANTS] },
        rows: { types: ["number"] },
        columns: { types: ["number"] },
        fields: { types: ["number"] },
      },
      propertyRequired: ["variant"],
      ...(declared === undefined ? { kind: "skeleton" as const } : {}),
      ...(declared?.default !== undefined ? { default: declared.default } : {}),
      tier: "presentation",
    },
  };
}
