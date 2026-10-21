/**
 * A `:root` custom property defined as `var(--color-*)` is resolved AT :root,
 * so a `[data-theme]` subtree that redefines `--color-*` still inherits the
 * root theme's computed value. Skeletons painted that way showed the default
 * theme's (near-black) muted color inside every other theme. Theme colors must
 * be resolved where they are painted, never aliased on :root.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const base = fs.readFileSync(path.resolve(__dirname, '../themes/_base.css'), 'utf-8');

function rootBlocks(css: string): string[] {
  return [...css.matchAll(/(^|\n):root\s*\{([\s\S]*?)\n\}/g)].map((m) => m[2]);
}

describe('theme colors are never aliased on :root', () => {
  it('no :root custom property is defined from a --color-* token', () => {
    const offenders = rootBlocks(base).flatMap((block) =>
      [...block.matchAll(/(--[\w-]+)\s*:\s*[^;]*var\(--color-[\w-]+/g)].map((m) => m[1]),
    );
    expect(offenders).toEqual([]);
  });

  it('control: the shimmer resolves the theme colors where it paints', () => {
    const shimmer = /\.almadar-shimmer\s*\{([\s\S]*?)\}/.exec(base)?.[1] ?? '';
    expect(shimmer).toMatch(/var\(--skeleton-base,\s*var\(--color-muted\)\)/);
    expect(shimmer).toMatch(/var\(--skeleton-highlight,\s*var\(--color-surface\)\)/);
  });
});
