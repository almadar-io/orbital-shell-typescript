/**
 * One column layout for every AVL graph drawn as labelled columns of pills: the app's
 * dependencies, one orbital's trait flow, and a deployment's infrastructure.
 */
import { describe, it, expect } from 'vitest';
import { layeredGraph } from '../avl-layered-graph';

const row = { height: 20, gap: 10, columnGap: 100, headerHeight: 30 };

describe('layeredGraph', () => {
  const graph = layeredGraph({
    columns: [{ id: 'client', width: 200 }, { id: 'host', width: 150 }, { id: 'store', width: 180 }],
    units: [
      { id: 'u:web', column: 'client', label: 'browser' },
      { id: 'u:host', column: 'host', label: 'shared host', status: 'degraded', metric: 'p50 12 ms' },
      { id: 'u:db', column: 'store', label: 'firestore' },
      { id: 'u:db2', column: 'store', label: 'storage' },
    ],
    edges: [{ id: 'e1', source: 'u:web', target: 'u:host' }, { id: 'e2', source: 'u:db', target: 'u:host' }],
    row,
    handles: 'facing',
  });

  it('lays each column out left to right with a header and rows under it', () => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    expect(byId.get('__column_client')?.position).toEqual({ x: 0, y: 0 });
    expect(byId.get('__column_host')?.position).toEqual({ x: 300, y: 0 });
    expect(byId.get('u:db2')?.position).toEqual({ x: 550, y: 60 });
    expect(byId.get('u:host')?.data).toMatchObject({ kind: 'dependency', dependencyColumn: 'host', cardWidth: 150, orbitalName: 'shared host', unitStatus: 'degraded', unitMetric: 'p50 12 ms' });
  });

  it('wires each edge from the side facing the other end', () => {
    expect(graph.edges.find((e) => e.id === 'e1')).toMatchObject({ sourceHandle: 'out-right', targetHandle: 'in-left' });
    expect(graph.edges.find((e) => e.id === 'e2')).toMatchObject({ sourceHandle: 'out-left', targetHandle: 'in-right' });
  });

  it('control: an empty column draws no header and takes no space', () => {
    const g = layeredGraph({ columns: [{ id: 'client', width: 200 }, { id: 'host', width: 150 }], units: [{ id: 'h', column: 'host', label: 'h' }], edges: [], row, handles: 'default' });
    expect(g.nodes.map((n) => n.id)).toEqual(['__column_host', 'h']);
    expect(g.nodes[1]?.position.x).toBe(0);
  });

  it('edge: default handles leave the edge to the renderer', () => {
    const g = layeredGraph({ columns: [{ id: 'host', width: 150 }], units: [{ id: 'a', column: 'host', label: 'a' }, { id: 'b', column: 'host', label: 'b' }], edges: [{ id: 'x', source: 'a', target: 'b' }], row, handles: 'default' });
    expect(g.edges[0]).toEqual({ id: 'x', source: 'a', target: 'b' });
  });

  it('an edge carries its label and, when failing, the error colour', () => {
    const g = layeredGraph({
      columns: [{ id: 'host', width: 150 }, { id: 'store', width: 180 }],
      units: [{ id: 'h', column: 'host', label: 'h' }, { id: 'd', column: 'store', label: 'd' }],
      edges: [{ id: 'bad', source: 'h', target: 'd', label: '12 calls · 3 errors', status: 'down' }, { id: 'fine', source: 'h', target: 'd', label: '4 calls', status: 'ok' }],
      row,
      handles: 'facing',
    });
    expect(g.edges.find((e) => e.id === 'bad')).toMatchObject({ label: '12 calls · 3 errors', style: { stroke: 'var(--color-error)' }, data: { status: 'down' } });
    expect(g.edges.find((e) => e.id === 'fine')).toMatchObject({ label: '4 calls', data: { status: 'ok' } });
    expect(g.edges.find((e) => e.id === 'fine')?.style).toBeUndefined();
  });

  it('control: an edge without label or status draws as before', () => {
    const g = layeredGraph({ columns: [{ id: 'host', width: 150 }], units: [{ id: 'a', column: 'host', label: 'a' }, { id: 'b', column: 'host', label: 'b' }], edges: [{ id: 'e', source: 'a', target: 'b' }], row, handles: 'default' });
    expect(g.edges[0]).toEqual({ id: 'e', source: 'a', target: 'b' });
  });
});

