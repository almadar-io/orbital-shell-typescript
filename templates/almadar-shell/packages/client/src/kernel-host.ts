/**
 * Kernel loader
 *
 * Fetches and instantiates the WebAssembly client kernel (`@almadar/kernel/client`) once, for the renderer's
 * `KernelEngineProvider` (and `main.tsx`, which starts it at boot), through the one browser loader (`@almadar/shell-browser/kernel-loader`) the Chrome worker also
 * uses. The language data is installed there, once; the engine never installs it again.
 *
 * @packageDocumentation
 */

import init, * as kernel from '@almadar/kernel/client';
import wasmUrl from '@almadar/kernel/client.wasm?url';
import { createKernelInstance, type KernelInstance } from '@almadar/kernel/client/instance';
import { loadBrowserKernel, type IsolatingKernel } from '@almadar/shell-browser/kernel-loader';

let loaded: Promise<IsolatingKernel<typeof kernel, KernelInstance>> | undefined;

export function loadKernel(language: string): Promise<IsolatingKernel<typeof kernel, KernelInstance>> {
  loaded ??= loadBrowserKernel({
    init,
    glue: kernel,
    createInstance: createKernelInstance,
    wasm: wasmUrl,
    language: `${import.meta.env.BASE_URL}${language}`,
  }).catch((error: Error) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}
