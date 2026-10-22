/**
 * Awaiting-server skeletons — the platform-neutral contract.
 *
 * A server-backed trait renders through a server round trip (on entering the
 * screen and on events that open a new view). While it waits, an empty slot
 * (or embedded frame) shows a skeleton shaped like what the server WILL render:
 * - every data pattern declares its natural shape as the default of its
 *   universal `skeleton` prop, and a `.lolo` element may override it
 *   (`skeleton: list`, `skeleton: { variant: table, rows: 6 }`, `skeleton: none`);
 * - orbital-compiler (enrich, resolve/codegen only — never persisted) folds the
 *   render a transition's server effects lead to into a `SkeletonNode` and
 *   attaches it to the transition as `awaitRender`;
 * - each execution engine marks a trait as awaiting from server-leg send until
 *   fold or error (`AwaitingTrait`), and the shell draws the node.
 */
import { z } from "zod";

/** The skeleton shapes every shell can draw. */
export const SKELETON_VARIANTS = ["header", "table", "list", "grid", "detail", "stats", "form", "card", "text"] as const;
export type SkeletonVariant = (typeof SKELETON_VARIANTS)[number];
export const SkeletonVariantSchema = z.enum(SKELETON_VARIANTS);

/** A sized shape. `rows` for table/list/text, cards for grid, field pairs for detail; `columns` for table/stats; `fields` for form. */
export type SkeletonShape = {
  variant: SkeletonVariant;
  rows?: number;
  columns?: number;
  fields?: number;
};

export const SkeletonShapeSchema = z.object({
  variant: SkeletonVariantSchema,
  rows: z.number().int().positive().optional(),
  columns: z.number().int().positive().optional(),
  fields: z.number().int().positive().optional(),
});

/**
 * The universal `skeleton` prop value on a render-ui node: a shape name, a
 * sized shape, or `none` (this element contributes no skeleton).
 */
export type SkeletonSpec = SkeletonVariant | "none" | SkeletonShape;

export const SkeletonSpecSchema = z.union([SkeletonVariantSchema, z.literal("none"), SkeletonShapeSchema]);

/** A predicted skeleton: one shape, or a vertical stack of nodes (a container's children). */
export type SkeletonNode = { shape: SkeletonShape } | { stack: SkeletonNode[] };

export const SkeletonNodeSchema: z.ZodType<SkeletonNode> = z.lazy(() =>
  z.union([z.object({ shape: SkeletonShapeSchema }), z.object({ stack: z.array(SkeletonNodeSchema) })]),
);

/**
 * One predicted render a transition's server effects lead to: `trait` (the seed
 * itself, or a listener reached across the declared listens graph) will render
 * into `slot` something shaped like `skeleton`.
 */
export type AwaitRender = {
  trait: string;
  slot: string;
  skeleton: SkeletonNode;
};

export const AwaitRenderSchema = z.object({
  trait: z.string(),
  slot: z.string(),
  skeleton: SkeletonNodeSchema,
});

/**
 * Kernel contract: a non-local trait is awaiting from its server leg's send
 * until the fold (or error), keyed by the transition its local run took.
 * Local/hybrid traits and tick legs are never awaiting.
 */
export type AwaitingTrait = {
  trait: string;
  event: string;
  /** `from` state of the transition the local run took (with `event`, identifies its `awaitRender`). */
  from: string;
};
