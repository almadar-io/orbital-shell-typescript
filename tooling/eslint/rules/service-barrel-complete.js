"use strict";

/**
 * @fileoverview Rule to ensure all public functions are exported from barrel files (index.ts)
 */

const fs = require("fs");
const path = require("path");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Ensure all public functions are exported from barrel files (index.ts)",
      category: "Almadar Services",
      recommended: true,
    },
    messages: {
      missingFromBarrel: "Public export '{{name}}' from '{{source}}' is not re-exported in '{{barrel}}'.",
      notExported: "Function '{{name}}' is declared but not exported. Add export keyword or include in index.ts.",
    },
    schema: [
      {
        type: "object",
        properties: {
          barrelFile: {
            type: "string",
            default: "index.ts",
          },
          ignorePrivate: {
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
    const barrelFileName = options.barrelFile || "index.ts";
    void options.ignorePrivate;

    const filename = context.filename;
    const dir = path.dirname(filename);
    const barrelPath = path.join(dir, barrelFileName);

    // Skip if this IS the barrel file itself
    if (path.basename(filename) === barrelFileName) {
      return {};
    }

    // Skip if no barrel file exists
    if (!fs.existsSync(barrelPath)) {
      return {};
    }

    // Read barrel file content
    let barrelContent = "";
    try {
      barrelContent = fs.readFileSync(barrelPath, "utf-8");
    } catch {
      return {};
    }

    // Track exports in this file
    const fileExports = new Set();

    return {
      // Export declarations: export function foo() {}
      ExportNamedDeclaration(node) {
        if (node.declaration) {
          if (node.declaration.type === "FunctionDeclaration" && node.declaration.id) {
            fileExports.add(node.declaration.id.name);
          } else if (node.declaration.type === "VariableDeclaration") {
            node.declaration.declarations.forEach((decl) => {
              if (decl.id && decl.id.type === "Identifier") {
                fileExports.add(decl.id.name);
              }
            });
          } else if (node.declaration.type === "ClassDeclaration" && node.declaration.id) {
            fileExports.add(node.declaration.id.name);
          }
        }
        // Handle: export { foo, bar }
        if (node.specifiers) {
          node.specifiers.forEach((spec) => {
            if (spec.exported && spec.exported.type === "Identifier") {
              fileExports.add(spec.exported.name);
            }
          });
        }
      },

      // Export default: export default foo
      ExportDefaultDeclaration(node) {
        if (node.declaration && node.declaration.type === "Identifier") {
          fileExports.add(node.declaration.name);
        }
      },

      // Check function declarations at end of file
      "Program:exit"() {
        fileExports.forEach((name) => {
          // Check if this export is in the barrel file
          // Look for: export { name } or export * from './this-file'
          const exportPattern = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`, "i");
          const starExportPattern = new RegExp(`export\\s*\\*\\s*from\\s*['"]\\.\\/${path.basename(filename, path.extname(filename))}['"]`, "i");
          
          const isInBarrel = exportPattern.test(barrelContent) || 
                            starExportPattern.test(barrelContent);

          if (!isInBarrel) {
            context.report({
              node: context.getSourceCode().ast,
              messageId: "missingFromBarrel",
              data: {
                name,
                source: path.basename(filename),
                barrel: barrelFileName,
              },
            });
          }
        });
      },
    };
  },
};
