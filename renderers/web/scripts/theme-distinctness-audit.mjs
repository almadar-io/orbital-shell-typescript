#!/usr/bin/env node
/**
 * Theme distinctness audit — fails when two themes differ (almost) only in
 * color. Each theme's NON-color signature is compared pairwise: display font,
 * body font, radius, corner shape, border style + width, shadow recipe family,
 * heading voice and surface material. Two themes must differ on at least
 * MIN_DIFF of those axes.
 *
 * Usage:
 *   node theme-distinctness-audit.mjs [--dir <themes-dir>] [--min <n>]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let themesDir = resolve(__dirname, '..', 'themes');
let MIN_DIFF = 3;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir') themesDir = resolve(process.cwd(), args[++i]);
  else if (args[i] === '--min') MIN_DIFF = Number(args[++i]);
}

function parseBlocks(css) {
  const blocks = new Map();
  const re = /(\[data-theme="([^"]+)"\]|:root)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const key = m[2] ?? ':root';
    const vars = blocks.get(key) ?? {};
    for (const decl of m[3].split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const name = decl.slice(0, i).trim();
      if (name.startsWith('--')) vars[name] = decl.slice(i + 1).trim();
    }
    blocks.set(key, vars);
  }
  return blocks;
}

const basePath = existsSync(resolve(themesDir, '_base.css')) ? resolve(themesDir, '_base.css') : resolve(__dirname, '..', 'themes', '_base.css');
const baseVars = parseBlocks(readFileSync(basePath, 'utf8')).get(':root') ?? {};

function resolveVar(value, vars, depth = 0) {
  if (value === undefined || depth > 8) return value;
  return value.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name, fallback) => {
    const v = vars[name] ?? baseVars[name];
    if (v !== undefined) return resolveVar(v, vars, depth + 1);
    return fallback !== undefined ? resolveVar(fallback.trim(), vars, depth + 1) : '';
  });
}

const firstFamily = (stack) => (stack ?? '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();

function shadowFamily(shadow) {
  const s = (shadow ?? '').trim();
  if (!s || s === 'none') return 'none';
  const layers = s.split(/,(?![^(]*\))/).map((l) => l.trim());
  const inset = layers.filter((l) => l.startsWith('inset')).length;
  if (inset >= 2 && layers.length >= 3) return 'clay';
  if (inset > 0 && inset === layers.length) return 'inset';
  if (inset > 0) return 'bevel';
  const lengths = layers.map((l) => (l.replace(/(rgba?|hsla?|color-mix)\([^)]*\)/g, '').match(/-?[\d.]+px|\b0\b/g) ?? []));
  if (layers.length >= 2 && lengths.some((ls) => parseFloat(ls[0]) < 0 || parseFloat(ls[1]) < 0)) return 'neumorphic';
  if (lengths.every((ls) => ls.length >= 2 && parseFloat(ls[2] ?? '0') === 0)) return 'hard';
  if (lengths.every((ls) => parseFloat(ls[0] ?? '0') === 0 && parseFloat(ls[1] ?? '0') === 0)) return 'glow';
  return 'soft';
}

function radiusBucket(r) {
  const v = (r ?? '').trim();
  if (/\//.test(v) || v.split(/\s+/).length > 1) return 'organic';
  const px = parseFloat(v);
  if (Number.isNaN(px)) return v || 'default';
  if (px === 0) return '0';
  if (px <= 4) return 'xs';
  if (px <= 10) return 'sm';
  if (px <= 18) return 'md';
  if (px < 999) return 'lg';
  return 'pill';
}

function signature(vars) {
  const r = (name) => resolveVar(vars[name] ?? baseVars[name], vars);
  return {
    display: firstFamily(r('--font-family-display') || r('--font-family')),
    body: firstFamily(r('--font-family-body') || r('--font-family')),
    radius: radiusBucket(r('--radius-container') || r('--radius-md')),
    corner: r('--corner-shape') || 'round',
    border: `${r('--border-style') || 'solid'}/${r('--border-width') || '1px'}`,
    shadow: shadowFamily(r('--shadow-main')),
    voice: [r('--heading-transform') || 'none', r('--heading-style') || 'normal', (r('--heading-shadow') || 'none') === 'none' ? '' : 'shadow'].join('/'),
    surface: ['--surface-backdrop', '--surface-card-image', '--surface-page-image'].map((n) => ((r(n) || 'none') === 'none' ? '-' : 'y')).join(''),
  };
}

const files = readdirSync(themesDir).filter((f) => f.endsWith('.css') && !f.startsWith('_') && f !== 'index.css');
const themes = [];
for (const f of files) {
  const blocks = parseBlocks(readFileSync(resolve(themesDir, f), 'utf8'));
  const name = f.slice(0, -4);
  const vars = blocks.get(`${name}-light`) ?? blocks.get(`${name}-dark`);
  if (!vars) continue;
  themes.push({ name, sig: signature(vars) });
}

let violations = 0;
for (let i = 0; i < themes.length; i++) {
  for (let j = i + 1; j < themes.length; j++) {
    const a = themes[i], b = themes[j];
    const differing = Object.keys(a.sig).filter((k) => a.sig[k] !== b.sig[k]);
    if (differing.length < MIN_DIFF) {
      violations++;
      const same = Object.keys(a.sig).filter((k) => !differing.includes(k)).map((k) => `${k}=${a.sig[k]}`).join(', ');
      console.log(`  ${a.name} ~ ${b.name}: differ only on [${differing.join(', ') || 'nothing'}]; shared ${same}`);
    }
  }
}
console.log(
  violations === 0
    ? `\nAll ${themes.length} themes differ on >= ${MIN_DIFF} non-color axes.`
    : `\n${violations} theme pair(s) differ on fewer than ${MIN_DIFF} non-color axes.`,
);
process.exit(violations === 0 ? 0 : 1);
