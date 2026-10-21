/**
 * AVL layered graph: labelled columns of pills, left to right, with edges between pills.
 * The one layout behind the app's dependencies, one orbital's trait flow and a deployment's
 * infrastructure (clients, host, services, stores). Callers choose the columns, their widths
 * and spacing, and whether edges attach on the side facing the other end.
 */

import type { Edge, Node } from '@xyflow/react';
import type { PreviewNodeData } from './avl-preview-converter';

export type LayeredColumnId = NonNullable<PreviewNodeData['dependencyColumn']>;

export interface LayeredColumn {
  id: LayeredColumnId;
  width: number;
}

export interface LayeredUnit {
  id: string;
  column: LayeredColumnId;
  label: string;
  status?: PreviewNodeData['unitStatus'];
  metric?: string;
  /** Trait flow: a composed unit's traits and embedded render pieces. */
  flowTraits?: number;
  flowRenderPieces?: number;
}

export interface LayeredEdge {
  id: string;
  source: string;
  target: string;
  /** Drawn on the wire, e.g. a deployment's call count, errors and p50. */
  label?: string;
  /** Health of the wire; a `down` or `degraded` one draws in the error / warning colour. */
  status?: PreviewNodeData['unitStatus'];
}

const EDGE_STROKE: Partial<Record<NonNullable<PreviewNodeData['unitStatus']>, string>> = {
  down: 'var(--color-error)',
  degraded: 'var(--color-warning)',
};

function edgeExtras(e: LayeredEdge): Partial<Edge> {
  const stroke = e.status !== undefined ? EDGE_STROKE[e.status] : undefined;
  return {
    ...(e.label !== undefined ? { label: e.label } : {}),
    ...(e.status !== undefined ? { data: { status: e.status } } : {}),
    ...(stroke !== undefined ? { style: { stroke } } : {}),
  };
}

export interface LayeredRow {
  height: number;
  gap: number;
  columnGap: number;
  headerHeight: number;
}

export interface LayeredGraphInput {
  columns: readonly LayeredColumn[];
  units: readonly LayeredUnit[];
  edges: readonly LayeredEdge[];
  row: LayeredRow;
  /** `facing`: each wire leaves and arrives on the side facing the other end (looping out on
   *  the right within one column); `default`: the renderer's default sides. */
  handles: 'facing' | 'default';
}

export function layeredGraph(input: LayeredGraphInput): { nodes: Node<PreviewNodeData>[]; edges: Edge[] } {
  const nodes: Node<PreviewNodeData>[] = [];
  let x = 0;
  for (const column of input.columns) {
    const units = input.units.filter((u) => u.column === column.id);
    if (units.length === 0) continue;
    nodes.push({
      id: `__column_${column.id}`,
      type: 'dependencyColumn',
      position: { x, y: 0 },
      draggable: false,
      selectable: false,
      data: { orbitalName: `__column_${column.id}`, kind: 'dependency-column', dependencyColumn: column.id, patterns: [], eventSources: [] },
    });
    units.forEach((u, row) => {
      nodes.push({
        id: u.id,
        type: 'dependency',
        position: { x, y: input.row.headerHeight + row * (input.row.height + input.row.gap) },
        draggable: false,
        data: {
          orbitalName: u.label,
          kind: 'dependency',
          dependencyColumn: column.id,
          cardWidth: column.width,
          ...(u.flowTraits !== undefined ? { flowTraits: u.flowTraits } : {}),
          ...(u.flowRenderPieces !== undefined ? { flowRenderPieces: u.flowRenderPieces } : {}),
          ...(u.status !== undefined ? { unitStatus: u.status } : {}),
          ...(u.metric !== undefined ? { unitMetric: u.metric } : {}),
          patterns: [],
          eventSources: [],
        },
      });
    });
    x += column.width + input.row.columnGap;
  }
  if (input.handles === 'default') {
    return { nodes, edges: input.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...edgeExtras(e) })) };
  }
  const xOf = new Map(nodes.map((n) => [n.id, n.position.x]));
  const edges: Edge[] = input.edges.map((e) => {
    const from = xOf.get(e.source) ?? 0;
    const to = xOf.get(e.target) ?? 0;
    const handles = to > from
      ? { sourceHandle: 'out-right', targetHandle: 'in-left' }
      : to < from
        ? { sourceHandle: 'out-left', targetHandle: 'in-right' }
        : { sourceHandle: 'out-right', targetHandle: 'in-right' };
    return { id: e.id, source: e.source, target: e.target, ...handles, ...edgeExtras(e) };
  });
  return { nodes, edges };
}
