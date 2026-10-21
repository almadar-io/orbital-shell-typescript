"use strict";
const tsParser = require("@typescript-eslint/parser");
const almadarPlugin = require("@almadar/eslint-plugin");
const reactCompiler = require("eslint-plugin-react-compiler");

module.exports = [
  { ignores: ["dist/**", "node_modules/**", "**/*.test.tsx", "**/*.test.ts", "**/*.generated.ts"] },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: {
      almadar: almadarPlugin,
      "react-compiler": reactCompiler,
    },
    rules: {
      "almadar/no-as-any": "error",
      "almadar/no-unknown-type": "error",
      "almadar/no-record-string-unknown": "error",
      "almadar/no-import-generated": "error",
      "almadar/atom-molecule-no-entity-prop": "error",
      "almadar/no-hardcoded-colors": "error",
      // react-compiler: disabled at package level — pre-existing patterns need incremental cleanup
      "react-compiler/react-compiler": "off",
    },
  },
];
