import { describe, expect, it } from 'vitest';
import { themeTokensToCssVars } from '../../src/lib/themeTokens';

describe('surface band axes', () => {
  it('emits every band var when set', () => {
    const vars = themeTokensToCssVars({
      surface: {
        edgeMask: 'url("a.svg")',
        edgeHeight: '40px',
        textureMask: 'url("b.svg")',
        textureSize: '24px 24px',
        accentImage: 'linear-gradient(red, blue)',
        scrim: 'linear-gradient(black, transparent)',
      },
    });
    expect(vars['--surface-edge-mask']).toBe('url("a.svg")');
    expect(vars['--surface-edge-height']).toBe('40px');
    expect(vars['--surface-texture-mask']).toBe('url("b.svg")');
    expect(vars['--surface-texture-size']).toBe('24px 24px');
    expect(vars['--surface-accent-image']).toBe('linear-gradient(red, blue)');
    expect(vars['--surface-scrim']).toBe('linear-gradient(black, transparent)');
  });

  it('emits nothing for a theme without the band axes', () => {
    const vars = themeTokensToCssVars({ surface: { backdrop: 'none' } });
    expect(vars['--surface-edge-mask']).toBeUndefined();
    expect(vars['--surface-accent-image']).toBeUndefined();
  });

  it('uses the dark variant surface in dark mode (no merge with base)', () => {
    const vars = themeTokensToCssVars(
      { surface: { edgeMask: 'url("light.svg")' } },
      'dark',
      { surface: { edgeMask: 'url("dark.svg")' } },
    );
    expect(vars['--surface-edge-mask']).toBe('url("dark.svg")');
  });
});
