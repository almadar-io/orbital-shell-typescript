"use strict";

const { isTemplateFile } = require("../utils/helpers");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow local variable declarations in template function bodies",
      category: "Almadar Templates",
    },
    messages: {
      noLocalVar:
        "Local variable '{{name}}' in a template cannot survive the flattener. Access entity fields directly (entity.{{name}}) or move logic to an organism.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;
    if (!isTemplateFile(filename)) return {};

    // Track which function is the template component
    let templateFunctionDepth = 0;

    function isExportedComponent(node) {
      // function MyTemplate(...) or const MyTemplate = ...
      const parent = node.parent;
      if (!parent) return false;

      // export function MyTemplate
      if (parent.type === "ExportNamedDeclaration") return true;

      // export const MyTemplate = ...
      if (
        parent.type === "VariableDeclarator" &&
        parent.parent &&
        parent.parent.parent &&
        parent.parent.parent.type === "ExportNamedDeclaration"
      ) {
        return true;
      }

      // const MyTemplate = ... (top-level, likely exported elsewhere)
      if (parent.type === "VariableDeclarator") {
        const id = parent.id;
        if (id.type === "Identifier" && /Template$/.test(id.name)) return true;
      }

      return false;
    }

    return {
      // Track entry into the template component function
      "FunctionDeclaration"(node) {
        if (node.id && /Template$/.test(node.id.name)) {
          templateFunctionDepth++;
        }
      },
      "FunctionDeclaration:exit"(node) {
        if (node.id && /Template$/.test(node.id.name)) {
          templateFunctionDepth--;
        }
      },
      "ArrowFunctionExpression"(node) {
        if (isExportedComponent(node)) {
          templateFunctionDepth++;
        }
      },
      "ArrowFunctionExpression:exit"(node) {
        if (isExportedComponent(node)) {
          templateFunctionDepth--;
        }
      },

      VariableDeclaration(node) {
        if (templateFunctionDepth <= 0) return;

        for (const decl of node.declarations) {
          // Allow: const { entity, className } = props  (prop destructuring)
          if (
            decl.id.type === "ObjectPattern" &&
            decl.init &&
            decl.init.type === "Identifier"
          ) {
            // Check if all destructured keys are known template props
            const propNames = new Set(["entity", "className", "scale", "animationSpeed", "unitScale"]);
            const keys = decl.id.properties
              .filter((p) => p.type === "Property" && p.key.type === "Identifier")
              .map((p) => p.key.name);
            if (keys.every((k) => propNames.has(k))) continue;
          }

          const name =
            decl.id.type === "Identifier"
              ? decl.id.name
              : decl.id.type === "ObjectPattern"
              ? "{...}"
              : decl.id.type === "ArrayPattern"
              ? "[...]"
              : "variable";

          context.report({
            node: decl,
            messageId: "noLocalVar",
            data: { name },
          });
        }
      },
    };
  },
};
