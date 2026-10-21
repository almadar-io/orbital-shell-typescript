import { describe, it, expect } from 'vitest';
import type { OrbitalSchema } from '@almadar/core';
import { resolvePreviewTheme } from '../OrbPreview';

const schema = {
  name: 'App',
  theme: 'corporate-light',
  orbitals: [
    { name: 'A', theme: 'art-deco-light', pages: [{ name: 'APage', path: '/a' }] },
    { name: 'B', pages: [{ name: 'BPage', path: '/b' }] },
    { name: 'C', theme: { name: 'inline-c', tokens: {} }, pages: [{ name: 'CPage', path: '/c' }] },
  ],
} as OrbitalSchema;

// The host override itself is covered by providers/__tests__/OrbitalThemeProvider.override.test.tsx.
describe('resolvePreviewTheme', () => {
  it('the page orbital declared theme', () => {
    expect(resolvePreviewTheme(schema, 'APage')).toBe('art-deco-light');
  });

  it('an inline orbital theme stays the definition', () => {
    expect(resolvePreviewTheme(schema, 'CPage')).toEqual({ name: 'inline-c', tokens: {} });
  });

  it('an orbital without a theme falls back to the app theme', () => {
    expect(resolvePreviewTheme(schema, 'BPage')).toBe('corporate-light');
  });

  it('before a page is picked, the first orbital theme applies', () => {
    expect(resolvePreviewTheme(schema, undefined)).toBe('art-deco-light');
  });
});
