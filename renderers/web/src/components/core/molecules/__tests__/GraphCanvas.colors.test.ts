import { describe, it, expect, afterEach } from 'vitest';
import { GROUP_COLORS, resolveColor } from '../GraphCanvas';

const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

describe('GraphCanvas GROUP_COLORS', () => {
  it('holds no literal color — every entry is a theme token', () => {
    expect(GROUP_COLORS.length).toBeGreaterThan(0);
    for (const c of GROUP_COLORS) expect(c, c).not.toMatch(LITERAL);
  });
});

// jsdom's CSSOM never substitutes var() into a computed shorthand property
// (getComputedStyle hands the literal `var(...)` string straight back), so a
// live var()-resolves-to-a-real-color case cannot run under jsdom — the same
// reason theme-color.test.ts only exercises the pass-through and null paths.
// This suite covers the two paths jsdom CAN exercise for this function's contract.
describe('GraphCanvas resolveColor (converged onto resolveThemeColor)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('passes a literal color through unchanged', () => {
    expect(resolveColor('#0f766e', document.body)).toBe('#0f766e');
    expect(resolveColor('rgb(1, 2, 3)', document.body)).toBe('rgb(1, 2, 3)');
  });

  it('returns the raw var() expression — never a guessed color — when the token is undefined', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(resolveColor('var(--graph-color-not-defined)', el)).toBe('var(--graph-color-not-defined)');
  });
});
