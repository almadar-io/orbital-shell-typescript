/**
 * AVL dependency graph — the app over what it is built from (the cosmic
 * Dependencies lens): orbitals, then the io realizations, std behaviors and
 * std UI primitives they import, left to right, one edge per `uses` import.
 * The host supplies the graph (orbitals' imports and each behavior's own).
 */

import type { Edge, Node } from '@xyflow/react';
import type { PreviewNodeData } from './avl-preview-converter';
import { layeredGraph, type LayeredUnit } from './avl-layered-graph';

import type { DependencyGraph, DependencyLayer } from '@almadar/core';

export type { DependencyLayer };

export type SystemDependencies = DependencyGraph;

export type DependencyColumn = 'app' | DependencyLayer;

const COLUMNS: readonly DependencyColumn[] = ['app', 'io', 'std', 'primitive', 'unknown'];
const WIDTH: Record<DependencyColumn, number> = { app: 240, io: 220, std: 250, primitive: 200, unknown: 220 };
export const DEPENDENCY_ROW = { height: 26, gap: 8, columnGap: 120, headerHeight: 30 };

export const orbitalNodeId = (name: string): string => `orbital:${name}`;
export const behaviorNodeId = (name: string): string => `behavior:${name}`;

/** Every edge the graph draws, as node ids: each orbital to each import, each behavior to each of its own (not itself). */
function importEdges(deps: SystemDependencies): Array<[string, string]> {
  const edges: Array<[string, string]> = [];
  for (const [orbital, imports] of Object.entries(deps.orbitals)) {
    for (const b of new Set(imports)) edges.push([orbitalNodeId(orbital), behaviorNodeId(b)]);
  }
  for (const [name, b] of Object.entries(deps.behaviors)) {
    for (const i of new Set(b.imports)) if (i !== name) edges.push([behaviorNodeId(name), behaviorNodeId(i)]);
  }
  return edges;
}

export function schemaToDependencyGraph(deps: SystemDependencies): { nodes: Node<PreviewNodeData>[]; edges: Edge[] } {
  const units: LayeredUnit[] = Object.keys(deps.orbitals).map((orbital) => ({ id: orbitalNodeId(orbital), column: 'app', label: orbital }));
  for (const [name, b] of Object.entries(deps.behaviors).sort(([a], [z]) => a.localeCompare(z))) {
    units.push({ id: behaviorNodeId(name), column: b.layer, label: name });
  }
  return layeredGraph({
    columns: COLUMNS.map((id) => ({ id, width: WIDTH[id] })),
    units,
    edges: importEdges(deps).map(([source, target]) => ({ id: `dep-${source}-${target}`, source, target })),
    row: DEPENDENCY_ROW,
    handles: 'default',
  });
}

/** What `selected` is built from (upstream, through every import) and what reaches it (downstream). */
export function dependencyReach(deps: SystemDependencies, selected: string): { upstream: Set<string>; downstream: Set<string> } {
  const edges = importEdges(deps);
  const walk = (from: string, next: (e: [string, string]) => [string, string] | null): Set<string> => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const at = stack.pop();
      for (const e of edges) {
        const hop = next(e);
        if (hop && hop[0] === at && hop[1] !== selected && !seen.has(hop[1])) {
          seen.add(hop[1]);
          stack.push(hop[1]);
        }
      }
    }
    return seen;
  };
  return { upstream: walk(selected, (e) => e), downstream: walk(selected, ([a, b]) => [b, a]) };
}
