"use strict";

/**
 * Rule: no-entity-string-type
 *
 * Prevents typing the `entity` prop as `string` in TypeScript interfaces and type aliases.
 * Entity props must carry actual data (objects, arrays, or domain types), never string identifiers.
 */

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow typing the 'entity' prop as 'string' — entity carries data, not a type name",
      category: "Almadar Architecture",
    },
    messages: {
      noEntityString:
        "The 'entity' prop must not be typed as 'string'. Use a proper entity type (object, array, or domain interface) instead.",
    },
    schema: [],
  },

  create(context) {
    /**
     * Check if a type annotation contains 'string' at any level
     * (direct TSStringKeyword, or inside a union/intersection).
     */
    function typeIncludesString(typeNode) {
      if (!typeNode) return false;

      // Direct string keyword
      if (typeNode.type === "TSStringKeyword") return true;

      // Union: string | Foo
      if (typeNode.type === "TSUnionType") {
        return typeNode.types.some(typeIncludesString);
      }

      // Intersection: string & Foo (unlikely but defensive)
      if (typeNode.type === "TSIntersectionType") {
        return typeNode.types.some(typeIncludesString);
      }

      return false;
    }

    /**
     * Check a property signature (interface member or type literal member)
     */
    function checkPropertySignature(node) {
      // Only check properties named "entity"
      const key = node.key;
      if (!key) return;

      const propName =
        key.type === "Identifier"
          ? key.name
          : key.type === "Literal"
            ? String(key.value)
            : null;

      if (propName !== "entity") return;

      // Check the type annotation
      const typeAnnotation = node.typeAnnotation;
      if (!typeAnnotation) return;

      const typeNode =
        typeAnnotation.type === "TSTypeAnnotation"
          ? typeAnnotation.typeAnnotation
          : typeAnnotation;

      if (typeIncludesString(typeNode)) {
        context.report({ node, messageId: "noEntityString" });
      }
    }

    return {
      TSPropertySignature: checkPropertySignature,
    };
  },
};
