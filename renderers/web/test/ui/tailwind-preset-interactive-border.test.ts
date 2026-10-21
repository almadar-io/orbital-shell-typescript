/**
 * `.interactive-border` carries the interactive-control geometry (Button, Input,
 * Select, Textarea): border style and corner shape, each falling back to the
 * theme-wide value so a theme that sets neither renders as before.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import type { Config } from 'tailwindcss';

const require = createRequire(import.meta.url);
const preset: Config = require('../../tailwind-preset.cjs');

async function compile(html: string): Promise<string> {
  const config: Config = { presets: [preset], content: [{ raw: html, extension: 'html' }], safelist: [] };
  const out = await postcss([tailwindcss(config)]).process('@tailwind utilities;', { from: undefined });
  return out.css;
}

describe('.interactive-border', () => {
  it('takes the interactive corner shape, falling back to the theme corner shape', async () => {
    const css = await compile('<button class="interactive-border"></button>');
    expect(css).toContain('corner-shape: var(--corner-shape-interactive, var(--corner-shape, round))');
    expect(css).toContain('border-style: var(--border-style-interactive, var(--border-style, solid))');
  });

  it('control: an element without the class gets no interactive corner shape', async () => {
    const css = await compile('<div class="rounded-interactive"></div>');
    expect(css).not.toContain('--corner-shape-interactive');
  });
});
