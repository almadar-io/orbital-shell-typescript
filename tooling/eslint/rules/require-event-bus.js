"use strict";

const { isTemplateFile, isStoryFile, isOrganism } = require("../utils/helpers");

/**
 * Callback props that have declarative equivalents in @almadar/shell-web.
 */
const CALLBACK_TO_DECLARATIVE = {
  onClick: "action",
  onClose: "closeEvent",
  onDismiss: "dismissEvent",
  onRetry: "retryEvent",
  onSubmit: "submitEvent",
};

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer declarative event props over callback props on @almadar/shell-web components",
      category: "Almadar Architecture",
    },
    messages: {
      preferDeclarative:
        "Prefer declarative '{{declarative}}' prop over '{{callback}}' for closed circuit integration.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;

    // Enforce in templates and organisms
    if (!isTemplateFile(filename) && !isOrganism(filename)) return {};

    // Stories use callbacks for testing
    if (isStoryFile(filename)) return {};

    return {
      JSXAttribute(node) {
        if (!node.name || node.name.type !== "JSXIdentifier") return;

        const propName = node.name.name;
        const declarative = CALLBACK_TO_DECLARATIVE[propName];

        if (!declarative) return;

        // Only flag if the value is a function expression
        if (
          node.value &&
          node.value.type === "JSXExpressionContainer" &&
          (node.value.expression.type === "ArrowFunctionExpression" ||
           node.value.expression.type === "FunctionExpression")
        ) {
          context.report({
            node,
            messageId: "preferDeclarative",
            data: { declarative, callback: propName },
          });
        }
      },
    };
  },
};
