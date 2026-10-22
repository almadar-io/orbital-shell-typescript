/**
 * Resolves drawing tones to a theme preset's colors and measures how far apart two colors look, so a
 * test can prove that the tones a simulation tells apart stay distinguishable in every theme.
 */

import { DIAGRAM_TONE_COLOR_KEYS, type DiagramTone } from '../types/canvas-theme.js';
import type { ThemeDefinition } from '../types/domain.js';

/** Two marks closer than this (CIEDE2000) read as the same color. */
export const INDISTINCT_DELTA_E = 10;

export interface ThemeMode {
  /** `<theme>` for the base tokens, `<theme>:<variant>` for a variant. */
  id: string;
  colors: Readonly<Record<string, string>>;
}

/**
 * The base mode plus every variant, as the theme CSS emits them: a variant block carries only its own
 * colors (a key it omits falls back to the CSS defaults, not to the base). A base that declares no
 * colors is not a designed mode (it renders the app's default palette), so it is left out.
 */
export function themeModes(name: string, theme: ThemeDefinition): ThemeMode[] {
  const base = theme.tokens.colors ?? {};
  const modes: ThemeMode[] = Object.keys(base).length > 0 ? [{ id: name, colors: base }] : [];
  for (const [variant, v] of Object.entries(theme.variants ?? {})) modes.push({ id: `${name}:${variant}`, colors: v.colors ?? {} });
  return modes;
}

/** The mode's color for a tone, or undefined when the theme leaves it to the CSS defaults. */
export function toneColor(mode: ThemeMode, tone: DiagramTone): string | undefined {
  return mode.colors[DIAGRAM_TONE_COLOR_KEYS[tone]];
}

export type Lab = readonly [number, number, number];

/** sRGB hex (`#rgb`, `#rrggbb`, alpha ignored) to CIE L*a*b* (D65). Undefined for any other form. */
export function hexToLab(hex: string): Lab | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return undefined;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1].slice(0, 6);
  const lin = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin(0), lin(2), lin(4)];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const fy = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const fz = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 color difference (Sharma, Wu & Dalal 2005). */
export function ciede2000(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h >= 0 ? h : h + 360;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * rad) +
    0.24 * Math.cos(2 * hbarp * rad) +
    0.32 * Math.cos((3 * hbarp + 6) * rad) -
    0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7;
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}

/** CIEDE2000 between two hex colors; undefined when either is not a hex color. */
export function colorDifference(a: string, b: string): number | undefined {
  const la = hexToLab(a);
  const lb = hexToLab(b);
  return la && lb ? ciede2000(la, lb) : undefined;
}
