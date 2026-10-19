/**
 * Kernel loader
 *
 * Fetches and instantiates the WebAssembly client kernel (`@almadar/kernel/client`) once, for the renderer's
 * `KernelEngineProvider`.
 *
 * @packageDocumentation
 */

import init, * as kernel from '@almadar/kernel/client';
import wasmUrl from '@almadar/kernel/client.wasm?url';

export async function loadKernel(): Promise<typeof kernel> {
  await init({ module_or_path: wasmUrl });
  return kernel;
}

/** The language bundle the kernel a browser opens over its browser-stored rows installs, fetched when that kernel opens. */
export async function loadLanguage(): Promise<string> {
  const response = await fetch(`${import.meta.env.BASE_URL}language.json`);
  if (!response.ok) throw new Error(`language.json: ${response.status} ${response.statusText}`);
  return response.text();
}
