"use strict";

const fs = require("fs");
const path = require("path");
const { isStoryFile, isOrganism, isTemplateFile } = require("../utils/helpers");

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require .stories.tsx file for organism and template components",
      category: "Almadar Architecture",
    },
    messages: {
      missingStory:
        "Component '{{name}}' is missing a .stories.tsx file. Every organism and template needs Storybook coverage.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;

    // Only check organisms and templates
    if (!isOrganism(filename) && !isTemplateFile(filename)) return {};
    if (isStoryFile(filename)) return {};
    if (!/\.(tsx|jsx)$/.test(filename)) return {};

    // Skip index files
    if (/index\.(tsx|jsx)$/.test(filename)) return {};

    return {
      Program(node) {
        const dir = path.dirname(filename);
        const base = path.basename(filename, path.extname(filename));

        // Check for sibling .stories.tsx
        const storyFile = path.join(dir, `${base}.stories.tsx`);
        const storyFileJsx = path.join(dir, `${base}.stories.jsx`);

        // Also check stories/ subdirectory
        const storiesDir = path.join(dir, "stories", `${base}.stories.tsx`);

        if (
          !fs.existsSync(storyFile) &&
          !fs.existsSync(storyFileJsx) &&
          !fs.existsSync(storiesDir)
        ) {
          context.report({
            node,
            messageId: "missingStory",
            data: { name: base },
          });
        }
      },
    };
  },
};
