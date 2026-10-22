"use strict";
const { isOrganism, isStoryFile, isGameOrganism } = require("../utils/helpers");

/**
 * Find the outermost JSX element returned from a .map() callback.
 * Handles: arrow with expression body, arrow with block body + return,
 * and conditional expressions.
 */
function getReturnedJSX(callbackBody) {
  if (
    callbackBody.type === "JSXElement" ||
    callbackBody.type === "JSXFragment"
  ) {
    return callbackBody;
  }

  if (callbackBody.type === "ConditionalExpression") {
    return (
      getReturnedJSX(callbackBody.consequent) ||
      getReturnedJSX(callbackBody.alternate)
    );
  }

  if (callbackBody.type === "BlockStatement") {
    for (const stmt of callbackBody.body) {
      if (stmt.type === "ReturnStatement" && stmt.argument) {
        const jsx = getReturnedJSX(stmt.argument);
        if (jsx) return jsx;
      }
    }
  }

  return null;
}

/**
 * Check if a JSX element has a specific attribute (by name).
 */
function hasJSXAttribute(jsxElement, attrName) {
  if (jsxElement.type !== "JSXElement") return false;
  return jsxElement.openingElement.attributes.some(
    (attr) =>
      attr.type === "JSXAttribute" &&
      attr.name?.type === "JSXIdentifier" &&
      attr.name.name === attrName
  );
}

/**
 * Check if a JSX element has key={param.id} where param is the callback's
 * first parameter. This distinguishes entity iteration (key={hero.id})
 * from utility iteration (key={field}, key={index}, key={actionIdx}).
 */
function hasEntityKeyPattern(jsxElement, callbackParam) {
  if (jsxElement.type !== "JSXElement") return false;
  if (!callbackParam) return false;

  // Get the callback parameter name
  const paramName =
    callbackParam.type === "Identifier"
      ? callbackParam.name
      : callbackParam.type === "ObjectPattern"
        ? null // destructured param, check differently
        : null;

  for (const attr of jsxElement.openingElement.attributes) {
    if (attr.type !== "JSXAttribute") continue;
    if (attr.name?.type !== "JSXIdentifier" || attr.name.name !== "key") continue;

    const value = attr.value;
    if (!value || value.type !== "JSXExpressionContainer") continue;

    const expr = value.expression;

    // key={param.id} pattern
    if (
      paramName &&
      expr.type === "MemberExpression" &&
      expr.object?.type === "Identifier" &&
      expr.object.name === paramName &&
      expr.property?.type === "Identifier" &&
      expr.property.name === "id"
    ) {
      return true;
    }

    // key={param?.id} optional chaining
    if (
      paramName &&
      expr.type === "ChainExpression" &&
      expr.expression?.type === "MemberExpression" &&
      expr.expression.object?.type === "Identifier" &&
      expr.expression.object.name === paramName &&
      expr.expression.property?.type === "Identifier" &&
      expr.expression.property.name === "id"
    ) {
      return true;
    }

    // Destructured: key={id} when param is { id, ... }
    if (
      callbackParam.type === "ObjectPattern" &&
      expr.type === "Identifier" &&
      expr.name === "id"
    ) {
      // Verify 'id' is actually destructured from the param
      const hasId = callbackParam.properties.some(
        (p) =>
          p.type === "Property" &&
          p.key?.type === "Identifier" &&
          p.key.name === "id"
      );
      if (hasId) return true;
    }
  }

  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require data-entity-row attribute on the outermost JSX element returned from .map() in organisms when iterating over entities",
      category: "Almadar Architecture",
    },
    messages: {
      missingEntityRow:
        "Entity row element in .map() is missing 'data-entity-row' attribute. Add it to the root DOM element of each entity card so the verification system can detect entity rows.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();

    if (!isOrganism(filename) || isStoryFile(filename)) return {};
    if (isGameOrganism(filename)) return {};

    return {
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.property.type !== "Identifier" ||
          node.callee.property.name !== "map"
        ) {
          return;
        }

        const callback = node.arguments[0];
        if (!callback) return;

        let body;
        if (
          callback.type === "ArrowFunctionExpression" ||
          callback.type === "FunctionExpression"
        ) {
          body = callback.body;
        } else {
          return;
        }

        const jsxElement = getReturnedJSX(body);
        if (!jsxElement || jsxElement.type !== "JSXElement") return;

        // Only flag entity iteration: key={param.id} pattern
        const callbackParam = callback.params[0];
        if (!hasEntityKeyPattern(jsxElement, callbackParam)) return;

        if (!hasJSXAttribute(jsxElement, "data-entity-row")) {
          context.report({
            node: jsxElement.openingElement,
            messageId: "missingEntityRow",
          });
        }
      },
    };
  },
};
