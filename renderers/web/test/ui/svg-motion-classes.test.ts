/**
 * G-UI-101: every svg motion class an atom puts on an element has a rule in the theme CSS that
 * runs a defined keyframe, and no atom spells an svg motion class outside `lib/svgMotion.ts`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SVG_MOTION_CLASSES } from '../../src/core';

const ROOT = path.resolve(__dirname, '..');
const BASE_CSS = fs.readFileSync(path.join(ROOT, 'themes/_base.css'), 'utf8');

function escape(name: string): string {
  return name.replace(/[-]/g, '\\-');
}

/** Classes whose rule is missing, or whose rule names a keyframe the CSS never defines. */
function missingMotionRules(classes: readonly string[], css: string): string[] {
  return classes.filter((cls) => {
    const rule = new RegExp(`\\.${escape(cls)}\\s*\\{([^}]*)\\}`).exec(css);
    if (!rule) return true;
    const anim = /animation(?:-name)?\s*:\s*([a-z0-9-]+)/.exec(rule[1]);
    if (!anim) return true;
    return !new RegExp(`@keyframes\\s+${escape(anim[1])}\\s*\\{`).test(css);
  });
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories)\./.test(entry.name)) out.push(full);
  }
  return out;
}

describe('svg motion classes', () => {
  it('every declared class runs a defined keyframe in _base.css', () => {
    expect(missingMotionRules(Object.values(SVG_MOTION_CLASSES), BASE_CSS)).toEqual([]);
  });

  it('control: a class with no rule, and a rule naming an undefined keyframe, are both reported', () => {
    const css = '.almadar-a { animation: almadar-gone 1s; }\n@keyframes almadar-b { to { opacity: 0; } }';
    expect(missingMotionRules(['almadar-a', 'almadar-b'], css)).toEqual(['almadar-a', 'almadar-b']);
  });

  it('control: a class whose rule runs a defined keyframe passes', () => {
    const css = '.almadar-a { animation: almadar-a 1s linear infinite; }\n@keyframes almadar-a { to { opacity: 0; } }';
    expect(missingMotionRules(['almadar-a'], css)).toEqual([]);
  });

  it('no component spells an svg motion class outside lib/svgMotion.ts', () => {
    const owner = path.join(ROOT, 'lib/svgMotion.ts');
    const offenders = ['components', 'lib', 'hooks']
      .flatMap((d) => walk(path.join(ROOT, d)))
      .filter((f) => f !== owner && /almadar-svg-[a-z]/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
