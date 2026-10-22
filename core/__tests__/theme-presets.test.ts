import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_PRESETS } from '../src/themes/index.js';
import { ThemeDefinitionSchema } from '../src/types/domain.js';

describe('THEME_PRESETS', () => {
  it('has one entry per migrated preset, keyed by its theme name', () => {
    const files = readdirSync(join(__dirname, '..', 'themes')).filter((f) => f.endsWith('.json'));
    expect(Object.keys(THEME_PRESETS).sort()).toEqual(files.map((f) => f.slice(0, -'.json'.length)).sort());
    for (const [key, def] of Object.entries(THEME_PRESETS)) {
      expect(def.name).toBe(key);
    }
  });

  it('every preset validates against ThemeDefinitionSchema', () => {
    for (const [key, def] of Object.entries(THEME_PRESETS)) {
      const result = ThemeDefinitionSchema.safeParse(def);
      expect(result.success, `${key}: ${result.success ? '' : JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('every preset declares a displayName and a heading/display family', () => {
    for (const [key, def] of Object.entries(THEME_PRESETS)) {
      expect(def.displayName, key).toBeTruthy();
      const ts = def.tokens.typeScale ?? def.variants?.dark?.typeScale;
      expect(ts?.displayFamily, key).toBeTruthy();
    }
  });

  it('includes the well-known built-in presets', () => {
    for (const key of ['minimalist', 'clay', 'glass', 'wireframe', 'trait-wars']) {
      expect(THEME_PRESETS[key]).toBeDefined();
    }
  });

  it('dark-only game presets carry their tokens under variants.dark, not the base tokens', () => {
    for (const key of ['game-adventure', 'game-rpg', 'game-sci-fi', 'game-ui-pack']) {
      const def = THEME_PRESETS[key];
      expect(def, key).toBeDefined();
      expect(def!.tokens).toEqual({});
      expect(def!.variants?.dark).toBeDefined();
    }
  });

  it('light+dark presets carry populated colors on both tokens and variants.dark', () => {
    const def = THEME_PRESETS.minimalist!;
    expect(def.tokens.colors?.primary).toBeTruthy();
    expect(def.variants?.dark?.colors?.primary).toBeTruthy();
    expect(def.tokens.colors?.primary).not.toBe(def.variants?.dark?.colors?.primary);
  });
});
