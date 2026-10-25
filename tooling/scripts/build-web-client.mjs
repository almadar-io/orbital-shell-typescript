#!/usr/bin/env node
/**
 * Builds the program-independent web client `orb serve` hands out: the `almadar-shell` template's client, built
 * once with ALMADAR_GENERIC_CLIENT=1 into `templates/almadar-web-client/` (shipped beside the shell binary by
 * `package-program.mjs`). Each program's files (`client.json`, `program.client.orb`, `themes.css`, `locales/`,
 * `language.json`) are served next to it at run time.
 *
 *   node tooling/scripts/build-web-client.mjs                       released @almadar/* from the template's lockfile
 *   node tooling/scripts/build-web-client.mjs --workspace <root>    the monorepo's @almadar/* sources, linked
 *
 * Before the template is copied, `orb tailwind-content` rewrites its tailwind-content.txt from the installed
 * behaviors (with --workspace, the ones resolved from <root>), so the bundled CSS carries their classes.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const out = path.resolve(flag('--out') ?? path.join(repo, 'templates', 'almadar-web-client'));
const workspace = flag('--workspace');

/** The monorepo folder of each @almadar package the client depends on. */
const WORKSPACE_PACKAGES = {
  '@almadar/core': 'orbital-rust/crates/orbital-shell-typescript/core',
  '@almadar/kernel': 'orbital-rust/crates/orbital-wasm/js',
  '@almadar/logger': 'orbital-rust/crates/orbital-shell-typescript/runtime/logger',
  '@almadar/syntax': 'orbital-rust/crates/orbital-shell-typescript/tooling/syntax',
  '@almadar/shell-browser': 'orbital-rust/crates/orbital-shell-typescript/hosts/browser',
  '@almadar/shell-runtime': 'orbital-rust/crates/orbital-shell-typescript/runtime/kernel',
  '@almadar/shell-web': 'orbital-rust/crates/orbital-shell-typescript/renderers/web',
  '@almadar/shell-node': 'orbital-rust/crates/orbital-shell-typescript/hosts/node',
  '@almadar/std': 'packages/almadar-std',
  '@almadar/eslint-plugin': 'orbital-rust/crates/orbital-shell-typescript/tooling/eslint',
};

const run = (cmd, argv, cwd, env = {}) => execFileSync(cmd, argv, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

const tailwindContent = path.join(repo, 'templates', 'almadar-shell', 'packages', 'client', 'tailwind-content.txt');
run('orb', ['tailwind-content', '--out', tailwindContent], workspace === undefined ? process.cwd() : path.resolve(workspace));

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'almadar-web-client-'));
try {
  fs.cpSync(path.join(repo, 'templates', 'almadar-shell'), scratch, {
    recursive: true,
    filter: (p) => !['node_modules', 'dist', '.turbo'].includes(path.basename(p)),
  });
  const client = path.join(scratch, 'packages', 'client');
  if (workspace === undefined) {
    run('pnpm', ['install', '--frozen-lockfile', '--filter', '@almadar/shell-client...'], scratch);
  } else {
    const root = path.resolve(workspace);
    const manifestPath = path.join(scratch, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const [name, dir] of Object.entries(WORKSPACE_PACKAGES)) {
      const at = path.join(root, dir);
      if (!fs.existsSync(path.join(at, 'package.json'))) throw new Error(`${name}: no package at ${at}`);
      manifest.pnpm.overrides[name] = `link:${at}`;
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    fs.rmSync(path.join(scratch, 'pnpm-lock.yaml'), { force: true });
    run('pnpm', ['install', '--no-frozen-lockfile', '--ignore-scripts', '--filter', '@almadar/shell-client...'], scratch);
  }
  run('pnpm', ['exec', 'tsc', '--noEmit'], client);
  fs.rmSync(out, { recursive: true, force: true });
  run('pnpm', ['exec', 'vite', 'build', '--outDir', out, '--emptyOutDir'], client, { ALMADAR_GENERIC_CLIENT: '1' });
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
