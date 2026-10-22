"use strict";

/**
 * @fileoverview Rule to ensure package.json exports match tsup build configuration
 */

const fs = require("fs");
const path = require("path");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Ensure package.json exports match tsup build entries",
      category: "Almadar Services",
      recommended: true,
    },
    messages: {
      exportMismatch: "package.json export '{{exportPath}}' does not match any tsup entry.",
      missingExport: "tsup entry '{{entry}}' is not exported in package.json.",
      invalidPattern: "Export pattern '{{pattern}}' does not match expected format (./dist/*.js).",
    },
    schema: [],
  },

  create(context) {
    // Only check package.json files
    if (!context.filename.endsWith("package.json")) {
      return {};
    }

    const dir = path.dirname(context.filename);
    const tsupConfigPath = path.join(dir, "tsup.config.ts");

    // Skip if no tsup config
    if (!fs.existsSync(tsupConfigPath)) {
      return {};
    }

    return {
      Program(node) {
        const sourceCode = context.getSourceCode();
        const text = sourceCode.getText();
        
        let pkg;
        try {
          pkg = JSON.parse(text);
        } catch {
          return;
        }

        // Read tsup config (simplified - just check if entries exist)
        let tsupContent = "";
        try {
          tsupContent = fs.readFileSync(tsupConfigPath, "utf-8");
        } catch {
          return;
        }

        // Extract entry points from tsup config
        // Look for: entry: ['src/index.ts'] or entry: { main: 'src/index.ts' }
        const entryMatch = tsupContent.match(/entry\s*:\s*(\[[^\]]+\]|\{[^}]+\})/);
        if (!entryMatch) {
          return;
        }

        const exports = pkg.exports || {};
        
        // Check each export has a corresponding tsup entry
        for (const [exportPath] of Object.entries(exports)) {
          if (exportPath.startsWith("./")) {
            // Check if there's a matching entry in tsup
            const hasMatchingEntry = tsupContent.includes(exportPath.replace(/^\.\//, "src/")) ||
                                    tsupContent.includes(exportPath.replace(/^\.\//, "")) ||
                                    (exportPath === "." && tsupContent.includes("src/index"));

            if (!hasMatchingEntry) {
              context.report({
                node,
                messageId: "exportMismatch",
                data: { exportPath },
              });
            }
          }
        }
      },
    };
  },
};
