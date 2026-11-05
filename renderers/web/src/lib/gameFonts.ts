import gameFontFamilies from '@almadar/core/patterns/game-font-families.json';

export const GAME_FONT_KEYS: Readonly<Record<string, string>> = gameFontFamilies.aliases;

/**
 * Resolve a font-family prop value:
 *   - a known game key (e.g. "future-narrow") → "'Kenney Future Narrow', ui-sans-serif, system-ui, sans-serif"
 *   - any other value → returned as-is (assumed to be a CSS font-family string)
 *   - undefined/null → undefined
 */
export function resolveGameFontFamily(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const resolved = GAME_FONT_KEYS[input];
  if (resolved) return `'${resolved}', ${gameFontFamilies.fallback}`;
  return input;
}
