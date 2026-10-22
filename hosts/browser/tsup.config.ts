import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
  "index": "src/index.ts",
  "auth/index": "src/auth/index.ts",
  "storage/index": "src/storage/index.ts",
  "kv": "src/kv.ts",
  "page-facts": "src/page-facts.ts"
},
  format: ['esm'],
  dts: true,
  splitting: true,
  clean: true,
});
