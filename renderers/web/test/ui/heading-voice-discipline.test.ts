import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const HEADING_TAG = /<Typography\b[^>]*?\bvariant=["'](h[1-6])["'][^>]*>/gs;
const WEIGHT_OVERRIDE = /\bweight=|\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/;

function files(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(files(p));
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('heading voice discipline', () => {
  it('no heading-variant Typography overrides the theme heading weight', () => {
    const offenders: string[] = [];
    for (const file of files(join(ROOT, 'components'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(HEADING_TAG)) {
        if (WEIGHT_OVERRIDE.test(m[0])) {
          offenders.push(`${relative(ROOT, file)}:${src.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('control: the scan sees heading tags at all', () => {
    const src = readFileSync(join(ROOT, 'components/core/molecules/StatDisplay.tsx'), 'utf8');
    expect([...src.matchAll(HEADING_TAG)].length).toBeGreaterThan(0);
  });
});

describe('elevation by intent', () => {
  const LITERAL_SHADOW = /(?:^|[\s"'`])(?:[a-z-]+:)*shadow-(?:sm|md|lg|xl|2xl|inner)\b|\bshadow=["'](?:sm|md|lg|xl|2xl)["']/g;
  // Box's own `shadow` size knob is the sanctioned explicit-size escape hatch.
  const SANCTIONED = new Set(['components/core/atoms/Box.tsx']);

  it('core and game components use elevation intents, never literal shadow sizes', () => {
    const offenders: string[] = [];
    for (const dir of ['components/core', 'components/game']) {
      for (const file of files(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (SANCTIONED.has(rel)) continue;
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(LITERAL_SHADOW)) {
          offenders.push(`${rel}:${src.slice(0, m.index).split('\n').length} ${m[0].trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('geometry by theme', () => {
  const FIXED_BORDER_WIDTH = /(?:^|[\s"'`:])border(?:-[trblxyse])?-(?:2|4|8)\b/g;
  const UNTHEMED_RADIUS = /(?:^|[\s"'`:])rounded(?:-[trblse]{1,2})?-(?:2xl|3xl)\b/g;

  it('core and game components take border widths and radii from the theme', () => {
    const offenders: string[] = [];
    for (const dir of ['components/core', 'components/game']) {
      for (const file of files(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        const src = readFileSync(file, 'utf8');
        for (const re of [FIXED_BORDER_WIDTH, UNTHEMED_RADIUS]) {
          for (const m of src.matchAll(re)) {
            offenders.push(`${rel}:${src.slice(0, m.index).split('\n').length} ${m[0].trim()}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
