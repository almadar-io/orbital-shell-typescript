import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

/**
 * The program's locale messages (the compiled app's root `locales/`) at `/locales/<locale>.json`: served in dev and
 * copied into the build. The prebuilt program-independent client is built with ALMADAR_GENERIC_CLIENT=1 and carries
 * none: `orb serve` serves the program's.
 */
function programLocales(): Plugin {
  const dir = path.resolve(__dirname, '../../locales');
  const files = (): string[] => fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
  return {
    name: 'almadar-program-locales',
    configureServer(server) {
      server.middlewares.use('/locales', (req, res, next) => {
        const name = path.basename(req.url ?? '');
        if (!files().includes(name)) return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(fs.readFileSync(path.join(dir, name)));
      });
    },
    generateBundle() {
      for (const name of files()) this.emitFile({ type: 'asset', fileName: `locales/${name}`, source: fs.readFileSync(path.join(dir, name)) });
    },
  };
}

const CHUNKS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ['kernel', ['/node_modules/@almadar/kernel/']],
  ['react', ['/node_modules/react/', '/node_modules/react-dom/', '/node_modules/scheduler/']],
  ['firebase', ['/node_modules/firebase/', '/node_modules/@firebase/']],
];

function manualChunk(id: string): string | undefined {
  for (const [name, markers] of CHUNKS) {
    if (markers.some((marker) => id.includes(marker))) return name;
  }
  return undefined;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_API_URL || 'http://localhost:3030';
  const wsUrl = backendUrl.replace('http://', 'ws://').replace('https://', 'wss://');

  return {
    plugins: env.ALMADAR_GENERIC_CLIENT === '1' ? [react()] : [react(), programLocales()],

    resolve: {
      alias: {
        '@design-system': path.resolve(__dirname, '../../../design-system'),
        '@': path.resolve(__dirname, './src'),
        '@generated': path.resolve(__dirname, './src/generated'),
        '@pages': path.resolve(__dirname, './src/pages'),
        '@app/shared': path.resolve(__dirname, '../shared/src'),
        '@shared': path.resolve(__dirname, '../shared/src'),
      },
      // One copy of each package that carries React context or a global registry, also when @almadar/* are linked
      // from a workspace (scripts/build-web-client.mjs --workspace) and resolve their own.
      dedupe: ['react', 'react-dom', 'react-router-dom', 'firebase', '@tanstack/react-query', 'zustand', '@almadar/shell-web/components'],
    },

    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/ws': {
          target: wsUrl,
          ws: true,
        },
      },
    },

    build: {
      outDir: 'dist',
      sourcemap: mode === 'development',
      rollupOptions: {
        output: { manualChunks: manualChunk },
      },
    },

    test: {
      environment: 'jsdom',
      globals: true,
    },
  };
});
