import { describe, expect, it } from 'vitest';
import { resolveGameFontFamily } from '../gameFonts';

describe('shared game font families', () => {
  it('resolves authored aliases and preserves CSS family values', () => {
    expect(resolveGameFontFamily('future-narrow')).toBe(
      "'Kenney Future Narrow', ui-sans-serif, system-ui, sans-serif",
    );
    expect(resolveGameFontFamily("'My Font', serif")).toBe("'My Font', serif");
  });
});
