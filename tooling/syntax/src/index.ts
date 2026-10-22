/**
 * @almadar/syntax
 *
 * Registry-driven syntax highlighting for .orb and .lolo programs.
 * Colors align with the Almadar Visual Language (AVL).
 *
 * @packageDocumentation
 */

// ── .orb (JSON) ──────────────────────────────────────────────────────────────
export { registerOrbLanguage, classifyOrbToken, isRegisteredOperator, isRegisteredPattern } from './prism-orb.js';

/**
 * Refractor/react-syntax-highlighter language definition for .orb files.
 *
 *   import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
 *   import { orbLanguage } from '@almadar/syntax';
 *   SyntaxHighlighter.registerLanguage('orb', orbLanguage);
 */
export { orbLanguage } from './refractor-orb.js';

// ── .lolo (text) ─────────────────────────────────────────────────────────────
export { registerLoloLanguage, classifyLoloToken } from './lolo/prism-lolo.js';

/**
 * Refractor/react-syntax-highlighter language definition for .lolo files.
 *
 *   import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
 *   import { loloLanguage } from '@almadar/syntax';
 *   SyntaxHighlighter.registerLanguage('lolo', loloLanguage);
 */
export { loloLanguage } from './lolo/refractor-lolo.js';

// ── i18n (English → native rendering) ────────────────────────────────────────

/**
 * Render an English `.lolo` / `.orb` program in Arabic or Slovenian.
 *
 * These are `@almadar/core/i18n`'s `localizeLoloSource` / `localizeOrbValue`
 * with `@almadar/std`'s operator vocabulary already wired in — core cannot
 * import std, and std does not publish its `i18n/` tables, so this package
 * (which depends on both) owns the binding.
 */
export { translateLolo, translateOrb, stdOperatorTables } from './i18n.js';

/** The multilingual word lists the grammars are built from. */
export {
  NATIVE_LANGUAGES,
  multilingualWords,
  multilingualOrbKeys,
  nativeWords,
  reservedEventWords,
  nativeShapeWords,
} from './i18n.js';
export type { LanguageCode, OperatorTables, JsonValue } from './i18n.js';

// ── Shared ────────────────────────────────────────────────────────────────────
export { ORB_COLORS } from './colors.js';
