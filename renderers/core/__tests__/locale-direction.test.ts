// Twin of orbital-core `messages::RTL_LOCALES` / `locale_direction`.
import { describe, it, expect } from 'vitest';
import { RTL_LOCALES, localeDirection } from '../src/i18n/index.js';

describe('localeDirection', () => {
  it('reads right-to-left for every RTL locale', () => {
    for (const locale of RTL_LOCALES) expect(localeDirection(locale)).toBe('rtl');
    expect([...RTL_LOCALES]).toEqual(['ar', 'he', 'fa', 'ur']);
  });

  it('control: other locales read left-to-right', () => {
    expect(localeDirection('en')).toBe('ltr');
    expect(localeDirection('sl')).toBe('ltr');
  });
});
