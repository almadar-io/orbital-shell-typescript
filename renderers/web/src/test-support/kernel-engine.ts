import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installKernelEvaluator } from '@almadar/core';
import { installNativeLanguages } from '@almadar/syntax';
import type { OrbitalSchema } from '@almadar/core';
import { readLanguageBundle } from '@almadar/core/language-data';
import { kernelEngine, type KernelEngineValue } from '../providers/kernel-engine.js';
import type { KernelModule } from '../lib/kernel-wire.js';

interface WasmGlue extends Omit<KernelModule, 'isolate'> {
  initSync(input: { module: WebAssembly.Module }): void;
  installLanguage(bundleJson: string): void;
}

interface InstanceFactory {
  createKernelInstance(module: WebAssembly.Module, languageBundle: string): Promise<Omit<KernelModule, 'isolate'>>;
}

const resolveInstalled = createRequire(import.meta.url).resolve;

/** `loaded` with `isolate()`: one more instance of the same compiled kernel, with the test language installed, as the browser loader makes one. */
function isolatingModule(loaded: Omit<KernelModule, 'isolate'>, factory: InstanceFactory, compiled: WebAssembly.Module): KernelModule {
  return { ...loaded, isolate: () => factory.createKernelInstance(compiled, TEST_LANGUAGE).then((own) => isolatingModule(own, factory, compiled)) };
}

/** The kernel's glue and wasm: the installed `@almadar/kernel`, or the build in `ALMADAR_KERNEL_DIR` to test an unpublished one. */
function kernelFiles(): { glue: string; instance: string; wasm: string } {
  const dir = process.env.ALMADAR_KERNEL_DIR;
  if (dir !== undefined && dir !== '') {
    return { glue: join(dir, 'pkg/orbital_wasm.js'), instance: join(dir, 'pkg/orbital_wasm_instance.js'), wasm: join(dir, 'pkg/orbital_wasm_bg.wasm') };
  }
  return { glue: resolveInstalled('@almadar/kernel'), instance: resolveInstalled('@almadar/kernel/instance'), wasm: resolveInstalled('@almadar/kernel/kernel.wasm') };
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
  const factory: InstanceFactory = await import(/* @vite-ignore */ pathToFileURL(files.instance).href);
  const compiled = new WebAssembly.Module(readFileSync(files.wasm));
  glue.initSync({ module: compiled });
  glue.installLanguage(TEST_LANGUAGE);
  const module = isolatingModule(glue, factory, compiled);
  installKernelEvaluator(module);
  installNativeLanguages();
  return module;
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

export const KERNEL_ENGINE: KernelEngineValue = kernelEngine(() => loadTestKernel());
export const ENGINES: ReadonlyArray<readonly [string, KernelEngineValue]> = KERNEL_AVAILABLE ? [['kernel', KERNEL_ENGINE]] : [];

/** A client-build kernel instance of its own, as a browser loads it: initialised, with the language installed once, as the browser kernel loader does. */
export async function loadFreshClientKernel(): Promise<KernelModule> {
  const dir = process.env.ALMADAR_KERNEL_DIR;
  const files = dir !== undefined && dir !== ''
    ? { glue: join(dir, 'pkg-client/orbital_wasm.js'), instance: join(dir, 'pkg-client/orbital_wasm_instance.js'), wasm: join(dir, 'pkg-client/orbital_wasm_bg.wasm') }
    : { glue: resolveInstalled('@almadar/kernel/client'), instance: resolveInstalled('@almadar/kernel/client/instance'), wasm: resolveInstalled('@almadar/kernel/client.wasm') };
  const glue: WasmGlue = await import(/* @vite-ignore */ `${pathToFileURL(files.glue).href}?fresh=${Math.random()}`);
  const factory: InstanceFactory = await import(/* @vite-ignore */ pathToFileURL(files.instance).href);
  const compiled = new WebAssembly.Module(readFileSync(files.wasm));
  glue.initSync({ module: compiled });
  glue.installLanguage(TEST_LANGUAGE);
  const module = isolatingModule(glue, factory, compiled);
  installKernelEvaluator(module);
  installNativeLanguages();
  return module;
}

/** Load the WebAssembly and the adapter chunk before a timing-sensitive test: the first dispatch otherwise waits on both. */
export async function warmKernel(): Promise<void> {
  if (!KERNEL_AVAILABLE) return;
  await KERNEL_ENGINE.loadModule();
  await import('../lib/kernel-client.js');
}
