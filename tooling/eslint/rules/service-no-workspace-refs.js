"use strict";

/**
 * @fileoverview Rule to prevent workspace:* references in published packages
 */

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Prevent workspace:* references in published package.json dependencies",
      category: "Almadar Services",
      recommended: true,
    },
    messages: {
      workspaceRef: "Workspace reference '{{ref}}' found in '{{field}}'. Use explicit version for published packages.",
      workspaceProtocol: "workspace: protocol found in '{{field}}'. This will fail when package is published.",
    },
    schema: [],
  },

  create(context) {
    // Only check package.json files
    if (!context.filename.endsWith("package.json")) {
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

        // Check if this is a private package
        if (pkg.private === true) {
          return;
        }

        // Check all dependency fields
        const depFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
        
        for (const field of depFields) {
          const deps = pkg[field];
          if (!deps || typeof deps !== "object") {
            continue;
          }

          for (const [, version] of Object.entries(deps)) {
            // Check for workspace:*
            if (version === "workspace:*" || version === "workspace:") {
              context.report({
                node,
                messageId: "workspaceRef",
                data: { ref: version, field },
              });
            }
            // Check for any workspace: protocol
            if (typeof version === "string" && version.startsWith("workspace:")) {
              context.report({
                node,
                messageId: "workspaceProtocol",
                data: { field },
              });
            }
          }
        }
      },
    };
  },
};
