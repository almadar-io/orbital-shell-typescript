"use strict";

const { isServiceFile } = require("../utils/helpers");

/**
 * Built-in classes that are safe to construct at module scope.
 * These are lightweight, deterministic, and side-effect free.
 */
const SAFE_CONSTRUCTORS = new Set([
  "Set",
  "Map",
  "WeakMap",
  "WeakSet",
  "WeakRef",
  "Proxy",
  "RegExp",
  "URL",
  "URLSearchParams",
  "Date",
  "Error",
  "TypeError",
  "RangeError",
  "TextEncoder",
  "TextDecoder",
  "AbortController",
  "Headers",
  "FormData",
  "Blob",
  "Int8Array",
  "Uint8Array",
  "Float32Array",
  "Float64Array",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
]);

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Prevent eager singleton construction at module scope — use lazy get*()/reset*() pattern",
      category: "Almadar Services",
    },
    messages: {
      eagerSingleton:
        "Don't eagerly construct '{{name}}' at module scope. Use a lazy get*()/reset*() pattern so the .orb runtime controls initialization timing.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;
    if (!isServiceFile(filename)) return {};

    return {
      ExportNamedDeclaration(node) {
        if (!node.declaration || node.declaration.type !== "VariableDeclaration") return;

        for (const declarator of node.declaration.declarations) {
          if (
            declarator.init &&
            declarator.init.type === "NewExpression"
          ) {
            const callee = declarator.init.callee;
            const name =
              callee.type === "Identifier"
                ? callee.name
                : callee.type === "MemberExpression" && callee.property.type === "Identifier"
                  ? callee.property.name
                  : null;

            if (name && !SAFE_CONSTRUCTORS.has(name)) {
              context.report({
                node: declarator,
                messageId: "eagerSingleton",
                data: { name },
              });
            }
          }
        }
      },
    };
  },
};
