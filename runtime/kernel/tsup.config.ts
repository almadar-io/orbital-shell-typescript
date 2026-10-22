import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig } from 'tsup';

function entries(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? entries(path) : path.endsWith('.ts') ? [path] : [];
  });
}

export default defineConfig({
  entry: Object.fromEntries(entries('src').map((path) => [relative('src', path).replace(/\.ts$/, ''), path])),
  format: ['esm'],
  dts: true,
  splitting: true,
  treeshake: true,
  clean: true,
});
