/**
 * Code is text: every token colour of the light palette reads at WCAG AA (4.5:1) on the light surfaces a code block
 * paints, the highlighted-line tint included, and every dark-palette colour on the dark block.
 */
import { describe, it, expect } from 'vitest';
import { CODE_SURFACES, ORB_COLORS } from '../colors';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const LIGHT_SURFACES = CODE_SURFACES.light;
const DARK_SURFACES = CODE_SURFACES.dark;

describe('syntax palette contrast', () => {
  it('every light token colour holds 4.5:1 on every light code surface', () => {
    const failing = Object.entries(ORB_COLORS.light).flatMap(([token, color]) =>
      LIGHT_SURFACES.filter((bg) => contrast(color, bg) < 4.5).map((bg) => `${token} ${color} on ${bg}: ${contrast(color, bg).toFixed(2)}`));
    expect(failing).toEqual([]);
  });

  it('every dark token colour holds 4.5:1 on the dark code block', () => {
    const failing = Object.entries(ORB_COLORS.dark).flatMap(([token, color]) =>
      DARK_SURFACES.filter((bg) => contrast(color, bg) < 4.5).map((bg) => `${token} ${color} on ${bg}: ${contrast(color, bg).toFixed(2)}`));
    expect(failing).toEqual([]);
  });
});
