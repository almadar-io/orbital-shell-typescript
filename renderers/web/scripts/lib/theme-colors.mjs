/**
 * Shared theme-colour maths for the contrast audits: parse the
 * [data-theme="..."] blocks of the theme CSS, resolve var() aliases, and
 * measure WCAG contrast with translucent colours composited correctly.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function parseColor(raw) {
  const s = raw.trim();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(',').map(p => parseFloat(p));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  return null;
}

export function compositeOver(fg, bg) {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a: 1,
  };
}

function luminance({ r, g, b }) {
  const f = c => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(c1, c2) {
  const l1 = luminance(c1), l2 = luminance(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Every theme mode in `themesDir`: `{ file, name, color(varName) }` where `color` resolves aliases. */
export function loadThemeModes(themesDir, filter) {
  const files = readdirSync(themesDir).filter(f => f.endsWith('.css') && !f.startsWith('_') && f !== 'index.css' && (!filter || f === filter));
  const modes = [];
  for (const file of files.sort()) {
    const css = readFileSync(resolve(themesDir, file), 'utf8');
    for (const [, name, body] of css.matchAll(/\[data-theme="([^"]+)"\]\s*\{([^}]*)\}/gs)) {
      const vars = {};
      for (const decl of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[decl[1]] = decl[2].trim();
      const raw = (varName, depth = 0) => {
        const v = vars[varName];
        if (v === undefined || depth > 5) return undefined;
        const ref = v.match(/^var\((--[\w-]+)\)$/);
        return ref ? raw(ref[1], depth + 1) : v;
      };
      const color = (varName) => {
        const r = raw(varName);
        return r ? parseColor(r) : null;
      };
      modes.push({ file, name, raw, color });
    }
  }
  return modes;
}

/**
 * Contrast of `fg` text on `bg`, with translucent layers composited: the fill
 * over the theme background, then the text over the fill.
 */
export function pairContrast(mode, fg, bg) {
  const page = mode.color('--color-background');
  if (!fg || !bg) return null;
  let fill = bg;
  if (fill.a < 1 && page) fill = compositeOver(fill, page);
  let text = fg;
  if (text.a < 1) text = compositeOver(text, fill);
  return contrast(text, fill);
}
