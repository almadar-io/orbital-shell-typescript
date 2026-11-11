import { describe, it, expect } from 'vitest';
import { LEGIBLE_FIT_ZOOM, legibleFitViewport } from '../avl-legible-fit';

const frame = { width: 800, height: 600 };

describe('legibleFitViewport', () => {
  it('a graph far taller than the frame opens at the readable floor, framed on its start', () => {
    const viewport = legibleFitViewport({ x: 0, y: 0, width: 1920, height: 3600 }, frame, 0.08);
    expect(viewport?.zoom).toBe(LEGIBLE_FIT_ZOOM);
    expect(viewport?.y).toBeCloseTo(24);
    expect(28 * (viewport?.zoom ?? 0)).toBeGreaterThan(10);
  });

  it('control: a graph that fits at a readable scale is left to the whole-graph fit', () => {
    expect(legibleFitViewport({ x: 0, y: 0, width: 900, height: 500 }, frame, 0.08)).toBeNull();
  });

  it('edge: the axis that fits is centred while the overflowing one starts at its edge', () => {
    const viewport = legibleFitViewport({ x: 100, y: 50, width: 400, height: 6000 }, frame, 0.1);
    expect(viewport).toEqual({ x: (800 - 160) / 2 - 40, y: 30 - 20, zoom: LEGIBLE_FIT_ZOOM });
  });

  it('edge: a graph offset from the origin is framed on its own start, not on zero', () => {
    const viewport = legibleFitViewport({ x: 5000, y: 3000, width: 4000, height: 4000 }, frame, 0);
    expect(viewport).toEqual({ x: -2000, y: -1200, zoom: LEGIBLE_FIT_ZOOM });
  });

  it('edge: an empty graph or an unmeasured frame asks for nothing', () => {
    expect(legibleFitViewport({ x: 0, y: 0, width: 0, height: 0 }, frame, 0.1)).toBeNull();
    expect(legibleFitViewport({ x: 0, y: 0, width: 9000, height: 9000 }, { width: 0, height: 0 }, 0.1)).toBeNull();
  });

  it('control: a graph exactly at the floor is fitted whole', () => {
    expect(legibleFitViewport({ x: 0, y: 0, width: 2000, height: 100 }, frame, 0)).toBeNull();
  });
});
