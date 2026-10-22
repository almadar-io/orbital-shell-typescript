/**
 * G-RABIT-037: a theme override paints only the color tokens it carries over the app's theme (the
 * runtime maps `tokens.colors`, with a variant's `colors` layered over them in that mode), so an
 * override must be self-contained: real tokens, both sides of every contrast pair it touches, and
 * WCAG AA on each pair.
 */
import type { ThemeDefinition } from '../types/domain.js';
import { THEME_PRESETS } from './index.js';

/** WCAG AA for normal text. */
export const MIN_TEXT_CONTRAST = 4.5;

export interface ThemeOverrideIssue {
  token: string;
  /** `base` for `tokens.colors`; a variant name for that variant layered over it. */
  mode: string;
  message: string;
}

/** Every color token a preset declares — the vocabulary an override may set. */
function colorVocabulary(): Set<string> {
  const out = new Set<string>();
  for (const preset of Object.values(THEME_PRESETS)) {
    for (const key of Object.keys(preset.tokens.colors ?? {})) out.add(key);
    for (const variant of Object.values(preset.variants ?? {})) for (const key of Object.keys(variant.colors ?? {})) out.add(key);
  }
  return out;
}

/** Text-on-fill pairs: `X` with its `X-foreground`, and page text on the page and surface fills. */
function contrastPairs(vocabulary: ReadonlySet<string>): Array<[string, string]> {
  const pairs: Array<[string, string]> = [
    ['background', 'foreground'],
    ['surface', 'foreground'],
  ];
  for (const key of vocabulary) if (vocabulary.has(`${key}-foreground`)) pairs.push([key, `${key}-foreground`]);
  return pairs;
}

function opaqueRgb(color: string): [number, number, number] | null {
  const c = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((d) => d + d).join('') : hex[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(c);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two opaque colors (hex or `rgb()`); null when either is not one. */
export function contrastRatio(a: string, b: string): number | null {
  const ra = opaqueRgb(a);
  const rb = opaqueRgb(b);
  if (ra === null || rb === null) return null;
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function themeOverrideIssues(override: Partial<ThemeDefinition>): ThemeOverrideIssue[] {
  const vocabulary = colorVocabulary();
  const pairs = contrastPairs(vocabulary);
  const base = override.tokens?.colors ?? {};
  const layers: Array<{ mode: string; set: Record<string, string>; effective: Record<string, string> }> = [
    { mode: 'base', set: base, effective: base },
    ...Object.entries(override.variants ?? {}).map(([mode, v]) => ({ mode, set: v.colors ?? {}, effective: { ...base, ...(v.colors ?? {}) } })),
  ];
  const issues: ThemeOverrideIssue[] = [];
  for (const { mode, set, effective } of layers) {
    for (const token of Object.keys(set)) {
      if (!vocabulary.has(token)) issues.push({ token, mode, message: `"${token}" is not a theme color token` });
    }
    for (const [fill, text] of pairs) {
      if (!(fill in set) && !(text in set)) continue;
      const fillColor = effective[fill];
      const textColor = effective[text];
      if (fillColor === undefined || textColor === undefined) {
        issues.push({ token: fill, mode, message: `${fill} and ${text} are read together — set both` });
        continue;
      }
      const ratio = contrastRatio(fillColor, textColor);
      if (ratio === null) {
        issues.push({ token: fill, mode, message: `${fill} (${fillColor}) and ${text} (${textColor}) must be opaque hex or rgb() colors` });
      } else if (ratio < MIN_TEXT_CONTRAST) {
        issues.push({ token: fill, mode, message: `${text} on ${fill} is ${ratio.toFixed(2)}:1, below ${MIN_TEXT_CONTRAST}:1` });
      }
    }
  }
  return issues;
}
