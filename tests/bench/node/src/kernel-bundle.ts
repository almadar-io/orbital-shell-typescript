import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import type { BundleFile } from './types.js';

/** What `@almadar/kernel` ships as its runtime: the wasm module and the wasm-bindgen glue. */
export const KERNEL_RUNTIME_FILES = ['pkg/orbital_wasm_bg.wasm', 'pkg/orbital_wasm.js'] as const;

export async function bundleSizes(kernelDir: string): Promise<BundleFile[]> {
  const files: BundleFile[] = [];
  for (const file of KERNEL_RUNTIME_FILES) {
    const bytes = await readFile(join(kernelDir, file));
    files.push({
      file,
      rawBytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
      brotliBytes: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    });
  }
  const sum = (pick: (f: BundleFile) => number): number => files.reduce((n, f) => n + pick(f), 0);
  return [...files, { file: 'total', rawBytes: sum((f) => f.rawBytes), gzipBytes: sum((f) => f.gzipBytes), brotliBytes: sum((f) => f.brotliBytes) }];
}
