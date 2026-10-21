/**
 * A CSS size container (`@container/<name>`) gets `container-type:
 * inline-size`, so its own width can never come from its content. As a flex
 * item with auto width it collapses to ~0 (PageHeader in std-contract's
 * header row, 2026-09-30: the subtitle wrapped one word per line). Every size
 * container must take its width from its parent: `w-full`, an explicit
 * `w-[…]`, or a `style` width on the same element.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', 'components');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name === '__tests__') return [];
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

/** The opening tag around `index`: from the nearest `<` before it to the first `>` that closes the tag. */
function openingTag(src: string, index: number): string {
  const start = src.lastIndexOf('<', index);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

describe('size containers take their width from their parent', () => {
  const offenders: string[] = [];
  for (const file of sources(ROOT)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/className=[^\n]*@container\/[\w-]+/g)) {
      const tag = openingTag(src, m.index ?? 0);
      if (!/\bw-full\b|\bw-\[|width:/.test(tag)) offenders.push(`${file.slice(ROOT.length + 1)}: ${m[0].slice(0, 90)}`);
    }
  }

  it('every @container element carries w-full, w-[…] or a style width', () => {
    expect(offenders).toEqual([]);
  });
});
