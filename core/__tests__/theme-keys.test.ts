import { describe, expect, it } from 'vitest';

import { builtInThemeKeys, THEME_PRESETS, themeKeys } from '../src/themes/index.js';
import type { ThemeDefinition } from '../src/types/domain.js';

describe('themeKeys — the [data-theme] keys a preset defines (orbital-core `theme_keys`)', () => {
  it('a preset with base tokens and a dark variant has both keys', () => {
    const def: ThemeDefinition = { name: 'clay', tokens: { colors: { primary: '#000' } }, variants: { dark: {} } };
    expect(themeKeys(def)).toEqual(['clay-light', 'clay-dark']);
  });

  it('a dark-only preset (empty base tokens) has no light key', () => {
    expect(themeKeys({ name: 'game-rpg', tokens: {}, variants: { dark: {} } })).toEqual(['game-rpg-dark']);
  });

  it('control: a non-dark variant adds no key', () => {
    expect(themeKeys({ name: 'clay', tokens: { colors: { a: 'b' } }, variants: { 'high-contrast': {} } })).toEqual(['clay-light']);
  });

  it('the built-in set covers every preset, sorted, and the game presets are dark-only', () => {
    const keys = builtInThemeKeys();
    expect(keys).toEqual([...keys].sort());
    expect(keys.length).toBeGreaterThan(Object.keys(THEME_PRESETS).length);
    expect(keys).toContain('game-rpg-dark');
    expect(keys).not.toContain('game-rpg-light');
    expect(keys).toContain('minimalist-light');
  });
});
