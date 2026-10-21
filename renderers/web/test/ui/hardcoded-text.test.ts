import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const DIRS = ['components', 'lib', 'runtime', 'providers', 'renderer'];
const JSX_TEXT = />\s*([^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]*?)\s*<\//g;
const TEXT_ATTR = /\b(placeholder|aria-label|title|alt|label)="([^"]*[A-Za-z]{2,}[^"]*)"/g;

// Deliberately literal: legal attribution / proper nouns, code tokens, CSS examples.
const ALLOWED = new Set([
  'components/core/molecules/MapView.tsx text OpenStreetMap',
  'components/avl/organisms/OrbInspector.tsx text &times;',
  'components/avl/organisms/OrbInspector.tsx text render-ui',
  'components/avl/organisms/OrbInspector.tsx placeholder w-[243px]',
]);

function files(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(files(p));
    else if (name.endsWith('.tsx') && !name.includes('.stories.')) out.push(p);
  }
  return out;
}

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '');

function findings(): string[] {
  const out: string[] = [];
  for (const d of DIRS) {
    for (const file of files(join(ROOT, d))) {
      const rel = relative(ROOT, file);
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(JSX_TEXT)) {
        const key = `${rel} text ${m[1].trim()}`;
        if (!ALLOWED.has(key)) out.push(`${key} (line ${src.slice(0, m.index).split('\n').length})`);
      }
      for (const m of src.matchAll(TEXT_ATTR)) {
        const key = `${rel} ${m[1]} ${m[2]}`;
        if (!ALLOWED.has(key)) out.push(`${key} (line ${src.slice(0, m.index).split('\n').length})`);
      }
    }
  }
  return out;
}

describe('no hardcoded user-visible text', () => {
  it('every visible string in components is passed in or translated', () => {
    expect(findings()).toEqual([]);
  });

  it('control: the scan catches a literal (proves the regexes match real JSX)', () => {
    const sample = '<Button aria-label="Close">Save changes</Button>';
    expect([...sample.matchAll(JSX_TEXT)].map((m) => m[1])).toEqual(['Save changes']);
    expect([...sample.matchAll(TEXT_ATTR)].map((m) => m[2])).toEqual(['Close']);
  });
});
