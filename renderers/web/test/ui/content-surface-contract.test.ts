/**
 * A content block never hand-rolls its own card surface: it paints the
 * theme-owned `surface-content` through `useContentSurface` (or is an explicit
 * surface like Card). A className literal combining `bg-card`, a border and a
 * container radius is a hand-rolled surface that ignores the theme and stacks
 * inside other surfaces.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const DIRS = ['atoms', 'molecules', 'organisms'].map((d) => join(ROOT, 'components/core', d));

export function handRolledSurfaces(source: string): string[] {
  const literals = source.match(/(["'`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? [];
  return literals.filter(
    (lit) => /\bbg-card\b(?!\/)/.test(lit) && /\bborder\b/.test(lit) && /\brounded-(container|lg)\b/.test(lit),
  );
}

// file (relative to components/core) -> reason it legitimately paints its own panel
const ALLOWED: Record<string, string> = {
  'molecules/Popover.tsx': 'floating popover panel (overlay)',
  'molecules/DocSearch.tsx': 'floating results dropdown (overlay)',
  'molecules/TopNavItem.tsx': 'floating nav submenu panel (overlay)',
};

// exact literals that are control chrome, not a content block
const ALLOWED_LITERALS: Record<string, string> = {
  '"flex items-center gap-1 rounded-container border border-border bg-card p-0.5"': 'BranchingLogicBuilder segmented view-toggle control',
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === '__tests__') return [];
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

describe('content surface contract', () => {
  it('control: the rule catches a hand-rolled card surface', () => {
    expect(handRolledSurfaces(`<Box className="rounded-container border border-border bg-card p-4" />`)).toHaveLength(1);
    expect(handRolledSurfaces(`<div className={cn('bg-card border rounded-lg', x)} />`)).toHaveLength(1);
  });

  it('control: translucent chrome, a lone bg-card and plain borders are not flagged', () => {
    expect(handRolledSurfaces(`"bg-card/95 border rounded-container"`)).toHaveLength(0);
    expect(handRolledSurfaces(`"bg-card px-4"`)).toHaveLength(0);
    expect(handRolledSurfaces(`"rounded-container border border-border"`)).toHaveLength(0);
  });

  it('no core component hand-rolls a card surface', () => {
    const offenders: string[] = [];
    for (const file of DIRS.flatMap(walk)) {
      const rel = relative(join(ROOT, 'components/core'), file);
      if (ALLOWED[rel]) continue;
      const hits = handRolledSurfaces(readFileSync(file, 'utf8')).filter((lit) => !ALLOWED_LITERALS[lit]);
      if (hits.length > 0) offenders.push(`${rel}: ${hits.join(' | ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
