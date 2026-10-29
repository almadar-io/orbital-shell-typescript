/**
 * The app's server: the served program (the app composed with `std-http-server` by `orb compile`) running on the Node
 * host. The program listens, routes, serves the client and streams live events itself; this module only loads it and
 * closes it on SIGINT/SIGTERM. What mounts at boot is the kernel's (EXEC-ENDPOINT-3), run by `register`.
 */

import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MessageCatalogs, OrbitalSchema } from '@almadar/core';
import { createNodeOsHost, loadNativeKernelModule, OrbitalServerRuntime, processAnchors } from '@almadar/shell-node';

const KERNEL_DIR_ENV = 'ORBITAL_KERNEL_DIR';
const server = join(dirname(fileURLToPath(import.meta.url)), '..');
const project = join(server, '..', '..');

/** The message catalogs of every locale the program declares, from the compile's `locales/`. */
function catalogsOf(program: OrbitalSchema): MessageCatalogs {
  return Object.fromEntries((program.locales ?? []).map((locale) => {
    const file = join(project, 'locales', `${locale}.json`);
    if (!existsSync(file)) throw new Error(`the program declares locale "${locale}" but ${file} is missing`);
    return [locale, JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>];
  }));
}

const program: OrbitalSchema = JSON.parse(readFileSync(join(server, 'generated', 'program.orb'), 'utf8'));
const kernel = await loadNativeKernelModule(join(process.env[KERNEL_DIR_ENV] || join(project, 'kernel'), 'kernel.node'), { languageFrom: server });
const runtime = new OrbitalServerRuntime({
  kernel,
  secretPorts: {},
  osHost: (grants) => createNodeOsHost(grants, { anchors: { ...processAnchors(), start: project } }),
});
await runtime.register(program, { messages: catalogsOf(program) });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    runtime.unregisterAll();
    process.exit(0);
  });
}
