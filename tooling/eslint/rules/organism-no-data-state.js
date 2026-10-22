"use strict";
const { isOrganism, isStoryFile } = require("../utils/helpers");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow data-related useState in organisms",
      category: "Almadar Architecture",
    },
    messages: {
      noDataState: "Organism '{{component}}' must not manage '{{stateName}}' state internally. Receive it via props from the trait's render-ui instead.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    if (!isOrganism(filename) || isStoryFile(filename)) return {};

    // Whitelist Form.tsx
    if (/\/Form\.tsx$/.test(filename)) return {};

    const DATA_STATE_PATTERN = /^(sort|filter|search|page|pagination|selected|query|paginationParams|searchTerm|searchQuery|filters)/i;

    return {
      VariableDeclarator(node) {
        // Match: const [stateName, setStateName] = useState(...)
        if (
          node.init?.type === "CallExpression" &&
          node.init.callee?.type === "Identifier" &&
          node.init.callee.name === "useState" &&
          node.id?.type === "ArrayPattern" &&
          node.id.elements?.[0]?.type === "Identifier"
        ) {
          const stateName = node.id.elements[0].name;
          if (DATA_STATE_PATTERN.test(stateName)) {
            // Derive component name from filename
            const match = filename.match(/\/([^/]+)\.tsx?$/);
            const component = match ? match[1] : "Unknown";
            context.report({
              node,
              messageId: "noDataState",
              data: { stateName, component },
            });
          }
        }
      },
    };
  },
};
