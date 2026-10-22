"use strict";

const UI_EVENT_PATTERN = /^UI:[A-Z][A-Z0-9_]*$/;

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Enforce UI:SCREAMING_SNAKE_CASE naming convention for event bus emissions",
      category: "Almadar Architecture",
    },
    messages: {
      badEventName:
        "Event name '{{name}}' should follow the UI:SCREAMING_SNAKE_CASE pattern (e.g., 'UI:SAVE', 'UI:CONFIRM_DELETE').",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;

        // Match: emit('...'), eventBus.emit('...')
        let isEmit = false;
        if (
          callee.type === "Identifier" &&
          callee.name === "emit"
        ) {
          isEmit = true;
        } else if (
          callee.type === "MemberExpression" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "emit"
        ) {
          isEmit = true;
        }

        if (!isEmit || node.arguments.length === 0) return;

        const firstArg = node.arguments[0];

        // Check string literal: emit('UI:SAVE')
        if (firstArg.type === "Literal" && typeof firstArg.value === "string") {
          const eventName = firstArg.value;
          // Only check events that look like they should be UI events
          // (skip internal system events that don't start with UI:)
          if (eventName.startsWith("UI:") && !UI_EVENT_PATTERN.test(eventName)) {
            context.report({
              node: firstArg,
              messageId: "badEventName",
              data: { name: eventName },
            });
          }
        }

        // Check template literal: emit(`UI:${action}`)
        if (firstArg.type === "TemplateLiteral") {
          // If the static part starts with "UI:" we trust the dynamic part
          // This pattern is used inside atoms: emit(`UI:${action}`, ...)
          // No need to flag these — the action prop is validated elsewhere
        }
      },
    };
  },
};
