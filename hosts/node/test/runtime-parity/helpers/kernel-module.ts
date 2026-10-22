import { fileURLToPath } from 'node:url';
import { readLanguageBundle } from '@almadar/core/language-data';
import { loadKernelModule } from '@almadar/shell-node';
import type { KernelModule } from '@almadar/shell-runtime';
import type { LoadedKernel } from '@almadar/shell-node';

/** The runtime package root: where its tests find the installed language data. */
export const PACKAGE_ROOT: string = fileURLToPath(new URL('../../..', import.meta.url));

/** The directory of the built `@almadar/kernel` package (the one holding `pkg/`); kernel suites skip without it. */
export const KERNEL_DIR: string | undefined = process.env.ALMADAR_KERNEL_DIR;

export function loadKernel(): Promise<LoadedKernel> {
  if (KERNEL_DIR === undefined) throw new Error('ALMADAR_KERNEL_DIR is not set');
  return loadKernelModule(KERNEL_DIR, { languageFrom: PACKAGE_ROOT });
}

/** The installed language as the bundle a browser host hands its kernel. */
export const TEST_LANGUAGE: string = JSON.stringify(readLanguageBundle(PACKAGE_ROOT));

let loaded: Promise<KernelModule> | undefined;

/** The built kernel, loaded once per test file. */
export function testKernel(): Promise<KernelModule> {
  return (loaded ??= loadKernel());
}

/** The built native kernel add-on (`kernel.node`); the native-engine suites skip without it. */
export const NATIVE_ADDON: string | undefined = process.env.ALMADAR_KERNEL_NODE;
