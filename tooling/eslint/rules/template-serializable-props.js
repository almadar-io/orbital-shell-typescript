"use strict";

const { isTemplateFile } = require("../utils/helpers");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Ensure JSX prop values in templates are serializable (no functions, JSX elements, computed expressions)",
      category: "Almadar Templates",
    },
    messages: {
      noJsxElement:
        "JSX elements as prop values cannot survive the flattener. Use a string prop or entity binding.",
      noTemplateLiteral:
        "Template literals with expressions cannot be serialized. Pre-compute on the entity or use a string prop.",
      noComputed:
        "Computed expressions in props cannot survive the flattener. Pre-compute on the entity (server-side).",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;
    if (!isTemplateFile(filename)) return {};

    return {
      JSXAttribute(node) {
        if (!node.value || node.value.type !== "JSXExpressionContainer") return;

        const expr = node.value.expression;

        // JSX element as prop value: icon={<Icon name="star" />}
        if (expr.type === "JSXElement" || expr.type === "JSXFragment") {
          context.report({ node, messageId: "noJsxElement" });
          return;
        }

        // Template literal with expressions: text={`Level ${entity.level}`}
        if (
          expr.type === "TemplateLiteral" &&
          expr.expressions.length > 0
        ) {
          context.report({ node, messageId: "noTemplateLiteral" });
          return;
        }

        // Binary/unary/conditional computed expressions
        // Allow: entity.field, entity.field.nested, literal values, arrays of objects
        if (
          expr.type === "BinaryExpression" ||
          expr.type === "UnaryExpression" ||
          expr.type === "UpdateExpression" ||
          expr.type === "AssignmentExpression" ||
          expr.type === "SequenceExpression" ||
          expr.type === "NewExpression"
        ) {
          context.report({ node, messageId: "noComputed" });
          return;
        }

        // Conditional expression: only flag if branches contain computed values
        // Allow: entity.active ? "primary" : "secondary" (both branches are literals)
        if (expr.type === "ConditionalExpression") {
          const { consequent, alternate } = expr;
          const isSimple = (n) =>
            n.type === "Literal" ||
            n.type === "MemberExpression" ||
            n.type === "Identifier";
          if (!isSimple(consequent) || !isSimple(alternate)) {
            context.report({ node, messageId: "noComputed" });
          }
        }
      },
    };
  },
};
