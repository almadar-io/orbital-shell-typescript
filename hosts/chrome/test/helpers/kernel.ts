import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as kernel from '@almadar/kernel';

kernel.initSync({ module: readFileSync(createRequire(import.meta.url).resolve('@almadar/kernel/kernel.wasm')) });

/** The built `@almadar/kernel`, initialised: the credential vault the host tests run the real store through. */
export { kernel };
