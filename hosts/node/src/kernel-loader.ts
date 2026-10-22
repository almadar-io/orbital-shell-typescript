/** Node-only: load and initialise `@almadar/kernel` from its package directory (the one with `pkg/`). */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installKernelEvaluator } from '@almadar/core';
import { readLanguageBundle } from '@almadar/core/language-data';
import * as installedModule from '@almadar/kernel';
import type { HttpKernel } from '@almadar/shell-runtime';
import type { KernelModule } from '@almadar/shell-runtime';
import type { CredentialSeedKernel } from '@almadar/shell-runtime';

/** The whole server kernel as Node loads it: the shared module plus the server-only exports the client build omits. */
export interface LoadedKernel extends KernelModule, HttpKernel, CredentialSeedKernel {
  initSync(input: { module: Uint8Array }): object;
}

export interface LoadKernelOptions {
  /** Where the installed `@almadar/core` and `@almadar/std` are found, node-style. Required: the caller names its own root. */
  languageFrom: string;
}

/**
 * Loads the kernel and installs the language data the installed packages declare (the operator table that
 * routes `program/*` and the other host effects), as `orb` reads it. The first install in a process wins.
 */
export async function loadKernelModule(kernelDir: string, options: LoadKernelOptions): Promise<LoadedKernel> {
  return loadKernel(kernelDir, options);
}

const initialised = new WeakSet<LoadedKernel>();

/**
 * The one place a kernel is initialised: wasm init, language install and the kernel evaluator, once per kernel
 * module in the process (the first install wins).
 */
function initOnce(loaded: LoadedKernel, wasm: Uint8Array | undefined, languageFrom: string): LoadedKernel {
  if (initialised.has(loaded)) return loaded;
  if (wasm !== undefined) loaded.initSync({ module: wasm });
  loaded.installLanguage(JSON.stringify(readLanguageBundle(languageFrom)));
  installKernelEvaluator(loaded);
  initialised.add(loaded);
  return loaded;
}

/**
 * The kernel of the `@almadar/kernel` package this host installs, initialised synchronously with the language data
 * the packages under `languageFrom` declare. `languageFrom` is required; the first call in a process wins.
 */
export function initKernelSync(languageFrom: string): typeof installedModule {
  initOnce(installedModule, readFileSync(createRequire(import.meta.url).resolve('@almadar/kernel/kernel.wasm')), languageFrom);
  return installedModule;
}

/**
 * The kernel of the `@almadar/kernel` package this host installs, loaded once per process with the language data
 * the packages under `languageFrom` declare. A host with no package installed rejects, never falls back.
 */
export async function loadInstalledKernel(languageFrom: string): Promise<LoadedKernel> {
  return initKernelSync(languageFrom);
}

/**
 * The `http` effect's builder exports of the same package (`buildHttpRequest`, `isPublicAddress`, …): the
 * interpreter's only way to build a request. A directory that does not hold a built kernel rejects, never falls back.
 */
export async function loadHttpKernel(kernelDir: string, options: LoadKernelOptions): Promise<HttpKernel> {
  return loadKernel(kernelDir, options);
}

async function loadKernel(kernelDir: string, options: LoadKernelOptions): Promise<LoadedKernel> {
  const loaded: LoadedKernel = await import(pathToFileURL(join(kernelDir, 'pkg/orbital_wasm.js')).href);
  return initOnce(loaded, initialised.has(loaded) ? undefined : readFileSync(join(kernelDir, 'pkg/orbital_wasm_bg.wasm')), options.languageFrom);
}

/** The platform packages `@almadar/orb` ships its binaries in; each holds the native kernel add-on as `kernel.node`. */
const NATIVE_PLATFORMS: Record<string, string> = {
  'darwin-x64': 'darwin-x64',
  'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'win32-x64': 'windows-x64',
};

/**
 * Where the native kernel add-on is: `ALMADAR_KERNEL_NODE`, else `kernel.node` in the `@almadar/orb-<platform>-<arch>`
 * package this platform installs. Rejects when neither exists, so a host can fall back to the wasm kernel by choice.
 */
export function resolveNativeAddon(from: string): string {
  const named = process.env.ALMADAR_KERNEL_NODE;
  if (named !== undefined && named !== '') return named;
  const platform = NATIVE_PLATFORMS[`${process.platform}-${process.arch}`];
  if (platform === undefined) throw new Error(`no native kernel add-on is shipped for ${process.platform}-${process.arch}`);
  return createRequire(join(from, 'resolve.js')).resolve(`@almadar/orb-${platform}/kernel.node`);
}

/**
 * Loads the native kernel add-on (the same API as the wasm module, run as machine code) and installs the language data
 * the installed packages declare. The first install in a process wins.
 */
export async function loadNativeKernelModule(addonPath: string, options: LoadKernelOptions): Promise<LoadedKernel> {
  const loaded: LoadedKernel = createRequire(import.meta.url)(addonPath);
  return initOnce(loaded, undefined, options.languageFrom);
}
