"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow useNavigate from react-router-dom. Use useEventBus and emit UI:NAVIGATE instead.",
      category: "Almadar Architecture",
    },
    messages: {
      noUseNavigate:
        "Do not use useNavigate() from react-router-dom. Emit 'UI:NAVIGATE' via useEventBus instead for closed circuit compliance.",
      noReactRouterNavigate:
        "Do not import useNavigate from react-router-dom. Use useEventBus().emit('UI:NAVIGATE', { url }) instead.",
    },
    schema: [],
  },

  create(context) {
    return {
      // Catch: import { useNavigate } from 'react-router-dom'
      ImportDeclaration(node) {
        if (
          node.source &&
          node.source.value === "react-router-dom" &&
          node.specifiers
        ) {
          for (const specifier of node.specifiers) {
            if (
              specifier.type === "ImportSpecifier" &&
              specifier.imported &&
              specifier.imported.name === "useNavigate"
            ) {
              context.report({
                node: specifier,
                messageId: "noReactRouterNavigate",
              });
            }
          }
        }
      },
      // Catch: useNavigate() call expressions
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "useNavigate"
        ) {
          context.report({
            node,
            messageId: "noUseNavigate",
          });
        }
      },
    };
  },
};
