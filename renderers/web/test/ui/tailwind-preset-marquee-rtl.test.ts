/**
 * The marquee strip starts at the reading-start edge: on an RTL page it sits
 * at the right and must slide right, or the loop carries it off-screen and
 * the band shows empty space.
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
    content: [{ raw: '<div class="proof-marquee"><div class="proof-marquee-track animate-almadar-marquee"></div></div>' }],
    corePlugins: { preflight: false },
  };
  const result = await postcss([tailwindcss(config)]).process('@tailwind components; @tailwind utilities;', { from: undefined });
  return result.css.replace(/\s+/g, ' ');
}

describe('almadar-marquee direction', () => {
  it('slides by a sign the track sets times a distance, not a fixed leftward shift', async () => {
    const css = await compile();
    expect(css).toMatch(/@keyframes almadar-marquee \{.*to \{ transform: translateX\(calc\(var\(--marquee-sign, -1\) \* var\(--marquee-distance, 50%\)\)\)/);
  });

  it('an RTL page flips the sign to slide right', async () => {
    const css = await compile();
    expect(css).toMatch(/\[dir="rtl"\] \.proof-marquee-track \{ --marquee-sign: 1 \}/);
  });

  it('control: an LTR track keeps the leftward default', async () => {
    const css = await compile();
    expect(css).toMatch(/\.proof-marquee-track \{ display: flex; width: max-content \}/);
    expect(css).not.toMatch(/\[dir="ltr"\][^{]*\{ --marquee-sign/);
  });
});
