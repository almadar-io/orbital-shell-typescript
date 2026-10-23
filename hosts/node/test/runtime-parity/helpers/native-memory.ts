import { describe } from 'vitest';
import { NativeMemoryPersistenceAdapter } from '@almadar/shell-runtime';
import { loadNativeKernelModule, type LoadedKernel } from '../../../src/kernel-loader.js';
import { PACKAGE_ROOT } from './kernel-module.js';

/** The kernel build whose `MemoryStore` these suites keep rows in: the native add-on, else the memory-capable wasm. */
export const MEMORY_KERNEL_PATH: string | undefined = [process.env.ORBITAL_KERNEL_NODE, process.env.ORBITAL_KERNEL_MEMORY_WASM].find((path) => path !== undefined && path !== '');

/** A suite that needs a kernel with a `MemoryStore`; skipped without `ORBITAL_KERNEL_NODE` or `ORBITAL_KERNEL_MEMORY_WASM`. */
export const describeWithMemoryKernel = describe.skipIf(MEMORY_KERNEL_PATH === undefined);

let loaded: Promise<LoadedKernel> | undefined;

/** The memory-capable kernel, loaded once per test file. */
export function memoryKernel(): Promise<LoadedKernel> {
  if (MEMORY_KERNEL_PATH === undefined) throw new Error('ORBITAL_KERNEL_NODE or ORBITAL_KERNEL_MEMORY_WASM is not set');
  return (loaded ??= loadNativeKernelModule(MEMORY_KERNEL_PATH, { languageFrom: PACKAGE_ROOT }));
}

/** A row store the kernel holds itself, as a host keeps rows with no database. */
export async function nativeMemory(): Promise<NativeMemoryPersistenceAdapter> {
  const kernel = await memoryKernel();
  return new NativeMemoryPersistenceAdapter(new kernel.MemoryStore());
}
