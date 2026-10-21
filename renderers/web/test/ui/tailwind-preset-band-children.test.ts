/**
 * A band lifts its content above its own layers by making each content child
 * `position: relative`. That default must never outrank a position the child
 * declares itself: std-hero's background layer is an `absolute inset-0` child
 * of the band, and when the default won it sat in the flow and pushed the hero
 * content down by its own height.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const require = createRequire(import.meta.url);
const preset = require('../../tailwind-preset.cjs');

async function compile(): Promise<string> {
  const config = {
    presets: [preset],
    content: [{ raw: '<div class="band"><div class="absolute inset-0"></div><div></div></div>' }],
    corePlugins: { preflight: false },
  };
  const result = await postcss([tailwindcss(config)]).process('@tailwind components; @tailwind utilities;', { from: undefined });
  return result.css.replace(/\s+/g, ' ');
}

describe('band content children', () => {
  it('lifts content children with a zero-specificity default, so an explicit position utility wins', async () => {
    const css = await compile();
    expect(css).toMatch(/:where\(\.band > :not\(\[data-band-layer\]\)\) \{ position: relative; z-index: 1 \}/);
    expect(css).not.toMatch(/(^|[ }])\.band > :not\(\[data-band-layer\]\) \{/);
  });

  it('control: the band itself is still a relative, isolated stacking context', async () => {
    const css = await compile();
    expect(css).toMatch(/\.band \{ position: relative; overflow: hidden; isolation: isolate \}/);
  });
});
