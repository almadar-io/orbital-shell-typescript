/**
 * Kernel loader
 *
 * Fetches and instantiates the WebAssembly client kernel (`@almadar/kernel/client`) once, for the renderer's
 * `KernelEngineProvider`, through the one browser loader (`@almadar/shell-browser/kernel-loader`) the Chrome worker also
 * uses. The language data is installed there, once; the engine never installs it again.
 *
 * @packageDocumentation
 */

import init, * as kernel from '@almadar/kernel/client';
import wasmUrl from '@almadar/kernel/client.wasm?url';
import { loadBrowserKernel } from '@almadar/shell-browser/kernel-loader';

export function loadKernel(): Promise<typeof kernel> {
  return loadBrowserKernel({
    init,
    glue: kernel,
    wasm: wasmUrl,
    language: `${import.meta.env.BASE_URL}language.json`,
  });
}
