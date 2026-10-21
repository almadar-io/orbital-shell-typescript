/**
 * Import every built `dist/**` ESM entry under plain Node. Bundlers paper over
 * CommonJS interop (a named import from a `module.exports` package), so a
 * consumer that loads the package natively — playground-runtime's tests,
 * SSR — is the only place that bug shows. This runs the same load.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const entries = new Set();
for (const target of Object.values(pkg.exports)) {
  if (typeof target === 'object' && typeof target.import === 'string' && target.import.startsWith('./dist/')) {
    entries.add(target.import);
  }
}

const failures = [];
for (const entry of [...entries].sort()) {
  try {
    await import(pathToFileURL(resolve(root, entry)).href);
    console.log(`  ok  ${entry}`);
  } catch (err) {
    failures.push(entry);
    console.log(`  FAIL ${entry}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (failures.length > 0) {
  console.log(`\n${failures.length} dist entr${failures.length === 1 ? 'y' : 'ies'} fail to load under Node ESM.`);
  process.exit(1);
}
console.log(`\nAll ${entries.size} dist ESM entries load under Node.`);
