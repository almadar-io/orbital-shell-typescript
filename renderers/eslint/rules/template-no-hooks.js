"use strict";

const { isTemplateFile, BANNED_TEMPLATE_HOOKS, WARNED_TEMPLATE_HOOKS } = require("../utils/helpers");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow React hooks in template files — templates must be pure functions of entity props",
      category: "Almadar Templates",
    },
    messages: {
      bannedHook:
        "Hook '{{hook}}' is not allowed in template files. Move stateful logic to an organism component.",
      warnedHook:
        "Hook '{{hook}}' in templates is discouraged. Prefer declarative event props (action, closeEvent, etc.).",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;
    if (!isTemplateFile(filename)) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        let hookName = null;

        if (callee.type === "Identifier") {
          hookName = callee.name;
        } else if (
          callee.type === "MemberExpression" &&
          callee.property.type === "Identifier"
        ) {
          hookName = callee.property.name;
        }

        if (!hookName) return;

        if (BANNED_TEMPLATE_HOOKS.has(hookName)) {
          context.report({
            node,
            messageId: "bannedHook",
            data: { hook: hookName },
          });
        } else if (WARNED_TEMPLATE_HOOKS.has(hookName)) {
          context.report({
            node,
            messageId: "warnedHook",
            data: { hook: hookName },
          });
        }
      },
    };
  },
};
