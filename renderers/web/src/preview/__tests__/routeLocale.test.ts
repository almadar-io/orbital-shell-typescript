import { describe, expect, it } from 'vitest';
import type { OrbitalSchema } from '@almadar/core';
import { routeLocaleValue } from '../routeLocale';

const program: OrbitalSchema = {
  name: 'site',
  locales: ['en', 'ar', 'sl'],
  messages: { en: { hi: 'Hello' }, ar: { hi: 'مرحبا' }, sl: { hi: 'Živjo' } },
  orbitals: [{ name: 'Home', entity: { name: 'Row', fields: [] }, traits: [], pages: [] }],
};

describe('routeLocaleValue', () => {
  it("a route naming a declared locale renders in it, with that locale's messages", () => {
    const value = routeLocaleValue('/sl', program, 'en');
    expect(value?.locale).toBe('sl');
    expect(value?.t('hi')).toBe('Živjo');
  });

  it('an Arabic route is right to left', () => {
    expect(routeLocaleValue('/ar/blog', program, 'en')?.direction).toBe('rtl');
  });

  it("control: a route naming no locale keeps the host's locale", () => {
    expect(routeLocaleValue('/', program, 'ar')).toBeUndefined();
    expect(routeLocaleValue('/blog', program, 'en')).toBeUndefined();
  });

  it('edge: an undeclared first segment is not a locale', () => {
    expect(routeLocaleValue('/es', program, 'en')).toBeUndefined();
  });

  it('edge: a program that declares no locales never switches', () => {
    expect(routeLocaleValue('/sl', { ...program, locales: undefined }, 'en')).toBeUndefined();
  });

  it('edge: the route naming the locale the host already shows changes nothing', () => {
    expect(routeLocaleValue('/sl', program, 'sl')).toBeUndefined();
  });
});
