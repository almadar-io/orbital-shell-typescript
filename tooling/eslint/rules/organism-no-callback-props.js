"use strict";
const { isOrganism, isStoryFile } = require("../utils/helpers");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow callback props (onXxx) in organism interfaces",
      category: "Almadar Architecture",
    },
    messages: {
      noCallbackProp: "Organism prop '{{propName}}' in '{{interfaceName}}' is a callback. Use a declarative event string prop instead (e.g., '{{suggestion}}').",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    if (!isOrganism(filename) || isStoryFile(filename)) return {};

    // Whitelist Form.tsx (needs onFieldChange)
    if (/\/Form\.tsx$/.test(filename)) return {};

    const CALLBACK_PATTERN = /^on[A-Z]/;
    const SUGGESTION_MAP = {
      onSort: "sortEvent",
      onSearch: "searchEvent",
      onPageChange: "paginateEvent",
      onSelectionChange: "selectEvent",
      onRowClick: "viewEvent or navigatesTo",
      onCardClick: "viewEvent or navigatesTo",
      onItemAction: "itemActions[].event",
      onClose: "closeEvent",
    };

    return {
      TSPropertySignature(node) {
        // Only check inside *Props interfaces
        const parent = node.parent;
        if (parent?.type !== "TSInterfaceBody") return;
        const interfaceNode = parent.parent;
        if (interfaceNode?.type !== "TSInterfaceDeclaration") return;
        const interfaceName = interfaceNode.id?.name;
        if (!interfaceName?.endsWith("Props")) return;

        const propName = node.key?.type === "Identifier" ? node.key.name : null;
        if (!propName || !CALLBACK_PATTERN.test(propName)) return;

        const suggestion = SUGGESTION_MAP[propName] || propName.replace(/^on/, "").toLowerCase() + "Event";
        context.report({
          node,
          messageId: "noCallbackProp",
          data: { propName, interfaceName, suggestion },
        });
      },
    };
  },
};
