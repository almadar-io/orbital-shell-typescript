/**
 * themeTokens — runtime / compile-time mapping parity tests.
 *
 * These tests are the contract that keeps `@almadar/ui`'s runtime token
 * application (`themeTokensToCssVars`) byte-identical with the Rust
 * compiler's emitted CSS (orbital-rust/.../codegen/theme.rs). When a key
 * goes through both paths, both paths must produce the same CSS variable
 * name and value. Tokens diverging here means a Studio Design System edit
 * would render differently from an `orbital compile` of the same schema —
 * the explicit thing this layer exists to prevent.
 */

import { describe, it, expect } from 'vitest';
import type { ThemeTokens, ThemeVariant } from '@almadar/core';
import { themeTokensToCssVars, resolveThemeForRuntime } from '../../src/lib/themeTokens';

describe('themeTokensToCssVars', () => {
  it('maps colors keys to --color-<k>', () => {
    const tokens: ThemeTokens = {
      colors: { primary: '#14b8a6', 'primary-foreground': '#ffffff' },
    };
    const vars = themeTokensToCssVars(tokens, 'light');
    expect(vars).toEqual({
      '--color-primary': '#14b8a6',
      '--color-primary-foreground': '#ffffff',
    });
  });

  it('maps radii keys to --radius-<k>', () => {
    const tokens: ThemeTokens = {
      radii: { sm: '4px', md: '8px', full: '9999px' },
    };
    expect(themeTokensToCssVars(tokens, 'light')).toEqual({
      '--radius-sm': '4px',
      '--radius-md': '8px',
      '--radius-full': '9999px',
    });
  });

  it('maps spacing keys to --space-<k>', () => {
    const tokens: ThemeTokens = { spacing: { '1': '4px', '2': '8px' } };
    expect(themeTokensToCssVars(tokens, 'light')).toEqual({
      '--space-1': '4px',
      '--space-2': '8px',
    });
  });

  it('maps typography keys verbatim (prefix already present in schema)', () => {
    const tokens: ThemeTokens = {
      typography: { 'font-family': 'Inter', 'line-height-base': '1.5' },
    };
    expect(themeTokensToCssVars(tokens, 'light')).toEqual({
      '--font-family': 'Inter',
      '--line-height-base': '1.5',
    });
  });

  it('maps shadow keys to --shadow-<k> (schema key has no prefix)', () => {
    const tokens: ThemeTokens = { shadows: { sm: '0 1px 2px #000', main: '0 4px 8px #000' } };
    expect(themeTokensToCssVars(tokens, 'light')).toEqual({
      '--shadow-sm': '0 1px 2px #000',
      '--shadow-main': '0 4px 8px #000',
    });
  });

  it('emits an empty object for empty tokens (defaults cascade from parent)', () => {
    expect(themeTokensToCssVars({}, 'light')).toEqual({});
  });

  it('layers dark variant on top of base in dark mode', () => {
    const tokens: ThemeTokens = {
      colors: { primary: '#14b8a6', background: '#ffffff' },
    };
    const darkVariant: ThemeVariant = {
      colors: { background: '#000000' },
    };
    expect(themeTokensToCssVars(tokens, 'dark', darkVariant)).toEqual({
      // dark overrides background
      '--color-background': '#000000',
      // primary not in dark variant — falls back to base tokens.colors
      '--color-primary': '#14b8a6',
    });
  });

  it('uses base radii in dark mode when dark variant omits radii', () => {
    const tokens: ThemeTokens = { radii: { md: '8px' } };
    const darkVariant: ThemeVariant = { colors: { background: '#000' } };
    expect(themeTokensToCssVars(tokens, 'dark', darkVariant)).toEqual({
      '--color-background': '#000',
      '--radius-md': '8px',
    });
  });

  it('does not emit unrelated categories — only keys present in tokens', () => {
    // This is the runtime/compile-time difference: compiler emits defaults,
    // runtime emits ONLY schema-provided keys so the parent cascade fills the rest.
    const tokens: ThemeTokens = { colors: { primary: '#ff0000' } };
    const vars = themeTokensToCssVars(tokens, 'light');
    expect(Object.keys(vars)).toEqual(['--color-primary']);
  });
});

describe('resolveThemeForRuntime', () => {
  it('returns undefined for undefined input', () => {
    expect(resolveThemeForRuntime(undefined)).toBeUndefined();
  });

  it('returns undefined for unresolved string ref (upstream resolution missing)', () => {
    expect(resolveThemeForRuntime('Ocean.theme')).toBeUndefined();
  });

  it('returns the definition object unchanged when inline', () => {
    const def = { name: 'project', tokens: { colors: { primary: '#000' } } };
    expect(resolveThemeForRuntime(def)).toBe(def);
  });
});
