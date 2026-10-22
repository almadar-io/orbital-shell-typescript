import { describe, it, expect } from 'vitest';
import { ciede2000, colorDifference, hexToLab, themeModes, toneColor, DIAGRAM_TONES, DIAGRAM_TONE_COLOR_KEYS, INDISTINCT_DELTA_E, type DiagramTone } from '../index';
import { THEME_PRESETS } from '../src/themes/index';

describe('ciede2000 (Sharma, Wu & Dalal 2005 reference pairs)', () => {
  const pairs: [[number, number, number], [number, number, number], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
  ];
  it.each(pairs)('%j vs %j = %f', (a, b, expected) => {
    expect(ciede2000(a, b)).toBeCloseTo(expected, 3);
    expect(ciede2000(b, a)).toBeCloseTo(expected, 3);
  });

  it('identical colors are 0 apart', () => {
    expect(ciede2000([40, 10, -20], [40, 10, -20])).toBe(0);
  });
});

describe('hexToLab / colorDifference', () => {
  it('white and black sit at the ends of lightness', () => {
    expect(hexToLab('#ffffff')?.[0]).toBeCloseTo(100, 1);
    expect(hexToLab('#000')?.[0]).toBeCloseTo(0, 1);
  });

  it('short, long and alpha hex forms agree', () => {
    expect(colorDifference('#f00', '#ff0000')).toBe(0);
    expect(colorDifference('#ff0000cc', '#ff0000')).toBe(0);
  });

  it('black vs white is the largest everyday difference', () => {
    expect(colorDifference('#000000', '#ffffff')).toBeCloseTo(100, 0);
  });

  it('control: a non-hex color is not measured', () => {
    expect(colorDifference('rgba(0,0,0,0.5)', '#000000')).toBeUndefined();
    expect(hexToLab('var(--color-primary)')).toBeUndefined();
  });
});

describe('themeModes / toneColor', () => {
  it('every tone names a color key', () => {
    for (const tone of DIAGRAM_TONES) expect(DIAGRAM_TONE_COLOR_KEYS[tone]).toMatch(/^[a-z0-9-]+$/);
  });

  it('a variant carries only its own colors, as its CSS block does', () => {
    const modes = themeModes('t', {
      name: 't',
      tokens: { colors: { 'diagram-ink': '#111111', 'series-1': '#ff0000' } },
      variants: { dark: { colors: { 'diagram-ink': '#eeeeee' } } },
    });
    expect(modes.map((m) => m.id)).toEqual(['t', 't:dark']);
    expect(toneColor(modes[1], 'ink')).toBe('#eeeeee');
    expect(toneColor(modes[1], 'series-1')).toBeUndefined();
    expect(toneColor(modes[0], 'series-1')).toBe('#ff0000');
    expect(toneColor(modes[0], 'highlight')).toBeUndefined();
  });

  it('edge: a dark-only theme (no base colors) yields only its variant', () => {
    const modes = themeModes('g', { name: 'g', tokens: {}, variants: { dark: { colors: { 'diagram-ink': '#eeeeee' } } } });
    expect(modes.map((m) => m.id)).toEqual(['g:dark']);
  });

  it('every preset mode resolves the meaning-bearing tones to hex colors', () => {
    const meaning = DIAGRAM_TONES.filter((t) => !['label', 'guide', 'axis', 'grid', 'fill'].includes(t));
    const missing: string[] = [];
    for (const [name, def] of Object.entries(THEME_PRESETS)) {
      for (const mode of themeModes(name, def)) {
        for (const tone of meaning) {
          const c = toneColor(mode, tone);
          if (!c || !hexToLab(c)) missing.push(`${mode.id}:${tone}=${c}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

/**
 * The roles a canvas draws meaning with, including the ones a canvas applies by default (a pointer is
 * `highlight`, a visited node `muted`, a bar `series-1`). Every theme keeps each pair apart, so no
 * simulation can lose a distinction to the theme. `primary`/`accent`/`info` are UI chrome, not drawing roles.
 */
const DRAWING_ROLES: readonly DiagramTone[] = ['ink', 'highlight', 'muted', 'success', 'warning', 'error', 'series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8'];

describe('every theme keeps the drawing roles apart', () => {
  it('no preset mode draws two drawing roles alike', () => {
    const collisions: string[] = [];
    for (const [name, def] of Object.entries(THEME_PRESETS)) {
      for (const mode of themeModes(name, def)) {
        for (let i = 0; i < DRAWING_ROLES.length; i++) {
          for (let j = i + 1; j < DRAWING_ROLES.length; j++) {
            const a = toneColor(mode, DRAWING_ROLES[i]);
            const b = toneColor(mode, DRAWING_ROLES[j]);
            const d = a && b ? colorDifference(a, b) : undefined;
            if (d !== undefined && d < INDISTINCT_DELTA_E) collisions.push(`${mode.id}: ${DRAWING_ROLES[i]} ${a} ≈ ${DRAWING_ROLES[j]} ${b} (ΔE ${d.toFixed(1)})`);
          }
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it('control: two roles drawn alike are reported', () => {
    const [mode] = themeModes('probe', { name: 'probe', tokens: { colors: { success: '#111111', error: '#121212' } } });
    expect(colorDifference(toneColor(mode, 'success') ?? '', toneColor(mode, 'error') ?? '')).toBeLessThan(INDISTINCT_DELTA_E);
  });
});
