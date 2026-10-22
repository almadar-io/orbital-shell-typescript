"use strict";

const { isStoryFile } = require("../utils/helpers");

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require displayName on exported React components",
      category: "Almadar Architecture",
    },
    messages: {
      missingDisplayName:
        "Component '{{name}}' is missing displayName. Add: {{name}}.displayName = '{{name}}';",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;

    if (isStoryFile(filename)) return {};
    // Only check design-system and @almadar/shell-web component files
    if (
      !/(design-system|renderers\/web\/src\/components)\//.test(filename) ||
      !/\.(tsx|jsx)$/.test(filename)
    ) {
      return {};
    }

    const exportedComponents = [];
    const displayNames = new Set();

    return {
      // Track: export const Foo = ...
      ExportNamedDeclaration(node) {
        if (node.declaration && node.declaration.type === "VariableDeclaration") {
          for (const decl of node.declaration.declarations) {
            if (
              decl.id.type === "Identifier" &&
              /^[A-Z]/.test(decl.id.name)
            ) {
              exportedComponents.push(decl.id);
            }
          }
        }
        // export function Foo
        if (
          node.declaration &&
          node.declaration.type === "FunctionDeclaration" &&
          node.declaration.id &&
          /^[A-Z]/.test(node.declaration.id.name)
        ) {
          exportedComponents.push(node.declaration.id);
        }
      },

      // Track: Foo.displayName = '...'
      AssignmentExpression(node) {
        if (
          node.left.type === "MemberExpression" &&
          node.left.property.type === "Identifier" &&
          node.left.property.name === "displayName" &&
          node.left.object.type === "Identifier"
        ) {
          displayNames.add(node.left.object.name);
        }
      },

      "Program:exit"() {
        for (const comp of exportedComponents) {
          if (!displayNames.has(comp.name)) {
            context.report({
              node: comp,
              messageId: "missingDisplayName",
              data: { name: comp.name },
            });
          }
        }
      },
    };
  },
};
