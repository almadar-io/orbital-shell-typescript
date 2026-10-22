"use strict";

const { GENERATED_PATHS } = require("../utils/helpers");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow imports from generated/compiled code paths",
      category: "Almadar Architecture",
    },
    messages: {
      noImportGenerated:
        "Do not import from generated code ('{{source}}'). Import from the source instead (design-system, packages, etc.).",
    },
    schema: [],
  },

  create(context) {
    function checkSource(node, source) {
      if (!source || !source.value) return;
      const importPath = source.value;

      for (const pattern of GENERATED_PATHS) {
        if (pattern.test(importPath)) {
          context.report({
            node,
            messageId: "noImportGenerated",
            data: { source: importPath },
          });
          return;
        }
      }
    }

    return {
      ImportDeclaration(node) {
        checkSource(node, node.source);
      },
      // Dynamic imports: import('...')
      ImportExpression(node) {
        checkSource(node, node.source);
      },
      // require('...')
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length > 0 &&
          node.arguments[0].type === "Literal"
        ) {
          checkSource(node, node.arguments[0]);
        }
      },
    };
  },
};
