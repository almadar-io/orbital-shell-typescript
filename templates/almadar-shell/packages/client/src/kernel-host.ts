/**
 * Kernel loader
 *
 * Fetches and instantiates the WebAssembly client kernel (`@almadar/kernel/client`) once, for the renderer's
 * `KernelEngineProvider`, through the one browser loader (`@almadar/shell-browser/kernel-loader`) the Chrome worker also
 * uses. The language data is installed there, once, when the program ships it; the engine never installs it again.
 *
 * @packageDocumentation
 */

import init, * as kernel from '@almadar/kernel/client';
import wasmUrl from '@almadar/kernel/client.wasm?url';
import { loadBrowserKernel } from '@almadar/shell-browser/kernel-loader';

/** `language`: the program's manifest says it ships `language.json` (a kernel over browser-stored rows needs it). */
export function loadKernel(language: boolean): Promise<typeof kernel> {
  return loadBrowserKernel({
    init,
    glue: kernel,
    wasm: wasmUrl,
    ...(language ? { language: `${import.meta.env.BASE_URL}language.json` } : {}),
  });
}
