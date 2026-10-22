"use strict";
const { isAtomOrMolecule, isStoryFile } = require("../utils/helpers");

/**
 * Exceptions: molecules that legitimately need entity-like array data props
 * because they are data-iteration components (mini-organisms promoted to molecules).
 */
const EXCEPTED_FILES = new Set([
  "DataGrid",
  "DataList",
  "TableView",      // data-iteration table molecule (sibling of DataList/DataGrid)
  "DocumentPanel",  // single-record document surface; entity supplies the id its commit events carry
  "DocumentDetails",// the document settings rail; entity supplies the id and property values its commits carry
  "ButtonGroup",    // uses entity as string name for event context
  "FilterGroup",    // uses entity as string name for filter events
  "SearchInput",    // uses entity as string name for search events
]);

function isExcepted(filename) {
  for (const name of EXCEPTED_FILES) {
    if (filename.endsWith(`/${name}.tsx`) || filename.endsWith(`/${name}.jsx`)) {
      return true;
    }
  }
  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow 'entity' prop on atoms and molecules. Atoms/molecules are pure UI building blocks that accept normal typed props. Only organisms and templates should accept 'entity'.",
      category: "Almadar Architecture",
    },
    messages: {
      noEntityProp:
        "Atoms and molecules must not accept an 'entity' prop. Use normal typed props instead (e.g., markers, nodes, items). Only organisms and templates should be entity-aware.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename || context.getFilename();
    if (!isAtomOrMolecule(filename)) return {};
    if (isStoryFile(filename)) return {};
    if (isExcepted(filename)) return {};

    return {
      // Check interface declarations: interface FooProps { entity?: ... }
      TSPropertySignature(node) {
        if (
          node.key?.type === "Identifier" &&
          node.key.name === "entity"
        ) {
          // Only flag if inside an interface ending with "Props"
          const parent = node.parent?.parent;
          if (
            parent?.type === "TSInterfaceDeclaration" &&
            parent.id?.name?.endsWith("Props")
          ) {
            context.report({ node, messageId: "noEntityProp" });
          }
        }
      },

      // Check type alias declarations: type FooProps = { entity?: ... }
      TSTypeAliasDeclaration(node) {
        if (!node.id?.name?.endsWith("Props")) return;
        const typeAnnotation = node.typeAnnotation;
        if (typeAnnotation?.type !== "TSTypeLiteral") return;

        for (const member of typeAnnotation.members) {
          if (
            member.type === "TSPropertySignature" &&
            member.key?.type === "Identifier" &&
            member.key.name === "entity"
          ) {
            context.report({ node: member, messageId: "noEntityProp" });
          }
        }
      },
    };
  },
};
