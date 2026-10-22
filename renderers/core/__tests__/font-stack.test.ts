import { describe, it, expect } from 'vitest';
import { isWellFormedFontStack, TypeScaleTokensSchema, ThemeTokensSchema } from '../src/types/domain.js';

describe('isWellFormedFontStack', () => {
  it.each([
    '"Inter", -apple-system, sans-serif',
    "'Kenney Pixel', ui-sans-serif",
    'Georgia, serif',
    'Times New Roman, serif',
    'var(--font-family)',
    'var(--font-family-display, var(--font-family))',
    '"IBM Plex Sans Condensed"',
    'monospace',
  ])('accepts %s', (stack) => {
    expect(isWellFormedFontStack(stack)).toBe(true);
  });

  it.each([
    ['"Bangers""Comic Sans MS", cursive', 'two quoted names with no comma'],
    ['"MedievalSharp"Georgia, serif', 'a bare name glued to a quoted one'],
    ['"Inter", , serif', 'an empty item'],
    ['"Inter, serif', 'an unterminated quote'],
    ['', 'an empty stack'],
    ['"Inter",', 'a trailing comma'],
    ['var(--font-family', 'an unclosed var('],
  ])('rejects %s (%s)', (stack) => {
    expect(isWellFormedFontStack(stack)).toBe(false);
  });
});

describe('theme schemas gate font stacks', () => {
  it('typeScale families must be well formed', () => {
    expect(TypeScaleTokensSchema.safeParse({ displayFamily: '"Bangers""Comic Sans MS"' }).success).toBe(false);
    expect(TypeScaleTokensSchema.safeParse({ displayFamily: '"Bangers", cursive' }).success).toBe(true);
  });

  it('the legacy typography map checks its font-family keys only', () => {
    expect(ThemeTokensSchema.safeParse({ typography: { 'font-family': '"A""B"' } }).success).toBe(false);
    expect(ThemeTokensSchema.safeParse({ typography: { 'letter-spacing': '"x""y"' } }).success).toBe(true);
  });
});
