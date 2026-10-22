"use strict";

/**
 * @fileoverview Rule to ensure all imports are declared in package.json dependencies
 */

const fs = require("fs");
const path = require("path");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Ensure all imports are declared in package.json dependencies",
      category: "Almadar Services",
      recommended: true,
    },
    messages: {
      undeclaredImport: "Import '{{package}}' is not declared in package.json dependencies. Add to dependencies, devDependencies, or peerDependencies.",
      missingPackageJson: "Could not find package.json to validate imports.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowBuiltin: {
            type: "boolean",
            default: true,
          },
          allowInternal: {
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
    const allowBuiltin = options.allowBuiltin !== false;
    const allowInternal = options.allowInternal !== false;

    // Find package.json
    let dir = path.dirname(context.filename);
    let pkgPath = null;
    let pkg = null;

    while (dir !== path.dirname(dir)) {
      const candidate = path.join(dir, "package.json");
      if (fs.existsSync(candidate)) {
        pkgPath = candidate;
        break;
      }
      dir = path.dirname(dir);
    }

    if (!pkgPath) {
      return {};
    }

    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    } catch {
      return {};
    }

    // Collect all declared dependencies
    const declaredDeps = new Set();
    ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].forEach((field) => {
      if (pkg[field]) {
        Object.keys(pkg[field]).forEach((dep) => declaredDeps.add(dep));
      }
    });

    // Node.js built-in modules
    const builtinModules = new Set([
      "assert", "buffer", "child_process", "cluster", "console", "constants",
      "crypto", "dgram", "dns", "domain", "events", "fs", "http", "https",
      "module", "net", "os", "path", "punycode", "querystring", "readline",
      "repl", "stream", "string_decoder", "sys", "timers", "tls", "tty",
      "url", "util", "v8", "vm", "zlib", "worker_threads", "perf_hooks",
      "async_hooks", "http2", "diagnostics_channel", "stream/web",
    ]);

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        
        // Skip relative imports
        if (source.startsWith(".") || source.startsWith("/")) {
          return;
        }

        // Skip internal package imports (e.g., @almadar/* in monorepo)
        if (allowInternal && source.startsWith("@almadar/")) {
          // Only check if it's actually in the monorepo
          // For now, assume internal packages are allowed
          return;
        }

        // Extract package name (handle @scope/pkg and scoped packages with subpaths)
        let packageName = source;
        if (source.startsWith("@")) {
          // @scope/pkg or @scope/pkg/subpath
          const parts = source.split("/");
          packageName = `${parts[0]}/${parts[1]}`;
        } else {
          // pkg or pkg/subpath
          packageName = source.split("/")[0];
        }

        // Skip built-in modules
        if (allowBuiltin && builtinModules.has(packageName)) {
          return;
        }

        // Skip Node: prefixed imports
        if (packageName.startsWith("node:")) {
          return;
        }

        // Check if declared
        if (!declaredDeps.has(packageName)) {
          context.report({
            node,
            messageId: "undeclaredImport",
            data: { package: packageName },
          });
        }
      },

      // Handle require() calls
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length > 0 &&
          node.arguments[0].type === "Literal" &&
          typeof node.arguments[0].value === "string"
        ) {
          const source = node.arguments[0].value;
          
          if (source.startsWith(".") || source.startsWith("/")) {
            return;
          }

          if (allowInternal && source.startsWith("@almadar/")) {
            return;
          }

          let packageName = source;
          if (source.startsWith("@")) {
            const parts = source.split("/");
            packageName = `${parts[0]}/${parts[1]}`;
          } else {
            packageName = source.split("/")[0];
          }

          if (!declaredDeps.has(packageName)) {
            context.report({
              node,
              messageId: "undeclaredImport",
              data: { package: packageName },
            });
          }
        }
      },
    };
  },
};
