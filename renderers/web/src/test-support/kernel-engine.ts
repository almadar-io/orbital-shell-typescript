import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installKernelEvaluator } from '@almadar/core';
import type { OrbitalSchema } from '@almadar/core';
import { readLanguageBundle } from '@almadar/core/language-data';
import type { KernelEngineValue } from '../providers/KernelEngineContext.js';
import type { KernelModule } from '../lib/kernel-wire.js';

interface WasmGlue extends KernelModule {
  initSync(input: { module: Buffer }): void;
  installLanguage(bundleJson: string): void;
}

const resolveInstalled = createRequire(import.meta.url).resolve;

/** The kernel's glue and wasm: the installed `@almadar/kernel`, or the build in `ALMADAR_KERNEL_DIR` to test an unpublished one. */
function kernelFiles(): { glue: string; wasm: string } {
  const dir = process.env.ALMADAR_KERNEL_DIR;
  if (dir !== undefined && dir !== '') {
    return { glue: join(dir, 'pkg/orbital_wasm.js'), wasm: join(dir, 'pkg/orbital_wasm_bg.wasm') };
  }
  return { glue: resolveInstalled('@almadar/kernel'), wasm: resolveInstalled('@almadar/kernel/kernel.wasm') };
}

function kernelAvailable(): boolean {
  try {
    return existsSync(kernelFiles().glue);
  } catch {
    return false;
  }
}

export const KERNEL_AVAILABLE = kernelAvailable();

async function load(): Promise<KernelModule> {
  const files = kernelFiles();
  const glue: WasmGlue = await import(/* @vite-ignore */ pathToFileURL(files.glue).href);
  glue.initSync({ module: readFileSync(files.wasm) });
  glue.installLanguage(TEST_LANGUAGE);
  installKernelEvaluator(glue);
  return glue;
}

/** The type-contract stamp every test program carries, typed from core's `OrbitalSchema` so a version bump there fails here. */
export const TEST_TYPE_CONTRACT_VERSION: NonNullable<OrbitalSchema['typeContractVersion']> = 1;

/** The stamp option a hook under test hands the kernel: the same version, as a program's stamp. */
export const TEST_STAMP: Pick<OrbitalSchema, 'typeContractVersion'> = { typeContractVersion: TEST_TYPE_CONTRACT_VERSION };

/** The installed language as the bundle a browser host hands a kernel it opens over a local store. */
export const TEST_LANGUAGE: string = JSON.stringify(readLanguageBundle(process.cwd()));

let shared: Promise<KernelModule> | undefined;

/** The shared kernel module, loaded once, with the render evaluator installed from it. */
export function loadTestKernel(): Promise<KernelModule> {
  return (shared ??= load());
}

export const KERNEL_ENGINE: KernelEngineValue = { loadModule: () => loadTestKernel(), loadLanguage: () => Promise.resolve(TEST_LANGUAGE) };
export const ENGINES: ReadonlyArray<readonly [string, KernelEngineValue]> = KERNEL_AVAILABLE ? [['kernel', KERNEL_ENGINE]] : [];

/** A client-build kernel instance of its own, as a browser loads it: nothing has installed language data into it. */
export async function loadFreshClientKernel(): Promise<KernelModule> {
  const dir = process.env.ALMADAR_KERNEL_DIR;
  const files = dir !== undefined && dir !== ''
    ? { glue: join(dir, 'pkg-client/orbital_wasm.js'), wasm: join(dir, 'pkg-client/orbital_wasm_bg.wasm') }
    : { glue: resolveInstalled('@almadar/kernel/client'), wasm: resolveInstalled('@almadar/kernel/client.wasm') };
  const glue: WasmGlue = await import(/* @vite-ignore */ `${pathToFileURL(files.glue).href}?fresh=${Math.random()}`);
  glue.initSync({ module: readFileSync(files.wasm) });
  installKernelEvaluator(glue);
  return glue;
}

/** Load the WebAssembly and the adapter chunk before a timing-sensitive test: the first dispatch otherwise waits on both. */
export async function warmKernel(): Promise<void> {
  if (!KERNEL_AVAILABLE) return;
  await KERNEL_ENGINE.loadModule();
  await import('../lib/kernel-client.js');
}
