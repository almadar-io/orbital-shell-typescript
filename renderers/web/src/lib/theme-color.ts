/**
 * theme-color — resolve a theme color expression (`var(--color-*)`, `color-mix(…)`)
 * to a concrete sRGB value for surfaces that cannot evaluate CSS themselves:
 * canvas 2D `fillStyle` and three.js materials. SVG and DOM take the expression
 * as-is and never need this.
 *
 * @packageDocumentation
 */

import { createLogger } from '@almadar/logger';

const log = createLogger('almadar:ui:theme-color');

export interface ResolvedColor {
  r: number;
  g: number;
  b: number;
  a: number;
  /** Opaque `rgb(r, g, b)`; alpha is carried separately in `a`. */
  css: string;
}

/** The theme's categorical palette (`--color-series-1…8`) — the one palette every chart/diagram shares; no status meaning. */
export const THEME_SERIES: readonly string[] = [
  'var(--color-series-1)',
  'var(--color-series-2)',
  'var(--color-series-3)',
  'var(--color-series-4)',
  'var(--color-series-5)',
  'var(--color-series-6)',
  'var(--color-series-7)',
  'var(--color-series-8)',
];

function channel(value: string, unitScale: number): number {
  return Math.round(Math.min(255, Math.max(0, Number(value) * unitScale)));
}

function make(r: number, g: number, b: number, a: number): ResolvedColor {
  return { r, g, b, a, css: `rgb(${r}, ${g}, ${b})` };
}

function gamma(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
}

/** OKLab → sRGB (Björn Ottosson's reference matrices). */
function fromOklab(L: number, a: number, b: number, alpha: number): ResolvedColor {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return make(
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha,
  );
}

/** A CSS number or percentage component; `none` reads as 0. `percentOf` is the value 100% stands for. */
function component(raw: string, percentOf: number): number {
  if (raw === 'none') return 0;
  return raw.endsWith('%') ? (Number(raw.slice(0, -1)) / 100) * percentOf : Number(raw);
}

const NUM = '(none|-?[\\d.]+(?:e-?\\d+)?%?)';
const OKLCH = new RegExp(`^oklch\\(\\s*${NUM}\\s+${NUM}\\s+${NUM}(?:deg)?\\s*(?:\\/\\s*${NUM}\\s*)?\\)$`, 'i');
const OKLAB = new RegExp(`^oklab\\(\\s*${NUM}\\s+${NUM}\\s+${NUM}\\s*(?:\\/\\s*${NUM}\\s*)?\\)$`, 'i');

/** Parse the color serializations a browser's computed style produces. Null when unsupported. */
export function parseComputedColor(value: string): ResolvedColor | null {
  const v = value.trim();
  const lch = OKLCH.exec(v);
  if (lch) {
    const hue = (component(lch[3], 360) * Math.PI) / 180;
    const chroma = component(lch[2], 0.4);
    return fromOklab(component(lch[1], 1), chroma * Math.cos(hue), chroma * Math.sin(hue), lch[4] === undefined ? 1 : component(lch[4], 1));
  }
  const lab = OKLAB.exec(v);
  if (lab) {
    return fromOklab(component(lab[1], 1), component(lab[2], 0.4), component(lab[3], 0.4), lab[4] === undefined ? 1 : component(lab[4], 1));
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return make(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1);
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (rgb) {
    return make(channel(rgb[1], 1), channel(rgb[2], 1), channel(rgb[3], 1), rgb[4] === undefined ? 1 : Number(rgb[4]));
  }
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (srgb) {
    return make(channel(srgb[1], 255), channel(srgb[2], 255), channel(srgb[3], 255), srgb[4] === undefined ? 1 : Number(srgb[4]));
  }
  return null;
}

const SENTINEL = 'rgb(1, 2, 3)';

function getComputedSentinel(doc: Document): string {
  const s = doc.createElement('span');
  s.style.display = 'none';
  s.style.color = SENTINEL;
  doc.body.appendChild(s);
  const c = getComputedStyle(s).color;
  doc.body.removeChild(s);
  return c;
}

/**
 * Resolve `value` as it computes inside `scope` (so the scope's `data-theme`
 * applies). Null — and a logged error — when the value does not compute.
 */
export function resolveThemeColor(value: string, scope: Element): ResolvedColor | null {
  const doc = scope.ownerDocument;
  // An undefined var() is invalid at computed-value time and silently inherits;
  // the sentinel parent makes that inheritance detectable.
  const wrapper = doc.createElement('span');
  wrapper.style.display = 'none';
  wrapper.style.color = SENTINEL;
  const probe = doc.createElement('span');
  probe.style.color = value;
  wrapper.appendChild(probe);
  scope.appendChild(wrapper);
  const computed = probe.style.color === '' ? '' : getComputedStyle(probe).color;
  scope.removeChild(wrapper);
  const parsed = computed === getComputedSentinel(doc) ? null : parseComputedColor(computed);
  if (!parsed) log.error('unresolvable-theme-color', { value, computed });
  return parsed;
}
