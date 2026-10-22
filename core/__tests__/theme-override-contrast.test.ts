/**
 * G-RABIT-037 (owner ruling 2026-10-07): a theme override paints only the tokens it carries over the
 * app's theme, so it must be self-contained — real color tokens, both sides of every contrast pair
 * it touches, and WCAG AA (4.5:1) on each.
 */
import { describe, expect, it } from 'vitest';
import { contrastRatio, themeOverrideIssues } from '../src/themes/contrast.js';

const tokens = (colors: Record<string, string>) => ({ tokens: { colors } });

describe('contrastRatio', () => {
  it('black on white is 21:1, a color on itself 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#b5651d', '#b5651d')).toBeCloseTo(1, 5);
  });

  it('reads short hex and rgb()', () => {
    expect(contrastRatio('#000', 'rgb(255, 255, 255)')).toBeCloseTo(21, 5);
  });

  it('control: a translucent or unknown color has no ratio', () => {
    expect(contrastRatio('rgba(0, 0, 0, 0.6)', '#ffffff')).toBeNull();
    expect(contrastRatio('var(--brand)', '#ffffff')).toBeNull();
  });
});

describe('themeOverrideIssues', () => {
  it('the store study\'s invented "warmer" palette is refused: an unknown token and pairs set on one side', () => {
    const issues = themeOverrideIssues(tokens({ background: '#faf3e8', primary: '#b5651d', surface: '#f3e6d3', text: '#3b2a20' }));
    expect(issues.map((i) => i.token)).toEqual(expect.arrayContaining(['text', 'primary', 'background']));
    expect(issues.find((i) => i.token === 'primary')?.message).toContain('primary-foreground');
  });

  it('a pair set on both sides below AA is refused with its ratio', () => {
    const issues = themeOverrideIssues(tokens({ primary: '#b5651d', 'primary-foreground': '#fafaf7' }));
    expect(issues).toEqual([expect.objectContaining({ token: 'primary' })]);
    expect(issues[0]?.message).toMatch(/\d\.\d\d:1/);
  });

  it('control: a complete, readable override passes', () => {
    expect(
      themeOverrideIssues(tokens({ primary: '#8a4512', 'primary-foreground': '#ffffff', background: '#faf3e8', foreground: '#3b2a20', surface: '#f3e6d3' })),
    ).toEqual([]);
  });

  it('control: a token outside any contrast pair needs no partner', () => {
    expect(themeOverrideIssues(tokens({ ring: '#b5651d', border: '#e0d4c3' }))).toEqual([]);
  });

  it('a dark variant is checked merged over the override\'s own base colors', () => {
    const issues = themeOverrideIssues({
      tokens: { colors: { background: '#faf3e8', foreground: '#3b2a20', surface: '#f3e6d3' } },
      variants: { dark: { colors: { background: '#2a1d14' } } },
    });
    expect(issues).toEqual([expect.objectContaining({ token: 'background', mode: 'dark' })]);
  });

  it('a pair member that is not an opaque color is refused', () => {
    const issues = themeOverrideIssues(tokens({ primary: 'var(--brand)', 'primary-foreground': '#ffffff' }));
    expect(issues).toEqual([expect.objectContaining({ token: 'primary' })]);
  });

  it('control: an override with no colors has nothing to check', () => {
    expect(themeOverrideIssues({ name: 'override' })).toEqual([]);
  });
});
