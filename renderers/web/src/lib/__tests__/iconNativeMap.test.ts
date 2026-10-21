import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ICON_NATIVE_MAP, ICON_ALIASES, ICON_FALLBACK, resolveNativeIcon } from '../iconNativeMap';

describe('ICON_NATIVE_MAP', () => {
  it('every value has a non-empty sfSymbol and materialSymbol', () => {
    for (const [name, glyph] of Object.entries(ICON_NATIVE_MAP)) {
      expect(glyph.sfSymbol.length, `${name}.sfSymbol`).toBeGreaterThan(0);
      expect(glyph.materialSymbol.length, `${name}.materialSymbol`).toBeGreaterThan(0);
    }
  });

  it('every iconAliases key is present', () => {
    for (const alias of ICON_ALIASES) {
      expect(ICON_NATIVE_MAP[alias], alias).toBeDefined();
    }
  });

  it('ICON_FALLBACK is a real questionmark/help glyph', () => {
    expect(ICON_FALLBACK).toEqual({ sfSymbol: 'questionmark.circle', materialSymbol: 'help' });
  });

  it('every lucide icon a core component imports has a native glyph', () => {
    const root = path.resolve(__dirname, '../../components/core');
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(full);
        return /\.tsx$/.test(e.name) && !/\.(test|stories)\./.test(e.name) ? [full] : [];
      });
    const missing = new Set<string>();
    for (const file of walk(root)) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
        for (const spec of m[1].split(',')) {
          const name = spec.trim().split(/\s+as\s+/)[0];
          if (!name || name.startsWith('type ') || name === 'LucideIcon' || name === 'LucideProps') continue;
          const key = lucideKey(name);
          if (!(key in ICON_NATIVE_MAP)) missing.add(key);
        }
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it('control: lucideKey spells Lucide canonical names', () => {
    expect(['Terminal', 'Link2', 'Heading1', 'ListOrdered', 'PauseCircle', 'GitBranchIcon', 'XCircle'].map(lucideKey))
      .toEqual(['terminal', 'link-2', 'heading-1', 'list-ordered', 'pause-circle', 'git-branch', 'x-circle']);
  });

  it('sorted key snapshot', () => {
    expect(Object.keys(ICON_NATIVE_MAP).sort()).toMatchSnapshot();
  });
});

describe('resolveNativeIcon', () => {
  it('resolves an exact key', () => {
    expect(resolveNativeIcon('search')).toEqual({ sfSymbol: 'magnifyingglass', materialSymbol: 'search' });
  });

  it('resolves an iconAliases name', () => {
    expect(resolveNativeIcon('close')).toEqual(ICON_NATIVE_MAP.close);
  });

  it('falls back deterministically for an unknown name', () => {
    expect(resolveNativeIcon('totally-made-up-icon-xyz')).toEqual(ICON_FALLBACK);
  });
});

function lucideKey(componentName: string): string {
  return componentName
    .replace(/Icon$/, '')
    .replace(/([a-z])([A-Z0-9])/g, '$1-$2')
    .replace(/([0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}
