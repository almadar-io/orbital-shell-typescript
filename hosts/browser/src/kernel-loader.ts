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

export interface BrowserKernelSource<Glue extends BrowserKernelGlue, Instance extends BrowserKernelGlue> {
  /** The glue module's default export: instantiates the WebAssembly from `module_or_path`. */
  readonly init: (input: { module_or_path: WebAssembly.Module }) => Promise<unknown>;
  /** The glue module namespace (`import * as glue from '@almadar/kernel/client'`). */
  readonly glue: Glue;
  /** `@almadar/kernel/client/instance`'s `createKernelInstance`: one more instance of the kernel with its own memory. */
  readonly createInstance: (module: WebAssembly.Module, languageBundle: string) => Promise<Instance>;
  /** Where the `.wasm` is served from. */
  readonly wasm: string;
  /** Where the language bundle is served from: every kernel evaluates through it. */
  readonly language: string;
}

/** A loaded kernel module that can make another instance of itself: its own memory, freed once nothing references it (G-ORBITAL-WASM-009). */
export type IsolatingKernel<Module extends BrowserKernelGlue, Instance extends BrowserKernelGlue> = Module & {
  isolate(): Promise<IsolatingKernel<Instance, Instance>>;
};

async function fetchOk(location: string): Promise<Response> {
  const response = await fetch(location);
  if (!response.ok) throw new Error(`${location}: ${response.status} ${response.statusText}`);
  return response;
}

/** The kernel module, compiled and initialised with its language installed, once; the language downloads while the wasm compiles. */
export async function loadBrowserKernel<Glue extends BrowserKernelGlue, Instance extends BrowserKernelGlue>(
  source: BrowserKernelSource<Glue, Instance>,
): Promise<IsolatingKernel<Glue, Instance>> {
  const [module, language] = await Promise.all([
    fetchOk(source.wasm).then((response) => response.arrayBuffer()).then((bytes) => WebAssembly.compile(bytes)),
    fetchOk(source.language).then((response) => response.text()),
  ]);
  await source.init({ module_or_path: module });
  source.glue.installLanguage(language);
  const isolating = <M extends BrowserKernelGlue>(loaded: M): IsolatingKernel<M, Instance> => ({
    ...loaded,
    isolate: () => source.createInstance(module, language).then(isolating),
  });
  return isolating(source.glue);
}
