#!/usr/bin/env node
/**
 * Remove typography + density tokens from general-purpose themes so they
 * inherit the shared `_base.css` :root defaults. Personality themes
 * (terminal, wireframe, neon, kiosk, gazette, minimalist, trait-wars)
 * and atelier itself are untouched.
 *
 * Usage: node scripts/strip-base-tokens-from-themes.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const themesDir = resolve(__dirname, '..', 'themes');

const GENERAL_THEMES = [
  'almadar.css',
  'almadar-website.css',
  'prism.css',
];

// CSS variable names to strip from each [data-theme="..."] block.
const TYPOGRAPHY_VARS = new Set([
  '--font-family',
  '--font-family-display',
  '--font-family-body',
  '--font-family-mono',
  '--font-weight-normal',
  '--font-weight-medium',
  '--font-weight-bold',
  '--letter-spacing',
  '--line-height',
  '--text-xs', '--leading-xs',
  '--text-sm', '--leading-sm',
  '--text-base', '--leading-base',
  '--text-lg', '--leading-lg',
  '--text-xl', '--leading-xl',
  '--text-2xl', '--leading-2xl',
  '--text-3xl', '--leading-3xl',
  '--text-4xl', '--leading-4xl',
  '--text-display-1', '--leading-display-1',
  '--text-display-2', '--leading-display-2',
  '--intent-heading-major-size',
  '--intent-heading-major-weight',
  '--intent-heading-major-leading',
  '--intent-heading-minor-size',
  '--intent-heading-minor-weight',
  '--intent-heading-minor-leading',
  '--intent-body-emphasis-size',
  '--intent-body-emphasis-weight',
  '--intent-body-emphasis-leading',
  '--intent-body-default-size',
  '--intent-body-default-weight',
  '--intent-body-default-leading',
  '--intent-body-quiet-size',
  '--intent-body-quiet-weight',
  '--intent-body-quiet-leading',
  '--intent-caption-size',
  '--intent-caption-weight',
  '--intent-caption-leading',
  '--intent-numeric-size',
  '--intent-numeric-weight',
  '--intent-numeric-leading',
  '--intent-numeric-family',
]);

const DENSITY_VARS = new Set([
  '--space-0', '--space-1', '--space-2', '--space-3', '--space-4',
  '--space-5', '--space-6', '--space-7', '--space-8', '--space-9',
  '--space-10', '--space-11', '--space-12',
  '--button-height-sm', '--button-height-md', '--button-height-lg',
  '--input-height-sm', '--input-height-md', '--input-height-lg',
  '--row-height-compact', '--row-height-normal', '--row-height-spacious',
  '--card-padding-sm', '--card-padding-md', '--card-padding-lg',
  '--dialog-padding',
  '--section-gap',
]);

const SHARED_VARS = new Set([...TYPOGRAPHY_VARS, ...DENSITY_VARS]);

// Block-comment lines that introduce sections we're removing whole. When
// every variable in the section is stripped, the comment line is too.
const STRIPPABLE_COMMENTS = [
  /^\s*\/\*\s*Typography[^*]*\*\/\s*$/,
  /^\s*\/\*\s*Type scale[^*]*\*\/\s*$/,
  /^\s*\/\*\s*Intent mapping[^*]*\*\/\s*$/,
  /^\s*\/\*\s*Density[^*]*\*\/\s*$/,
  /^\s*\/\*\s*Density axis[^*]*\*\/\s*$/,
  /^\s*\/\*\s*Type axis[^*]*\*\/\s*$/,
  /^\s*\/\*\s*Layer 1[^*]*\*\/\s*$/,
];

function stripBlock(lines) {
  // Walk the file; for any line that declares one of the shared CSS
  // variables, drop it. CSS variable values can span multiple lines
  // (e.g. multi-fallback font-family), so once we start dropping a
  // declaration, keep dropping subsequent lines until we hit a
  // semicolon-terminated line — that's the end of the declaration.
  // Drop comments whose adjacent (next-non-blank) line is also being
  // dropped, so we don't leave orphan headers.
  const keep = new Array(lines.length).fill(true);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\s*(--[a-z0-9-]+)\s*:/);
    if (match && SHARED_VARS.has(match[1])) {
      keep[i] = false;
      // If the declaration didn't end on this line (no `;`), continue
      // dropping until we see one. Bail if we hit a `}` to avoid
      // eating into the next block on malformed CSS.
      if (!/;\s*$/.test(line)) {
        for (let j = i + 1; j < lines.length; j++) {
          if (/^\s*\}/.test(lines[j])) break;
          keep[j] = false;
          if (/;\s*$/.test(lines[j])) break;
        }
      }
    }
  }

  // Drop section-header comments whose body is fully stripped: look
  // forward through blank lines + variable declarations; if the next
  // declaration we see is a kept var, the header stays; if it's a
  // dropped var (or we hit the end of the block), the header goes.
  for (let i = 0; i < lines.length; i++) {
    if (!keep[i]) continue;
    if (!STRIPPABLE_COMMENTS.some(rx => rx.test(lines[i]))) continue;
    let next = i + 1;
    while (next < lines.length) {
      const l = lines[next];
      if (/^\s*$/.test(l)) { next++; continue; }
      if (/^\s*\/\*/.test(l)) break;
      if (/^\s*\}/.test(l)) break;
      const m = l.match(/^\s*(--[a-z0-9-]+)\s*:/);
      if (m) {
        if (!keep[next]) {
          keep[i] = false;
        }
        break;
      }
      next++;
    }
  }

  // Collapse adjacent blank lines (>2 in a row) created by the strip.
  const out = [];
  let blankRun = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!keep[i]) continue;
    if (/^\s*$/.test(lines[i])) {
      blankRun++;
      if (blankRun > 1) continue;
    } else {
      blankRun = 0;
    }
    out.push(lines[i]);
  }
  return out;
}

let totalRemoved = 0;
for (const name of GENERAL_THEMES) {
  const path = resolve(themesDir, name);
  const before = readFileSync(path, 'utf8');
  const lines = before.split('\n');
  const after = stripBlock(lines).join('\n');
  const beforeLines = lines.length;
  const afterLines = after.split('\n').length;
  const delta = beforeLines - afterLines;
  if (delta === 0) {
    console.log(`  ${name}: no change`);
    continue;
  }
  writeFileSync(path, after);
  totalRemoved += delta;
  console.log(`  ${name}: ${beforeLines} -> ${afterLines} (-${delta})`);
}
console.log(`\nTotal lines removed: ${totalRemoved}`);
