import { createRequire } from 'node:module';
import containerQueries from '@tailwindcss/container-queries';

const require = createRequire(import.meta.url);
// Single source of truth for the Layer 1 token surface (spacing, fontSize,
// height/minHeight/width, fontFamily, colors, borderRadius, borderWidth,
// boxShadow, fontWeight, transitionDuration/Timing) AND the Layer 2 intent
// utilities (rounded-container/interactive/pill, h-button-*, h-input-*,
// h-row-*, h-icon-default, p-card-*, p-dialog, p-section, shadow-elevation-*).
//
// Storybook and consumers must both go through this preset; inlining a
// shadow theme here is what made Layer 2 look identical across variants
// (2026-05-26 regression — see commit history).
const almadarPreset = require('./tailwind-preset.cjs');

/** @type {import('tailwindcss').Config} */
export default {
  presets: [almadarPreset],
  content: [
    './components/**/*.{js,ts,jsx,tsx}',
    '../../orbital-rust/crates/orbital-shell-typescript/renderers/web/src/core/**/*.{js,ts,jsx,tsx}',
    './clients/**/*.{js,ts,jsx,tsx}',
    './.storybook/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  plugins: [containerQueries],
};
