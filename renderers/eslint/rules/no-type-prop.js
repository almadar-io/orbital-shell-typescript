"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow 'type' as a component prop name — reserved for pattern type identifiers",
      category: "Almadar Architecture",
    },
    messages: {
      noTypeProp:
        "The 'type' prop is reserved for pattern type identifiers. Use a descriptive name instead: chartType, inputType, alertType, documentType, etc.",
    },
    schema: [],
  },

  create(context) {
    return {
      // Check TypeScript interfaces: interface FooProps { type: ... }
      TSPropertySignature(node) {
        if (
          node.key &&
          node.key.type === "Identifier" &&
          node.key.name === "type"
        ) {
          // Only flag if the parent interface name ends with "Props"
          const parent = node.parent;
          if (
            parent &&
            parent.parent &&
            parent.parent.type === "TSInterfaceDeclaration" &&
            parent.parent.id &&
            /Props$/.test(parent.parent.id.name)
          ) {
            context.report({ node, messageId: "noTypeProp" });
          }
        }
      },

      // Check type aliases: type FooProps = { type: ... }
      TSTypeAliasDeclaration(node) {
        if (!node.id || !/Props$/.test(node.id.name)) return;

        const typeAnnotation = node.typeAnnotation;
        if (typeAnnotation && typeAnnotation.type === "TSTypeLiteral") {
          for (const member of typeAnnotation.members) {
            if (
              member.type === "TSPropertySignature" &&
              member.key &&
              member.key.type === "Identifier" &&
              member.key.name === "type"
            ) {
              context.report({ node: member, messageId: "noTypeProp" });
            }
          }
        }
      },
    };
  },
};
