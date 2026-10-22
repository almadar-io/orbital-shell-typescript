"use strict";

const { isServiceFile } = require("../utils/helpers");

/**
 * Function calls that are safe at module scope.
 */
const SAFE_CALLS = new Set([
  "require",
  "Object.freeze",
  "Object.defineProperty",
  "Object.assign",
  "Object.create",
  "Symbol",
  "Symbol.for",
  "Array.from",
  "Array.of",
  "createLazyService",
  // Express route definitions at module scope are standard
  "registerIntegration",
  // dotenv config loading
  "dotenv.config",
]);

/**
 * Callee patterns that are safe at module scope (prefix match on member expressions).
 * Express router methods (router.get, router.post, etc.) and Commander (program.parse, etc.)
 */
const SAFE_MEMBER_PREFIXES = ["router.", "program."];

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Prevent top-level function calls at module scope — the .orb runtime controls when services start",
      category: "Almadar Services",
    },
    messages: {
      moduleSideEffect:
        "Top-level call to '{{name}}' runs at import time, bypassing .orb runtime control. Move into a factory function or get*() getter.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;
    if (!isServiceFile(filename)) return {};

    return {
      "Program > ExpressionStatement > CallExpression"(node) {
        const name = getCallName(node);
        if (name && !SAFE_CALLS.has(name) && !SAFE_MEMBER_PREFIXES.some(p => name.startsWith(p))) {
          context.report({
            node,
            messageId: "moduleSideEffect",
            data: { name },
          });
        }
      },
    };
  },
};

/**
 * Extract the human-readable name of a call expression.
 */
function getCallName(node) {
  const callee = node.callee;
  if (callee.type === "Identifier") {
    return callee.name;
  }
  if (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.property.type === "Identifier"
  ) {
    return callee.object.name + "." + callee.property.name;
  }
  return null;
}
