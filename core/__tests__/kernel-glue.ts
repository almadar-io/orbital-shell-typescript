import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installKernelEvaluator, type KernelEvaluatorExports } from '../src/kernel-evaluator.js';

interface WasmGlue extends KernelEvaluatorExports {
  initSync(input: { module: Buffer }): void;
}

const resolveInstalled = createRequire(import.meta.url).resolve;

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

/** Load the kernel's wasm and install its evaluator, as a host does; the tests that need the kernel's verdicts call this. */
export async function installTestKernel(): Promise<void> {
  if (!kernelAvailable()) {
    throw new Error('the kernel wasm is not reachable: install @almadar/kernel or point ALMADAR_KERNEL_DIR at a kernel build');
  }
  const files = kernelFiles();
  const glue: WasmGlue = await import(/* @vite-ignore */ pathToFileURL(files.glue).href);
  glue.initSync({ module: readFileSync(files.wasm) });
  installKernelEvaluator(glue);
}
