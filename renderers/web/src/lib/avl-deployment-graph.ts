/**
 * The deployment lens: a published app's infrastructure as layered columns, visitors → host →
 * services → stores → external services, each unit with its health and one metric, each wire
 * with its call count and health.
 */
import type { Edge, Node } from '@xyflow/react';
import type { PreviewNodeData } from './avl-preview-converter';
import { layeredGraph, type LayeredColumnId, type LayeredEdge, type LayeredUnit } from './avl-layered-graph';

const COLUMNS: readonly LayeredColumnId[] = ['client', 'host', 'service', 'store', 'external'];
const WIDTH: Partial<Record<LayeredColumnId, number>> = { client: 160, host: 220, service: 200, store: 200, external: 200 };
export const DEPLOYMENT_ROW = { height: 26, gap: 8, columnGap: 160, headerHeight: 30 };

export function deploymentGraph(input: { units: readonly LayeredUnit[]; edges: readonly LayeredEdge[] }): { nodes: Node<PreviewNodeData>[]; edges: Edge[] } {
  return layeredGraph({
    columns: COLUMNS.map((id) => ({ id, width: WIDTH[id] ?? 200 })),
    units: input.units,
    edges: input.edges,
    row: DEPLOYMENT_ROW,
    handles: 'facing',
  });
}
