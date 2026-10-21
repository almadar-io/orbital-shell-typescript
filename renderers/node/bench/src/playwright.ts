import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export interface PlaywrightPage {
  goto(url: string): Promise<unknown>;
  evaluate(expression: string): Promise<string>;
}

export interface PlaywrightBrowser {
  version(): string;
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

export interface PlaywrightCore {
  chromium: { launch(options: { headless: boolean; args: string[] }): Promise<PlaywrightBrowser> };
}

interface PlaywrightManifest {
  version: string;
}

/** `playwright-core` from the directory the caller names; nothing is searched for. */
export async function loadPlaywright(dir: string): Promise<{ core: PlaywrightCore; version: string }> {
  const require = createRequire(join(dir, 'package.json'));
  const core: PlaywrightCore = require(dir);
  const manifest: PlaywrightManifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  return { core, version: manifest.version };
}

/** Headers that make a page cross-origin isolated, so `performance.now()` resolves to 5 us instead of 100 us. */
export const ISOLATION_HEADERS = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'no-store',
} as const;

export const CHROMIUM_ARGS = ['--enable-precise-memory-info'];
