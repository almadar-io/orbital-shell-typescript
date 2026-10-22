/**
 * Shared utilities for orb and lolo syntax highlighting.
 *
 * Both grammars are registry-driven — all operator, pattern, and
 * behavior names come from tokens.json (generated from live @almadar/*
 * packages). This module provides the helpers that build runtime regex
 * patterns from those token lists.
 *
 * @packageDocumentation
 */

import tokens from './tokens.json' with { type: 'json' };

export { tokens };

/** Escape a string for use inside a regex character class or alternation. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a regex alternation from a list of words.
 * Sorts longest-first so longer tokens take priority over shorter prefixes.
 */
export function wordsToPattern(words: readonly string[]): string {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  return sorted.map(escapeRegex).join('|');
}

/**
 * Build a word-boundary-safe pattern for tokens that may contain hyphens
 * (e.g. `render-ui`, `call-service`, `game-core`). Standard `\b` anchors
 * break at the hyphen, so we use character-class lookahead/lookbehind.
 */
export function wordsToHyphenSafePattern(words: readonly string[]): string {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  return sorted.map(escapeRegex).join('|');
}

/**
 * The word-boundary lookaround the grammars anchor keyword lists with.
 *
 * `\b` is ASCII-only in JavaScript regex, so it can never match a word in
 * Arabic script — and it also breaks at the hyphen in `render-ui`. This is
 * the same character-class lookaround the namespaced-operator patterns
 * already use, generalized to Unicode so one grammar anchors English,
 * Arabic and Slovenian alike. Requires the `u` flag.
 */
export const UNICODE_WORD_EDGE = '[\\p{L}\\p{N}_-]';

/** `alternation` anchored on Unicode word edges, `u`-flagged. */
export function unicodeBoundaryRegExp(alternation: string): RegExp {
  return new RegExp(`(?<!${UNICODE_WORD_EDGE})(?:${alternation})(?!${UNICODE_WORD_EDGE})`, 'u');
}

/** A word list as one Unicode-word-boundary-anchored pattern. */
export function wordsToUnicodePattern(words: readonly string[]): RegExp {
  return unicodeBoundaryRegExp(wordsToPattern(words));
}

/** A word list as one fully-anchored `^…$` pattern (for `classify*`). */
export function wordsToAnchoredPattern(words: readonly string[]): RegExp {
  return new RegExp(`^(?:${wordsToPattern(words)})$`, 'u');
}

/** Set of all registered operator names (for unknown-operator detection). */
export const allOpsSet = new Set<string>(tokens.allOperatorNames);

/** Set of all registered pattern names. */
export const patternsSet = new Set<string>(tokens.patternNames);
