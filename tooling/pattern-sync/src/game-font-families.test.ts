import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PATTERNS_DIR, REPO_ROOT } from './config.js';
import source from './game-font-families-source.json' with { type: 'json' };

const generatedCore = JSON.parse(readFileSync(join(PATTERNS_DIR, 'game-font-families.json'), 'utf8'));
const generatedNative = JSON.parse(readFileSync(join(REPO_ROOT, 'orbital-rust/crates/orbital-shell-rust/renderers/dioxus/assets/game-font-families.json'), 'utf8'));

describe('game font family contract', () => {
  it('generates one alias contract for web and native', () => {
    expect(generatedCore).toEqual(source);
    expect(generatedNative).toEqual(source);
    expect(Object.keys(source.aliases)).toEqual(['fredoka', 'future', 'future-narrow', 'pixel', 'blocks', 'mini']);
    expect(source.unknownKey).toBe('css-font-family');
  });
});
