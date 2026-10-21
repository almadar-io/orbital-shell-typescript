/**
 * `themes/_head.css` is the shared theme layer a compiled client imports beside only the presets its program declares
 * (G-UI-106): the shared fonts and the base, no preset. `themes/index.css` (every preset) builds on it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const THEMES = join(__dirname, '..', '..', 'themes');
const imports = (file: string): string[] =>
  [...readFileSync(join(THEMES, file), 'utf8').matchAll(/@import\s+(?:url\()?["']([^"']+)["']/g)].map((m) => m[1] ?? '');
const presetFiles = readdirSync(THEMES).filter((f) => f.endsWith('.css') && !f.startsWith('_') && f !== 'index.css');

describe('themes/_head.css', () => {
  it('carries the shared fonts and the base layer', () => {
    expect(imports('_head.css')).toEqual(expect.arrayContaining(['./_fonts-kenney.css', './_base.css']));
    expect(imports('_head.css').some((i) => i.startsWith('https://fonts.googleapis.com/'))).toBe(true);
  });

  it('control: it carries no preset and no per-preset fonts', () => {
    const head = imports('_head.css');
    expect(head.filter((i) => presetFiles.includes(i.replace('./', '')))).toEqual([]);
    expect(head).not.toContain('./_presets.css');
    expect(head).not.toContain('./_fonts.css');
  });

  it('edge: index.css is head, then every preset, then the foundation', () => {
    const index = imports('index.css');
    expect(index[0]).toBe('./_head.css');
    expect(index.indexOf('./_presets.css')).toBeGreaterThan(0);
    expect(index.indexOf('./_foundation.css')).toBeGreaterThan(index.indexOf('./_presets.css'));
  });
});
