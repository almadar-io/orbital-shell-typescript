import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const WEB = resolve(import.meta.dirname, '../..');

function definedVars(): Set<string> {
  const dir = resolve(WEB, 'themes');
  const out = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.css'))) {
    for (const m of readFileSync(resolve(dir, file), 'utf8').matchAll(/(--[\w-]+)\s*:/g)) out.add(m[1]);
  }
  return out;
}

function readVars(source: string): string[] {
  return [...source.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
}

describe('G-ORBITAL-SHELL-TYPESCRIPT-053: MapView reads only theme tokens that exist', () => {
  const defined = definedVars();

  it('every var() MapView reads is defined by the themes', () => {
    const source = readFileSync(resolve(WEB, 'src/components/core/molecules/MapView.tsx'), 'utf8');
    expect(readVars(source).filter((v) => !defined.has(v))).toEqual([]);
  });

  it('control: the detector flags an undefined variable', () => {
    expect(readVars("color: 'var(--primary, #2563eb)'").filter((v) => !defined.has(v))).toEqual(['--primary']);
  });
});
