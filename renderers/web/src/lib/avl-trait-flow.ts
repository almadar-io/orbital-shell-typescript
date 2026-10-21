/**
 * AVL trait flow — one orbital as the units its traits come from (cosmic L2
 * "Flow"): each own trait on its own, each composed behavior as one unit
 * (its traits, plus the render pieces other traits embed), and the event
 * wires between units, rolled up from the trait wires the runtime delivers.
 */

import type { OrbitalSchema, Trait, TraitRef } from '@almadar/core';
import type { Edge, Node } from '@xyflow/react';
import type { PreviewNodeData } from './avl-preview-converter';
import { isInlineTrait } from '@almadar/core';
import { traitEventWires } from './avl-event-wires';
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

/** The trailing name of a `uses` path (`std/behaviors/std-browse` → `std-browse`), as the compiler resolves imports. */
const behaviorName = (from: string): string => from.slice(from.lastIndexOf('/') + 1);

/** The flow unit a trait belongs to: its own unit, or the behavior it was composed from. */
export const flowUnitOf = (t: Pick<Trait, 'name' | 'sourceBehavior'>): string =>
  (t.sourceBehavior ? `behavior:${behaviorName(t.sourceBehavior.behavior)}` : `trait:${t.name}`);

function traitsOf(schema: OrbitalSchema, orbital: string): Trait[] {
  const found = schema.orbitals?.find((o) => o.name === orbital);
  return (found?.traits ?? []).flatMap((ref: TraitRef) => (isInlineTrait(ref) ? [ref] : typeof ref === 'object' && ref._resolved ? [ref._resolved] : []));
}

export function traitFlowGraph(
  schema: OrbitalSchema,
  orbital: string,
  layers: Readonly<Record<string, DependencyLayer>> = {},
): { units: TraitFlowUnit[]; edges: TraitFlowEdge[] } {
  const traits = traitsOf(schema, orbital);
  const embedded = new Set(traits.flatMap((t) => Object.values(t.traitEmbedIds ?? {})));

  const own: TraitFlowUnit[] = [];
  const groups = new Map<string, TraitFlowUnit>();
  for (const t of traits) {
    const isPiece = t.id !== undefined && embedded.has(t.id);
    if (!t.sourceBehavior) {
      own.push({ id: flowUnitOf(t), name: t.name, column: 'own', traits: isPiece ? [] : [t.name], renderPieces: isPiece ? [t.name] : [] });
      continue;
    }
    const name = behaviorName(t.sourceBehavior.behavior);
    const unit = groups.get(name) ?? { id: flowUnitOf(t), name, column: layers[name] ?? 'unknown', traits: [], renderPieces: [] };
    (isPiece ? unit.renderPieces : unit.traits).push(t.name);
    groups.set(name, unit);
  }

  const unitByTrait = new Map(traits.map((t) => [t.name, flowUnitOf(t)]));
  const rolled = new Map<string, TraitFlowEdge>();
  for (const w of traitEventWires({ name: schema.name, orbitals: schema.orbitals?.filter((o) => o.name === orbital) ?? [] })) {
    const source = unitByTrait.get(w.emitterTrait);
    const target = unitByTrait.get(w.listenerTrait);
    if (!source || !target || source === target) continue;
    const key = `${source}␟${target}`;
    const edge = rolled.get(key) ?? { source, target, events: [] };
    if (!edge.events.includes(w.event)) edge.events.push(w.event);
    rolled.set(key, edge);
  }
  return { units: [...own, ...groups.values()], edges: [...rolled.values()] };
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
