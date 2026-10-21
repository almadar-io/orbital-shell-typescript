import { describe, expect, it } from 'vitest';

import {
  assignLayers,
  buildAdjacency,
  computeStaticLayout,
  findRoots,
} from '../../src/lib/graphViewLayouts';

describe('buildAdjacency / findRoots', () => {
  it('ignores edges referencing an unknown node id', () => {
    const adjacency = buildAdjacency(['a', 'b'], [{ source: 'a', target: 'ghost' }]);
    expect(adjacency.out.get('a')).toEqual([]);
    expect(adjacency.in.get('b')).toEqual([]);
  });

  it('finds in-degree-0 roots in input order', () => {
    const nodeIds = ['b', 'a', 'c'];
    const adjacency = buildAdjacency(nodeIds, [{ source: 'a', target: 'c' }]);
    expect(findRoots(nodeIds, adjacency)).toEqual(['b', 'a']);
  });

  it('a pure cycle has no roots', () => {
    const nodeIds = ['a', 'b'];
    const adjacency = buildAdjacency(nodeIds, [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ]);
    expect(findRoots(nodeIds, adjacency)).toEqual([]);
  });
});

describe('assignLayers', () => {
  it('uses the LONGEST path, not the shortest, when a chord shortcuts a chain', () => {
    // A->B, A->C, B->D, C->D, B->C: the A-B-C-D chain is 3 edges long, so C
    // and D must sit past where a shortest-path (BFS) layering would put them.
    const nodeIds = ['A', 'B', 'C', 'D'];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'A', target: 'C' },
      { source: 'B', target: 'D' },
      { source: 'C', target: 'D' },
      { source: 'B', target: 'C' },
    ];
    const adjacency = buildAdjacency(nodeIds, edges);
    const roots = findRoots(nodeIds, adjacency);
    const layers = assignLayers(nodeIds, adjacency, roots);
    expect(layers.get('A')).toBe(0);
    expect(layers.get('B')).toBe(1);
    expect(layers.get('C')).toBe(2);
    expect(layers.get('D')).toBe(3);
  });

  it('is cycle-safe (back edges are skipped, no infinite recursion)', () => {
    const nodeIds = ['A', 'B', 'C'];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'B' },
    ];
    const adjacency = buildAdjacency(nodeIds, edges);
    const roots = findRoots(nodeIds, adjacency);
    const layers = assignLayers(nodeIds, adjacency, roots);
    expect(layers.get('A')).toBe(0);
    expect(layers.get('B')).toBe(1);
    expect(layers.get('C')).toBe(2);
  });

  it('leaves unreachable nodes at layer 0', () => {
    const nodeIds = ['A', 'B', 'island'];
    const adjacency = buildAdjacency(nodeIds, [{ source: 'A', target: 'B' }]);
    const roots = findRoots(nodeIds, adjacency);
    const layers = assignLayers(nodeIds, adjacency, roots);
    expect(layers.get('island')).toBe(0);
  });
});

describe('computeStaticLayout', () => {
  const diamondEdges = [
    { source: 'A', target: 'B' },
    { source: 'A', target: 'C' },
    { source: 'B', target: 'D' },
    { source: 'C', target: 'D' },
    { source: 'B', target: 'C' },
  ];

  it('flow: 4 distinct layers, x strictly monotone with layer depth', () => {
    const points = computeStaticLayout('flow', {
      nodeIds: ['A', 'B', 'C', 'D'],
      edges: diamondEdges,
      width: 800,
      height: 400,
    });
    const byId = Object.fromEntries(points.map((p) => [p.id, p]));
    expect(byId.A.x).toBeLessThan(byId.B.x);
    expect(byId.B.x).toBeLessThan(byId.C.x);
    expect(byId.C.x).toBeLessThan(byId.D.x);
  });

  it('tree: root sits above its children (smaller y), tiers separated', () => {
    const points = computeStaticLayout('tree', {
      nodeIds: ['A', 'B', 'C', 'D'],
      edges: diamondEdges,
      width: 800,
      height: 400,
    });
    const byId = Object.fromEntries(points.map((p) => [p.id, p]));
    expect(byId.A.y).toBeLessThan(byId.B.y);
    expect(byId.B.y).toBeLessThan(byId.C.y);
    expect(byId.C.y).toBeLessThan(byId.D.y);
  });

  it('radial: a pure cycle renders as a single ring (equal radii)', () => {
    const nodeIds = ['A', 'B', 'C'];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'A' },
    ];
    const points = computeStaticLayout('radial', { nodeIds, edges, width: 400, height: 400 });
    const cx = 200;
    const cy = 200;
    const radii = points.map((p) => Math.hypot(p.x - cx, p.y - cy));
    for (const r of radii) {
      expect(r).toBeCloseTo(radii[0], 5);
    }
  });

  it('radial: root at center, deeper nodes further out', () => {
    const points = computeStaticLayout('radial', {
      nodeIds: ['A', 'B', 'C', 'D'],
      edges: diamondEdges,
      width: 400,
      height: 400,
    });
    const byId = Object.fromEntries(points.map((p) => [p.id, [p.x - 200, p.y - 200] as const]));
    const radiusOf = (id: string) => Math.hypot(...byId[id]);
    expect(radiusOf('A')).toBe(0);
    expect(radiusOf('D')).toBeGreaterThan(radiusOf('B'));
  });

  it('is deterministic: two calls on the same input produce identical output', () => {
    const input = { nodeIds: ['A', 'B', 'C', 'D'], edges: diamondEdges, width: 800, height: 400 };
    const first = computeStaticLayout('flow', input);
    const second = computeStaticLayout('flow', input);
    expect(second).toEqual(first);
  });

  it('ignores edges pointing at an unknown node id', () => {
    const points = computeStaticLayout('flow', {
      nodeIds: ['A', 'B'],
      edges: [{ source: 'A', target: 'ghost' }, { source: 'A', target: 'B' }],
      width: 400,
      height: 200,
    });
    expect(points.map((p) => p.id).sort()).toEqual(['A', 'B']);
  });

  it('centers a single-node graph and returns nothing for an empty graph', () => {
    expect(computeStaticLayout('flow', { nodeIds: [], edges: [], width: 400, height: 200 })).toEqual([]);
    expect(computeStaticLayout('tree', { nodeIds: ['only'], edges: [], width: 400, height: 200 })).toEqual([
      { id: 'only', x: 200, y: 100 },
    ]);
  });
});
