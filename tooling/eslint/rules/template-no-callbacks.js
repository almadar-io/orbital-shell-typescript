"use strict";

const { isTemplateFile } = require("../utils/helpers");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow function/callback props in JSX inside template files",
      category: "Almadar Templates",
    },
    messages: {
      noCallback:
        "Callback prop '{{prop}}' cannot survive the flattener. Use a declarative event prop instead (e.g., action, closeEvent, submitEvent).",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;
    if (!isTemplateFile(filename)) return {};

    return {
      JSXAttribute(node) {
        if (!node.value) return;

        // Check JSXExpressionContainer wrapping a function
        if (node.value.type !== "JSXExpressionContainer") return;

        const expr = node.value.expression;
        if (
          expr.type === "ArrowFunctionExpression" ||
          expr.type === "FunctionExpression"
        ) {
          const propName =
            node.name.type === "JSXIdentifier" ? node.name.name : "unknown";
          // renderItem is the standard per-item rendering pattern for DataGrid/DataList
          if (propName === "renderItem") return;
          context.report({
            node,
            messageId: "noCallback",
            data: { prop: propName },
          });
        }
      },
    };
  },
};
