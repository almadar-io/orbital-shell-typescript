import { describe, it, expect } from 'vitest';
import { THEME_PRESETS } from '../src/themes/index.js';
import { compositedOver, contrastRatio, legibleColor, MIN_TEXT_CONTRAST } from '../src/themes/contrast.js';

type Mode = { id: string; colors: Record<string, string> };

const MODES: Mode[] = Object.entries(THEME_PRESETS).flatMap(([theme, def]) => {
  const base = def.tokens.colors ?? {};
  const dark = def.variants?.dark?.colors;
  return [
    ...(Object.keys(base).length > 0 ? [{ id: `${theme}/light`, colors: base }] : []),
    ...(dark ? [{ id: `${theme}/dark`, colors: { ...base, ...dark } }] : []),
  ];
});

const surfaces = (c: Record<string, string>): string[] => [compositedOver(c.card!, c.background!), c.background!];
const reads = (color: string, c: Record<string, string>): boolean => surfaces(c).every((bg) => (contrastRatio(color, bg) ?? 0) >= MIN_TEXT_CONTRAST);

// A light card on a dark ground: no shade of the hue reads on both, so primary-text stays primary (G-CROSS-796).
const SPLIT_SURFACES = ['game-adventure/dark', 'game-ui-pack/dark', 'win95/light'];

describe('primary-text', () => {
  it('every preset mode declares primary-text as primary taken to AA on its card and background', () => {
    expect(MODES.length).toBeGreaterThan(100);
    const wrong = MODES.filter(({ id }) => !SPLIT_SURFACES.includes(id)).flatMap(({ id, colors }) => {
      const expected = legibleColor(colors.primary!, surfaces(colors));
      return colors['primary-text'] === expected ? [] : [`${id}: ${colors['primary-text']} != ${expected}`];
    });
    expect(wrong).toEqual([]);
  });

  it('primary-text reads at AA on the card and the background of every mode but the split-surface ones', () => {
    expect(MODES.filter(({ colors }) => !reads(colors['primary-text']!, colors)).map(({ id }) => id).sort()).toEqual(SPLIT_SURFACES);
  });

  it('control: a split-surface mode keeps primary, since the nearest shade reads on neither of both surfaces', () => {
    for (const id of SPLIT_SURFACES) {
      const mode = MODES.find((m) => m.id === id)!;
      expect(mode.colors['primary-text'], id).toBe(mode.colors.primary);
      expect(reads(legibleColor(mode.colors.primary!, surfaces(mode.colors)), mode.colors), id).toBe(false);
    }
  });

  it('control: a mode whose primary already reads at AA keeps primary as its text colour', () => {
    const passing = MODES.filter(({ colors }) => reads(colors.primary!, colors));
    expect(passing.length).toBeGreaterThan(90);
    expect(passing.filter(({ colors }) => colors['primary-text'] !== colors.primary).map(({ id }) => id)).toEqual([]);
  });

  it('control: risograph light, whose pink fails on cream, gets a darker pink', () => {
    const riso = MODES.find(({ id }) => id === 'risograph/light')!;
    expect(riso.colors.primary).toBe('#ff48b0');
    expect(riso.colors['primary-text']).toBe('#D7007A');
  });
});
