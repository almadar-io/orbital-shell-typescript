"use strict";
const { isOrganism, isStoryFile } = require("../utils/helpers");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow auto-fetch hooks in organisms",
      category: "Almadar Architecture",
    },
    messages: {
      noAutoFetch: "Organism must not call '{{hookName}}'. Receive data via the 'data' prop from the trait's render-ui instead.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    if (!isOrganism(filename) || isStoryFile(filename)) return {};

    const BANNED_HOOKS = new Set([
      "useEntityList",
      "useEntityDetail",
      "usePaginatedEntityList",
      "useEntityListSuspense",
      "useEntitySuspense",
    ]);

    return {
      CallExpression(node) {
        let hookName = null;
        if (node.callee.type === "Identifier") {
          hookName = node.callee.name;
        } else if (node.callee.type === "MemberExpression" && node.callee.property.type === "Identifier") {
          hookName = node.callee.property.name;
        }
        if (hookName && BANNED_HOOKS.has(hookName)) {
          context.report({
            node,
            messageId: "noAutoFetch",
            data: { hookName },
          });
        }
      },
    };
  },
};
