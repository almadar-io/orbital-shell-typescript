/**
 * AVL trait flow — one orbital as the units its traits come from (cosmic L2
 * "Flow"): each own trait on its own, each composed behavior as one unit
 * (its traits, plus the render pieces other traits embed), and the event
 * wires between units, rolled up from the trait wires the runtime delivers.
 */

import type { OrbitalSchema } from '@almadar/core';
import { inlineTraitRefs, kernelEvaluator } from '@almadar/core';
import type { Edge, Node } from '@xyflow/react';
import type { PreviewNodeData } from './avl-preview-converter';
import type { DependencyLayer } from './avl-dependency-graph';
import { layeredGraph } from './avl-layered-graph';

export type FlowColumn = 'own' | DependencyLayer;

export interface TraitFlowUnit {
  id: string;
  name: string;
  column: FlowColumn;
  /** Traits that do their own work. */
  traits: string[];
  /** Traits other traits embed to render a piece of their screen. */
  renderPieces: string[];
}

export interface TraitFlowEdge {
  source: string;
  target: string;
  events: string[];
}

export function traitFlowGraph(
  schema: OrbitalSchema,
  orbital: string,
  layers: Readonly<Record<string, DependencyLayer>> = {},
): { units: TraitFlowUnit[]; edges: TraitFlowEdge[] } {
  return kernelEvaluator().avlTraitFlowGraph({ ...schema, orbitals: inlineTraitRefs(schema.orbitals ?? []) }, orbital, layers);
}

/** One hop each way: the units that trigger `selected`, and the units it triggers. */
export function flowNeighbors(edges: readonly TraitFlowEdge[], selected: string): { triggeredBy: Set<string>; triggers: Set<string> } {
  return {
    triggeredBy: new Set(edges.filter((e) => e.target === selected).map((e) => e.source)),
    triggers: new Set(edges.filter((e) => e.source === selected).map((e) => e.target)),
  };
}

const COLUMNS: readonly FlowColumn[] = ['own', 'io', 'std', 'primitive', 'unknown'];
const WIDTH: Record<FlowColumn, number> = { own: 240, io: 340, std: 340, primitive: 260, unknown: 340 };
const ROW = { height: 28, gap: 12, columnGap: 96, headerHeight: 30 };

/** The flow on the canvas: units as pills in their columns (the dependency graph's nodes), one edge per unit pair. */
export function traitFlowCanvas(flow: { units: readonly TraitFlowUnit[]; edges: readonly TraitFlowEdge[] }): { nodes: Node<PreviewNodeData>[]; edges: Edge[] } {
  return layeredGraph({
    columns: COLUMNS.map((id) => ({ id, width: WIDTH[id] })),
    units: flow.units.map((u) => ({
      id: u.id,
      column: u.column,
      label: u.name,
      ...(u.column === 'own' ? {} : { flowTraits: u.traits.length, flowRenderPieces: u.renderPieces.length }),
    })),
    edges: flow.edges.map((e) => ({ id: `flow-${e.source}-${e.target}`, source: e.source, target: e.target })),
    row: ROW,
    handles: 'facing',
  });
}
