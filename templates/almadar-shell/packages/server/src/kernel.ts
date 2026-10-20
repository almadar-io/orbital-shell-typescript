/**
 * The native server: `orbital-server` running the program in this process (the native kernel add-on). Every API request
 * goes through its own router, so this app serves the routes `orb serve` serves; this module only loads it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HostResponse {
  status: number;
  headersJson: string;
  body: Buffer;
}

export interface NativeServer {
  handle(method: string, uri: string, headersJson: string, body: Buffer): HostResponse;
  takeTicket(ticket: string): string | null;
  liveRecipients(itemJson: string, connectionsJson: string): string;
}

interface KernelModule {
  installLanguage(bundleJson: string): void;
  NativeServer: { open(programJson: string, envJson: string, catalogsJson: string, onLive: ((itemJson: string) => void) | null): NativeServer };
}

const KERNEL_DIR_ENV = 'ORBITAL_KERNEL_DIR';
const project = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function loadKernel(): KernelModule {
  const dir = process.env[KERNEL_DIR_ENV] || join(project, 'kernel');
  const path = join(dir, 'kernel.node');
  try {
    return createRequire(import.meta.url)(path) as KernelModule;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`the native kernel is not at ${path} (put kernel.node there or set ${KERNEL_DIR_ENV}): ${reason}`);
  }
}

/** The message catalogs of every locale the program declares, from the compile's `locales/`. */
function catalogsOf(program: string): Record<string, object> {
  const { locales } = JSON.parse(program) as { locales?: string[] };
  return Object.fromEntries((locales ?? []).map((locale) => {
    const file = join(project, 'locales', `${locale}.json`);
    if (!existsSync(file)) throw new Error(`the program declares locale "${locale}" but ${file} is missing`);
    return [locale, JSON.parse(readFileSync(file, 'utf8')) as object];
  }));
}

/** The program the compile wrote, served natively; `onLive` receives each live item a dispatch produces. */
export function openKernel(onLive: (itemJson: string) => void): NativeServer {
  const kernel = loadKernel();
  kernel.installLanguage(readFileSync(join(project, 'packages', 'server', 'generated', 'language.json'), 'utf8'));
  const program = readFileSync(join(project, 'packages', 'shared', 'src', 'program.json'), 'utf8');
  return kernel.NativeServer.open(program, JSON.stringify(process.env), JSON.stringify(catalogsOf(program)), onLive);
}
