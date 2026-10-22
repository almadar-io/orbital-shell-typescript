/**
 * Prism.js language definition for .lolo files.
 *
 * LOLO is a Lisp-surface text language that lowers to .orb JSON.
 * The grammar style is Haskell-inspired: declaration keywords,
 * type constructors (PascalCase), function-arrow (`->`), and
 * Lisp s-expression operators — but with LOLO-specific primitives
 * distinguished by their own token classes.
 *
 * Token classification is registry-driven: all operator, pattern, and
 * behavior names come from tokens.json (same registry as prism-orb).
 *
 * Token hierarchy (first match wins):
 *   block-comment > comment > string > lolo-binding > lolo-reference >
 *   lolo-event > keyword > lolo-effect > lolo-op-<namespace> >
 *   lolo-type > lolo-persistence > lolo-category > lolo-constructor >
 *   lolo-arrow > number > boolean > null > lolo-modifier > punctuation
 *
 * @packageDocumentation
 */

import {
  tokens,
  wordsToPattern,
  wordsToUnicodePattern,
  wordsToAnchoredPattern,
  unicodeBoundaryRegExp,
  escapeRegex,
} from '../shared.js';
import { multilingualWords, nativeShapeWords, reservedEventWords } from '../i18n.js';

// ---------------------------------------------------------------------------
// Build registry-driven patterns from tokens.json
// ---------------------------------------------------------------------------

// Effect operators (semantic IO: set, persist, fetch, emit, render-ui, ...)
// These are the canonical LOLO effect primitives. They colour purple (#A78BFA)
// matching the AvlEffect visual concept in both .orb and .lolo.
const effectList = multilingualWords(tokens.effectTypes);

// Categorised runtime operators by namespace.
// We skip the 'effect' namespace because effectList already covers it.
const operatorNamespaces: Record<string, string[]> = {};
for (const [ns, ops] of Object.entries(tokens.operatorsByNamespace)) {
  if (ns !== 'effect') {
    operatorNamespaces[ns] = multilingualWords(ops as string[]);
  }
}

// Pattern names (for type: "..." values inside render-ui objects)
// Pattern and behavior names are opaque identifiers — the renderer never
// translates them, so these two lists stay English-only.
const patternNamesPattern = tokens.patternNames.length > 0
  ? wordsToUnicodePattern(tokens.patternNames)
  : null;

// Behavior names (for uses declarations: "std/behaviors/std-modal")
const behaviorNamesPattern = tokens.behaviorNames.length > 0
  ? new RegExp(`(?:${wordsToPattern(tokens.behaviorNames)})`)
  : null;

// ---------------------------------------------------------------------------
// Build the Prism grammar object
// ---------------------------------------------------------------------------

function buildLoloGrammar(): Record<string, unknown> {
  // Namespaced operators produce separate token types so each namespace can
  // carry its own highlight colour in CSS/themes.
  const opTokens: Record<string, RegExp> = {};
  for (const [ns, ops] of Object.entries(operatorNamespaces)) {
    if (ops.length === 0) continue;
    // Hyphen-safe word boundary: no alnum/hyphen char on either side.
    // Covers namespaced forms (array/map) and bare keywords (and, or, not).
    opTokens[`lolo-op-${ns}`] = wordsToUnicodePattern(ops);
  }

  // Unknown namespaced operators — present in source but not in registry.
  // Flagged as errors so authors know they're using an unregistered operator.
  const unknownOpPattern = /(?<![a-zA-Z0-9_-])[a-z][a-z0-9_]*\/[a-z][a-z0-9/_-]*(?![a-zA-Z0-9_-])/;

  return {

    // ── 1. Block comment: #= ... =# ─────────────────────────────────────────
    'block-comment': {
      pattern: /#=[\s\S]*?=#/,
      greedy: true,
    },

    // ── 2. Line comments: # (not followed by =) and ;; ──────────────────────
    'comment': {
      pattern: /(?:;;|#(?!=)).*$/m,
      greedy: true,
    },

    // ── 3. String literals ──────────────────────────────────────────────────
    'string': {
      pattern: /"(?:[^"\\]|\\.)*"/,
      greedy: true,
      // Inside strings: highlight behavior paths and pattern names.
      // e.g. "std/behaviors/std-modal" → lolo-behavior
      //      "data-grid" (in render-ui) → lolo-pattern
      inside: {
        ...(behaviorNamesPattern ? { 'lolo-behavior': { pattern: behaviorNamesPattern } } : {}),
        ...(patternNamesPattern ? { 'lolo-pattern': { pattern: patternNamesPattern } } : {}),
      },
    },

    // ── 4. Binding sigils: @field, @field.sub, ?field ───────────────────────
    // These are the most distinctive LOLO primitive — no equivalent in
    // Haskell. Cyan to match AvlBindingRef in .orb and AVL design system.
    'lolo-binding': /[@?][\p{L}_][\p{L}\p{N}_.]*/u,

    // ── 5. Dotted qualified references: Modal.traits.X, Browse.entity ───────
    // Like qualified module names in Haskell: Data.List.sort.
    // Must come before plain constructor names so the whole path is consumed.
    'lolo-reference': /\b[A-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*){1,}\b/,

    // ── 6. Event keys: UPPER_SNAKE_CASE (≥ 2 uppercase chars) ────────────────
    // Must come before general keywords to prevent `OPEN` matching `open`.
    // Author-written events stay UPPER_SNAKE in every language (they are
    // identifiers); only the reserved ones are translated.
    'lolo-event': unicodeBoundaryRegExp(`[A-Z][A-Z0-9_]+|${wordsToPattern(reservedEventWords)}`),

    // ── 7. Declaration keywords ──────────────────────────────────────────────
    // Structural keywords that introduce new declarations.
    // Analogous to Haskell's module/import/where/let/in/do/data/type.
    'keyword': wordsToUnicodePattern(multilingualWords(tokens.loloKeywords)),

    // ── 8. Effect operators ──────────────────────────────────────────────────
    // Semantic IO primitives: set, persist, fetch, emit, render-ui, navigate …
    // Appear as the first token inside a Lisp s-expression: (persist create …)
    // The hyphen-safe boundary handles `render-ui` and `call-service`.
    ...(effectList.length > 0 ? { 'lolo-effect': wordsToUnicodePattern(effectList) } : {}),

    // ── 9. Runtime operators by namespace ────────────────────────────────────
    // Each namespace gets its own token class so themes can apply different
    // colours (arithmetic=blue, comparison=orange, logic=purple, …).
    ...opTokens,

    // ── 10. Unregistered namespaced operators ────────────────────────────────
    // foo/bar form not found in registry → error colour.
    'lolo-unknown-op': unknownOpPattern,

    // ── 11. Primitive types ──────────────────────────────────────────────────
    // Like Haskell's Int, Bool, String. Orange to match .orb fieldType.
    'lolo-type': wordsToUnicodePattern(multilingualWords(tokens.loloPrimitiveTypes)),

    // ── 12. Persistence and scope keywords ───────────────────────────────────
    // Appear in [persistence: collection] tags and emitsScope / listens blocks.
    'lolo-persistence': wordsToUnicodePattern(multilingualWords(tokens.loloPersistenceAndScope)),

    // ── 13. Trait category tags ───────────────────────────────────────────────
    // The [category] marker after the entity name in a trait declaration.
    // These map to TraitCategory enum values.
    'lolo-category': wordsToUnicodePattern(multilingualWords(tokens.loloTraitCategories)),

    // ── 14. Constructor names ─────────────────────────────────────────────────
    // PascalCase identifiers: entity names, trait names, orbital names.
    // Like Haskell data constructors and type names. Teal to distinguish from
    // declaration keywords (blue) and type primitives (orange).
    'lolo-constructor': unicodeBoundaryRegExp(`[A-Z][a-zA-Z0-9]*|${wordsToPattern(nativeShapeWords)}`),

    // ── 15. Transition / function arrow ──────────────────────────────────────
    // `->` and `→` are the transition arrow in state machines and the
    // entity-binding arrow in trait declarations. Pink, like Haskell `->`.
    'lolo-arrow': /->|→|=/,

    // ── 16. Number literals ───────────────────────────────────────────────────
    'number': /-?(?:\d+\.?\d*)\b/,

    // ── 17. Boolean literals ──────────────────────────────────────────────────
    'boolean': wordsToUnicodePattern(multilingualWords(['true', 'false'])),

    // ── 18. Null ──────────────────────────────────────────────────────────────
    'null': wordsToUnicodePattern(multilingualWords(['null'])),

    // ── 19. Type modifiers and relation markers ───────────────────────────────
    // `!` = required, `*` = relation-many, `+` = relation-non-empty
    // These suffix type expressions: `string!`, `CartItem*`, `T+`
    'lolo-modifier': /[!*+](?=\s|$|,|\)|\]|\{)/,

    // ── 20. Punctuation ───────────────────────────────────────────────────────
    'punctuation': /[{}()[\]:,|]/,
  };
}

/**
 * Register the 'lolo' language with a Prism instance.
 *
 *   import Prism from 'prismjs';
 *   import 'prismjs/components/prism-json';
 *   import { registerLoloLanguage } from '@almadar/syntax';
 *   registerLoloLanguage(Prism);
 */
export function registerLoloLanguage(Prism: Record<string, unknown>): void {
  const languages = Prism.languages as Record<string, unknown>;
  languages.lolo = buildLoloGrammar();
}

/**
 * Classify a bare LOLO token string (no quotes) into a semantic category.
 * Useful for Monaco and other non-Prism consumers.
 */
export function classifyLoloToken(token: string): string {
  if (/^[@?][\p{L}_][\p{L}\p{N}_.]*$/u.test(token)) return 'binding';
  if (/^[A-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*){1,}$/.test(token)) return 'reference';
  if (/^[A-Z][A-Z0-9_]+$/.test(token)) return 'event';
  if (wordsToAnchoredPattern(reservedEventWords).test(token)) return 'event';
  if (wordsToAnchoredPattern(multilingualWords(tokens.loloKeywords)).test(token)) return 'keyword';

  if (wordsToAnchoredPattern(effectList).test(token)) return 'effect';

  for (const [ns, ops] of Object.entries(operatorNamespaces)) {
    if (wordsToAnchoredPattern(ops).test(token)) return `op-${ns}`;
  }

  if (wordsToAnchoredPattern(multilingualWords(tokens.loloPrimitiveTypes)).test(token)) return 'type';
  if (wordsToAnchoredPattern(multilingualWords(tokens.loloPersistenceAndScope)).test(token)) return 'persistence';
  if (wordsToAnchoredPattern(multilingualWords(tokens.loloTraitCategories)).test(token)) return 'category';
  if (/^[A-Z][a-zA-Z0-9]*$/.test(token)) return 'constructor';
  if (wordsToAnchoredPattern(nativeShapeWords).test(token)) return 'constructor';

  if (patternNamesPattern?.test(token)) return 'pattern';
  if (behaviorNamesPattern?.test(token)) return 'behavior';

  return 'identifier';
}

export { escapeRegex, wordsToPattern };
