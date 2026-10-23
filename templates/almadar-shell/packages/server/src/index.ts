/**
 * The app's server: the served program (the app composed with `std-http-server` by `orb compile`) running on the Node
 * host. The program listens, routes, serves the client and streams live events itself; this module only loads it,
 * mounts `INIT` on every trait and closes it on SIGINT/SIGTERM.
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

const program: OrbitalSchema = JSON.parse(readFileSync(join(server, 'generated', 'program.json'), 'utf8'));
const kernel = await loadNativeKernelModule(join(process.env[KERNEL_DIR_ENV] || join(project, 'kernel'), 'kernel.node'), { languageFrom: server });
const runtime = new OrbitalServerRuntime({
  mode: 'real',
  kernel,
  http: { kernel: async () => kernel },
  osHost: (grants) => createNodeOsHost(grants, { anchors: { ...processAnchors(), start: project } }),
});
await runtime.register(program, { messages: catalogsOf(program) });

for (const orbital of runtime.listOrbitals()) {
  const traits = (await runtime.describeOrbital(orbital))?.traits ?? [];
  if (traits.length === 0) continue;
  const mount = traits.map((t) => ({ trait: t.name, event: 'INIT' as const }));
  const answer = await runtime.processOrbitalEvent(orbital, { event: 'INIT', mount });
  if (!answer.success) throw new Error(`INIT of ${orbital}: ${answer.error ?? 'the kernel refused the mount'}`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    runtime.unregisterAll();
    process.exit(0);
  });
}
