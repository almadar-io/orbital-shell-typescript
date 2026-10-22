import type { ThemeDefinition } from '../types/domain.js';

/**
 * The `[data-theme]` keys a preset defines — the selectors `@almadar/ui`'s
 * generated theme CSS writes: `<name>-light` when its base tokens declare
 * anything, `<name>-dark` when it declares a `dark` variant (the `game-*`
 * presets are dark-only). The same rule as `orbital-core` `theme_keys`.
 */
export function themeKeys(definition: ThemeDefinition): string[] {
  const keys: string[] = [];
  if (Object.values(definition.tokens).some((value) => value !== undefined)) keys.push(`${definition.name}-light`);
  if (definition.variants?.['dark'] !== undefined) keys.push(`${definition.name}-dark`);
  return keys;
}
