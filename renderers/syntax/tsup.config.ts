import { defineConfig } from 'tsup';
import { copyFileSync } from 'fs';
import { resolve } from 'path';

export default defineConfig({
  entry: { index: 'src/index.ts', 'prism-orb': 'src/prism-orb.ts', colors: 'src/colors.ts', editor: 'src/editor/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  outDir: 'dist',
  async onSuccess() {
    // Copy tokens.json to dist for the "./tokens.json" export
    copyFileSync(
      resolve('src', 'tokens.json'),
      resolve('dist', 'tokens.json'),
    );
  },
});
