/**
 * Compile a list of Tailwind classes to CSS at runtime, with this package's
 * preset — for hosts that render a schema whose classNames exist only as data
 * (a live preview, a runtime-interpreted app). Build-time Tailwind never saw
 * those classes, so arbitrary values like `w-[243px]` would paint nothing.
 *
 * Utilities only: no base styles, and none of the preset's safelist (the host
 * already ships those). Node-only; the host provides `tailwindcss` + `postcss`
 * (optional peer dependencies — every host already builds its CSS with them).
 */
const postcss = require('postcss');
const tailwindcss = require('tailwindcss');
const containerQueries = require('@tailwindcss/container-queries');
const { safelist: _safelist, ...preset } = require('./tailwind-preset.cjs');

/** @param {string[]} classes @returns {Promise<string>} */
async function compileTailwindClasses(classes) {
  if (classes.length === 0) return '';
  const config = {
    presets: [preset],
    plugins: [containerQueries],
    content: [{ raw: classes.join(' '), extension: 'html' }],
    corePlugins: { preflight: false },
  };
  const result = await postcss([tailwindcss(config)]).process('@tailwind utilities;', { from: undefined });
  return result.css.trim();
}

module.exports = { compileTailwindClasses };
