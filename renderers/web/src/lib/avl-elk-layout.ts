/**
 * AVL ELK Layout
 *
 * Shared ELK-based layout engine for state machines. Extracted from
 * AvlTraitScene so both the V2 scene renderer and the V3 BehaviorView
 * can share the same layout computation.
 */

import type { ELK, ElkNode, ElkExtendedEdge, ElkEdgeSection, ElkLabel } from 'elkjs/lib/elk-api.js';
import type { MountedOrbital, MountedTrait } from '@almadar/core';
import { traitLevelFromMounted, type TraitLevelData } from './avl-schema-parser';
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

// ---------------------------------------------------------------------------
// Orbital layout — a whole mounted orbital as nested trait boxes
// ---------------------------------------------------------------------------

export type OrbitalBoxKind = 'machine' | 'collapsed' | 'chip';

export interface OrbitalBox {
  trait: string;
  kind: OrbitalBoxKind;
  lane: boolean;
  /** The box this one sits inside; null for a root and for the background lane. */
  parent: string | null;
  /** The box holds child boxes. */
  container: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OrbitalStateNode {
  trait: string;
  name: string;
  isInitial: boolean;
  isTerminal: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OrbitalTransitionEdge {
  id: string;
  trait: string;
  index: number;
  from: string;
  to: string;
  event: string;
  points: Array<{ x: number; y: number }>;
  labelX: number;
  labelY: number;
  labelW: number;
  labelH: number;
  isSelf: boolean;
}

export interface OrbitalEmbedEdge {
  trait: string;
  state: string;
  points: Array<{ x: number; y: number }>;
}

export interface OrbitalWire {
  key: string;
  from: string;
  to: string;
  /** Each pair is one listen: the emitted event and the listener's `triggers`. */
  pairs: Array<{ event: string; triggers: string | null }>;
  points: Array<{ x: number; y: number }>;
  labelX: number;
  labelY: number;
  labelW: number;
  labelH: number;
}

/** A box around the linked traits of one other orbital the page talks to. */
export interface OrbitalGroup {
  orbital: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Self-transitions of one state folded into a chip on the state; listed in the node when open. */
export interface OrbitalLoop {
  trait: string;
  state: string;
  events: Array<{ event: string; index: number }>;
  open: boolean;
}

export interface OrbitalLayout {
  boxes: OrbitalBox[];
  loops: OrbitalLoop[];
  groups: OrbitalGroup[];
  /** Where the linked orbitals start; null when the page talks to none. */
  groupTop: number | null;
  states: OrbitalStateNode[];
  edges: OrbitalTransitionEdge[];
  embeds: OrbitalEmbedEdge[];
  wires: OrbitalWire[];
  laneTop: number | null;
  width: number;
  height: number;
}

export interface OrbitalLayoutOptions {
  expandDepth: number;
  /** Traits opened in place whatever their depth. */
  open?: ReadonlySet<string>;
  /** Traits closed in place whatever their depth. */
  closed?: ReadonlySet<string>;
  /** Folded self-transition lists shown open, keyed by `loopKey(trait, state)`. */
  openLoops?: ReadonlySet<string>;
  metrics: TraitLayoutMetrics;
  charWidth: number;
  /** Wire label width for an event name. */
  wireLabelSize: (text: string) => { width: number; height: number };
}

const BOX_PAD = 16;
const BOX_HEAD_MACHINE = 46;
const BOX_HEAD_CONTAINER = 38;
const COLLAPSED_H = 56;
const CHIP_H = 28;
/** Room in a box head for the trait glyph and, on a box that opens, its disclosure button. */
const HEAD_GLYPH = 40;
const HEAD_TOGGLE = 28;
/** A state with this many self-transitions or more draws them as one chip instead of a stack of loops. */
export const LOOP_FOLD = 3;
/** Height of one listed event in an open loop list, and the room the closed chip needs under the name. */
export const LOOP_LINE = 18;

export function loopKey(trait: string, state: string): string {
  return `${trait}\u0000${state}`;
}
const LANE_HEAD = 30;
const LANE_MARGIN = 36;
const LANE_MIN_WIDTH = 480;
const PACK_ASPECT = 1.6;
const PACK_GAP = 14;

interface Point { x: number; y: number }
interface Rect { x: number; y: number; width: number; height: number }

function sectionPoints(e: ElkExtendedEdge): Point[] {
  const points: Point[] = [];
  for (const section of e.sections ?? []) {
    points.push({ x: section.startPoint.x, y: section.startPoint.y });
    for (const bp of section.bendPoints ?? []) points.push({ x: bp.x, y: bp.y });
    points.push({ x: section.endPoint.x, y: section.endPoint.y });
  }
  return points;
}

/** A smooth connector between two boxes, leaving and entering on the sides that face each other. */
export function boxWirePath(a: Rect, b: Rect): Point[] {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  if (b.x >= a.x + a.width) return [{ x: a.x + a.width, y: ay }, { x: b.x, y: by }];
  if (a.x >= b.x + b.width) return [{ x: a.x, y: ay }, { x: b.x + b.width, y: by }];
  if (by >= ay) return [{ x: ax, y: a.y + a.height }, { x: bx, y: b.y }];
  return [{ x: ax, y: a.y }, { x: bx, y: b.y + b.height }];
}

function boxKind(trait: MountedTrait, expandDepth: number, open: ReadonlySet<string>, closed: ReadonlySet<string>): OrbitalBoxKind {
  if (trait.states.length <= 1) return 'chip';
  if (open.has(trait.trait)) return 'machine';
  if (closed.has(trait.trait)) return 'collapsed';
  return trait.depth < expandDepth ? 'machine' : 'collapsed';
}

function compactSize(trait: MountedTrait, kind: OrbitalBoxKind, charWidth: number): { width: number; height: number } {
  if (kind === 'chip') return { width: Math.round(trait.trait.length * charWidth + 28 + HEAD_GLYPH), height: CHIP_H };
  const sub = (trait.linkedEntity ?? '').length;
  return { width: Math.max(132, Math.round(Math.max(trait.trait.length, sub) * charWidth + 64 + HEAD_GLYPH + HEAD_TOGGLE)), height: COLLAPSED_H };
}

function packOptions(padding: string, targetWidth?: number): { [key: string]: string } {
  return {
    'elk.algorithm': 'rectpacking',
    'elk.aspectRatio': String(PACK_ASPECT),
    'elk.rectpacking.orderBySize': 'false',
    'elk.spacing.nodeNode': String(PACK_GAP),
    'elk.padding': padding,
    ...(targetWidth === undefined ? {} : { 'elk.rectpacking.widthApproximation.targetWidth': String(targetWidth) }),
  };
}

export async function computeOrbitalLayout(orbital: MountedOrbital, options: OrbitalLayoutOptions): Promise<OrbitalLayout> {
  const { metrics, expandDepth, charWidth } = options;
  const byName = new Map(orbital.traits.map((t) => [t.trait, t]));
  const levels = new Map(orbital.traits.map((t) => [t.trait, traitLevelFromMounted(t)]));

  const lane = orbital.traits.filter((t) => !t.renders && !t.linked);
  const tree = orbital.traits.filter((t) => t.renders && !t.linked);
  const linkedByOrbital = new Map<string, MountedTrait[]>();
  for (const t of orbital.traits.filter((x) => x.linked)) {
    const key = t.orbital ?? '';
    linkedByOrbital.set(key, [...(linkedByOrbital.get(key) ?? []), t]);
  }

  // A rendering trait sits in its nearest rendering ancestor; with none it is a root of the main tree.
  const effectiveParent = new Map<string, string | null>();
  for (const t of tree) {
    let cur = t.parent === null ? undefined : byName.get(t.parent);
    while (cur !== undefined && !cur.renders) cur = cur.parent === null ? undefined : byName.get(cur.parent);
    effectiveParent.set(t.trait, cur === undefined ? null : cur.trait);
  }
  const childrenOf = new Map<string, MountedTrait[]>();
  const roots: MountedTrait[] = [];
  for (const t of tree) {
    const p = effectiveParent.get(t.trait) ?? null;
    if (p === null) roots.push(t);
    else childrenOf.set(p, [...(childrenOf.get(p) ?? []), t]);
  }

  const open = options.open ?? new Set<string>();
  const closed = options.closed ?? new Set<string>();
  const openLoops = options.openLoops ?? new Set<string>();
  const loops: OrbitalLoop[] = [];
  const kinds = new Map(orbital.traits.map((t) => [t.trait, boxKind(t, expandDepth, open, closed)]));

  const wirePairs = new Map<string, { from: string; to: string; pairs: Array<{ event: string; triggers: string | null }> }>();
  for (const w of orbital.wires) {
    if (!byName.has(w.from) || !byName.has(w.to)) continue;
    const key = `${w.from}\u2192${w.to}`;
    const entry = wirePairs.get(key) ?? { from: w.from, to: w.to, pairs: [] };
    entry.pairs.push({ event: w.event, triggers: w.triggers });
    wirePairs.set(key, entry);
  }
  const wireLabel = (pairs: Array<{ event: string }>): string => [...new Set(pairs.map((p) => p.event))].join(', ');

  // Each hierarchy level is laid out on its own: states with layered, boxes with rectpacking.
  const boxNode = (t: MountedTrait): ElkNode => {
    const kind = kinds.get(t.trait) ?? 'chip';
    const kids = childrenOf.get(t.trait) ?? [];
    const level = levels.get(t.trait);
    const titleWidth = Math.round(Math.max(t.trait.length, (t.linkedEntity ?? '').length) * charWidth + 32 + HEAD_GLYPH + (kind === 'chip' ? 0 : HEAD_TOGGLE));
    if (kind !== 'machine' && kids.length === 0) {
      const size = compactSize(t, kind, charWidth);
      return { id: `b:${t.trait}`, width: size.width, height: size.height };
    }
    const head = kind === 'machine' ? BOX_HEAD_MACHINE : BOX_HEAD_CONTAINER;
    const padding = `[top=${head},left=${BOX_PAD},bottom=${BOX_PAD},right=${BOX_PAD}]`;
    const minimum = { 'elk.nodeSize.constraints': 'MINIMUM_SIZE', 'elk.nodeSize.minimum': `(${titleWidth}, ${head + 20})` };
    const kidNodes = kids.map(boxNode);
    if (kind !== 'machine' || level === undefined) {
      return { id: `b:${t.trait}`, children: kidNodes, layoutOptions: { ...packOptions(padding), ...minimum } };
    }
    const selfCount = new Map<string, number>();
    for (const tr of level.transitions) if (tr.from === tr.to) selfCount.set(tr.from, (selfCount.get(tr.from) ?? 0) + 1);
    const folds = (tr: { from: string; to: string }) => tr.from === tr.to && (selfCount.get(tr.from) ?? 0) >= LOOP_FOLD;
    for (const [state, count] of selfCount) {
      if (count < LOOP_FOLD) continue;
      loops.push({
        trait: t.trait,
        state,
        events: level.transitions.filter((tr) => tr.from === state && tr.to === state).map((tr) => ({ event: tr.event, index: tr.index })),
        open: openLoops.has(loopKey(t.trait, state)),
      });
    }
    const stateNodes: ElkNode[] = flowOrder(level).map((s) => {
      const size = metrics.nodeSize(s.name);
      const count = (selfCount.get(s.name) ?? 0) >= LOOP_FOLD ? selfCount.get(s.name) ?? 0 : 0;
      const extra = count === 0 ? 0 : openLoops.has(loopKey(t.trait, s.name)) ? LOOP_LINE * (count + 1) + 8 : LOOP_LINE;
      const longest = count === 0 ? 0 : Math.max(...level.transitions.filter((tr) => tr.from === s.name && tr.to === s.name).map((tr) => tr.event.length));
      return {
        id: `s:${t.trait}:${s.name}`,
        width: Math.max(size.width, extra > LOOP_LINE ? Math.round(longest * charWidth + 40) : size.width),
        height: size.height + extra,
        layoutOptions: { 'elk.partitioning.partition': '0', ...(s.isInitial ? { 'elk.layered.layering.layerConstraint': 'FIRST' } : {}) },
      };
    });
    const group: ElkNode[] = kidNodes.length === 0 ? [] : [{
      id: `k:${t.trait}`,
      children: kidNodes,
      layoutOptions: { ...packOptions('[top=0,left=0,bottom=0,right=0]'), 'elk.partitioning.partition': '1' },
    }];
    return {
      id: `b:${t.trait}`,
      children: [...stateNodes, ...group],
      edges: level.transitions.flatMap((tr, i) => {
        if (folds(tr)) return [];
        const size = metrics.labelSize(tr);
        return [{
          id: `x:${t.trait}:${i}`,
          sources: [`s:${t.trait}:${tr.from}`],
          targets: [`s:${t.trait}:${tr.to}`],
          labels: [{ text: tr.event, width: size.width, height: size.height, layoutOptions: { 'elk.edgeLabels.inline': 'true' } }],
        }];
      }),
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': metrics.direction === 'rtl' ? 'LEFT' : 'RIGHT',
        'elk.padding': padding,
        'elk.partitioning.activate': 'true',
        'elk.spacing.nodeNode': String(metrics.nodeSpacing),
        'elk.spacing.edgeNode': '30',
        'elk.spacing.edgeEdge': '24',
        'elk.spacing.edgeLabel': '10',
        'elk.layered.spacing.nodeNodeBetweenLayers': String(metrics.layerSpacing),
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
        'elk.edgeLabels.placement': 'CENTER',
        'elk.layered.mergeEdges': 'false',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        ...minimum,
      },
    };
  };

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: { ...packOptions('[top=0,left=0,bottom=0,right=0]'), 'elk.hierarchyHandling': 'SEPARATE_CHILDREN' },
    children: roots.map(boxNode),
  };

  const elkEngine = await loadElk();
  const result: ElkNode = roots.length === 0 ? { id: 'root', width: 0, height: 0 } : await elkEngine.layout(graph);

  const boxes: OrbitalBox[] = [];
  const groups: OrbitalGroup[] = [];
  const states: OrbitalStateNode[] = [];
  const transitionEdges: OrbitalTransitionEdge[] = [];
  const walk = (node: ElkNode, ox: number, oy: number, parent: string | null): void => {
    for (const e of node.edges ?? []) {
      const [, ...rest] = e.id.split(':');
      const index = Number(rest[rest.length - 1]);
      const trait = rest.slice(0, -1).join(':');
      const tr = levels.get(trait)?.transitions[index];
      if (tr === undefined) continue;
      const label = (e.labels ?? [])[0];
      transitionEdges.push({
        id: e.id, trait, index: tr.index, from: tr.from, to: tr.to, event: tr.event,
        points: sectionPoints(e).map((p) => ({ x: p.x + ox, y: p.y + oy })),
        labelX: (label?.x ?? 0) + ox, labelY: (label?.y ?? 0) + oy, labelW: label?.width ?? 0, labelH: label?.height ?? 0, isSelf: tr.from === tr.to,
      });
    }
    for (const c of node.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      if (c.id.startsWith('b:')) {
        const name = c.id.slice(2);
        boxes.push({ trait: name, kind: kinds.get(name) ?? 'chip', lane: false, parent, container: (childrenOf.get(name) ?? []).length > 0, x, y, width: c.width ?? 0, height: c.height ?? 0 });
        walk(c, x, y, name);
      } else if (c.id.startsWith('g:')) {
        groups.push({ orbital: c.id.slice(2), x, y, width: c.width ?? 0, height: c.height ?? 0 });
        walk(c, x, y, null);
      } else if (c.id.startsWith('k:')) {
        walk(c, x, y, parent);
      } else if (c.id.startsWith('s:')) {
        const [, trait, ...rest] = c.id.split(':');
        const name = rest.join(':');
        const info = byName.get(trait)?.states.find((s) => s.name === name);
        states.push({ trait, name, isInitial: info?.isInitial ?? false, isTerminal: info?.isTerminal ?? false, x, y, width: c.width ?? 0, height: c.height ?? 0 });
      }
    }
  };
  walk(result, 0, 0, null);

  let width = result.width ?? 0;
  let height = result.height ?? 0;
  let laneTop: number | null = null;

  if (lane.length > 0) {
    laneTop = height + LANE_MARGIN;
    const laneWidth = Math.max(width, LANE_MIN_WIDTH);
    const chipSize = new Map(lane.map((t) => [t.trait, compactSize(t, kinds.get(t.trait) === 'chip' ? 'chip' : 'collapsed', charWidth)]));
    const packed: ElkNode = await elkEngine.layout({
      id: 'lane',
      layoutOptions: packOptions('[top=0,left=0,bottom=0,right=0]', laneWidth),
      children: lane.map((t) => ({ id: `b:${t.trait}`, width: chipSize.get(t.trait)?.width ?? 0, height: chipSize.get(t.trait)?.height ?? 0 })),
    });
    for (const c of packed.children ?? []) {
      const name = c.id.slice(2);
      boxes.push({ trait: name, kind: kinds.get(name) === 'chip' ? 'chip' : 'collapsed', lane: true, parent: null, container: false, x: c.x ?? 0, y: (laneTop + LANE_HEAD) + (c.y ?? 0), width: c.width ?? 0, height: c.height ?? 0 });
    }
    width = Math.max(width, packed.width ?? 0);
    height = laneTop + LANE_HEAD + (packed.height ?? 0);
  }

  let groupTop: number | null = null;
  if (linkedByOrbital.size > 0) {
    groupTop = height + LANE_MARGIN;
    const padding = `[top=${BOX_HEAD_CONTAINER},left=${BOX_PAD},bottom=${BOX_PAD},right=${BOX_PAD}]`;
    const packed: ElkNode = await elkEngine.layout({
      id: 'groups',
      layoutOptions: { ...packOptions('[top=0,left=0,bottom=0,right=0]', Math.max(width, LANE_MIN_WIDTH)), 'elk.hierarchyHandling': 'SEPARATE_CHILDREN' },
      children: [...linkedByOrbital].map(([name, traits]) => ({
        id: `g:${name}`,
        children: traits.map(boxNode),
        layoutOptions: {
          ...packOptions(padding),
          'elk.nodeSize.constraints': 'MINIMUM_SIZE',
          'elk.nodeSize.minimum': `(${Math.round(name.length * charWidth + 32 + HEAD_GLYPH)}, ${BOX_HEAD_CONTAINER + 20})`,
        },
      })),
    });
    walk(packed, 0, groupTop + LANE_HEAD, null);
    width = Math.max(width, packed.width ?? 0);
    height = groupTop + LANE_HEAD + (packed.height ?? 0);
  }

  const embeds: OrbitalEmbedEdge[] = [];
  for (const t of tree) {
    const parent = effectiveParent.get(t.trait) ?? null;
    const child = boxes.find((b) => b.trait === t.trait);
    if (parent === null || child === undefined) continue;
    for (const state of t.embeddedIn) {
      const node = states.find((s) => s.trait === parent && s.name === state);
      if (node !== undefined) embeds.push({ trait: t.trait, state, points: boxWirePath(node, child) });
    }
  }

  const wires: OrbitalWire[] = [];
  for (const [key, w] of wirePairs) {
    const a = boxes.find((b) => b.trait === w.from);
    const b = boxes.find((x) => x.trait === w.to);
    if (a === undefined || b === undefined) continue;
    const points = boxWirePath(a, b);
    const size = options.wireLabelSize(wireLabel(w.pairs));
    const mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
    wires.push({ key, from: w.from, to: w.to, pairs: w.pairs, points, labelX: mid.x - size.width / 2, labelY: mid.y - size.height / 2, labelW: size.width, labelH: size.height });
  }

  return { boxes, loops, groups, groupTop, states, edges: transitionEdges, embeds, wires, laneTop, width, height };
}
