"use strict";

const { BLOCKED_HTML_ELEMENTS, ALLOWED_HTML_ELEMENTS, isAtomOrMolecule, isStoryFile } = require("../utils/helpers");

const ELEMENT_REPLACEMENTS = {
  div: "Box, VStack, HStack, Stack",
  span: "Typography, Badge, TextHighlight",
  p: "Typography (variant='body1')",
  h1: "Typography (variant='h1')",
  h2: "Typography (variant='h2')",
  h3: "Typography (variant='h3')",
  h4: "Typography (variant='h4')",
  h5: "Typography (variant='h5')",
  h6: "Typography (variant='h6')",
  button: "Button",
  input: "Input, Checkbox, Radio, Switch",
  textarea: "Textarea",
  select: "Select, RelationSelect",
  img: "Avatar or Box with background",
  ul: "VStack with mapped children, or List",
  ol: "VStack with mapped children, or List",
  li: "Box or HStack",
  table: "DataTable, Table",
  tr: "DataTable, Table",
  td: "DataTable, Table",
  th: "DataTable, Table",
  form: "FormSection, Form",
  section: "Box, VStack, Section",
  main: "Box, VStack",
  article: "Box, VStack",
  aside: "Box, SidePanel",
  nav: "Navigation, Breadcrumb, Tabs",
  header: "Box, HStack, PageHeader",
  footer: "Box, HStack",
  label: "Label, FormField",
  a: "Button (with navigatesTo) or Typography (with link)",
};

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow raw HTML elements — use @almadar/shell-web components instead",
      category: "Almadar Architecture",
    },
    messages: {
      noRawElement:
        "Use @almadar/shell-web components instead of <{{element}}>. Suggested: {{replacement}}.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;

    // Atoms and molecules are allowed to use raw elements (they implement primitives)
    if (isAtomOrMolecule(filename)) return {};

    // Stories are allowed to use raw elements for demo wrappers
    if (isStoryFile(filename)) return {};

    return {
      JSXOpeningElement(node) {
        const name = node.name;

        // Only check simple element names (not member expressions like Foo.Bar)
        if (name.type !== "JSXIdentifier") return;

        const elementName = name.name;

        // Skip allowed elements (SVG, canvas, media)
        if (ALLOWED_HTML_ELEMENTS.has(elementName)) return;

        // Flag blocked elements
        if (BLOCKED_HTML_ELEMENTS.has(elementName)) {
          context.report({
            node,
            messageId: "noRawElement",
            data: {
              element: elementName,
              replacement: ELEMENT_REPLACEMENTS[elementName] || "an @almadar/shell-web component",
            },
          });
        }
      },
    };
  },
};
