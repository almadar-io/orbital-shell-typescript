"use strict";

const path = require("path");

/**
 * Files that are allowed to construct EventBus instances.
 */
const ALLOWED_FILES = new Set([
  "eventBus.ts",
  "eventBus.js",
  "eventBusTransport.ts",
  "eventBusTransport.js",
  "event-bus.ts",
  "event-bus.js",
]);

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Prevent creating multiple EventBus instances — use the singleton from eventBus.ts",
      category: "Almadar Services",
    },
    messages: {
      duplicateEventBus:
        "Don't create a new EventBus here. Import the singleton from your eventBus module. Split buses mean events emitted by the .orb schema never reach listeners on this bus.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;
    const basename = path.basename(filename);

    // Allow EventBus construction in dedicated files
    if (ALLOWED_FILES.has(basename)) return {};

    // Also allow in test files
    if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filename)) return {};

    return {
      NewExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "EventBus"
        ) {
          context.report({ node, messageId: "duplicateEventBus" });
        }
      },
    };
  },
};
