import { describe, it, expect } from 'vitest';
import { themeDataKey, isThemeRegistryKey, ThemeRefStringSchema } from '../src/types/domain.js';
import type { ThemeDefinition } from '../src/types/domain.js';

const inline: ThemeDefinition = { name: 'harbor', tokens: {} };

describe('themeDataKey', () => {
  it('maps a registry key to itself (the data-theme value)', () => {
    expect(themeDataKey('gazette-light')).toBe('gazette-light');
  });

  it('keys an inline definition by its name', () => {
    expect(themeDataKey(inline)).toBe('harbor');
  });

  it('is empty when no theme is declared', () => {
    expect(themeDataKey(undefined)).toBe('');
  });

  it('passes the legacy import form through unchanged (resolution happens upstream)', () => {
    expect(themeDataKey('Ocean.theme')).toBe('Ocean.theme');
  });
});

describe('isThemeRegistryKey', () => {
  it('accepts kebab-case registry keys, including multi-part families', () => {
    expect(isThemeRegistryKey('gazette-light')).toBe(true);
    expect(isThemeRegistryKey('bloomberg-dense-dark')).toBe(true);
    expect(isThemeRegistryKey('minimalist')).toBe(true);
  });

  it('rejects the legacy "Alias.theme" import form', () => {
    expect(isThemeRegistryKey('Ocean.theme')).toBe(false);
  });

  it('rejects inline definitions, absent themes and malformed strings', () => {
    expect(isThemeRegistryKey(inline)).toBe(false);
    expect(isThemeRegistryKey(undefined)).toBe(false);
    expect(isThemeRegistryKey('')).toBe(false);
    expect(isThemeRegistryKey('Gazette-Light')).toBe(false);
    expect(isThemeRegistryKey('gazette--light')).toBe(false);
  });

  it('agrees with ThemeRefStringSchema on every registry key it accepts', () => {
    for (const key of ['gazette-light', 'bloomberg-dense-dark', 'minimalist']) {
      expect(ThemeRefStringSchema.safeParse(key).success).toBe(true);
    }
  });
});
