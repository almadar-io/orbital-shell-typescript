import { defineConfig } from 'tsup';
import { ensureUseClient } from './scripts/lib/ensure-use-client.mjs';

// `build:dev` skips declarations (the slow step); `build` always emits them.
const emitDts = process.env.SHELL_WEB_SKIP_DTS !== '1';

const REACT_EXTERNAL = ['react', 'react-dom', 'react-router-dom', 'react/jsx-runtime', '@tanstack/react-query'];

const ESM_ENTRIES = {
  index: 'src/index.ts',
  'test-support': 'src/test-support/index.ts',
  core: 'src/core/index.ts',
  'components/index': 'src/components/index.ts',
  'hooks/index': 'src/hooks/index.ts',
  'providers/index': 'src/providers/index.ts',
  'context/index': 'src/context/index.ts',
  'renderer/index': 'src/renderer/index.ts',
  'runtime/index': 'src/preview/index.ts',
  'lib/index': 'src/lib/index.ts',
  'three/index': 'src/lib/drawable/three/index.ts',
  'avl/index': 'src/avl/index.ts',
  'storage/browser/index': 'src/storage/browser/index.ts',
  'auth/browser/index': 'src/auth/browser/index.ts',
  'auth/react/index': 'src/auth/react/index.tsx',
};

export default defineConfig([
  // Every ESM entry in ONE build that shares chunks: a module reached from several entries ships
  // once, so each React context, provider store and kernel singleton exists once per app.
  {
    entry: ESM_ENTRIES,
    format: ['esm'],
    dts: emitDts,
    clean: false,
    sourcemap: false,
    splitting: true,
    treeshake: true,
    external: REACT_EXTERNAL,
    banner: { js: '"use client";' },
    onSuccess: async () => ensureUseClient('dist', Object.keys(ESM_ENTRIES), 'js'),
  },
  // SSR-safe subset for Docusaurus/webpack sites (ESM + CJS, self-contained).
  {
    entry: { 'ssr/index': 'src/ssr/index.ts' },
    format: ['esm', 'cjs'],
    dts: emitDts,
    clean: false,
    sourcemap: false,
    splitting: false,
    treeshake: true,
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'],
    noExternal: ['clsx', 'tailwind-merge'],
    banner: { js: '"use client";' },
    onSuccess: async () => {
      ensureUseClient('dist', ['ssr/index'], 'js');
      ensureUseClient('dist', ['ssr/index'], 'cjs');
    },
  },
  // Design-class vocabulary: plain functions, loaded by the Tailwind preset's CJS require.
  {
    entry: { 'design-classes/index': 'src/lib/design-classes.ts' },
    format: ['esm', 'cjs'],
    dts: emitDts,
    clean: false,
    sourcemap: false,
    splitting: false,
    treeshake: true,
  },
]);
