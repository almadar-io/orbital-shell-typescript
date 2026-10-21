'use client';

/**
 * AlgoGraphCanvas
 *
 * A field-scoped learning molecule for computer-science graph/tree algorithm
 * visualizations (BFS/DFS/Dijkstra/A-star/topological sort/tree traversals).
 * Declares a fixed node/edge state vocabulary with default colors and
 * deterministic layouts (`manual` | `tree` | `layered` | `circle`) so a
 * `.lolo` behavior never computes pixel coordinates — it just sets node
 * `state`/edges and picks a layout. Distinguish from the core d3-force
 * `GraphCanvas`: this one is a dumb deterministic projection, not a
 * force simulation.
 *
 * @packageDocumentation
 */

import * as React from 'react';
import type { A11yProps, DiagramTone, EventKey } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { useCallback, useMemo } from 'react';
import { Card, Typography } from '../../../core';
import { VStack } from '../../../core';
import { LearningCanvas } from '../atoms/LearningCanvas';
import type { LearningPoint, LearningShape } from '../atoms/LearningCanvas';
import type { UiError } from '../../../core';

export type AlgoGraphNodeState = 'unvisited' | 'frontier' | 'current' | 'visited' | 'goal' | 'path';
export type AlgoGraphEdgeState = 'default' | 'tree' | 'relaxed' | 'candidate' | 'path';
export type AlgoGraphLayout = 'manual' | 'tree' | 'layered' | 'circle';

export interface AlgoGraphNodeBadge {
  text: string;
  color?: string;
}

export interface AlgoGraphNode {
  id: string;
  /** Manual layout only; ignored by `tree`/`layered`/`circle`. */
  x?: number;
  /** Manual layout only; ignored by `tree`/`layered`/`circle`. */
  y?: number;
  label?: string;
  /** Drives the default fill/stroke color via `NODE_STATE_COLOR`. */
  state?: AlgoGraphNodeState;
  color?: string;
  radius?: number;
  /** Small pill (e.g. distance/order) drawn at the node's upper-right. */
  badge?: AlgoGraphNodeBadge;
}

export interface AlgoGraphEdge {
  from: string;
  to: string;
  directed?: boolean;
  weight?: number;
  label?: string;
  /** Drives the default stroke color via `EDGE_STATE_COLOR`. */
  state?: AlgoGraphEdgeState;
  color?: string;
}

export interface AlgoGraphCanvasProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  className?: string;
  width?: number;
  height?: number;
  title?: string;
  backgroundColor?: string;
  /** Overrides the theme's categorical palette (`series-1…N`) for this canvas — real-world conventions like CPK atom colors or resistor bands. Unset, the theme's `--color-series-*` apply. */
  series?: string[];
  /** Maps a keydown `e.code` (optionally `Mod+`/`Shift+`/`Alt+` prefixed) to a SEMANTIC event emitted as `UI:{event}` — e.g. `{ Space: TOGGLE_RUN, ArrowRight: STEP, KeyR: RESET }`; keystrokes inside inputs never route. */
  keyMap?: Record<string, EventKey>;
  /** Maps a keyup `e.code` to a semantic event emitted as `UI:{event}`. */
  keyUpMap?: Record<string, EventKey>;
  nodes?: AlgoGraphNode[];
  edges?: AlgoGraphEdge[];
  /** Deterministic layout to compute node positions; `manual` passes through `x`/`y`. */
  layout?: AlgoGraphLayout;
  /** `tree` layout only: preferred root id. Falls back to the first indegree-0 node. */
  root?: string;
  /** Extra declarative shapes in canvas pixel coordinates. */
  shapes?: LearningShape[];
  interactive?: boolean;
  animate?: boolean;
  onShapeClick?: (payload: { id?: string; type?: string; index: number }) => void;
  /** Fires when a node circle is clicked, alongside `onShapeClick`. */
  onNodeClick?: (payload: { id: string; label?: string; index: number }) => void;
  isLoading?: boolean;
  error?: UiError | null;
}

export const NODE_STATE_COLOR: Record<AlgoGraphNodeState, DiagramTone> = {
  unvisited: 'ink',
  frontier: 'highlight',
  current: 'primary',
  visited: 'muted',
  goal: 'success',
  path: 'accent',
};

export const EDGE_STATE_COLOR: Record<AlgoGraphEdgeState, DiagramTone> = {
  default: 'ink',
  tree: 'muted',
  relaxed: 'primary',
  candidate: 'highlight',
  path: 'accent',
};

const DEFAULT_NODE_RADIUS = 18;

function layoutCircle(nodes: AlgoGraphNode[], width: number, height: number): Map<string, LearningPoint> {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(10, Math.min(cx, cy) - 40);
  const positions = new Map<string, LearningPoint>();
  const n = nodes.length;
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(n, 1) - Math.PI / 2;
    positions.set(node.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  });
  return positions;
}

function layoutTree(
  nodes: AlgoGraphNode[],
  edges: AlgoGraphEdge[],
  root: string | undefined,
  width: number,
  height: number,
): Map<string, LearningPoint> {
  const nodeIds = nodes.map((n) => n.id);
  const idSet = new Set(nodeIds);
  const childrenOf = new Map<string, string[]>();
  const hasIncoming = new Set<string>();
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
    const list = childrenOf.get(e.from) ?? [];
    list.push(e.to);
    childrenOf.set(e.from, list);
    hasIncoming.add(e.to);
  }

  const depth = new Map<string, number>();
  const treeChildren = new Map<string, string[]>();
  const visited = new Set<string>();

  const bfsFrom = (start: string) => {
    if (visited.has(start)) return;
    visited.add(start);
    depth.set(start, 0);
    const queue: string[] = [start];
    while (queue.length > 0) {
      const u = queue.shift() as string;
      for (const v of childrenOf.get(u) ?? []) {
        // Cycle guard: a node already reached keeps its first-discovered depth/parent.
        if (visited.has(v)) continue;
        visited.add(v);
        depth.set(v, (depth.get(u) ?? 0) + 1);
        const list = treeChildren.get(u) ?? [];
        list.push(v);
        treeChildren.set(u, list);
        queue.push(v);
      }
    }
  };

  const primaryRoot = root && idSet.has(root) ? root : nodeIds.find((id) => !hasIncoming.has(id)) ?? nodeIds[0];

  const rootsOrder: string[] = [];
  if (primaryRoot !== undefined) {
    bfsFrom(primaryRoot);
    rootsOrder.push(primaryRoot);
  }
  for (const id of nodeIds) {
    if (!visited.has(id)) {
      bfsFrom(id);
      rootsOrder.push(id);
    }
  }

  // Post-order: a leaf claims the next free x-slot; an internal node centers
  // over the average slot of its children.
  let leafCounter = 0;
  const xSlot = new Map<string, number>();
  const assignXSlot = (u: string): number => {
    const children = treeChildren.get(u) ?? [];
    if (children.length === 0) {
      const slot = leafCounter++;
      xSlot.set(u, slot);
      return slot;
    }
    const childSlots = children.map(assignXSlot);
    const avg = childSlots.reduce((a, b) => a + b, 0) / childSlots.length;
    xSlot.set(u, avg);
    return avg;
  };
  for (const r of rootsOrder) assignXSlot(r);

  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);

  const colWidth = width / Math.max(1, leafCounter);
  const rowHeight = height / (maxDepth + 1);

  const positions = new Map<string, LearningPoint>();
  for (const id of nodeIds) {
    const slot = xSlot.get(id) ?? 0;
    const d = depth.get(id) ?? 0;
    positions.set(id, { x: slot * colWidth + colWidth / 2, y: d * rowHeight + rowHeight / 2 });
  }
  return positions;
}

function layoutLayered(nodes: AlgoGraphNode[], edges: AlgoGraphEdge[], width: number, height: number): Map<string, LearningPoint> {
  const nodeIds = nodes.map((n) => n.id);
  const idSet = new Set(nodeIds);
  const adj = new Map<string, string[]>();
  const remainingIndegree = new Map<string, number>();
  for (const id of nodeIds) remainingIndegree.set(id, 0);
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
    remainingIndegree.set(e.to, (remainingIndegree.get(e.to) ?? 0) + 1);
  }

  const layer = new Map<string, number>();
  const dequeued = new Set<string>();
  const queue: string[] = [];
  for (const id of nodeIds) {
    if ((remainingIndegree.get(id) ?? 0) === 0) {
      layer.set(id, 0);
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const u = queue.shift() as string;
    dequeued.add(u);
    for (const v of adj.get(u) ?? []) {
      const candidate = (layer.get(u) ?? 0) + 1;
      layer.set(v, Math.max(layer.get(v) ?? 0, candidate));
      remainingIndegree.set(v, (remainingIndegree.get(v) ?? 0) - 1);
      if ((remainingIndegree.get(v) ?? 0) === 0 && !dequeued.has(v)) {
        queue.push(v);
      }
    }
  }

  let baseMaxLayer = 0;
  for (const id of nodeIds) {
    if (dequeued.has(id)) baseMaxLayer = Math.max(baseMaxLayer, layer.get(id) ?? 0);
  }
  // Nodes stuck in a cycle never reach indegree zero; park them one layer past the DAG.
  const cycleLayer = baseMaxLayer + 1;
  let maxLayer = baseMaxLayer;
  for (const id of nodeIds) {
    if (!dequeued.has(id)) {
      layer.set(id, cycleLayer);
      maxLayer = cycleLayer;
    }
  }

  const colWidth = width / Math.max(1, maxLayer + 1);
  const byLayer = new Map<number, string[]>();
  for (const id of nodeIds) {
    const l = layer.get(id) ?? 0;
    const list = byLayer.get(l) ?? [];
    list.push(id);
    byLayer.set(l, list);
  }

  const positions = new Map<string, LearningPoint>();
  for (const [l, ids] of byLayer) {
    const rowHeight = height / ids.length;
    ids.forEach((id, i) => {
      positions.set(id, { x: l * colWidth + colWidth / 2, y: i * rowHeight + rowHeight / 2 });
    });
  }
  return positions;
}

function computePositions(
  nodes: AlgoGraphNode[],
  edges: AlgoGraphEdge[],
  layout: AlgoGraphLayout,
  root: string | undefined,
  width: number,
  height: number,
): Map<string, LearningPoint> {
  switch (layout) {
    case 'circle':
      return layoutCircle(nodes, width, height);
    case 'tree':
      return layoutTree(nodes, edges, root, width, height);
    case 'layered':
      return layoutLayered(nodes, edges, width, height);
    case 'manual':
    default: {
      const positions = new Map<string, LearningPoint>();
      for (const n of nodes) positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
      return positions;
    }
  }
}

export const AlgoGraphCanvas: React.FC<AlgoGraphCanvasProps> = ({
  className,
  width = 600,
  height = 400,
  title,
  backgroundColor,
  series,
  keyMap,
  keyUpMap,
  nodes = [],
  edges = [],
  layout = 'manual',
  root,
  shapes = [],
  interactive = false,
  animate = false,
  onShapeClick,
  onNodeClick,
  isLoading,
  error,
  ...rest
}) => {
  const nodeById = useMemo(() => {
    const m = new Map<string, AlgoGraphNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const nodeIndexById = useMemo(() => {
    const m = new Map<string, number>();
    nodes.forEach((n, i) => m.set(n.id, i));
    return m;
  }, [nodes]);

  const derivedShapes: LearningShape[] = useMemo(() => {
    const out: LearningShape[] = [];
    const positions = computePositions(nodes, edges, layout, root, width, height);

    const edgeGeoms: {
      directed: boolean;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      label?: string;
    }[] = [];
    for (const e of edges) {
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      const posA = positions.get(e.from);
      const posB = positions.get(e.to);
      if (!a || !b || !posA || !posB) continue;
      const rA = a.radius ?? DEFAULT_NODE_RADIUS;
      const rB = b.radius ?? DEFAULT_NODE_RADIUS;
      const dx = posB.x - posA.x;
      const dy = posB.y - posA.y;
      const dist = Math.max(1e-6, Math.hypot(dx, dy));
      const ux = dx / dist;
      const uy = dy / dist;
      // Shorten each end by the node's rim so the line/arrow meets the circle edge, not its center.
      edgeGeoms.push({
        directed: e.directed ?? false,
        x1: posA.x + ux * rA,
        y1: posA.y + uy * rA,
        x2: posB.x - ux * rB,
        y2: posB.y - uy * rB,
        color: e.color ?? EDGE_STATE_COLOR[e.state ?? 'default'],
        label: e.label ?? (e.weight != null ? String(e.weight) : undefined),
      });
    }

    for (const g of edgeGeoms) {
      out.push({
        type: g.directed ? 'arrow' : 'line',
        x1: g.x1,
        y1: g.y1,
        x2: g.x2,
        y2: g.y2,
        color: g.color,
        stroke: 'normal',
      });
    }
    for (const g of edgeGeoms) {
      if (g.label === undefined) continue;
      const midX = (g.x1 + g.x2) / 2;
      const midY = (g.y1 + g.y2) / 2;
      const dx = g.x2 - g.x1;
      const dy = g.y2 - g.y1;
      const dist = Math.max(1e-6, Math.hypot(dx, dy));
      const perpX = -(dy / dist);
      const perpY = dx / dist;
      out.push({
        type: 'text',
        x: midX + perpX * 10,
        y: midY + perpY * 10,
        text: g.label,
        textSize: 'sm',
        align: 'center',
        tone: 'label',
      });
    }

    const nodeGeoms: { id: string; x: number; y: number; radius: number; color: string; label?: string; badge?: AlgoGraphNodeBadge }[] = [];
    for (const n of nodes) {
      const pos = positions.get(n.id);
      if (!pos) continue;
      nodeGeoms.push({
        id: n.id,
        x: pos.x,
        y: pos.y,
        radius: n.radius ?? DEFAULT_NODE_RADIUS,
        color: n.color ?? NODE_STATE_COLOR[n.state ?? 'unvisited'],
        label: n.label,
        badge: n.badge,
      });
    }

    for (const g of nodeGeoms) {
      out.push({ type: 'circle', id: g.id, x: g.x, y: g.y, radius: g.radius, color: g.color, fill: g.color, fillStyle: 'tint', stroke: 'normal' });
    }

    const badgeGeoms: { cx: number; cy: number; w: number; h: number; color: string; text: string }[] = [];
    for (const g of nodeGeoms) {
      // An empty badge is "no badge yet" — drawing it paints a bare dark pill.
      if (!g.badge || g.badge.text === '') continue;
      const w = Math.min(42, Math.max(18, g.badge.text.length * 6 + 10));
      badgeGeoms.push({
        cx: g.x + g.radius * 0.75,
        cy: g.y - g.radius * 0.75,
        w,
        h: 14,
        color: g.badge.color ?? 'ink',
        text: g.badge.text,
      });
    }
    for (const b of badgeGeoms) {
      out.push({ type: 'rect', x: b.cx - b.w / 2, y: b.cy - b.h / 2, width: b.w, height: b.h, color: b.color, fillTone: 'fill', fillStyle: 'solid', stroke: 'thin' });
    }
    for (const b of badgeGeoms) {
      out.push({ type: 'text', x: b.cx, y: b.cy, text: b.text, textSize: 'xs', align: 'center', tone: 'ink' });
    }

    for (const g of nodeGeoms) {
      if (g.label === undefined) continue;
      out.push({
        type: 'text',
        x: g.x,
        y: g.y + g.radius + 14,
        text: g.label,
        textSize: 'sm',
        align: 'center',
        tone: 'ink',
      });
    }

    out.push(...shapes);
    return out;
  }, [nodes, edges, layout, root, width, height, nodeById, shapes]);

  const handleShapeClick = useCallback(
    (payload: { id?: string; type?: string; index: number }) => {
      if (payload.type === 'circle' && payload.id) {
        const node = nodeById.get(payload.id);
        const idx = nodeIndexById.get(payload.id);
        if (node && idx !== undefined) {
          onNodeClick?.({ id: node.id, label: node.label, index: idx });
        }
      }
      onShapeClick?.(payload);
    },
    [nodeById, nodeIndexById, onNodeClick, onShapeClick],
  );

  return (
    <Card {...domPassthrough(rest)} className={className}>
      <VStack gap="sm">
        {title ? <Typography variant="h4">{title}</Typography> : null}
        <LearningCanvas
          width={width}
          height={height}
          backgroundColor={backgroundColor}
          series={series}
          keyMap={keyMap}
          keyUpMap={keyUpMap}
          shapes={derivedShapes}
          interactive={interactive}
          animate={animate}
          onShapeClick={onShapeClick || onNodeClick ? handleShapeClick : undefined}
          isLoading={isLoading}
          error={error}
        />
      </VStack>
    </Card>
  );
};
