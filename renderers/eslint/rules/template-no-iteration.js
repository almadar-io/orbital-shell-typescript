"use strict";

const { isTemplateFile } = require("../utils/helpers");

const ITERATION_METHODS = new Set(["map", "filter", "reduce", "forEach", "flatMap"]);

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow array iteration methods in template files",
      category: "Almadar Templates",
    },
    messages: {
      noIteration:
        "'.{{method}}()' in templates creates loop variables that can't survive the flattener. Use a list/table pattern or an organism component instead.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;
    if (!isTemplateFile(filename)) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          callee.property.type === "Identifier" &&
          ITERATION_METHODS.has(callee.property.name)
        ) {
          context.report({
            node,
            messageId: "noIteration",
            data: { method: callee.property.name },
          });
        }
      },

      ForInStatement(node) {
        context.report({
          node,
          messageId: "noIteration",
          data: { method: "for...in" },
        });
      },

      ForOfStatement(node) {
        context.report({
          node,
          messageId: "noIteration",
          data: { method: "for...of" },
        });
      },
    };
  },
};
