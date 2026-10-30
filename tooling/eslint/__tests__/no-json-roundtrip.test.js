"use strict";

const test = require("node:test");
const { RuleTester } = require("eslint");
const tsParser = require("@typescript-eslint/parser");
const rule = require("../rules/no-json-roundtrip");

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  },
});

const error = [{ messageId: "noJsonRoundtrip" }];

test("almadar/no-json-roundtrip", () => {
  ruleTester.run("no-json-roundtrip", rule, {
    valid: [
      "function f(text: string) { return JSON.parse(text); }",
      "async function f(r: Response) { return JSON.parse(await r.text()); }",
      "const s = JSON.stringify(x);",
      "send(JSON.stringify(x));",
      "const c = structuredClone(x);",
      "const s = JSON.stringify(x); s = 'other'; JSON.parse(s);",
      "let s = JSON.stringify(x); s = read(); JSON.parse(s);",
      "const s = read(); JSON.parse(s);",
      "const s = JSON.stringify(x); function g(s: string) { return JSON.parse(s); }",
      "Other.parse(JSON.stringify(x));",
    ],
    invalid: [
      { code: "const y = JSON.parse(JSON.stringify(x));", errors: error },
      { code: "const y = JSON.parse(JSON.stringify(x), reviver);", errors: error },
      { code: "const y = JSON.parse(JSON.stringify(x, null, 2));", errors: error },
      { code: "const y = JSON.parse(JSON.stringify(x), reviver) as T;", errors: error },
      { code: "const y = JSON.parse(JSON.stringify(x) as string);", errors: error },
      {
        code: "const s = JSON.stringify(x); const y = JSON.parse(s);",
        errors: error,
      },
      {
        code: "function f(x) { const s = JSON.stringify(x, null, 2); return JSON.parse(s, reviver); }",
        errors: error,
      },
      {
        code: "const s = JSON.stringify(x); function g() { return JSON.parse(s); }",
        errors: error,
      },
    ],
  });
});
