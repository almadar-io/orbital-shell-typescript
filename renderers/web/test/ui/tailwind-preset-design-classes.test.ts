/**
 * Every class a visual editor may write (this package's design-classes) must be
 * in the preset's safelist, or it never compiles and the edit paints nothing.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { allDesignClasses } from '../../src/lib/design-classes';

const require = createRequire(import.meta.url);
const preset: { safelist: string[] } = require('../../tailwind-preset.cjs');

describe('tailwind preset safelists the design-class vocabulary', () => {
  it('contains every design class', () => {
    const safelist = new Set(preset.safelist);
    expect(allDesignClasses().filter((c) => !safelist.has(c))).toEqual([]);
  });
});
