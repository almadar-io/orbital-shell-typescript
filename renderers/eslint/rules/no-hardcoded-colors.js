"use strict";

/**
 * Disallow hardcoded palette colors in Tailwind class strings.
 *
 * @almadar/shell-web components must read color from theme tokens
 * (text-foreground, bg-card, border-border, bg-primary, text-muted-foreground,
 * bg-error, ...) so every theme — light or dark — stays readable. Hardcoded
 * utilities (text-white, bg-gray-800, border-indigo-300, text-[#1a2b3c])
 * ignore the active theme and are the root cause of dark-on-dark /
 * light-on-light text, including on hover states.
 *
 * Arbitrary values that reference a CSS variable (bg-[var(--color-card)])
 * are token usage and allowed. Intentional theme-independent paint (e.g.
 * white caption over a media scrim) needs an explicit eslint-disable.
 */

const PALETTE_NAMES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|" +
  "teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

const COLOR_UTILITIES =
  "text|bg|border|ring|fill|stroke|from|via|to|divide|outline|shadow|" +
  "decoration|placeholder|caret|accent";

const PALETTE_RE = new RegExp(
  `^(?:${COLOR_UTILITIES})-(?:${PALETTE_NAMES})-\\d{2,3}(?:\\/[\\d.]+)?$`
);
const WHITE_BLACK_RE = new RegExp(
  `^(?:${COLOR_UTILITIES})-(?:white|black)(?:\\/[\\d.]+)?$`
);
const ARBITRARY_COLOR_RE = /\[(?:#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|hwb\(|color\()/;

const SUGGESTIONS = {
  "text-white": "text-primary-foreground (or the matching *-foreground token)",
  "text-black": "text-foreground",
  "bg-white": "bg-card",
  "bg-black": "bg-background",
  "text-gray-400": "text-muted-foreground",
  "text-gray-500": "text-muted-foreground",
  "text-gray-600": "text-muted-foreground",
  "text-gray-700": "text-foreground",
  "text-gray-900": "text-foreground",
  "bg-gray-50": "bg-muted",
  "bg-gray-100": "bg-muted",
  "bg-gray-800": "bg-card",
  "bg-gray-900": "bg-background",
};

function findHardcodedToken(classString) {
  for (const rawToken of classString.split(/\s+/)) {
    if (!rawToken) continue;
    // Strip variant prefixes (hover:, dark:, group-hover:, sm:, ...)
    const token = rawToken.slice(rawToken.lastIndexOf(":") + 1);
    // Strip important modifier
    const bare = token.startsWith("!") ? token.slice(1) : token;
    if (PALETTE_RE.test(bare) || WHITE_BLACK_RE.test(bare)) {
      return { token: rawToken, bare };
    }
    if (ARBITRARY_COLOR_RE.test(bare)) {
      return { token: rawToken, bare };
    }
  }
  return null;
}

function checkClassString(context, node, classString) {
  const hit = findHardcodedToken(classString);
  if (!hit) return;
  const suggestion = SUGGESTIONS[hit.bare];
  context.report({
    node,
    messageId: suggestion ? "hardcodedWithSuggestion" : "hardcoded",
    data: { token: hit.token, suggestion: suggestion || "" },
  });
}

function isClassNameAttribute(node) {
  return (
    node.type === "JSXAttribute" &&
    node.name.type === "JSXIdentifier" &&
    (node.name.name === "className" || node.name.name === "class")
  );
}

const CLASS_HELPERS = new Set(["cn", "clsx", "twMerge", "cva"]);

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hardcoded Tailwind palette colors — use theme tokens (text-foreground, bg-card, ...) so every theme stays readable",
      category: "Almadar Architecture",
    },
    messages: {
      hardcoded:
        "Hardcoded color '{{token}}' ignores the active theme (breaks light/dark contrast). Use a theme token instead (text-foreground, text-muted-foreground, bg-card, bg-primary, text-primary-foreground, border-border, ...).",
      hardcodedWithSuggestion:
        "Hardcoded color '{{token}}' ignores the active theme (breaks light/dark contrast). Use {{suggestion}} instead.",
    },
    schema: [],
  },

  create(context) {
    function inspectString(node, value) {
      if (typeof value === "string") checkClassString(context, node, value);
    }

    function walk(node) {
      if (!node || typeof node !== "object") return;
      if (node.type === "Literal") {
        inspectString(node, node.value);
        return;
      }
      if (node.type === "TemplateLiteral") {
        for (const quasi of node.quasis) inspectString(quasi, quasi.value.cooked);
        for (const expr of node.expressions) walk(expr);
        return;
      }
      // cn()/clsx()/cva() arguments are reported by the CallExpression
      // visitor — skip them here to avoid double-reporting.
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        CLASS_HELPERS.has(node.callee.name)
      ) {
        return;
      }
      for (const key of Object.keys(node)) {
        if (key === "parent" || key === "loc" || key === "range") continue;
        const child = node[key];
        if (Array.isArray(child)) child.forEach(walk);
        else if (child && typeof child.type === "string") walk(child);
      }
    }

    return {
      JSXAttribute(node) {
        if (!isClassNameAttribute(node) || !node.value) return;
        if (node.value.type === "Literal") {
          inspectString(node.value, node.value.value);
        } else if (node.value.type === "JSXExpressionContainer") {
          walk(node.value.expression);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "Identifier" || !CLASS_HELPERS.has(callee.name)) return;
        for (const arg of node.arguments) walk(arg);
      },
    };
  },
};
