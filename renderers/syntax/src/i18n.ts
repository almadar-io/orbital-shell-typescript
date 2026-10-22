/**
 * The binding between `@almadar/core/i18n` (which owns the English → native
 * renderer but must never import `@almadar/std`) and std's 431-entry operator
 * vocabulary (which core therefore cannot see).
 *
 * This package already depends on both, so it is where the two halves meet.
 * std neither exports nor ships its `i18n/` directory, so the operator tables
 * are snapshotted into `tokens.json` by `scripts/generate-tokens.ts` alongside
 * every other registry-derived list — a runtime deep-import would resolve in
 * the monorepo and break in a browser build against the published package.
 *
 * It also supplies the multilingual word lists the Prism grammars need, so one
 * grammar highlights a program rendered in any of the three languages.
 *
 * @packageDocumentation
 */

import {
  englishTables,
  getVocabulary,
  localizeLoloSource,
  localizeMap,
  localizeOrbValue,
  parseVocabularyPack,
  registerVocabulary,
  vocabularyOperators,
  type LanguageCode,
  type OperatorTables,
} from '@almadar/core/i18n';
import type { JsonValue } from '@almadar/core/types';
import { tokens } from './shared.js';

export type { LanguageCode, OperatorTables, JsonValue };

/**
 * The language packs snapshotted into `tokens.json` at build (this package's
 * devDependencies), registered with `@almadar/core/i18n` on import so a browser
 * bundle can render them; `en` is the canonical source and needs no pack.
 */
export const NATIVE_LANGUAGES: readonly LanguageCode[] = tokens.vocabularyPacks.map((raw, i) => {
  const pack = parseVocabularyPack(raw, `@almadar/syntax tokens.json#vocabularyPacks[${i}]`);
  registerVocabulary(pack);
  return pack.meta.code;
});

/** A language pack's operator spellings, as `@almadar/core/i18n` expects them. */
export function stdOperatorTables(lang: LanguageCode): OperatorTables {
  const table = vocabularyOperators(lang);
  if (!table) throw new Error(`no operator spellings for "${lang}" — English operators are their own names`);
  return table;
}

/**
 * Render an English `.lolo` source in `lang`, preserving formatting exactly.
 * `lang === 'en'` returns the source unchanged.
 */
export function translateLolo(source: string, lang: LanguageCode): string {
  return localizeLoloSource(source, lang, { operators: vocabularyOperators(lang) });
}

/**
 * Render an English `.orb` document in `lang`. A string in is a string out
 * (re-serialized at 2-space indent); a parsed value in is a parsed value out.
 *
 * A string that is not valid JSON is returned verbatim: callers render `.orb`
 * text they did not author (a docs fence, an editor buffer mid-keystroke) and
 * must degrade to "translate nothing" rather than throw — the same contract
 * core's `lexLolo` states for the `.lolo` side.
 */
export function translateOrb(json: string | JsonValue, lang: LanguageCode): string | JsonValue {
  const options = { operators: vocabularyOperators(lang) };
  if (typeof json !== 'string') return localizeOrbValue(json, lang, options);
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(json);
  } catch {
    return json;
  }
  return JSON.stringify(localizeOrbValue(parsed, lang, options), null, 2);
}

// ---------------------------------------------------------------------------
// Multilingual vocabulary for the grammars
// ---------------------------------------------------------------------------

const vocabularyCache = new Map<LanguageCode, ReadonlyMap<string, string>>();

function vocabulary(lang: LanguageCode): ReadonlyMap<string, string> {
  const cached = vocabularyCache.get(lang);
  if (cached) return cached;
  const map = localizeMap(lang, stdOperatorTables(lang));
  vocabularyCache.set(lang, map);
  return map;
}

/**
 * Symbolic operators (`+ - == …`) are notation, not words: the renderer keeps
 * the sign in every language, so their translations never appear in source.
 */
const WORD_SHAPED = /^[A-Za-z_][A-Za-z0-9_/-]*$/;

/** An English `.lolo` word list plus its `ar` and `sl` spellings. */
export function multilingualWords(words: readonly string[]): string[] {
  const out = new Set<string>(words);
  for (const lang of NATIVE_LANGUAGES) {
    const map = vocabulary(lang);
    for (const word of words) {
      if (!WORD_SHAPED.test(word)) continue;
      const native = map.get(word);
      if (native !== undefined) out.add(native);
    }
  }
  return [...out];
}

/** Only the `ar`/`sl` spellings of an English `.lolo` word list. */
export function nativeWords(words: readonly string[]): string[] {
  const english = new Set(words);
  return multilingualWords(words).filter((word) => !english.has(word));
}

/**
 * An English `.orb` JSON key list plus its `ar`/`sl` spellings. `.orb` keys
 * live in their own vocabulary section, which `localizeMap` excludes — they
 * are JSON keys, never `.lolo` source words.
 */
export function multilingualOrbKeys(keys: readonly string[]): string[] {
  const out = new Set<string>(keys);
  for (const lang of NATIVE_LANGUAGES) {
    const table = getVocabulary(lang).orb;
    for (const key of keys) {
      const native = table[key];
      if (native !== undefined) out.add(native);
    }
  }
  return [...out];
}

/** Reserved event names (`INIT`, …) in all three languages. */
export const reservedEventWords: readonly string[] = multilingualWords(
  Object.keys(englishTables.reservedEvents),
);

/** Declaration shapes (`Entity`, `Trait`, …) in `ar`/`sl` only. */
export const nativeShapeWords: readonly string[] = nativeWords(
  Object.keys(englishTables.shapes),
);
