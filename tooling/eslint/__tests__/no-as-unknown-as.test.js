"use strict";

const test = require("node:test");
const { RuleTester } = require("eslint");
const tsParser = require("@typescript-eslint/parser");
const rule = require("../rules/no-as-unknown-as");

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  },
});

test("almadar/no-as-unknown-as", () => {
  ruleTester.run("no-as-unknown-as", rule, {
    valid: [
      "const x = y as T;",
      "const x = y satisfies T;",
      "const x = y as unknown;",
      "function f(err: unknown) { return err; }",
      "try { f(); } catch (err: unknown) { console.log(err); }",
    ],
    invalid: [
      {
        code: "const x = y as unknown as T;",
        errors: [{ messageId: "noAsUnknownAs" }],
      },
      {
        code: "const x = (y as unknown as { relation: { entity: string } }).relation;",
        errors: [{ messageId: "noAsUnknownAs" }],
      },
      {
        code: "const orb = { name: 'X' } as unknown as Orbital;",
        errors: [{ messageId: "noAsUnknownAs" }],
      },
    ],
  });
});
