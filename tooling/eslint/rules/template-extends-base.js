"use strict";

const { isTemplateFile } = require("../utils/helpers");

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require template prop interfaces to extend TemplateProps<E>",
      category: "Almadar Templates",
    },
    messages: {
      mustExtend:
        "Template prop interface '{{name}}' should extend TemplateProps<YourEntity>. This ensures all data flows through the entity prop.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;
    if (!isTemplateFile(filename)) return {};

    return {
      TSInterfaceDeclaration(node) {
        // Only check interfaces ending in Props or TemplateProps
        if (!node.id || !/Props$/.test(node.id.name)) return;

        // Check if it extends TemplateProps
        const extendsTemplateProps =
          node.extends &&
          node.extends.some((ext) => {
            if (ext.expression.type === "Identifier") {
              return ext.expression.name === "TemplateProps";
            }
            // MemberExpression: SomeModule.TemplateProps
            if (
              ext.expression.type === "MemberExpression" &&
              ext.expression.property.type === "Identifier"
            ) {
              return ext.expression.property.name === "TemplateProps";
            }
            return false;
          });

        if (!extendsTemplateProps) {
          context.report({
            node: node.id,
            messageId: "mustExtend",
            data: { name: node.id.name },
          });
        }
      },
    };
  },
};
