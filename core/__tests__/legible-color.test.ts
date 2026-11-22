/**
 * A colour drawn as text is made legible on the surfaces it sits on: unchanged when it already holds WCAG AA on every
 * one, else the nearest shade of the same hue that does (darker on light surfaces, lighter on dark ones).
 */
import { describe, it, expect } from 'vitest';
import { compositedOver, contrastRatio, legibleColor, MIN_TEXT_CONTRAST } from '../src/themes/contrast.js';

const LIGHT = ['#FFFFFF', '#FBF8EE', '#DFE9F0'];
const DARK = ['#1E1E1E'];

describe('legibleColor', () => {
  it('a colour too faint for light surfaces becomes a darker shade that reads on all of them', () => {
    const fixed = legibleColor('#36ACAA', LIGHT);
    for (const bg of LIGHT) expect(contrastRatio(fixed, bg)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(fixed).not.toBe('#36ACAA');
  });

  it('a colour too dim for a dark surface becomes a lighter shade', () => {
    const fixed = legibleColor('#6B7280', DARK);
    expect(contrastRatio(fixed, '#1E1E1E')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('control: a colour that already reads everywhere is returned as it is', () => {
    expect(legibleColor('#1F1D2B', LIGHT)).toBe('#1F1D2B');
  });

  it('edge: a value that is not an opaque colour is returned as it is', () => {
    expect(legibleColor('inherit', LIGHT)).toBe('inherit');
  });
});

describe('compositedOver', () => {
  it('a translucent rgba colour drawn over an opaque ground is the blend of the two', () => {
    expect(compositedOver('rgba(255, 255, 255, 0.5)', '#000000')).toBe('#808080');
  });

  it('control: an opaque colour is returned as it is', () => {
    expect(compositedOver('#123456', '#ffffff')).toBe('#123456');
  });

  it('control: a ground that is not an opaque colour leaves the colour as it is', () => {
    expect(compositedOver('rgba(255, 255, 255, 0.5)', 'transparent')).toBe('rgba(255, 255, 255, 0.5)');
  });
});
