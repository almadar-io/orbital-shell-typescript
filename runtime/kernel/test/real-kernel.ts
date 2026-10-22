import { createRequire } from 'node:module';
import { readLanguageBundle } from '@almadar/core/language-data';
import type { KernelMemoryStoreExports } from '@almadar/core';
import type { KernelModule } from '../src/kernel/wire.js';

const require = createRequire(import.meta.url);
const languageBundleJson = JSON.stringify(readLanguageBundle(process.cwd()));

export function loadRealKernel(path: string): KernelModule & KernelMemoryStoreExports {
  const kernel: KernelModule & KernelMemoryStoreExports = require(path);
  kernel.installLanguage(languageBundleJson);
  return kernel;
}
