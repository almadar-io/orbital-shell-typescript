/**
 * Trait-binding resolver for the interpreted runtime path.
 *
 * When a pattern tree contains a string like `"@trait.ItemSearch"` or
 * `"@trait.ItemSearch.main"` inside a `children:` array (or a
 * `node`-typed prop), the `SlotContentRenderer` walker calls this
 * resolver to transform those string leaves into `<TraitFrame>` React
 * elements before rendering.
 *
 * This module only handles the INTERPRETED path — compiled apps bake
 * `<TraitFrame>` into JSX at build time via the TypeScript shell
 * codegen (`orbital-shell-typescript/src/backend.rs`). Both paths land
 * on the same component.
 *
 * Scope:
 *   - string values `"@trait.X[.slot]"` are replaced with
 *     `<TraitFrame traitName="X" slot={...} />`.
 *   - strings that don't match the `@trait.*` shape pass through
 *     verbatim (they may be `@entity.X` bindings resolved elsewhere,
 *     or plain text content).
 *   - recurses into arrays and objects so nested children are covered.
 *
 * @see docs/Almadar_Std_Gaps.md §3.8
 */

import React from "react";
import type { FieldValue } from "@almadar/core";
import { TraitFrame } from "../components/core/atoms/TraitFrame";
import { createLogger } from "@almadar/logger";

const log = createLogger("almadar:ui:trait-binding-resolver");

/**
 * Matches exactly `@trait.<PascalName>` — single-segment binding.
 * Any extra segment (`@trait.Foo.bar`) is rejected at validate time by
 * the compiler (`ORB_BINDING_TRAIT_INVALID_FORMAT`), so the runtime
 * regex here stays strict and won't accept the extended form.
 */
const TRAIT_BINDING_RE = /^@trait\.([A-Z][A-Za-z0-9]*)$/;

export interface ResolveTraitBindingsContext {
  /**
   * Depth cap — the walker refuses to descend deeper than this to
   * protect against deeply nested patterns (real or adversarial).
   * Default 8; roughly matches the deepest layout trees seen in the
   * std catalog plus head-room.
   */
  depth?: number;
}

const DEFAULT_DEPTH = 8;

/**
 * Walk a pattern-tree value, returning a structurally-identical tree
 * with `@trait.*` string leaves replaced by `<TraitFrame>` React
 * elements.
 *
 * The walker preserves insertion order of object keys and array
 * positions — it only transforms the narrow subset of string values
 * that match the `@trait.X[.slot]` form. Other strings are copied as-is.
 *
 * Call from `SlotContentRenderer` once per render, pointed at
 * `content.props` with `currentSlot` bound to the slot whose render-ui
 * is being composed.
 */
type PatternTreeNode = FieldValue | React.ReactElement | undefined;

export function resolveTraitBindingsInPattern(
  value: PatternTreeNode,
  ctx: ResolveTraitBindingsContext,
): PatternTreeNode {
  const depth = ctx.depth ?? DEFAULT_DEPTH;
  if (depth <= 0) {
    log.warn("Depth cap hit; truncating pattern tree walk.");
    return value;
  }

  if (typeof value === "string") {
    const match = TRAIT_BINDING_RE.exec(value);
    if (!match) return value;
    const traitName = match[1];
    // Wrap as a keyed React element so React can reconcile correctly
    // when sibling children shift. Trait name is sufficient for the
    // key since the binding is single-segment.
    return React.createElement(TraitFrame, {
      key: `trait:${traitName}`,
      traitName,
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      resolveTraitBindingsInPattern(item as PatternTreeNode, { ...ctx, depth: depth - 1 }),
    ) as FieldValue[];
  }

  if (value && typeof value === "object" && !("type" in value && "props" in value && "key" in value)) {
    const source = value as Record<string, PatternTreeNode>;
    const out: Record<string, PatternTreeNode> = {};
    for (const key of Object.keys(source)) {
      out[key] = resolveTraitBindingsInPattern(source[key], {
        ...ctx,
        depth: depth - 1,
      });
    }
    return out as FieldValue;
  }

  return value;
}

/**
 * Lower-level helper: is this string a `@trait.*` binding the resolver
 * would handle? Useful for consumers that need to treat the trait case
 * specially before handing the string back to the walker.
 */
export function isTraitBinding(value: PatternTreeNode): value is string {
  return typeof value === "string" && TRAIT_BINDING_RE.test(value);
}
