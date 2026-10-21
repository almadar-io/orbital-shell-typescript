/**
 * A runtime that renders a schema compiles its arbitrary-value classes on
 * demand with the real Tailwind and this package's preset (G-APPS_BUILDER-008).
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compileTailwindClasses }: { compileTailwindClasses: (classes: string[]) => Promise<string> } = require('../../tailwind-compile.cjs');

describe('compileTailwindClasses', () => {
  it('emits the rules for arbitrary classes, variants included', async () => {
    const css = await compileTailwindClasses(['w-[243px]', 'bg-[#e14b2a]', 'hover:bg-[#c43d20]']);
    expect(css).toMatch(/\.w-\\\[243px\\\]\s*\{\s*width:\s*243px/);
    expect(css).toMatch(/\.bg-\\\[\\#e14b2a\\\]\s*\{[^}]*background-color:\s*rgb\(225 75 42/);
    expect(css).toMatch(/\.hover\\:bg-\\\[\\#c43d20\\\]:hover/);
  });

  it('emits only what was asked for — not the preset safelist, not base styles', async () => {
    const css = await compileTailwindClasses(['w-[243px]']);
    expect(css).not.toMatch(/\.bg-primary\b/);
    expect(css).not.toMatch(/box-sizing/);
  });

  it('compiles a container-query class to a @container rule, which a host with the plugin renders', async () => {
    const css = await compileTailwindClasses(['@sm:w-1/2', '@md:hover:grow-[2]']);
    expect(css).toMatch(/@container\s*\(min-width/);
    expect(css).toMatch(/\.\\@sm\\:w-1\\\/2/);
    expect(css).toMatch(/\.\\@md\\:hover\\:grow-\\\[2\\\]:hover/);
  });

  it('control: a plain class is not wrapped in a container query', async () => {
    const css = await compileTailwindClasses(['w-1/2']);
    expect(css).toMatch(/\.w-1\\\/2\s*\{/);
    expect(css).not.toMatch(/@container/);
  });

  it('nothing to compile is no CSS', async () => {
    expect(await compileTailwindClasses([])).toBe('');
  });

  it('an unknown class compiles to nothing rather than failing', async () => {
    expect(await compileTailwindClasses(['not-a-tailwind-[class]'])).toBe('');
  });
});
