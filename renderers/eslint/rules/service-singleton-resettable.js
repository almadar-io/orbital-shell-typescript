"use strict";

const { isServiceFile } = require("../utils/helpers");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Every exported get*() singleton getter must have a matching reset*() export for test isolation",
      category: "Almadar Services",
    },
    messages: {
      missingReset:
        "Exported getter '{{getter}}' has no matching '{{expectedReset}}' export. Add a reset function for test isolation.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;
    if (!isServiceFile(filename)) return {};

    const exportedFunctions = new Map(); // name → node
    const getterNodes = []; // { name, expectedReset, node }

    return {
      // Collect exported function declarations
      ExportNamedDeclaration(node) {
        if (node.declaration) {
          if (node.declaration.type === "FunctionDeclaration" && node.declaration.id) {
            const name = node.declaration.id.name;
            exportedFunctions.set(name, node);

            // Check if it's a get* function that caches in a module-level variable (singleton pattern)
            if (/^get[A-Z]/.test(name) && isSingletonGetter(node.declaration.body, context)) {
              const suffix = name.slice(3); // getMemoryManager → MemoryManager
              getterNodes.push({
                name,
                expectedReset: "reset" + suffix,
                node,
              });
            }
          }
        }
      },

      // Also collect from export specifiers (export { getFoo })
      "ExportNamedDeclaration > ExportSpecifier"(node) {
        const name =
          node.exported.type === "Identifier"
            ? node.exported.name
            : node.exported.value;
        exportedFunctions.set(name, node);
      },

      "Program:exit"() {
        for (const getter of getterNodes) {
          if (!exportedFunctions.has(getter.expectedReset)) {
            context.report({
              node: getter.node,
              messageId: "missingReset",
              data: {
                getter: getter.name,
                expectedReset: getter.expectedReset,
              },
            });
          }
        }
      },
    };
  },
};

/**
 * Detect if a get*() function is a singleton getter — i.e., it checks a module-level
 * variable and assigns it if null/undefined (the lazy singleton pattern).
 *
 * Pattern we're looking for:
 *   if (!_instance) { _instance = new Foo(); }
 *   return _instance;
 *
 * We detect this by checking if the function body assigns to a variable that exists
 * at module scope (not a local variable).
 */
function isSingletonGetter(body, context) {
  if (!body || !body.body) return false;

  // Collect module-scope variable names
  const moduleVars = new Set();
  const program = context.sourceCode.ast;
  for (const stmt of program.body) {
    if (stmt.type === "VariableDeclaration") {
      for (const decl of stmt.declarations) {
        if (decl.id && decl.id.type === "Identifier") {
          moduleVars.add(decl.id.name);
        }
      }
    }
  }

  // Check if the function body assigns to a module-level variable
  return hasAssignmentToModuleVar(body, moduleVars);
}

/**
 * Check if an AST node contains an assignment to one of the given module-level variables.
 */
function hasAssignmentToModuleVar(node, moduleVars) {
  if (!node) return false;
  if (
    node.type === "AssignmentExpression" &&
    node.left &&
    node.left.type === "Identifier" &&
    moduleVars.has(node.left.name)
  ) {
    return true;
  }

  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const child = node[key];
    if (child && typeof child === "object") {
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item.type === "string" && hasAssignmentToModuleVar(item, moduleVars)) {
            return true;
          }
        }
      } else if (typeof child.type === "string") {
        if (hasAssignmentToModuleVar(child, moduleVars)) return true;
      }
    }
  }
  return false;
}
