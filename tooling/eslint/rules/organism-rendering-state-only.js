"use strict";
const { isStoryFile } = require("../utils/helpers");

function isGameOrganism(filename) {
  return /\/organisms\/game\//.test(filename);
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Warn if game organisms have non-rendering useState",
      category: "Almadar Architecture",
    },
    messages: {
      nonRenderingState: "Game organism useState '{{stateName}}' does not match a rendering-only pattern. Extract game-logic state to a hook.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    if (!isGameOrganism(filename) || isStoryFile(filename)) return {};

    const RENDERING_ONLY_PATTERN = /^(hover|isHover|isDrag|isShak|tooltip|viewport|moving|displayed|isTyp|phase|visible|flash|shakeOffset|internalError|activeButtons|activeDirections|isPressed|openActionMenu|canvas|camera|animate|render|frame|scroll|zoom|pan|cursor|highlight|glow|fade|opacity|offset|position|dimension|scale|rotation)/i;

    return {
      VariableDeclarator(node) {
        if (
          node.init?.type === "CallExpression" &&
          node.init.callee?.type === "Identifier" &&
          node.init.callee.name === "useState" &&
          node.id?.type === "ArrayPattern" &&
          node.id.elements?.[0]?.type === "Identifier"
        ) {
          const stateName = node.id.elements[0].name;
          if (!RENDERING_ONLY_PATTERN.test(stateName)) {
            context.report({
              node,
              messageId: "nonRenderingState",
              data: { stateName },
            });
          }
        }
      },
    };
  },
};
