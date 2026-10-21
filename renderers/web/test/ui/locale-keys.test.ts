import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import en from '../../src/core/locales/en.json';
import ar from '../../src/core/locales/ar.json';
import sl from '../../src/core/locales/sl.json';

const ROOT = join(__dirname, '..');
const SOURCE_DIRS = ['components', 'hooks', 'providers', 'runtime', 'renderer', 'lib', 'context', 'avl'];
const KEY_CALL = /\bt\(\s*['"]([A-Za-z0-9_.]+)['"]/g;
const DOC_EXAMPLE_FILES = new Set(['hooks/useTranslate.ts']);

function sourceFiles(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '__tests__' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(sourceFiles(p));
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const d of SOURCE_DIRS) {
    for (const file of sourceFiles(join(ROOT, d))) {
      const rel = relative(ROOT, file);
      if (DOC_EXAMPLE_FILES.has(rel)) continue;
      for (const m of readFileSync(file, 'utf8').matchAll(KEY_CALL)) {
        if (!keys.has(m[1])) keys.set(m[1], rel);
      }
    }
  }
  return keys;
}

const LOCALES: Record<string, object> = { en, ar, sl };

describe('locale keys', () => {
  const used = usedKeys();

  it('finds translation calls to check (the scan itself works)', () => {
    expect(used.has('dialog.confirm')).toBe(true);
  });

  for (const [lang, table] of Object.entries(LOCALES)) {
    it(`every literal t('…') key exists in ${lang}.json`, () => {
      const missing = [...used].filter(([k]) => !(k in table)).map(([k, f]) => `${k} (${f})`);
      expect(missing).toEqual([]);
    });
  }

  it('ar and sl carry every en key', () => {
    const enKeys = Object.keys(en);
    expect(enKeys.filter((k) => !(k in ar))).toEqual([]);
    expect(enKeys.filter((k) => !(k in sl))).toEqual([]);
  });
});
