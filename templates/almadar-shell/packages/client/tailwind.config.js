import { createRequire } from 'module';
import { dirname, join } from 'path';
const require = createRequire(import.meta.url);

// Resolve @almadar/shell-web dist regardless of node_modules hoisting
const uiDist = join(dirname(require.resolve('@almadar/shell-web/package.json')), 'dist', '**', '*.js');

// @almadar/shell-web's DashboardLayout (sidebar / topnav / bottomnav modes) and
// several molecules use container-query Tailwind variants (`@md/dashboard:flex`,
// `@sm/dashboard:block`, etc.). Without this plugin Tailwind silently drops
// every `@*/dashboard:*` class and the chrome renders as a blank top-bar with
// action icons collapsed to the left (no nav, no search, no app title).
const containerQueries = require('@tailwindcss/container-queries');

/** @type {import('tailwindcss').Config} */
export default {
  // Single source of truth for Layer 1 + Layer 2 token mappings is
  // @almadar/shell-web's published preset. Don't fork a local copy — it goes
  // stale silently and breaks look variants without any build error.
  presets: [require('@almadar/shell-web/tailwind-preset')],
  // `tailwind-content.txt` is every className token of the installed behaviors, written by
  // `almadar-sync renderer-css` (tools/almadar-pattern-sync): the program's classes arrive at runtime,
  // so the utilities they use must already be in the stylesheet.
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./tailwind-content.txt",
    uiDist,
  ],
  theme: {
    extend: {},
  },
  plugins: [containerQueries],
}
