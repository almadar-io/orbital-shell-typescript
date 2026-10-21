#!/usr/bin/env npx tsx
/**
 * Tailwind Safelist Audit
 *
 * Scans all @almadar/ui source files for Tailwind classes that need
 * to be in the safelist (because consuming apps can't extract them
 * from compiled dist/ files). Compares against the current safelist
 * in tailwind-preset.cjs and reports missing entries.
 *
 * Classes that need safelisting:
 * 1. Arbitrary value classes: bg-[var(--color-X)], min-h-[200px], etc.
 * 2. Opacity modifiers on semantic colors: bg-primary/10, text-foreground/60
 * 3. Responsive prefixes on dynamic values: sm:grid-cols-2
 * 4. State prefixes on CSS vars: hover:bg-[var(--color-X)]
 *
 * Standard utility classes (flex, p-4, rounded-lg) are fine because
 * the shell template's tailwind.config.js includes the dist/ path in
 * content scanning. But CSS-variable-based arbitrary classes use bracket
 * notation that Tailwind can't extract from minified JS.
 *
 * Usage:
 *   npx tsx scripts/audit-tailwind-safelist.ts
 *   npx tsx scripts/audit-tailwind-safelist.ts --fix  (appends missing to preset)
 *
 * @packageDocumentation
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { createRequire } from 'module';
import { join, relative, resolve } from 'path';

const requireCjs = createRequire(import.meta.url);
const { compileTailwindClasses } = requireCjs('../tailwind-compile.cjs') as {
  compileTailwindClasses: (classes: string[]) => Promise<string>;
};
const { safelist: loadedSafelist } = requireCjs('../tailwind-preset.cjs') as { safelist: Array<string | { pattern: RegExp }> };

const ROOT = join(import.meta.dirname, '..');
const PRESET_PATH = join(ROOT, 'tailwind-preset.cjs');
const SCAN_DIRS = ['src/components', 'src/preview', 'src/renderer', 'src/context', 'src/providers', 'src/hooks', 'src/core'];

// ---------------------------------------------------------------------------
// Regex patterns for classes that need safelisting
// ---------------------------------------------------------------------------

// Matches arbitrary value classes: bg-[var(...)], min-h-[200px], w-[300px], etc.
// Requires a hyphen before the bracket to avoid matching JS array access like arr[0]
// A bracket followed by `:` is a variant (`data-[active=true]:`), not a class.
const ARBITRARY_RE = /(?:^|\s|["'`])([a-z][a-z0-9]*(?::[a-z][a-z0-9-]*)+-\[[^\]]+\]|[a-z][a-z0-9]*-[a-z0-9-]*-\[[^\]]+\]|[a-z][a-z0-9]*-\[[^\]]+\])(?!:)/g;

// Matches opacity modifiers on semantic colors: bg-primary/10, text-foreground/60
const OPACITY_RE = /(?:^|\s|["'`])((?:bg|text|border|ring|from|to|via|hover:bg|hover:text|hover:border|dark:bg|dark:hover:bg|group-hover:bg|group-hover:text|peer-focus:ring|focus:ring)-(?:primary|secondary|muted|accent|foreground|card|surface|background|border|error|success|warning|info|ring|input|muted-foreground|card-foreground|primary-foreground|secondary-foreground|error-foreground|success-foreground|warning-foreground|info-foreground)\/\d+)/g;

// Matches classes with [var(--...)] or [length:var(--...)]
const CSS_VAR_RE = /(?:^|\s|["'`])([a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)*-\[(?:length:|color:)?var\(--[a-z0-9-]+\)[^\]]*\])/g;

// ---------------------------------------------------------------------------
// File scanner
// ---------------------------------------------------------------------------

function getAllFiles(dir: string, ext = '.tsx'): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory() && entry !== 'node_modules' && entry !== 'dist' && entry !== '.storybook') {
        results.push(...getAllFiles(full, ext));
      } else if (entry.endsWith(ext) || entry.endsWith('.ts')) {
        results.push(full);
      }
    }
  } catch {
    // directory doesn't exist
  }
  return results;
}

function extractSafelistCandidates(content: string): Set<string> {
  const candidates = new Set<string>();

  // Find arbitrary value classes
  for (const match of content.matchAll(ARBITRARY_RE)) {
    const cls = match[1];
    if (cls && !cls.startsWith('//') && !cls.startsWith('*')) {
      candidates.add(cls);
    }
  }

  // Find opacity modifier classes
  for (const match of content.matchAll(OPACITY_RE)) {
    if (match[1]) candidates.add(match[1]);
  }

  // Find CSS variable classes
  for (const match of content.matchAll(CSS_VAR_RE)) {
    if (match[1]) candidates.add(match[1]);
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Safelist parser
// ---------------------------------------------------------------------------

/** The safelist the preset really exports: parts of it are generated, so its source text lists only some of it. */
function getCurrentSafelist(): Set<string> {
  return new Set(loadedSafelist.filter((entry): entry is string => typeof entry === 'string'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const fix = process.argv.includes('--fix');

console.log('Tailwind Safelist Audit');
console.log('='.repeat(60));
console.log(`Scanning: ${SCAN_DIRS.join(', ')}`);
console.log(`Preset: ${relative(ROOT, PRESET_PATH)}`);
console.log();

// Scan all source files
const allCandidates = new Map<string, Set<string>>(); // class -> set of files
let fileCount = 0;

for (const dir of SCAN_DIRS) {
  const files = getAllFiles(resolve(ROOT, dir));
  for (const file of files) {
    if (file.includes('.stories.') || file.includes('.test.') || file.includes('.spec.')) continue;
    fileCount++;
    const content = readFileSync(file, 'utf-8');
    const candidates = extractSafelistCandidates(content);
    for (const cls of candidates) {
      if (!allCandidates.has(cls)) allCandidates.set(cls, new Set());
      allCandidates.get(cls)!.add(relative(ROOT, file));
    }
  }
}

console.log(`Scanned ${fileCount} files, found ${allCandidates.size} safelist candidates`);
console.log();

// Compare against current safelist
const currentSafelist = getCurrentSafelist();
const missing: Array<{ cls: string; files: string[] }> = [];
const alreadySafe: string[] = [];

for (const [cls, files] of allCandidates) {
  if (currentSafelist.has(cls)) {
    alreadySafe.push(cls);
  } else {
    missing.push({ cls, files: Array.from(files) });
  }
}

// Also exclude standard utility classes that Tailwind extracts from dist/ scanning.
// Only arbitrary values ([...]), opacity modifiers (/N), and CSS var classes need safelisting.
const needsSafelist = (cls: string) =>
  cls.includes('[') || cls.includes('/') || cls.includes('var(');

const filtered = missing.filter(m => needsSafelist(m.cls));
const skipped = missing.filter(m => !needsSafelist(m.cls));
missing.length = 0;
missing.push(...filtered);

// A class Tailwind generates no CSS for paints nothing whether or not it is safelisted
// (`justify-[inherit]`: Tailwind 3 has no arbitrary justify-content) — fail on it.
const dead: Array<{ cls: string; files: string[] }> = [];
for (const cls of new Set([...loadedSafelist.filter((e): e is string => typeof e === 'string'), ...missing.map((m) => m.cls)])) {
  if ((await compileTailwindClasses([cls])) === '') dead.push({ cls, files: Array.from(allCandidates.get(cls) ?? []) });
}
if (dead.length > 0) {
  console.log('Classes that generate no CSS (fix the class at its source, or drop the safelist entry):');
  for (const { cls, files } of dead) console.log(`  ${cls}${files.length > 0 ? `  <- ${files.join(', ')}` : '  (safelist only)'}`);
  process.exit(1);
}

// Report
console.log(`Current safelist: ${currentSafelist.size} entries`);
console.log(`Already safelisted: ${alreadySafe.length}`);
console.log(`Standard utilities (no safelist needed): ${skipped.length}`);
console.log(`Missing from safelist: ${missing.length}`);
console.log();

if (missing.length === 0) {
  console.log('All safelist candidates are covered. No changes needed.');
  process.exit(0);
}

// Sort missing by class name
missing.sort((a, b) => a.cls.localeCompare(b.cls));

console.log('Missing classes:');
for (const { cls, files } of missing) {
  console.log(`  ${cls}`);
  for (const f of files.slice(0, 3)) {
    console.log(`    <- ${f}`);
  }
  if (files.length > 3) {
    console.log(`    ... and ${files.length - 3} more files`);
  }
}

if (fix) {
  console.log();
  console.log('Appending missing classes to safelist...');

  const presetContent = readFileSync(PRESET_PATH, 'utf-8');

  // Find the end of the safelist array and insert before the closing ]
  const safelistEndIdx = presetContent.indexOf('],', presetContent.indexOf('safelist:'));
  if (safelistEndIdx === -1) {
    console.error('Could not find safelist closing bracket in preset file');
    process.exit(1);
  }

  const newEntries = missing.map(m => `  '${m.cls}',`).join('\n');
  const comment = `  // Auto-added by audit-tailwind-safelist.ts (${new Date().toISOString().split('T')[0]})`;
  const updated = presetContent.slice(0, safelistEndIdx) +
    '\n' + comment + '\n' + newEntries + '\n' +
    presetContent.slice(safelistEndIdx);

  writeFileSync(PRESET_PATH, updated, 'utf-8');
  console.log(`Added ${missing.length} classes to safelist.`);
} else {
  console.log();
  console.log('Run with --fix to add missing classes to the preset.');
  // A missing entry here means a component ships a class Tailwind will silently
  // drop CSS for (the Gantt bar defect: axis rendered, bars were invisible on
  // every reload) — CI must fail so it is caught at merge, not in production.
  process.exit(1);
}
