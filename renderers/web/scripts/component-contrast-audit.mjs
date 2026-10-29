#!/usr/bin/env node
/**
 * WCAG contrast audit of the text/background pairs components actually
 * paint: every class string that sets both a `text-<token>` and a
 * `bg-<token>` (and every `hover:` pair) is measured in every theme mode.
 * Text whose class string sets no background at all (or `bg-transparent`) sits on
 * whatever is behind it, so it is measured against the page `--color-background`.
 * The paired inks (`text-<x>-foreground`, `text-background`) are written for the
 * `bg-<x>` / `bg-foreground` ground, never the page, so they are not measured there.
 *
 * Usage: node component-contrast-audit.mjs [--json] [--min <ratio>]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadThemeModes, pairContrast } from './lib/theme-colors.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const minIdx = args.indexOf('--min');
const MIN = minIdx >= 0 ? Number(args[minIdx + 1]) : 4.5;

const NOT_COLOR = /^(xs|sm|base|lg|xl|\dxl|left|right|center|start|end|justify|inherit|current|transparent|balance|wrap|nowrap|pretty|ellipsis|clip)$/;
const PAIRED_INK = /^(background|(?!muted-)[a-z]+-foreground)$/;
const PAGE = { name: 'background', alpha: 1, page: true };
const STRINGS = /"([^"\n]{3,})"|'([^'\n]{3,})'|`([^`\n]{3,})`/g;

function colorToken(cls, prefix) {
  const m = cls.match(new RegExp(`^${prefix}-([a-z][a-z0-9-]*)(?:/(\\d+))?$`));
  if (!m || NOT_COLOR.test(m[1])) return null;
  return { name: m[1], alpha: m[2] ? Number(m[2]) / 100 : 1 };
}

function files(dir) {
  let out = [];
  for (const n of readdirSync(dir)) {
    if (n === '__tests__') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out = out.concat(files(p));
    else if (n.endsWith('.tsx') && !n.includes('.stories.')) out.push(p);
  }
  return out;
}

/** { key: "text-x on bg-y", fg, bg, state, sites[] } collected from source. */
function collectPairs() {
  const pairs = new Map();
  const add = (state, fg, bg, site) => {
    const ground = bg.page ? 'page' : `bg-${bg.name}${bg.alpha < 1 ? '/' + bg.alpha * 100 : ''}`;
    const key = `${state === 'hover' ? 'hover: ' : ''}text-${fg.name}${fg.alpha < 1 ? '/' + fg.alpha * 100 : ''} on ${ground}`;
    if (!pairs.has(key)) pairs.set(key, { key, fg, bg, state, sites: [] });
    pairs.get(key).sites.push(site);
  };
  for (const dir of ['src/components/core', 'src/components/game', 'src/components/learning']) {
    for (const file of files(join(ROOT, dir))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/no-hardcoded-colors/.test(line) || /no-hardcoded-colors/.test(lines[i - 1] ?? '')) return;
        for (const m of line.matchAll(STRINGS)) {
          const toks = (m[1] ?? m[2] ?? m[3]).split(/\s+/);
          const text = toks.map(t => colorToken(t, 'text')).filter(Boolean);
          const bg = toks.map(t => colorToken(t, 'bg')).filter(Boolean);
          const hText = toks.map(t => t.startsWith('hover:') ? colorToken(t.slice(6), 'text') : null).filter(Boolean);
          const hBg = toks.map(t => t.startsWith('hover:') ? colorToken(t.slice(6), 'bg') : null).filter(Boolean);
          const site = `${relative(ROOT, file)}:${i + 1}`;
          for (const b of bg) for (const t of text) add('base', t, b, site);
          const paintsGround = !toks.some(t => /(^|:)bg-/.test(t) && t !== 'bg-transparent');
          if (paintsGround) {
            for (const t of text) if (!PAIRED_INK.test(t.name)) add('base', t, PAGE, site);
            for (const t of hText) if (!PAIRED_INK.test(t.name)) add('hover', t, PAGE, site);
          }
          const hoverBgs = hBg.length ? hBg : (hText.length ? bg : []);
          const hoverTexts = hText.length ? hText : text;
          if (hBg.length || hText.length) for (const b of hoverBgs) for (const t of hoverTexts) add('hover', t, b, site);
        }
      });
    }
  }
  return [...pairs.values()];
}

const modes = loadThemeModes(resolve(ROOT, 'themes'));
const report = [];
for (const pair of collectPairs()) {
  const failing = [];
  for (const mode of modes) {
    // Inside a card the foundation CSS re-scopes --color-foreground to the card's own foreground.
    const fgVar = pair.fg.name === 'foreground' && pair.bg.name === 'card' ? '--color-card-foreground' : `--color-${pair.fg.name}`;
    const fg = mode.color(fgVar);
    const bg = mode.color(`--color-${pair.bg.name}`);
    if (!fg || !bg) continue;
    const ratio = pairContrast(mode, { ...fg, a: fg.a * pair.fg.alpha }, { ...bg, a: bg.a * pair.bg.alpha });
    if (ratio !== null && ratio < MIN) failing.push({ theme: mode.name, ratio: Number(ratio.toFixed(2)) });
  }
  if (failing.length) report.push({ pair: pair.key, modes: failing.length, worst: failing.sort((a, b) => a.ratio - b.ratio)[0], sites: pair.sites });
}
report.sort((a, b) => b.modes - a.modes);
if (asJson) {
  console.log(JSON.stringify({ totalModes: modes.length, min: MIN, failing: report }, null, 1));
} else {
  console.log(`${modes.length} theme modes, threshold ${MIN}:1`);
  for (const r of report) console.log(`${String(r.modes).padStart(3)} modes  worst ${r.worst.ratio}:1 (${r.worst.theme})  ${r.pair}  — ${r.sites.length} site(s): ${r.sites.slice(0, 3).join(', ')}${r.sites.length > 3 ? ' …' : ''}`);
  console.log(report.length === 0 ? 'All painted pairs pass.' : `${report.length} failing pair(s).`);
}
process.exit(report.length === 0 ? 0 : 1);
