import { describe, it, expect, afterEach } from 'vitest';
import { parseComputedColor, resolveThemeColor, THEME_SERIES } from '../theme-color';

describe('parseComputedColor', () => {
  it('parses legacy comma rgb()', () => {
    expect(parseComputedColor('rgb(15, 118, 110)')).toEqual({ r: 15, g: 118, b: 110, a: 1, css: 'rgb(15, 118, 110)' });
  });

  it('parses rgba() and keeps alpha out of the css string', () => {
    expect(parseComputedColor('rgba(20, 184, 166, 0.25)')).toEqual({ r: 20, g: 184, b: 166, a: 0.25, css: 'rgb(20, 184, 166)' });
  });

  it('parses space-separated rgb with slash alpha', () => {
    expect(parseComputedColor('rgb(1 2 3 / 0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5, css: 'rgb(1, 2, 3)' });
  });

  it('parses color(srgb …), the serialization of color-mix(in srgb …)', () => {
    expect(parseComputedColor('color(srgb 1 0.5 0 / 0.22)')).toEqual({ r: 255, g: 128, b: 0, a: 0.22, css: 'rgb(255, 128, 0)' });
  });

  it('parses 6- and 3-digit hex', () => {
    expect(parseComputedColor('#0f766e')?.css).toBe('rgb(15, 118, 110)');
    expect(parseComputedColor('#fff')?.css).toBe('rgb(255, 255, 255)');
  });

  it('returns null for an unresolved var() or unsupported space instead of guessing', () => {
    expect(parseComputedColor('var(--color-primary)')).toBeNull();
    expect(parseComputedColor('lab(50 20 30)')).toBeNull();
    expect(parseComputedColor('')).toBeNull();
  });

  it('converts oklch(), the serialization of a relative color like the default series', () => {
    expect(parseComputedColor('oklch(0.627955 0.257683 29.2339)')?.css).toBe('rgb(255, 0, 0)');
    expect(parseComputedColor('oklch(0.519752 0.176858 142.495 / 0.5)')).toEqual({ r: 0, g: 128, b: 0, a: 0.5, css: 'rgb(0, 128, 0)' });
  });

  it('edge: an achromatic oklch with a `none` hue is a grey, and percentages scale', () => {
    expect(parseComputedColor('oklch(0.6 0 none)')?.css).toBe('rgb(128, 128, 128)');
    expect(parseComputedColor('oklch(100% 0 0)')?.css).toBe('rgb(255, 255, 255)');
  });

  it('converts oklab()', () => {
    expect(parseComputedColor('oklab(0 0 0)')?.css).toBe('rgb(0, 0, 0)');
  });
});

describe('resolveThemeColor', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('reads the computed color of the value inside the given scope and removes its probe', () => {
    const scope = document.createElement('div');
    document.body.appendChild(scope);
    expect(resolveThemeColor('rgb(10, 20, 30)', scope)?.css).toBe('rgb(10, 20, 30)');
    expect(scope.childElementCount).toBe(0);
  });

  it('returns null when the scope cannot compute the value', () => {
    const scope = document.createElement('div');
    document.body.appendChild(scope);
    expect(resolveThemeColor('var(--color-not-defined)', scope)).toBeNull();
  });
});

describe('THEME_SERIES', () => {
  it('is token-only — no literal colors', () => {
    for (const c of THEME_SERIES) expect(c).toMatch(/^var\(--color-series-[1-8]\)$/);
  });
});
