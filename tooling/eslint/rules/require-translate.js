"use strict";

const { isStoryFile, isTemplateFile, isOrganism } = require("../utils/helpers");

/**
 * Check if a file is inside a molecules/ directory.
 */
function isMolecule(filename) {
  return /\/molecules\//.test(filename);
}

/**
 * Check if a file is inside an atoms/ directory (but NOT molecules/).
 */
function isAtom(filename) {
  return /\/atoms\//.test(filename) && !isMolecule(filename);
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require useTranslate import in organism and molecule components for i18n",
      category: "Almadar Architecture",
    },
    messages: {
      missingUseTranslate:
        "Component '{{name}}' should import useTranslate for i18n. Add: const { t } = useTranslate();",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;

    // Only applies to .tsx files in design-system/ or renderers/web/src/components/
    if (!/\.(tsx)$/.test(filename)) return {};
    if (!/(design-system|renderers\/web\/src\/components)\//.test(filename)) return {};

    // Skip story files, atom files, template files
    if (isStoryFile(filename)) return {};
    if (isAtom(filename)) return {};
    if (isTemplateFile(filename)) return {};

    // Only check organisms and molecules
    if (!isOrganism(filename) && !isMolecule(filename)) return {};

    let hasUseTranslateImport = false;
    const exportedComponents = [];

    return {
      // Check for import of useTranslate from @almadar/shell-web/core or the relative core barrel
      ImportDeclaration(node) {
        const source = node.source.value;
        if (
          source === "@almadar/shell-web/core" ||
          /(^|\/)core(\/index)?$/.test(source) ||
          /useTranslate/.test(source)
        ) {
          for (const specifier of node.specifiers) {
            if (
              specifier.type === "ImportSpecifier" &&
              specifier.imported.name === "useTranslate"
            ) {
              hasUseTranslateImport = true;
            }
          }
        }
      },

      // Track exported components: export const Foo = ...
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

      "Program:exit"() {
        if (hasUseTranslateImport) return;
        if (exportedComponents.length === 0) return;

        // Report on the first exported component
        context.report({
          node: exportedComponents[0],
          messageId: "missingUseTranslate",
          data: { name: exportedComponents[0].name },
        });
      },
    };
  },
};
