import { describe, expect, it } from 'vitest';
import { localeOfPath, pathLocale } from '../src/i18n/index.js';

const LOCALES = ['en', 'ar', 'sl'];

describe('localeOfPath (twin of orbital-core OirModule::locale_of_path)', () => {
  it('a path whose first segment names a declared locale renders under it', () => {
    expect(localeOfPath('/ar', LOCALES)).toBe('ar');
    expect(localeOfPath('/ar/blog/why', LOCALES)).toBe('ar');
    expect(localeOfPath('/sl/how-it-works', LOCALES)).toBe('sl');
  });

  it('control: an unprefixed path renders under the first declared locale', () => {
    expect(localeOfPath('/', LOCALES)).toBe('en');
    expect(localeOfPath('/blog/why', LOCALES)).toBe('en');
  });

  it('a first segment that only starts with a locale code is not that locale', () => {
    expect(localeOfPath('/arcade', LOCALES)).toBe('en');
    expect(localeOfPath('/blog/ar', LOCALES)).toBe('en');
  });

  it('an undeclared locale prefix falls back to the first declared locale', () => {
    expect(localeOfPath('/de/blog', LOCALES)).toBe('en');
  });

  it('the first declared locale need not be en', () => {
    expect(localeOfPath('/', ['ar', 'en'])).toBe('ar');
    expect(localeOfPath('/en/x', ['ar', 'en'])).toBe('en');
  });

  it('a program declaring no locales has no locale', () => {
    expect(localeOfPath('/ar', [])).toBeUndefined();
  });
});

describe('pathLocale', () => {
  it('names the declared locale of the first segment', () => {
    expect(pathLocale('/ar/blog', LOCALES)).toBe('ar');
    expect(pathLocale('/en', LOCALES)).toBe('en');
  });

  it('control: an unprefixed path names no locale', () => {
    expect(pathLocale('/', LOCALES)).toBeUndefined();
    expect(pathLocale('/blog/ar', LOCALES)).toBeUndefined();
    expect(pathLocale('/arcade', LOCALES)).toBeUndefined();
  });
});
