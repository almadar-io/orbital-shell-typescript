"use strict";

/**
 * Forbid the JSON stringify -> parse round trip. `JSON.parse` returns `any`,
 * so `JSON.parse(JSON.stringify(x))` launders `x` past the type checker.
 * Also flags `JSON.parse(s)` when `s` is a variable bound only to a
 * `JSON.stringify(...)` call in scope.
 */

function isJsonCall(node, method) {
  return (
    node &&
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "JSON" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === method
  );
}

function unwrap(node) {
  let cur = node;
  while (
    cur &&
    (cur.type === "TSAsExpression" ||
      cur.type === "TSNonNullExpression" ||
      cur.type === "TSSatisfiesExpression" ||
      cur.type === "ChainExpression")
  ) {
    cur = cur.expression;
  }
  return cur;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow JSON.parse(JSON.stringify(x)) round trips, which launder a value's type",
      category: "Almadar Architecture",
    },
    messages: {
      noJsonRoundtrip:
        "JSON round trip launders the value's type; use structuredClone for a copy or a typed conversion",
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();

    function boundOnlyToStringify(identifier) {
      let scope = sourceCode.getScope
        ? sourceCode.getScope(identifier)
        : context.getScope();
      let variable = null;
      while (scope && !variable) {
        variable = scope.set.get(identifier.name) || null;
        scope = scope.upper;
      }
      if (!variable || variable.defs.length !== 1) return false;
      const def = variable.defs[0];
      if (def.type !== "Variable" || def.node.id.type !== "Identifier") return false;
      if (!isJsonCall(unwrap(def.node.init), "stringify")) return false;
      const writes = variable.references.filter((ref) => ref.isWrite());
      return writes.length === 1;
    }

    return {
      CallExpression(node) {
        if (!isJsonCall(node, "parse") || node.arguments.length === 0) return;
        const arg = unwrap(node.arguments[0]);
        if (
          isJsonCall(arg, "stringify") ||
          (arg.type === "Identifier" && boundOnlyToStringify(arg))
        ) {
          context.report({ node, messageId: "noJsonRoundtrip" });
        }
      },
    };
  },
};
