import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const uiDist = join(dirname(require.resolve('@almadar/shell-web/package.json')), 'dist', '**', '*.js');

/** @type {import('tailwindcss').Config} */
export default {
  presets: [require('@almadar/shell-web/tailwind-preset')],
  content: ['./panel.html', './src/**/*.{ts,tsx}', uiDist],
  plugins: [require('@tailwindcss/container-queries')],
};
