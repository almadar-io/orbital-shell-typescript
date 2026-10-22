"use strict";

/**
 * @fileoverview Rule to enforce EventBus usage over direct function calls between modules
 */

const path = require("path");

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Enforce EventBus usage over direct function calls between modules",
      category: "Almadar Services",
      recommended: true,
    },
    messages: {
      directCall: "Cross-module function call to '{{function}}' from '{{module}}'. Consider using EventBus for loose coupling.",
      directImport: "Direct import from service module '{{module}}'. Use EventBus or service factory instead.",
      useEventBus: "Use getGlobalEventBus() or eventBus.emit() for cross-module communication instead of direct function calls.",
    },
    schema: [
      {
        type: "object",
        properties: {
          servicePaths: {
            type: "array",
            items: { type: "string" },
            default: ["src/services/", "src/lib/"],
          },
          allowSameDirectory: {
            type: "boolean",
            default: true,
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const servicePaths = options.servicePaths || ["src/services/", "src/lib/"];
    const allowSameDirectory = options.allowSameDirectory !== false;

    const filename = context.filename;
    const currentDir = path.dirname(filename);

    // Track imports from service directories
    const serviceImports = new Map();

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        
        // Check if importing from a service path
        const isServiceImport = servicePaths.some(sp => 
          source.includes(sp) || source.includes("/services/")
        );

        if (!isServiceImport) {
          return;
        }

        // Allow same directory imports
        if (allowSameDirectory) {
          const importDir = path.dirname(path.resolve(currentDir, source));
          if (importDir === currentDir) {
            return;
          }
        }

        // Track the imported bindings
        node.specifiers.forEach((spec) => {
          if (spec.type === "ImportSpecifier" && spec.imported) {
            serviceImports.set(spec.local.name, {
              source,
              imported: spec.imported.name,
            });
          } else if (spec.type === "ImportDefaultSpecifier") {
            serviceImports.set(spec.local.name, {
              source,
              imported: "default",
            });
          } else if (spec.type === "ImportNamespaceSpecifier") {
            serviceImports.set(spec.local.name, {
              source,
              imported: "*",
            });
          }
        });

        // Report direct service imports
        if (source.includes("/services/") && !source.startsWith(".")) {
          context.report({
            node,
            messageId: "directImport",
            data: { module: source },
          });
        }
      },

      // Check for direct function calls to imported service functions
      CallExpression(node) {
        if (node.callee.type === "Identifier") {
          const name = node.callee.name;
          const importInfo = serviceImports.get(name);

          if (importInfo && importInfo.source.includes("/services/")) {
            context.report({
              node,
              messageId: "directCall",
              data: {
                function: name,
                module: importInfo.source,
              },
            });
          }
        }

        // Check for member expressions: Service.method()
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier"
        ) {
          const objectName = node.callee.object.name;
          const importInfo = serviceImports.get(objectName);

          if (importInfo && importInfo.source.includes("/services/")) {
            const methodName = node.callee.property.name || node.callee.property.value;
            context.report({
              node,
              messageId: "directCall",
              data: {
                function: `${objectName}.${methodName}`,
                module: importInfo.source,
              },
            });
          }
        }
      },
    };
  },
};
