import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { installKernelEvaluator, lazyKernelExports } from '@almadar/core';
import { readLanguageBundle } from '@almadar/core/language-data';
import * as kernel from '@almadar/kernel';

// The wasm is compiled on the first evaluation, so a test file that never evaluates pays nothing.
installKernelEvaluator(
  lazyKernelExports(() => {
    kernel.initSync({ module: readFileSync(createRequire(import.meta.url).resolve('@almadar/kernel/kernel.wasm')) });
    kernel.installLanguage(JSON.stringify(readLanguageBundle(process.cwd())));
    return kernel;
  }),
);
