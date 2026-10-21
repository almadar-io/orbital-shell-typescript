import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'test-support': 'src/test-support/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  splitting: true,
  treeshake: true,
});
