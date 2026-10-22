"use strict";

/**
 * Forbid the `x as unknown as T` double-cast chain (CLAUDE.md "Type safety —
 * Zero `as any` / `unknown` / `as unknown as X`"). The pattern routes an
 * arbitrarily-typed value through `unknown` purely to defeat structural
 * checking before landing it on a target type — the value is never actually
 * narrowed, so the compiler stops verifying the cast at all.
 *
 * Flags a `TSAsExpression` whose own expression is itself a `TSAsExpression`
 * to `unknown` — i.e. an `as unknown` that exists only as a step toward
 * another cast, not a value genuinely left as `unknown`. A terminal
 * `x as unknown` (nothing casts it further) is not itself reported by this
 * rule — `almadar/no-unknown-type` already owns flagging bare `unknown`.
 */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow the `x as unknown as T` double-cast chain — type the value or parse it instead",
      category: "Almadar Architecture",
    },
    messages: {
      noAsUnknownAs:
        "Double cast via `as unknown as` is forbidden (CLAUDE.md type-safety rule) — type the value or parse it",
    },
    schema: [],
  },

  create(context) {
    return {
      TSAsExpression(node) {
        const inner = node.expression;
        if (
          inner &&
          inner.type === "TSAsExpression" &&
          inner.typeAnnotation &&
          inner.typeAnnotation.type === "TSUnknownKeyword"
        ) {
          context.report({ node, messageId: "noAsUnknownAs" });
        }
      },
    };
  },
};
