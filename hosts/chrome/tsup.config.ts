import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', content: 'src/host/content.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  splitting: true,
  treeshake: true,
});
