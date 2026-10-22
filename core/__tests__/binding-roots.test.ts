// The TS root list is anchored to the author vocabulary (i18n `sigils`); orbital-compiler pins CORE_BINDING_ROOTS the same way.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseI18nTables } from '../src/i18n/index.js';
import { BINDING_ROOTS, toBindingRoot } from '../src/types/binding.js';

const en = parseI18nTables(JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')), 'en.json');

describe('binding roots', () => {
  it('every author-facing sigil is a known root', () => {
    for (const sigil of Object.keys(en.sigils)) {
      expect(BINDING_ROOTS).toContain(sigil);
      expect(toBindingRoot(sigil)).toBe(sigil);
    }
  });

  it('matches the validator set exactly', () => {
    expect(BINDING_ROOTS.filter((r) => r !== 'other').sort()).toEqual(
      ['callsitePayload', 'config', 'currentTheme', 'entity', 'event', 'fromEntity', 'fromState', 'locale', 'now', 'pages', 'payload', 'prevEvents', 'prevStates', 'state', 'toState', 'trait', 'user'],
    );
  });

  it('a local or an entity reference is not a root', () => {
    expect(toBindingRoot('item')).toBe('other');
    expect(toBindingRoot('User')).toBe('other');
  });
});
