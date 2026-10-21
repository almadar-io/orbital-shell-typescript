#!/usr/bin/env node
/**
 * WCAG contrast audit for theme CSS files: checks the canonical
 * foreground/background token pairs every component relies on, in every
 * theme mode. `scripts/component-contrast-audit.mjs` checks the pairs
 * components actually paint.
 *
 * Usage:
 *   node theme-contrast-audit.mjs [--dir <themes-dir>] [file-filter]
 *
 * Defaults to this package's own themes/ dir. Apps that ship their own
 * [data-theme] files (e.g. apps/kflow's design-system/themes) run the same
 * audit against that dir via --dir so app-local themes stay gated.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadThemeModes, pairContrast } from './lib/theme-colors.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let themesDir = resolve(__dirname, '..', 'themes');
let filter;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir') {
    themesDir = resolve(process.cwd(), args[++i]);
  } else {
    filter = args[i];
  }
}

const PAIRS = [
  ['--color-foreground', '--color-background'],
  ['--color-card-foreground', '--color-card'],
  ['--color-primary-foreground', '--color-primary'],
  ['--color-primary-foreground', '--color-primary-hover'],
  ['--color-secondary-foreground', '--color-secondary'],
  ['--color-secondary-foreground', '--color-secondary-hover'],
  ['--color-accent-foreground', '--color-accent'],
  ['--color-muted-foreground', '--color-muted'],
  ['--color-muted-foreground', '--color-card'],
  ['--color-error-foreground', '--color-error'],
  ['--color-success-foreground', '--color-success'],
  ['--color-warning-foreground', '--color-warning'],
  ['--color-info-foreground', '--color-info'],
  // Surfaces with no *-foreground token of their own carry page text.
  ['--color-foreground', '--color-surface'],
];

// Drawing surfaces: labels are text (4.5:1); marks are graphics (WCAG 1.4.11, 3:1). Measured
// against the drawing ground, which falls back to the card when a theme sets none.
const DIAGRAM_TEXT = ['--color-diagram-label'];
const DIAGRAM_GRAPHICS = [
  '--color-diagram-ink',
  '--color-diagram-axis',
  '--color-diagram-highlight',
  ...Array.from({ length: 8 }, (_, i) => `--color-series-${i + 1}`),
];

let violations = 0;
for (const mode of loadThemeModes(themesDir, filter)) {
  const results = [];
  for (const [fgName, bgName] of PAIRS) {
    const ratio = pairContrast(mode, mode.color(fgName), mode.color(bgName));
    // Text on filled surfaces needs 4.5:1 (WCAG AA normal text)
    if (ratio !== null && ratio < 4.5) {
      results.push({ pair: `${fgName} on ${bgName}`, ratio: ratio.toFixed(2), fg: mode.raw(fgName), bg: mode.raw(bgName) });
    }
  }
  const groundName = mode.color('--surface-diagram') ? '--surface-diagram' : '--color-card';
  for (const [names, min] of [[DIAGRAM_TEXT, 4.5], [DIAGRAM_GRAPHICS, 3]]) {
    for (const fgName of names) {
      const ratio = pairContrast(mode, mode.color(fgName), mode.color(groundName));
      if (ratio !== null && ratio < min) {
        results.push({ pair: `${fgName} on ${groundName} (needs ${min}:1)`, ratio: ratio.toFixed(2), fg: mode.raw(fgName), bg: mode.raw(groundName) });
      }
    }
  }
  if (results.length) {
    violations += results.length;
    console.log(`\n${mode.name}  (${mode.file})`);
    for (const r of results) console.log(`  FAIL ${r.ratio}:1  ${r.pair}   fg=${r.fg} bg=${r.bg}`);
  }
}
console.log(violations === 0 ? '\nAll theme pairs pass WCAG AA (text 4.5:1, drawing marks 3:1).' : `\n${violations} violation(s).`);
process.exit(violations === 0 ? 0 : 1);
