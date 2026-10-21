/**
 * AVL ELK Layout
 *
 * Shared ELK-based layout engine for state machines. Extracted from
 * AvlTraitScene so both the V2 scene renderer and the V3 BehaviorView
 * can share the same layout computation.
 */

import type { ELK, ElkNode, ElkExtendedEdge, ElkEdgeSection, ElkLabel } from 'elkjs/lib/elk-api.js';
import type { TraitLevelData } from './avl-schema-parser';
import { getStateRole, type StateRole } from './avl-theme';

// ---------------------------------------------------------------------------
// Layout types
// ---------------------------------------------------------------------------

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isInitial?: boolean;
  isTerminal?: boolean;
  role: StateRole;
  transitionCount: number;
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  event: string;
  effects: Array<{ type: string }>;
  guard: boolean;
  guardExpr?: string;
  index: number;
  labelX: number;
  labelY: number;
  labelW: number;
  labelH: number;
  points: Array<{ x: number; y: number }>;
  isSelf: boolean;
  isBackward: boolean;
}

export interface ElkLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Proportional state width
// ---------------------------------------------------------------------------

export function stateWidth(transitionCount: number): number {
  if (transitionCount >= 5) return 160;
  if (transitionCount >= 3) return 130;
  return 110;
}

export const STATE_H = 40;

// ---------------------------------------------------------------------------
// ELK layout computation — LEFT-TO-RIGHT
// ---------------------------------------------------------------------------

let elk: Promise<ELK> | undefined;
// elkjs is large and only diagrams need it, so it loads with the first layout.
function loadElk(): Promise<ELK> {
  elk ??= import('elkjs/lib/elk.bundled.js').then(({ default: Elk }) => new Elk());
  return elk;
}

/** Measured sizes for a renderer that draws real nodes and label pills. */
export interface TraitLayoutMetrics {
  nodeSize: (stateName: string) => { width: number; height: number };
  labelSize: (transition: TraitLevelData['transitions'][number]) => { width: number; height: number };
  nodeSpacing: number;
  layerSpacing: number;
  orthogonal: boolean;
  direction: 'ltr' | 'rtl';
}

/** States in breadth-first order from the initial state(s); unreachable states keep declaration order at the end. */
function flowOrder(data: TraitLevelData): TraitLevelData['states'] {
  const byName = new Map(data.states.map((s) => [s.name, s]));
  const seen = new Set<string>();
  const queue = data.states.filter((s) => s.isInitial).map((s) => s.name);
  const out: TraitLevelData['states'] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    const state = byName.get(name);
    if (!state) continue;
    seen.add(name);
    out.push(state);
    for (const t of data.transitions) if (t.from === name && !seen.has(t.to)) queue.push(t.to);
  }
  for (const s of data.states) if (!seen.has(s.name)) out.push(s);
  return out;
}

export async function computeTraitLayout(data: TraitLevelData, metrics?: TraitLayoutMetrics): Promise<ElkLayout> {
  const transitionCounts: Record<string, number> = {};
  for (const s of data.states) transitionCounts[s.name] = 0;
  for (const t of data.transitions) {
    transitionCounts[t.from] = (transitionCounts[t.from] ?? 0) + 1;
    transitionCounts[t.to] = (transitionCounts[t.to] ?? 0) + 1;
  }
  const maxTC = Math.max(...Object.values(transitionCounts), 0);

  const LABEL_BASE_W = 100;
  const LABEL_H = 44;
  const states = metrics ? flowOrder(data) : data.states;

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': metrics?.direction === 'rtl' ? 'LEFT' : 'RIGHT',
      'elk.spacing.nodeNode': String(metrics?.nodeSpacing ?? 80),
      'elk.spacing.edgeNode': '30',
      'elk.spacing.edgeEdge': '24',
      'elk.spacing.edgeLabel': '10',
      'elk.spacing.labelLabel': '8',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(metrics?.layerSpacing ?? 100),
      ...(metrics?.orthogonal ? { 'elk.edgeRouting': 'ORTHOGONAL' } : {}),
      ...(metrics ? { 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES', 'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER' } : {}),
      'elk.edgeLabels.placement': 'CENTER',
      'elk.layered.mergeEdges': 'false',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: states.map(s => {
      const tc = transitionCounts[s.name] ?? 0;
      const size = metrics ? metrics.nodeSize(s.name) : { width: stateWidth(tc), height: STATE_H };
      return {
        id: s.name,
        width: size.width,
        height: size.height,
        labels: [{ text: s.name, width: size.width - 10, height: 14 }],
        ...(metrics && s.isInitial ? { layoutOptions: { 'elk.layered.layering.layerConstraint': 'FIRST' } } : {}),
      };
    }),
    edges: data.transitions.map((t, i) => {
      const textW = Math.max(t.event.length * 8, 60);
      const iconsW = Math.min(t.effects.length, 6) * 28 + 20;
      const label = metrics ? metrics.labelSize(t) : { width: Math.max(textW, iconsW, LABEL_BASE_W), height: LABEL_H };
      return {
        id: `e${i}`,
        sources: [t.from],
        targets: [t.to],
        labels: [{
          text: t.event,
          width: label.width,
          height: label.height,
          ...(metrics ? { layoutOptions: { 'elk.edgeLabels.inline': 'true' } } : {}),
        }],
      };
    }),
  };

  const layout: ElkNode = await (await loadElk()).layout(elkGraph);
  const layoutChildren: ElkNode[] = layout.children ?? [];
  const layoutEdges: ElkExtendedEdge[] = layout.edges ?? [];

  const nodeXMap: Record<string, number> = {};
  for (const n of layoutChildren) {
    nodeXMap[n.id] = n.x ?? 0;
  }

  const nodes: LayoutNode[] = layoutChildren.map(n => {
    const name = n.id;
    const stateInfo = data.states.find(s => s.name === name);
    const tc = transitionCounts[name] ?? 0;
    return {
      id: name,
      x: n.x ?? 0,
      y: n.y ?? 0,
      width: n.width ?? 110,
      height: n.height ?? STATE_H,
      isInitial: stateInfo?.isInitial ?? undefined,
      isTerminal: stateInfo?.isTerminal ?? undefined,
      role: getStateRole(stateInfo?.isInitial ?? undefined, stateInfo?.isTerminal ?? undefined, tc, maxTC),
      transitionCount: tc,
    };
  });

  const edges: LayoutEdge[] = layoutEdges.map((e: ElkExtendedEdge, i: number) => {
    const t = data.transitions[i];
    const labels: ElkLabel[] = e.labels ?? [];
    const label: ElkLabel | undefined = labels[0];
    const sections: ElkEdgeSection[] = e.sections ?? [];
    const points: Array<{ x: number; y: number }> = [];

    for (const section of sections) {
      const bendPoints = section.bendPoints ?? [];
      points.push({ x: section.startPoint.x, y: section.startPoint.y });
      for (const bp of bendPoints) points.push({ x: bp.x, y: bp.y });
      points.push({ x: section.endPoint.x, y: section.endPoint.y });
    }

    const isSelf = t.from === t.to;
    const toX = nodeXMap[t.to] ?? 0;
    const fromX = nodeXMap[t.from] ?? 0;
    const isBackward = !isSelf && (metrics?.direction === 'rtl' ? toX >= fromX : toX <= fromX);
    const lw = label?.width ?? LABEL_BASE_W;
    const lh = label?.height ?? LABEL_H;

    return {
      id: e.id,
      from: t.from,
      to: t.to,
      event: t.event,
      effects: t.effects,
      guard: !!t.guard,
      guardExpr: typeof t.guard === 'string' ? t.guard : undefined,
      index: t.index,
      labelX: label?.x ?? 0,
      labelY: label?.y ?? 0,
      labelW: lw,
      labelH: lh,
      points,
      isSelf,
      isBackward,
    };
  });

  return {
    nodes,
    edges,
    width: layout.width ?? 600,
    height: layout.height ?? 400,
  };
}

// ---------------------------------------------------------------------------
// Edge path helper
// ---------------------------------------------------------------------------

/** Orthogonal polyline with its corners rounded to `radius` (clamped to half of each leg). */
export function roundedEdgePath(points: Array<{ x: number; y: number }>, radius: number): string {
  if (points.length < 3) return edgePath(points);
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r <= 0) { d += ` L ${cur.x},${cur.y}`; continue; }
    const ax = cur.x - ((cur.x - prev.x) / inLen) * r;
    const ay = cur.y - ((cur.y - prev.y) / inLen) * r;
    const bx = cur.x + ((next.x - cur.x) / outLen) * r;
    const by = cur.y + ((next.y - cur.y) / outLen) * r;
    d += ` L ${ax},${ay} Q ${cur.x},${cur.y} ${bx},${by}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x},${last.y}`;
}

export function edgePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) d += ` L ${points[i].x},${points[i].y}`;
  return d;
}
