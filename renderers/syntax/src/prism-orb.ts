/**
 * Prism.js language definition for .orb files.
 *
 * Registry-driven: reads tokens.json (generated from @almadar/std
 * and @almadar/core/patterns) to classify tokens. Unknown operators and
 * unregistered patterns get error/warning colors.
 *
 * @packageDocumentation
 */

import { tokens, escapeRegex, wordsToPattern, allOpsSet, patternsSet } from './shared.js';
import { multilingualWords, multilingualOrbKeys, reservedEventWords } from './i18n.js';

// Every word list is English + its `ar`/`sl` spellings, so one grammar
// highlights a document rendered in any of the three languages. Pattern and
// behavior names are opaque identifiers the renderer never translates.
const operatorsByNamespace: Record<string, string[]> = {};
for (const [ns, ops] of Object.entries(tokens.operatorsByNamespace)) {
  operatorsByNamespace[ns] = multilingualWords(ops as string[]);
}
const effectTypes = multilingualWords(tokens.effectTypes);
const structuralKeys = multilingualOrbKeys(tokens.structuralKeys);
const fieldTypes = multilingualWords(tokens.fieldTypes);
const persistenceKinds = multilingualWords(tokens.persistenceKinds);
const uiSlots = multilingualWords(tokens.uiSlots);
const sigilRoots = multilingualWords([
  'entity', 'payload', 'state', 'now', 'config', 'computed', 'trait', 'user',
]);

// Build namespace-specific patterns
const namespacePatterns: Record<string, RegExp> = {};
for (const [ns, ops] of Object.entries(operatorsByNamespace)) {
  if (ops.length > 0) {
    namespacePatterns[ns] = new RegExp(`^"(${wordsToPattern(ops)})"$`, 'u');
  }
}

const effectPattern = new RegExp(`^"(${wordsToPattern(effectTypes)})"$`, 'u');
const structuralPattern = new RegExp(`^"(${wordsToPattern(structuralKeys)})"$`, 'u');
const fieldTypePattern = new RegExp(`^"(${wordsToPattern(fieldTypes)})"$`, 'u');
const persistencePattern = new RegExp(`^"(${wordsToPattern(persistenceKinds)})"$`, 'u');
const slotPattern = new RegExp(`^"(${wordsToPattern(uiSlots)})"$`, 'u');
const eventPattern = new RegExp(`^"(?:[A-Z][A-Z0-9_]{2,}|${wordsToPattern(reservedEventWords)})"$`, 'u');
const bindingPattern = new RegExp(
  `^"@(?:(?:${wordsToPattern(sigilRoots)})|[A-Z][a-zA-Z0-9]*)(?:\\.[\\p{L}\\p{N}_.]+)?"$`,
  'u',
);
const patternNamesPattern = tokens.patternNames.length > 0
  ? new RegExp(`^"(${wordsToPattern(tokens.patternNames)})"$`, 'u')
  : null;
const behaviorPattern = tokens.behaviorNames.length > 0
  ? new RegExp(`^"(${wordsToPattern(tokens.behaviorNames)})"$`, 'u')
  : null;

/**
 * Register the 'orb' language with Prism.
 *
 * Call this before any code blocks render:
 *   import { registerOrbLanguage } from '@almadar/syntax';
 *   registerOrbLanguage(Prism);
 */
export function registerOrbLanguage(Prism: Record<string, unknown>): void {
  const languages = Prism.languages as Record<string, unknown>;

  // Extend JSON as the base grammar
  const json = languages.json as Record<string, unknown>;
  if (!json) {
    console.warn('[almadar-syntax] Prism JSON language not found. Load it first.');
    return;
  }

  // Build inside grammar for semantic string classification.
  // Refractor-compatible: uses standard Prism `inside` tokenization,
  // no hooks. Order matters (first match wins).
  const orbInside: Record<string, RegExp | { pattern: RegExp }> = {};

  // 1. Bindings: @entity.field, @payload.x, @Entity.field
  orbInside['orb-binding'] = new RegExp(
    `"@(?:(?:${wordsToPattern(sigilRoots)})|[A-Z][a-zA-Z0-9]*)(?:\\.[\\p{L}\\p{N}_.]+)?"`,
    'u',
  );

  // 2. Effect types
  if (effectTypes.length > 0) {
    orbInside['orb-effect'] = new RegExp(`"(?:${wordsToPattern(effectTypes)})"`, 'u');
  }

  // 3. Operator namespaces
  for (const [ns, ops] of Object.entries(operatorsByNamespace)) {
    if (ops.length > 0) {
      orbInside[`orb-op-${ns}`] = new RegExp(`"(?:${wordsToPattern(ops)})"`, 'u');
    }
  }

  // 4. Events: UPPER_SNAKE_CASE (3+ chars), plus the translated reserved ones
  orbInside['orb-event'] = new RegExp(
    `"(?:[A-Z][A-Z0-9_]{2,}|${wordsToPattern(reservedEventWords)})"`,
    'u',
  );

  // 5. UI slots
  if (uiSlots.length > 0) {
    orbInside['orb-slot'] = new RegExp(`"(?:${wordsToPattern(uiSlots)})"`, 'u');
  }

  // 6. Structural keys
  if (structuralKeys.length > 0) {
    orbInside['orb-structural'] = new RegExp(`"(?:${wordsToPattern(structuralKeys)})"`, 'u');
  }

  // 7. Field types
  if (fieldTypes.length > 0) {
    orbInside['orb-field-type'] = new RegExp(`"(?:${wordsToPattern(fieldTypes)})"`, 'u');
  }

  // 8. Persistence kinds
  if (persistenceKinds.length > 0) {
    orbInside['orb-persistence'] = new RegExp(`"(?:${wordsToPattern(persistenceKinds)})"`, 'u');
  }

  // 9. Pattern names
  if (tokens.patternNames.length > 0) {
    orbInside['orb-pattern'] = new RegExp(`"(?:${wordsToPattern(tokens.patternNames)})"`);
  }

  // 10. Behavior names
  if (tokens.behaviorNames.length > 0) {
    orbInside['orb-behavior'] = new RegExp(`"(?:${wordsToPattern(tokens.behaviorNames)})"`);
  }

  // 11. Unknown operators: namespaced identifiers not in registry
  orbInside['orb-unknown-op'] = /"[a-z][a-z0-9_-]*\/[a-z][a-z0-9/_-]*"/;

  // Clone JSON property and string tokens, adding the inside grammar
  const jsonProp = json.property as Record<string, unknown>;
  const jsonStr = json.string as Record<string, unknown>;

  languages.orb = {
    ...json,
    property: {
      ...(typeof jsonProp === 'object' ? jsonProp : { pattern: jsonProp }),
      inside: orbInside,
    },
    string: {
      ...(typeof jsonStr === 'object' ? jsonStr : { pattern: jsonStr }),
      inside: orbInside,
    },
  };
}

/**
 * Get the token classification for a string value.
 * Useful for Monaco and other non-Prism consumers.
 */
export function classifyOrbToken(quotedString: string): string {
  // Reuse the same logic without Prism dependency
  if (bindingPattern.test(quotedString)) return 'binding';
  if (effectPattern.test(quotedString)) return 'effect';
  for (const [ns, pattern] of Object.entries(namespacePatterns)) {
    if (pattern.test(quotedString)) return ns;
  }
  if (eventPattern.test(quotedString)) return 'event';
  if (slotPattern.test(quotedString)) return 'slot';
  if (structuralPattern.test(quotedString)) return 'structural';
  if (fieldTypePattern.test(quotedString)) return 'fieldType';
  if (persistencePattern.test(quotedString)) return 'persistence';
  if (patternNamesPattern?.test(quotedString)) return 'pattern';
  if (behaviorPattern?.test(quotedString)) return 'behavior';
  return 'string';
}

/**
 * Check if an operator name is registered.
 */
export function isRegisteredOperator(name: string): boolean {
  return allOpsSet.has(name);
}

/**
 * Check if a pattern name is registered.
 */
export function isRegisteredPattern(name: string): boolean {
  return patternsSet.has(name);
}
