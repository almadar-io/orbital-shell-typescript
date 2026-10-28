import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const USE_CLIENT = '"use client";';

/** True when the directive is the first statement of the built module. */
export function startsWithUseClient(source) {
  return source.startsWith(`${USE_CLIENT}\n`);
}

/** Rollup's tree-shaking drops the esbuild banner, so the built entries get the directive back as their first statement. */
export function ensureUseClient(dir, entries, extension) {
  for (const entry of entries) {
    const file = join(dir, `${entry}.${extension}`);
    const source = readFileSync(file, 'utf8');
    if (!startsWithUseClient(source)) writeFileSync(file, `${USE_CLIENT}\n${source}`);
  }
}
