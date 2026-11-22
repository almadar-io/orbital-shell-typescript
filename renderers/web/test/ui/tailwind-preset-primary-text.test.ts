/**
 * `text-primary` paints primary's text shade (`--color-primary-text`, AA on the card and background), falling back to
 * primary for a theme that sets none; fills, borders and rings keep primary itself.
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

const rule = (css: string, selector: string): string => new RegExp(`\\${selector} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

describe('text-primary', () => {
  it('paints the primary text shade, falling back to primary', async () => {
    const css = await compile('<p class="text-primary"></p>');
    expect(rule(css, '.text-primary')).toContain('var(--color-primary-text, var(--color-primary))');
  });

  it('an opacity modifier mixes the text shade', async () => {
    const css = await compile('<p class="text-primary/50"></p>');
    expect(css).toContain('color-mix(in srgb, var(--color-primary-text, var(--color-primary)) calc(0.5 * 100%), transparent)');
  });

  it('control: text-primary-foreground still paints the foreground on primary', async () => {
    const css = await compile('<p class="text-primary-foreground"></p>');
    expect(rule(css, '.text-primary-foreground')).toContain('var(--color-primary-foreground)');
  });

  it('control: bg-primary and border-primary keep primary itself', async () => {
    const css = await compile('<div class="bg-primary border-primary"></div>');
    expect(rule(css, '.bg-primary')).toContain('var(--color-primary)');
    expect(rule(css, '.bg-primary')).not.toContain('--color-primary-text');
    expect(rule(css, '.border-primary')).not.toContain('--color-primary-text');
  });
});
