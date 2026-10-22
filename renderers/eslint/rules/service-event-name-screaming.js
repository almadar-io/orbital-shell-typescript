"use strict";

const SCREAMING_SNAKE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "EventBus event names must use SCREAMING_SNAKE_CASE to match .orb schema conventions",
      category: "Almadar Services",
    },
    messages: {
      badEventName:
        "Event name '{{name}}' must be SCREAMING_SNAKE_CASE (e.g., 'LLM_REQUEST_COMPLETE'). The .orb schema uses this convention — mismatched names mean listeners won't fire.",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;

        // Match: eventBus.emit('...') or getServerEventBus().emit('...')
        // Skip generic .emit() calls on non-EventBus objects (Node EventEmitter, etc.)
        if (
          callee.type !== "MemberExpression" ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "emit" ||
          node.arguments.length === 0
        ) return;

        // Only flag calls on objects that look like EventBus instances
        const obj = callee.object;
        const isEventBus =
          // Direct: eventBus.emit, serverEventBus.emit, bus.emit
          (obj.type === "Identifier" && /[Ee]vent[Bb]us/.test(obj.name)) ||
          // Getter: getServerEventBus().emit()
          (obj.type === "CallExpression" &&
           obj.callee.type === "Identifier" &&
           /[Ee]vent[Bb]us/.test(obj.callee.name)) ||
          // this.eventBus.emit or this.bus.emit (inside service classes)
          (obj.type === "MemberExpression" &&
           obj.property.type === "Identifier" &&
           /[Ee]vent[Bb]us|^bus$/.test(obj.property.name));

        if (!isEventBus) return;

        const firstArg = node.arguments[0];

        // Only check string literals
        if (firstArg.type !== "Literal" || typeof firstArg.value !== "string") return;

        const eventName = firstArg.value;

        // Skip UI:* events (handled by event-naming-convention rule)
        if (eventName.startsWith("UI:")) return;

        // Skip wildcard
        if (eventName === "*") return;

        if (!SCREAMING_SNAKE.test(eventName)) {
          context.report({
            node: firstArg,
            messageId: "badEventName",
            data: { name: eventName },
          });
        }
      },
    };
  },
};
