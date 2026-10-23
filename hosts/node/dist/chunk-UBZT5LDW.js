import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { installKernelEvaluator } from '@almadar/core';
import { readLanguageBundle } from '@almadar/core/language-data';
import * as installedModule from '@almadar/kernel';
import { NativeMemoryPersistenceAdapter } from '@almadar/shell-runtime';

// src/kernel-loader.ts
function hasMemoryStore(kernel) {
  return "MemoryStore" in kernel;
}
function nativeMemoryOf(kernel) {
  if (!hasMemoryStore(kernel)) throw new Error("this kernel module exports no MemoryStore; install a kernel build that carries it");
  return new NativeMemoryPersistenceAdapter(new kernel.MemoryStore());
}
async function loadKernelModule(kernelDir, options) {
  return loadKernel(kernelDir, options);
}
var initialised = /* @__PURE__ */ new WeakSet();
function initOnce(loaded, wasm, languageFrom) {
  if (initialised.has(loaded)) return loaded;
  if (wasm !== void 0) loaded.initSync({ module: wasm });
  loaded.installLanguage(JSON.stringify(readLanguageBundle(languageFrom)));
  installKernelEvaluator(loaded);
  initialised.add(loaded);
  return loaded;
}
function initKernelSync(languageFrom) {
  initOnce(installedModule, readFileSync(createRequire(import.meta.url).resolve("@almadar/kernel/kernel.wasm")), languageFrom);
  return installedModule;
}
async function loadInstalledKernel(languageFrom) {
  return initKernelSync(languageFrom);
}
async function loadHttpKernel(kernelDir, options) {
  return loadKernel(kernelDir, options);
}
async function loadKernel(kernelDir, options) {
  const loaded = await import(pathToFileURL(join(kernelDir, "pkg/orbital_wasm.js")).href);
  return initOnce(loaded, initialised.has(loaded) ? void 0 : readFileSync(join(kernelDir, "pkg/orbital_wasm_bg.wasm")), options.languageFrom);
}
var NATIVE_PLATFORMS = {
  "darwin-x64": "darwin-x64",
  "darwin-arm64": "darwin-arm64",
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
  "win32-x64": "windows-x64"
};
function resolveNativeAddon(from) {
  const named = process.env.ALMADAR_KERNEL_NODE;
  if (named !== void 0 && named !== "") return named;
  const platform = NATIVE_PLATFORMS[`${process.platform}-${process.arch}`];
  if (platform === void 0) throw new Error(`no native kernel add-on is shipped for ${process.platform}-${process.arch}`);
  return createRequire(join(from, "resolve.js")).resolve(`@almadar/orb-${platform}/kernel.node`);
}
async function loadNativeKernelModule(addonPath, options) {
  const loaded = createRequire(import.meta.url)(addonPath);
  return initOnce(loaded, void 0, options.languageFrom);
}

export { initKernelSync, loadHttpKernel, loadInstalledKernel, loadKernelModule, loadNativeKernelModule, nativeMemoryOf, resolveNativeAddon };
