"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow 'as any' type casts — fix the actual type issue instead",
      category: "Almadar Architecture",
    },
    messages: {
      noAsAny:
        "Never use 'as any'. Fix the actual type issue: add missing fields, use proper interfaces, or create type-safe helpers.",
    },
    schema: [],
  },

  create(context) {
    return {
      TSAsExpression(node) {
        const typeAnnotation = node.typeAnnotation;
        if (
          typeAnnotation &&
          typeAnnotation.type === "TSAnyKeyword"
        ) {
          context.report({ node, messageId: "noAsAny" });
        }
      },
    };
  },
};
