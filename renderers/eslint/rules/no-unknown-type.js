"use strict";

/**
 * Forbid `unknown` as a type annotation or cast target — fix the actual
 * type issue instead. Mirrors `no-as-any` but for `unknown`.
 *
 * Rationale: `unknown` is technically safe (you can't use it until you
 * narrow it), but in this codebase it gets used as a lazy escape hatch
 * on trace events, service results, API boundaries — exactly where
 * typed interfaces from `@almadar/core` or service return types SHOULD
 * appear. Ban it across the board.
 *
 * Allowed contexts (where `unknown` is the idiomatic correct answer):
 *   - `catch (err: unknown)` — catch-clause parameter. TS 4.4+ idiom;
 *     the alternative is `any`, which is worse.
 *   - `<T extends unknown>` — generic parameter extends clause. `unknown`
 *     there is just "no constraint" and is sometimes required for
 *     conditional-type edge cases.
 *
 * Everything else — type annotations, return types, property types,
 * `as unknown` casts, type aliases — is flagged.
 */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `unknown` as a type annotation or cast target — use a real typed interface from @almadar/core or the relevant package instead",
      category: "Almadar Architecture",
    },
    messages: {
      noUnknownType:
        "Never use `unknown` as a type annotation or cast target. Fix the real type issue: import the right interface from @almadar/core (OrbitalSchema, Entity, Trait, Field, PatternConfig, Effect, Transition, PayloadField, ServiceParams, EntityRow, FieldValue) or the relevant package, or export a typed union from the producing module. Allowed only in `catch (err: unknown)` and generic `<T extends unknown>` clauses.",
    },
    schema: [],
  },

  create(context) {
    /** Walk up the parent chain looking for an allowed-context ancestor. */
    function isInAllowedContext(node) {
      let cur = node.parent;
      while (cur) {
        // catch (err: unknown)
        if (cur.type === "CatchClause") return true;
        // catch binding's type annotation wraps the unknown:
        //   CatchClause → Identifier → TSTypeAnnotation → TSUnknownKeyword
        if (
          cur.type === "TSTypeAnnotation" &&
          cur.parent &&
          cur.parent.type === "Identifier" &&
          cur.parent.parent &&
          cur.parent.parent.type === "CatchClause"
        ) {
          return true;
        }
        // <T extends unknown> — generic parameter's extends clause
        if (cur.type === "TSTypeParameter") return true;
        cur = cur.parent;
      }
      return false;
    }

    return {
      TSUnknownKeyword(node) {
        if (isInAllowedContext(node)) return;
        context.report({ node, messageId: "noUnknownType" });
      },
    };
  },
};
