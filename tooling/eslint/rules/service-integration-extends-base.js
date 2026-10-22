"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Integration classes must extend BaseIntegration for the .orb call-integration contract",
      category: "Almadar Services",
    },
    messages: {
      missingBase:
        "Class '{{name}}' ends with 'Integration' but doesn't extend BaseIntegration. The .orb schema's call-integration effect expects the BaseIntegration contract (execute, validateParams, handleError, retry).",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;

    // Only apply in integration directories
    if (!/\/integrations\//.test(filename)) return {};

    return {
      ClassDeclaration(node) {
        if (!node.id || !node.id.name) return;

        const name = node.id.name;
        if (!name.endsWith("Integration")) return;

        // Skip BaseIntegration itself
        if (name === "BaseIntegration") return;

        const superClass = node.superClass;
        if (
          !superClass ||
          (superClass.type === "Identifier" && superClass.name !== "BaseIntegration")
        ) {
          context.report({
            node,
            messageId: "missingBase",
            data: { name },
          });
        }
      },
    };
  },
};
