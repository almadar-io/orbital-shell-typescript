import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = '@almadar-io/kernel-bench-tool';

/** The tool's own root — never the process cwd, whatever launched the CLI. */
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth++) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf-8')) as { name?: string };
      if (parsed.name === PACKAGE_NAME) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`${PACKAGE_NAME} package.json not found above ${dirname(fileURLToPath(import.meta.url))}`);
}

export function packageFixturesDir(): string {
  return resolve(packageRoot(), 'fixtures');
}

