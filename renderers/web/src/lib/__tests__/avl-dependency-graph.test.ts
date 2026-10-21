import { describe, it, expect } from 'vitest';
import { dependencyReach, schemaToDependencyGraph, type SystemDependencies } from '../avl-dependency-graph';

const deps: SystemDependencies = {
  orbitals: { Patient: ['std-browse', 'std-crm'], Person: ['std-browse'], Solo: [] },
  behaviors: {
    'std-browse': { layer: 'std', imports: ['ui-data-list'] },
    'std-crm': { layer: 'io', imports: ['std-browse', 'std-crm'] },
    'ui-data-list': { layer: 'primitive', imports: [] },
  },
};

describe('schemaToDependencyGraph — the app over what it is built from', () => {
  const g = schemaToDependencyGraph(deps);
  const x = (id: string) => g.nodes.find((n) => n.id === id)?.position.x;

  it('columns run app → io → std → UI primitives, left to right', () => {
    const cols = [x('orbital:Patient'), x('behavior:std-crm'), x('behavior:std-browse'), x('behavior:ui-data-list')].map((v) => v ?? -1);
    expect(cols.every((v, k) => k === 0 || v > cols[k - 1])).toBe(true);
  });

  it('one edge per import, never a self-import', () => {
    expect(g.edges.map((e) => `${e.source}>${e.target}`).sort()).toEqual([
      'behavior:std-browse>behavior:ui-data-list',
      'behavior:std-crm>behavior:std-browse',
      'orbital:Patient>behavior:std-browse',
      'orbital:Patient>behavior:std-crm',
      'orbital:Person>behavior:std-browse',
    ]);
  });

  it('control: an orbital importing nothing is still on the map', () => {
    expect(g.nodes.some((n) => n.id === 'orbital:Solo')).toBe(true);
  });
});

describe('dependencyReach — upstream and downstream of a selection', () => {
  it('an orbital is built from everything it reaches; nothing depends on it', () => {
    const r = dependencyReach(deps, 'orbital:Patient');
    expect([...r.upstream].sort()).toEqual(['behavior:std-browse', 'behavior:std-crm', 'behavior:ui-data-list']);
    expect([...r.downstream]).toEqual([]);
  });

  it('a behavior: what it is built from, and every orbital and behavior that reaches it', () => {
    const r = dependencyReach(deps, 'behavior:std-browse');
    expect([...r.upstream]).toEqual(['behavior:ui-data-list']);
    expect([...r.downstream].sort()).toEqual(['behavior:std-crm', 'orbital:Patient', 'orbital:Person']);
  });

  it('control: a self-importing behavior does not list itself', () => {
    const r = dependencyReach(deps, 'behavior:std-crm');
    expect(r.upstream.has('behavior:std-crm')).toBe(false);
    expect(r.downstream.has('behavior:std-crm')).toBe(false);
  });
});
