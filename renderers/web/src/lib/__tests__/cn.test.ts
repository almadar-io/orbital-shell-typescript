/**
 * `cn` must know every custom scale key the Tailwind preset declares, or a
 * caller's override never replaces the component's default: `h-auto` lost to
 * `h-button-md` (the Studio persona cards clipped to button height), and
 * `text-display-1` was mistaken for a colour and dropped next to `text-primary`.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { cn } from '../../core';
import { THEME_SCALE_KEYS } from '../../core';

describe('cn merges the preset custom scales', () => {
  it('a caller height replaces a density height', () => {
    expect(cn('h-button-md px-4', 'h-auto p-3')).toBe('h-auto p-3');
    expect(cn('min-h-row-normal', 'min-h-0')).toBe('min-h-0');
  });

  it('a caller icon size replaces the default icon size', () => {
    expect(cn('h-icon-default w-icon-default', 'h-4 w-4')).toBe('h-4 w-4');
  });

  it('a display font size is a size, not a colour', () => {
    expect(cn('text-display-1 text-primary')).toBe('text-display-1 text-primary');
    expect(cn('text-sm', 'text-display-2')).toBe('text-display-2');
  });

  it('intent radius and elevation shadows replace the defaults', () => {
    expect(cn('rounded-md', 'rounded-container')).toBe('rounded-container');
    expect(cn('shadow-sm', 'shadow-elevation-card')).toBe('shadow-elevation-card');
  });

  it('custom spacing keys merge with the stock scale', () => {
    expect(cn('p-card-md', 'p-2')).toBe('p-2');
    expect(cn('gap-2', 'gap-section')).toBe('gap-section');
  });

  it('control: unrelated utilities are kept', () => {
    expect(cn('h-button-md px-4 text-sm', 'px-2')).toBe('h-button-md text-sm px-2');
  });

  it('every custom key the preset declares is registered with cn', () => {
    const require = createRequire(import.meta.url);
    const preset = require('../../../tailwind-preset.cjs') as {
      theme: { extend: Record<string, Record<string, string | readonly (string | object)[]>> };
    };
    const ext = preset.theme.extend;
    const custom = (group: string, stock: readonly string[]) =>
      Object.keys(ext[group] ?? {}).filter((k) => !stock.includes(k)).sort();
    expect(custom('height', [])).toEqual([...THEME_SCALE_KEYS.height].sort());
    expect(custom('minHeight', [])).toEqual([...THEME_SCALE_KEYS.minHeight].sort());
    expect(custom('width', [])).toEqual([...THEME_SCALE_KEYS.width].sort());
    expect(custom('fontSize', ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'])).toEqual([...THEME_SCALE_KEYS.fontSize].sort());
    expect(custom('borderRadius', ['none', 'sm', 'md', 'lg', 'xl', 'full'])).toEqual([...THEME_SCALE_KEYS.borderRadius].sort());
    expect(custom('boxShadow', ['sm', 'DEFAULT', 'lg', 'inner'])).toEqual([...THEME_SCALE_KEYS.boxShadow].sort());
    expect(custom('spacing', ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])).toEqual([...THEME_SCALE_KEYS.spacing].sort());
  });

  it('every plugin utility the preset adds survives a merge with stock utilities of every group', () => {
    const require = createRequire(import.meta.url);
    type PresetPlugin = { handler: (api: { addBase: (b: Record<string, object>) => void; addUtilities: (u: Record<string, object>) => void }) => void };
    const preset = require('../../../tailwind-preset.cjs') as { plugins: readonly (PresetPlugin | (() => object))[] };
    const names: string[] = [];
    // The preset's own utility plugins are `{ handler }` objects; a third-party
    // options plugin (e.g. @tailwindcss/typography) is a function and adds no
    // utilities of ours to check.
    for (const plugin of preset.plugins) {
      if (typeof plugin === 'function') continue;
      // Only single-class keys are utilities a caller writes in className; descendant selectors such as
      // `.band > :not([data-band-layer])` style a utility's children and never reach cn.
      // Base-layer rules are element/attribute selectors, not utility classes.
      plugin.handler({ addBase: () => undefined, addUtilities: (u) => names.push(...Object.keys(u).filter((k) => /^\.[\w-]+$/.test(k)).map((k) => k.slice(1))) });
    }
    expect(names).toContain('interactive-border');
    expect(names).toEqual(expect.arrayContaining(['band', 'band-edge', 'band-gradient', 'band-inverse', 'proof-marquee', 'proof-marquee-track']));
    const stock = 'border border-accent border-dashed text-lg text-primary bg-card bg-none rounded-md shadow-sm font-bold';
    for (const name of names) {
      expect(cn(name, stock).split(' '), name).toContain(name);
    }
  });

  it('control: a utility spelled in the border-* namespace IS merged away (why interactive-border avoids it)', () => {
    expect(cn('border-interactive', 'border-accent')).toBe('border-accent');
  });
});
