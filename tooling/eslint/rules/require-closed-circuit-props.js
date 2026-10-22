"use strict";

const { isOrganism } = require("../utils/helpers");

const REQUIRED_PROPS = ["className"];
const RECOMMENDED_PROPS = ["isLoading", "error", "entity", "sortBy", "sortDirection", "page", "pageSize", "totalCount", "searchValue"];

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require closed circuit base props (className, isLoading, error, entity) on organism prop interfaces",
      category: "Almadar Architecture",
    },
    messages: {
      missingProp:
        "Organism prop interface '{{interface}}' is missing '{{prop}}'. Closed circuit requires: className, isLoading, error, entity.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;

    if (!isOrganism(filename)) return {};
    if (!/\.(tsx|jsx|ts)$/.test(filename)) return {};

    return {
      TSInterfaceDeclaration(node) {
        // Only check interfaces ending with Props
        if (!node.id || !/Props$/.test(node.id.name)) return;

        const declaredProps = new Set();

        // Collect props from the interface body
        for (const member of node.body.body) {
          if (
            member.type === "TSPropertySignature" &&
            member.key &&
            member.key.type === "Identifier"
          ) {
            declaredProps.add(member.key.name);
          }
        }

        // Check for extends that might provide the props
        if (node.extends && node.extends.length > 0) {
          // If it extends something, assume it might get props from parent
          // We can't easily resolve what the parent provides, so only
          // flag if it extends nothing and is missing props
          return;
        }

        const allExpected = [...REQUIRED_PROPS, ...RECOMMENDED_PROPS];
        for (const prop of allExpected) {
          if (!declaredProps.has(prop)) {
            context.report({
              node: node.id,
              messageId: "missingProp",
              data: {
                interface: node.id.name,
                prop,
              },
            });
          }
        }
      },
    };
  },
};
