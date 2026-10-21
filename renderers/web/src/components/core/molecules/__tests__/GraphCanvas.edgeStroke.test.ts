import { describe, it, expect } from 'vitest';
import { edgeStroke } from '../GraphCanvas';

const strokes = { thin: 1, normal: 2, bold: 3 };
const linkOpacity = 0.18;

describe('GraphCanvas edgeStroke', () => {
  it('never lets weight change opacity, so a weak drawn edge stays visible', () => {
    for (const weight of [0.01, 0.1, 0.375, 1]) {
      expect(edgeStroke(weight, linkOpacity, strokes).alpha).toBe(linkOpacity);
    }
  });

  it('maps weight onto width between the thin and normal strokes', () => {
    expect(edgeStroke(0, linkOpacity, strokes).width).toBe(1);
    expect(edgeStroke(0.5, linkOpacity, strokes).width).toBe(1.5);
    expect(edgeStroke(1, linkOpacity, strokes).width).toBe(2);
    expect(edgeStroke(0.4, linkOpacity, strokes).width).toBeLessThan(edgeStroke(0.6, linkOpacity, strokes).width);
  });

  it('clamps weights outside 0..1', () => {
    expect(edgeStroke(2, linkOpacity, strokes).width).toBe(2);
    expect(edgeStroke(-1, linkOpacity, strokes).width).toBe(1);
  });

  it('control: an unweighted edge draws as before, thin at the link opacity', () => {
    expect(edgeStroke(undefined, linkOpacity, strokes)).toEqual({ alpha: linkOpacity, width: 1 });
  });
});
