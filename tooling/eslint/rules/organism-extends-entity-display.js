"use strict";
const { isOrganism, isStoryFile } = require("../utils/helpers");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Require organisms with entity/data props to extend EntityDisplayProps",
      category: "Almadar Architecture",
    },
    messages: {
      mustExtend: "'{{interfaceName}}' has '{{propName}}' prop but does not extend EntityDisplayProps. Extend it to share the base contract.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    if (!isOrganism(filename) || isStoryFile(filename)) return {};

    // Whitelist Form.tsx (documented exception)
    if (/\/Form\.tsx$/.test(filename)) return {};

    return {
      TSInterfaceDeclaration(node) {
        const interfaceName = node.id?.name;
        if (!interfaceName?.endsWith("Props")) return;

        // Check if it has entity or data prop
        const hasEntityOrData = node.body?.body?.some(
          (member) =>
            member.type === "TSPropertySignature" &&
            member.key?.type === "Identifier" &&
            (member.key.name === "entity" || member.key.name === "data")
        );
        if (!hasEntityOrData) return;

        // Check if it extends EntityDisplayProps
        const extendsEntityDisplay = node.extends?.some((ext) => {
          const typeName = ext.expression?.type === "Identifier"
            ? ext.expression.name
            : ext.expression?.type === "TSTypeReference"
            ? ext.expression.typeName?.name
            : null;
          return typeName === "EntityDisplayProps";
        });

        if (!extendsEntityDisplay) {
          const dataProp = node.body?.body?.find(
            (m) => m.type === "TSPropertySignature" && m.key?.type === "Identifier" && (m.key.name === "entity" || m.key.name === "data")
          );
          context.report({
            node: dataProp || node,
            messageId: "mustExtend",
            data: {
              interfaceName,
              propName: dataProp?.key?.name || "entity/data",
            },
          });
        }
      },
    };
  },
};
