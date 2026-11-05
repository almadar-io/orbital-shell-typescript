/**
 * The one browser loader of the WebAssembly kernel (`@almadar/kernel/client`): where the `.wasm` is served from, and
 * where the language data its operators are routed by comes from. The web template's client and the generated Chrome
 * worker both load the kernel here; what they differ in is only the two locations they pass.
 *
 * @packageDocumentation
 */

/** The part of the kernel glue module a loader drives. */
export interface BrowserKernelGlue {
  /** Installs the language data (`LanguageBundle` as JSON) for a host with no `node_modules`; the first install wins. */
  installLanguage(bundleJson: string): void;
}

export interface BrowserKernelSource<Glue extends BrowserKernelGlue> {
  /** The glue module's default export: instantiates the WebAssembly from `module_or_path`. */
  readonly init: (input: { module_or_path: string }) => Promise<unknown>;
  /** The glue module namespace (`import * as glue from '@almadar/kernel/client'`). */
  readonly glue: Glue;
  /** Where the `.wasm` is served from. */
  readonly wasm: string;
  /** Where the language bundle is served from: every kernel evaluates through it. */
  readonly language: string;
}

async function fetchLanguage(location: string): Promise<string> {
  const response = await fetch(location);
  if (!response.ok) throw new Error(`${location}: ${response.status} ${response.statusText}`);
  return response.text();
}

/** The kernel module, initialised and with its language installed, once; the language downloads while the wasm instantiates. */
export async function loadBrowserKernel<Glue extends BrowserKernelGlue>(source: BrowserKernelSource<Glue>): Promise<Glue> {
  const [, language] = await Promise.all([source.init({ module_or_path: source.wasm }), fetchLanguage(source.language)]);
  source.glue.installLanguage(language);
  return source.glue;
}
