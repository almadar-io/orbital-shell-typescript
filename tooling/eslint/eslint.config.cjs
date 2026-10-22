"use strict";
module.exports = [
  { ignores: ["node_modules/**"] },
  {
    files: ["index.js", "rules/**/*.js", "utils/**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "commonjs" },
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    },
  },
];
