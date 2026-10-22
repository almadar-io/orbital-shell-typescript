"use strict";

/**
 * behavior-no-organisms
 *
 * Behaviors (.orb files in behaviors/) must only use atom and molecule patterns.
 * Organisms and templates are forbidden, with exceptions for:
 *   - form / form-section (explicitly allowed by convention)
 *
 * All game components (canvas renderers, HUDs, menus, logs, panels) have been
 * moved to molecule level. No game exception is needed.
 *
 * Requires: jsonc-eslint-parser configured for *.orb files.
 *
 * To regenerate BLOCKED_PATTERNS from component-mapping.json:
 *   node -e "
 *     const m = require('../almadar-patterns/src/component-mapping.json').mappings;
 *     const blocked = Object.entries(m)
 *       .filter(([k, v]) =>
 *         (v.importPath.includes('/organisms/') || v.importPath.includes('/templates/'))
 *         && !['form', 'form-section'].includes(k))
 *       .map(([k]) => k);
 *     console.log(JSON.stringify(blocked, null, 2));
 *   "
 */

// Organism patterns: importPath contains /organisms/ or /templates/
// Excludes: form, form-section (allowed by convention)
const BLOCKED_PATTERNS = new Set([
  // ── Organisms (non-game, non-form) ────────────────────────────────
  "page-header",
  "entity-list",
  "entity-table",
  "entity-cards",
  "stats",
  "detail-panel",
  "wizard-container",
  "confirm-dialog",
  "master-detail",
  "dashboard-grid",
  "runtime-debugger",
  "button-pattern",
  "custom-pattern",
  "drawer-slot",
  "header",
  "layout-pattern",
  "modal-slot",
  "navigation",
  "orbital-visualization",
  "section",
  "sidebar",
  "split",
  "table",
  "toast-slot",
  "u-i-slot-renderer",
  "split-pane",
  "tabbed-container",
  "collapsible-section",
  "camera3-d",
  "lighting3-d",
  "scene3-d",
  "canvas3-d-error-boundary",
  "canvas3-d-loading-state",
  "model-loader",
  "physics-object3-d",
  "feature-renderer",
  "feature-renderer3-d",
  "unit-renderer",
  "trait-slot",
  "trait-state-viewer",
  "content-renderer",
  "jazari-state-machine",
  "state-machine-view",
  "book-chapter-view",
  "book-cover-page",
  "book-nav-bar",
  "book-table-of-contents",
  "book-viewer",
  "simulation-controls",
  "simulation-graph",
  "chart",
  "timeline",
  "media-gallery",
  "signature-pad",
  "document-viewer",
  "graph-canvas",
  "code-viewer",
  "event-log",
  "object-rule-panel",
  "rule-editor",
  "action-palette",
  "sequence-bar",
  "code-view",
  "state-architect-board",
  "state-node",
  "transition-arrow",
  "variable-panel",

  // ── Templates (non-game) ──────────────────────────────────────────
  "auth-layout",
  "counter-template",
  "dashboard-layout",
  "generic-app-template",
]);

// Alternative names that map to the same organism
const ALIASES = {
  form: null, // explicitly allowed
  "form-section": null, // explicitly allowed
};

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Behavior schemas must only use atom and molecule patterns. " +
        "Organisms and templates (except canvas game organisms and form-section) are forbidden.",
      category: "Almadar Architecture",
    },
    messages: {
      blockedPattern:
        'Pattern "{{pattern}}" is an organism/template. ' +
        "Behaviors must only use atoms and molecules. " +
        "Replace with a molecule-level equivalent or restructure the schema.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename || context.getFilename();

    // Only apply to .orb files inside behaviors/ directories
    if (!filename.endsWith(".orb") || !filename.includes("behaviors")) {
      return {};
    }

    return {
      // jsonc-eslint-parser provides JSONProperty AST nodes
      JSONProperty(node) {
        // Look for "type": "<pattern-name>" properties
        if (
          node.key &&
          node.key.type === "JSONLiteral" &&
          node.key.value === "type" &&
          node.value &&
          node.value.type === "JSONLiteral" &&
          typeof node.value.value === "string"
        ) {
          const pattern = node.value.value;

          // Skip explicitly allowed aliases
          if (pattern in ALIASES) return;

          if (BLOCKED_PATTERNS.has(pattern)) {
            context.report({
              node: node.value,
              messageId: "blockedPattern",
              data: { pattern },
            });
          }
        }
      },
    };
  },
};
