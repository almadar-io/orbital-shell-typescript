/**
 * Deterministic static layout strategies for GraphView (flow / tree / radial).
 * Pure layout math — no rendering, no randomness, no wall-clock time.
 */

export type GraphViewLayout = 'force' | 'flow' | 'tree' | 'radial';

export interface GraphLayoutInput {
  /** Node ids in input order (also the tie-break key for ordering). */
  nodeIds: string[];
  edges: ReadonlyArray<{ source: string; target: string }>;
  width: number;
  height: number;
  /** Edge-to-canvas margin in px (default 40, matches the force layout's clamp). */
  margin?: number;
}

export interface LayoutPoint {
  id: string;
  x: number;
  y: number;
}

export interface GraphAdjacency {
  out: Map<string, string[]>;
  in: Map<string, string[]>;
}

/** Out/in neighbor lists per node. Edges referencing an unknown id are ignored. */
export function buildAdjacency(
  nodeIds: string[],
  edges: ReadonlyArray<{ source: string; target: string }>,
): GraphAdjacency {
  const known = new Set(nodeIds);
  const out = new Map<string, string[]>();
  const inMap = new Map<string, string[]>();
  for (const id of nodeIds) {
    out.set(id, []);
    inMap.set(id, []);
  }
  for (const edge of edges) {
    if (!known.has(edge.source) || !known.has(edge.target)) continue;
    out.get(edge.source)?.push(edge.target);
    inMap.get(edge.target)?.push(edge.source);
  }
  return { out, in: inMap };
}

/** In-degree-0 nodes, in input order. A pure cycle (no such node) yields an empty array. */
export function findRoots(nodeIds: string[], adjacency: GraphAdjacency): string[] {
  return nodeIds.filter((id) => (adjacency.in.get(id)?.length ?? 0) === 0);
}

/**
 * Longest-path layering over forward edges, DFS from `roots` with recursion-stack
 * back-edge detection so cycles never recurse forever. Nodes unreached from any
 * root (disconnected islands, or every node when `roots` is empty) stay at layer 0.
 */
export function assignLayers(
  nodeIds: string[],
  adjacency: GraphAdjacency,
  roots: string[],
): Map<string, number> {
  const layer = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const onStack = new Set<string>();

  const visit = (id: string): void => {
    onStack.add(id);
    const currentLayer = layer.get(id) ?? 0;
    for (const next of adjacency.out.get(id) ?? []) {
      if (onStack.has(next)) continue; // back edge — cycle, skip to stay finite
      const candidate = currentLayer + 1;
      if (candidate > (layer.get(next) ?? 0)) {
        layer.set(next, candidate);
      }
      visit(next);
    }
    onStack.delete(id);
  };

  for (const root of roots) visit(root);
  return layer;
}

/** Pre-order DFS visit index from `roots`; any node never reached is appended in input order. */
function computeVisitOrder(
  nodeIds: string[],
  adjacency: GraphAdjacency,
  roots: string[],
): Map<string, number> {
  const order = new Map<string, number>();
  const visited = new Set<string>();
  let counter = 0;

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    order.set(id, counter++);
    for (const next of adjacency.out.get(id) ?? []) visit(next);
  };

  for (const root of roots) visit(root);
  for (const id of nodeIds) {
    if (!visited.has(id)) order.set(id, counter++);
  }
  return order;
}

/** Multi-source BFS depth from `roots` (out-edges only) plus a stable discovery order. */
function bfsDepthAndOrder(
  nodeIds: string[],
  adjacency: GraphAdjacency,
  roots: string[],
): { depth: Map<string, number>; visitOrder: Map<string, number> } {
  const depth = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const visitOrder = new Map<string, number>();
  const visited = new Set<string>();
  const queue: string[] = [];
  let counter = 0;

  for (const root of roots) {
    if (visited.has(root)) continue;
    visited.add(root);
    depth.set(root, 0);
    visitOrder.set(root, counter++);
    queue.push(root);
  }

  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const d = depth.get(id) ?? 0;
    for (const next of adjacency.out.get(id) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      depth.set(next, d + 1);
      visitOrder.set(next, counter++);
      queue.push(next);
    }
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) visitOrder.set(id, counter++);
  }
  return { depth, visitOrder };
}

/** Follows out-edges from the first unvisited input node, restarting on dead ends. */
function edgeWalkOrder(nodeIds: string[], adjacency: GraphAdjacency): string[] {
  const visited = new Set<string>();
  const result: string[] = [];
  for (const start of nodeIds) {
    if (visited.has(start)) continue;
    let current: string | undefined = start;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      result.push(current);
      const outs: string[] = adjacency.out.get(current) ?? [];
      current = outs.find((next) => !visited.has(next));
    }
  }
  return result;
}

function groupByTier(nodeIds: string[], tierOf: Map<string, number>, maxTier: number): string[][] {
  const groups: string[][] = Array.from({ length: maxTier + 1 }, () => []);
  for (const id of nodeIds) {
    groups[tierOf.get(id) ?? 0].push(id);
  }
  return groups;
}

/** Evenly divides [start, end] into `count` slots, returning each slot's midpoint. */
function distributeAxis(count: number, start: number, end: number): number[] {
  if (count <= 0) return [];
  const slot = (end - start) / count;
  return Array.from({ length: count }, (_, i) => start + slot * (i + 0.5));
}

function orderByParentPositionThenInput(
  group: string[],
  adjacency: GraphAdjacency,
  positioned: Map<string, number>,
  inputIndex: Map<string, number>,
): string[] {
  const withKey = group.map((id) => {
    const parentValues = (adjacency.in.get(id) ?? [])
      .map((p) => positioned.get(p))
      .filter((v): v is number => v !== undefined);
    const avg =
      parentValues.length > 0
        ? parentValues.reduce((a, b) => a + b, 0) / parentValues.length
        : Number.POSITIVE_INFINITY;
    return { id, avg, idx: inputIndex.get(id) ?? 0 };
  });
  withKey.sort((a, b) => (a.avg !== b.avg ? a.avg - b.avg : a.idx - b.idx));
  return withKey.map((k) => k.id);
}

function layoutFlow(
  nodeIds: string[],
  adjacency: GraphAdjacency,
  roots: string[],
  width: number,
  height: number,
  margin: number,
): LayoutPoint[] {
  const inputIndex = new Map(nodeIds.map((id, i) => [id, i]));
  const layers = assignLayers(nodeIds, adjacency, roots);
  const maxLayer = Math.max(...Array.from(layers.values()));
  const layerGroups = groupByTier(nodeIds, layers, maxLayer);

  const positions = new Map<string, LayoutPoint>();
  const yById = new Map<string, number>();

  for (let l = 0; l <= maxLayer; l++) {
    const x = margin + (l * (width - 2 * margin)) / Math.max(1, maxLayer);
    const ordered = orderByParentPositionThenInput(layerGroups[l], adjacency, yById, inputIndex);
    const ys = distributeAxis(ordered.length, margin, height - margin);
    ordered.forEach((id, i) => {
      positions.set(id, { id, x, y: ys[i] });
      yById.set(id, ys[i]);
    });
  }

  return nodeIds.map((id) => positions.get(id) as LayoutPoint);
}

function layoutTree(
  nodeIds: string[],
  adjacency: GraphAdjacency,
  roots: string[],
  width: number,
  height: number,
  margin: number,
): LayoutPoint[] {
  const effectiveRoots = roots.length > 0 ? roots : [nodeIds[0]];
  const layers = assignLayers(nodeIds, adjacency, effectiveRoots);
  const maxLayer = Math.max(...Array.from(layers.values()));
  const visitOrder = computeVisitOrder(nodeIds, adjacency, effectiveRoots);
  const layerGroups = groupByTier(nodeIds, layers, maxLayer);

  const positions = new Map<string, LayoutPoint>();
  for (let l = 0; l <= maxLayer; l++) {
    const ordered = [...layerGroups[l]].sort(
      (a, b) => (visitOrder.get(a) ?? 0) - (visitOrder.get(b) ?? 0),
    );
    const y = margin + (l * (height - 2 * margin)) / Math.max(1, maxLayer);
    const xs = distributeAxis(ordered.length, margin, width - margin);
    ordered.forEach((id, i) => positions.set(id, { id, x: xs[i], y }));
  }

  return nodeIds.map((id) => positions.get(id) as LayoutPoint);
}

function layoutRadial(
  nodeIds: string[],
  adjacency: GraphAdjacency,
  roots: string[],
  width: number,
  height: number,
  margin: number,
): LayoutPoint[] {
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) / 2 - margin;

  if (roots.length === 0) {
    const order = edgeWalkOrder(nodeIds, adjacency);
    const k = order.length;
    const positions = new Map<string, LayoutPoint>();
    order.forEach((id, i) => {
      const angle = (i / k) * 2 * Math.PI;
      positions.set(id, { id, x: cx + maxRadius * Math.cos(angle), y: cy + maxRadius * Math.sin(angle) });
    });
    return nodeIds.map((id) => positions.get(id) as LayoutPoint);
  }

  const { depth, visitOrder } = bfsDepthAndOrder(nodeIds, adjacency, roots);
  const maxDepth = Math.max(...Array.from(depth.values()));
  const ringGroups = groupByTier(nodeIds, depth, maxDepth);

  const positions = new Map<string, LayoutPoint>();
  for (let d = 0; d <= maxDepth; d++) {
    const ordered = [...ringGroups[d]].sort(
      (a, b) => (visitOrder.get(a) ?? 0) - (visitOrder.get(b) ?? 0),
    );
    const radius = (d * maxRadius) / Math.max(1, maxDepth);
    const k = ordered.length;
    ordered.forEach((id, i) => {
      const angle = (i / k) * 2 * Math.PI;
      positions.set(id, { id, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });
  }

  return nodeIds.map((id) => positions.get(id) as LayoutPoint);
}

export function computeStaticLayout(
  mode: Exclude<GraphViewLayout, 'force'>,
  input: GraphLayoutInput,
): LayoutPoint[] {
  const { nodeIds, edges, width, height } = input;
  const margin = input.margin ?? 40;

  if (nodeIds.length === 0) return [];
  if (nodeIds.length === 1) return [{ id: nodeIds[0], x: width / 2, y: height / 2 }];

  const adjacency = buildAdjacency(nodeIds, edges);
  const roots = findRoots(nodeIds, adjacency);

  if (mode === 'flow') return layoutFlow(nodeIds, adjacency, roots, width, height, margin);
  if (mode === 'tree') return layoutTree(nodeIds, adjacency, roots, width, height, margin);
  return layoutRadial(nodeIds, adjacency, roots, width, height, margin);
}
