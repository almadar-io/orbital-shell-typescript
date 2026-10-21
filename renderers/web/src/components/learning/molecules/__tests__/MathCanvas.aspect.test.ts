/**
 * A geometry plot keeps circles round: `aspect: 'equal'` maps both axes with one scale and centres
 * the plot box; `fit` keeps the two ranges filling the plot (function plots).
 */
import { describe, it, expect } from 'vitest';
import { plotTransform } from '../MathCanvas';

describe('MathCanvas plotTransform', () => {
  it('equal: one scale for both axes, so a unit circle maps to a circle', () => {
    const t = plotTransform(600, 400, -9, 9, -7, 7, 'equal');
    expect(t.sx).toBeCloseTo(t.sy);
    const rx = t.mapX(1) - t.mapX(0);
    const ry = t.mapY(0) - t.mapY(1);
    expect(rx).toBeCloseTo(ry);
  });

  it('equal: the narrower dimension is filled and the plot box is centred in the other', () => {
    const t = plotTransform(600, 400, -9, 9, -7, 7, 'equal');
    expect(t.top).toBeCloseTo(24);
    expect(t.bottom).toBeCloseTo(376);
    expect((t.left + t.right) / 2).toBeCloseTo(300);
  });

  it('control: fit stretches each range across the plot', () => {
    const t = plotTransform(600, 400, -9, 9, -7, 7, 'fit');
    expect(t.left).toBeCloseTo(24);
    expect(t.right).toBeCloseTo(576);
    expect(t.sx).not.toBeCloseTo(t.sy);
  });

  it('edge: the corners of the world range land on the plot box in both modes', () => {
    for (const aspect of ['fit', 'equal'] as const) {
      const t = plotTransform(600, 400, 0, 20, -1, 1, aspect);
      expect(t.mapX(0)).toBeCloseTo(t.left);
      expect(t.mapX(20)).toBeCloseTo(t.right);
      expect(t.mapY(-1)).toBeCloseTo(t.bottom);
      expect(t.mapY(1)).toBeCloseTo(t.top);
    }
  });
});
