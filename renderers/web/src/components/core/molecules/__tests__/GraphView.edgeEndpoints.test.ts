import { describe, it, expect } from 'vitest';
import { edgeEndpoints, EDGE_ARROW_GAP } from '../GraphView';

const node = (x: number, y: number, size: number) => ({ x, y, size });

describe('edgeEndpoints keeps the arrowhead outside the target circle', () => {
  it('a vertical edge runs from the source rim to just outside the target rim', () => {
    const e = edgeEndpoints(node(100, 0, 10), node(100, 200, 20));
    expect(e).toEqual({ x1: 100, y1: 10, x2: 100, y2: 200 - 20 - EDGE_ARROW_GAP });
  });

  it('a horizontal edge pointing left trims both ends along the line', () => {
    const e = edgeEndpoints(node(300, 50, 8), node(0, 50, 12));
    expect(e).toEqual({ x1: 292, y1: 50, x2: 12 + EDGE_ARROW_GAP, y2: 50 });
  });

  it('a diagonal edge ends at the rim distance from the target centre', () => {
    const e = edgeEndpoints(node(0, 0, 5), node(300, 400, 15));
    expect(Math.hypot(300 - e.x2, 400 - e.y2)).toBeCloseTo(15 + EDGE_ARROW_GAP);
    expect(Math.hypot(e.x1, e.y1)).toBeCloseTo(5);
  });

  it('control: nodes too close to fit a trimmed line keep the centre-to-centre line', () => {
    expect(edgeEndpoints(node(0, 0, 10), node(20, 0, 10))).toEqual({ x1: 0, y1: 0, x2: 20, y2: 0 });
  });

  it('control: coincident nodes keep their shared centre instead of dividing by zero', () => {
    expect(edgeEndpoints(node(5, 5, 10), node(5, 5, 10))).toEqual({ x1: 5, y1: 5, x2: 5, y2: 5 });
  });
});
