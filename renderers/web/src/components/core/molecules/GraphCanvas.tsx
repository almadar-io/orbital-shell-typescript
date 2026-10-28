'use client';
/**
 * GraphCanvas Organism Component
 *
 * A force-directed graph visualization component for node-link data.
 * Uses canvas (necessary for performant graph rendering) with atom wrappers.
 *
 * Orbital Component Interface Compliance:
 * - Entity binding with auto-fetch when entity is a string
 * - Event emission via useEventBus (UI:* events)
 * - isLoading and error state props
 * - className for external styling
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import type { A11yProps, EventKey, EventEmit, EventPayload } from "@almadar/core";
import { domPassthrough } from '../../../core';
import { cn } from '../../../core';
import { Card, Typography, Badge, Button, Box } from '../../../core';
import { VStack, HStack } from '../../../core';
import { LoadingState } from "./LoadingState";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { useCanvasGestures } from "../../../hooks/useCanvasGestures";
import { Maximize2, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { forceSimulation, forceManyBody, forceLink, forceCollide, forceX, forceY } from "d3-force";
import type { UiError } from '../../../core';
import { ThemedPortal } from "../../../lib/ThemedPortal";
import { THEME_SERIES, resolveThemeColor } from "../../../lib/theme-color";
import { applyLineCharacter, fillLabel, labelFont as themeLabelFont, labelText, markColor } from "../../../lib/canvasTheme";
import { useCanvasTheme } from "../../../hooks/useCanvasTheme";

export type GraphNodeMark =
    | { kind: 'suggested'; suggestionId: string }
    | { kind: 'proposed'; suggestionId: string; tint?: string };

export type GraphNode = EventPayload & {
    id: string;
    label?: string;
    group?: string;
    color?: string;
    size?: number;
    /** Merge-cluster count (drawn as a top-right badge; click expands). */
    badge?: number;
    /** Overlay decoration: a suggestion/proposal target. undefined = ordinary committed node. */
    mark?: GraphNodeMark;
    /** Position (optional, computed if missing) */
    x?: number;
    y?: number;
}

export interface GraphEdge {
    source: string;
    target: string;
    label?: string;
    weight?: number;
    color?: string;
}

/**
 * All-pairs similarity (cosine 0–1) used ONLY for layout, never drawn — `edges`
 * remain the only rendered links. It is the SECONDARY macro-layout: pairs that are
 * NOT directly connected get a weak spring (higher cosine ⇒ closer) so clusters
 * arrange relative to each other, while drawn `edges` stay the primary tight
 * structure. When omitted, edges alone drive the layout.
 */
export interface GraphSimilarity {
    source: string;
    target: string;
    /** Cosine similarity in [0,1]; higher ⇒ closer. */
    weight: number;
}

export interface GraphAction {
    label: string;
    event?: EventKey;
    navigatesTo?: string;
    variant?: "primary" | "secondary" | "ghost";
}

export interface GraphCanvasProps extends A11yProps {
    /** Text alternative for the graph, rendered as visually hidden text and linked by aria-describedby. */
    description?: string;
    /** Graph title */
    title?: string;
    /** Graph nodes */
    nodes?: readonly GraphNode[];
    /** Graph edges (the only rendered links) */
    edges?: readonly GraphEdge[];
    /** Uncommitted proposal links — rendered dashed/faint in a separate pass, never folded into the layout springs. */
    proposedEdges?: readonly GraphEdge[];
    /**
     * All-pairs similarity (cosine 0–1) used ONLY for layout, never drawn. It is the
     * secondary macro-layout: non-connected pairs get a weak spring (higher cosine ⇒
     * closer) so clusters arrange relative to each other; drawn `edges` stay the
     * primary tight structure. When omitted, edges alone drive the layout.
     */
    similarity?: readonly GraphSimilarity[];
    /** Canvas height */
    height?: number;
    /** Show node labels */
    showLabels?: boolean;
    /** Enable zoom/pan */
    interactive?: boolean;
    /** Enable node dragging */
    draggable?: boolean;
    /** Actions */
    actions?: readonly GraphAction[];
    /** On node click */
    onNodeClick?: (node: GraphNode) => void;
    /** On marked-node click (suggestion/proposal target). Takes priority over onNodeClick. */
    onMarkClick?: (node: GraphNode) => void;
    /** On node double-click (e.g. to drill in) */
    onNodeDoubleClick?: (node: GraphNode) => void;
    /** On node badge click (e.g. to expand a merged cluster). */
    onBadgeClick?: (node: GraphNode) => void;
    /** Node click event */
    nodeClickEvent?: EventEmit<{ id: string }>;
    /** Currently selected node id (rendered emphasized) */
    selectedNodeId?: string;
    /** Force-sim repulsion strength between nodes (larger ⇒ more spread out) */
    repulsion?: number;
    /** Force-sim target edge length (larger ⇒ more spread out) */
    linkDistance?: number;
    /** Minimum empty gap (px) enforced between node edges so nodes never overlap. */
    nodeSpacing?: number;
    /** Base opacity for links when nothing is hovered (kept faint so dense graphs stay readable; incident links brighten on hover). */
    linkOpacity?: number;
    /** Layout algorithm */
    layout?: "force" | "circular" | "grid";
    /** Loading state */
    isLoading?: boolean;
    /** Error state */
    error?: UiError | null;
    /** Additional CSS classes */
    className?: string;
}

/** Group colors — the shared semantic series every chart/diagram draws from. */
export const GROUP_COLORS = THEME_SERIES;

/**
 * Sector-gravity strengths (d3 forceX/Y = fraction-of-the-way per tick). Grouped nodes
 * get pulled to their cluster's ring sector HARD enough that same-color islands hold
 * even when a node's cross-cluster links disagree (link springs are 0.9, but a single
 * link stretches long before gravity lets the node leave its island); ungrouped nodes
 * only drift gently to center. Raise GROUP_GRAVITY for tighter islands, lower for a
 * more link-driven layout.
 */
const GROUP_GRAVITY = 0.3;
const UNGROUPED_GRAVITY = 0.02;

type SimNode = GraphNode & {
    vx: number;
    vy: number;
    // d3-force reads fx/fy as FIXED coordinates; leave them undefined so nodes stay free.
    fx?: number | null;
    fy?: number | null;
    /** Cached rendered width of the TRUNCATED label so collision keeps on-screen text apart. */
    labelW?: number;
};

/** Offscreen 2D context reused to measure label widths (matches the rendered label font). */
let labelMeasureCtx: CanvasRenderingContext2D | null = null;
function measureLabelWidth(text: string, fontFamily = "system-ui"): number {
    if (typeof document === "undefined") return text.length * 6;
    if (!labelMeasureCtx) labelMeasureCtx = document.createElement("canvas").getContext("2d");
    if (!labelMeasureCtx) return text.length * 6;
    labelMeasureCtx.font = `12px ${fontFamily}`;
    return labelMeasureCtx.measureText(text).width + 4;
}

function getGroupColor(group: string | undefined, groups: string[]): string {
    // Ungrouped nodes render neutral in a mixed graph so real groups pop; a graph with
    // no groups at all keeps the primary color everywhere.
    if (!group) return groups.length > 0 ? "var(--color-muted-foreground)" : GROUP_COLORS[0];
    const idx = groups.indexOf(group);
    return GROUP_COLORS[idx % GROUP_COLORS.length];
}

/** Deterministic 32-bit string hash — the seed for the layout PRNG. */
function hashSeed(str: string): number {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return (h ^= h >>> 16) >>> 0;
}

/** mulberry32: tiny deterministic PRNG so a graph lays out identically on every load. */
function mulberry32(a: number): () => number {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A drawn edge's stroke: weight sets width between the thin and normal strokes and never opacity, so no weight can erase an edge; an unweighted edge stays thin. */
export function edgeStroke(
    weight: number | undefined,
    linkOpacity: number,
    strokes: Readonly<{ thin: number; normal: number }>,
): { alpha: number; width: number } {
    if (weight === undefined) return { alpha: linkOpacity, width: strokes.thin };
    const w = Math.min(1, Math.max(0, weight));
    return { alpha: linkOpacity, width: strokes.thin + (strokes.normal - strokes.thin) * w };
}

/** Order-independent key for a node pair — used to tell drawn edges from similarity-only pairs. */
function edgeKeyOf(a: string, b: string): string {
    return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/**
 * Canvas 2D `fillStyle`/`strokeStyle` cannot resolve CSS custom properties (`var(--x)`),
 * so resolve them against the element's computed style; pass through literal colors.
 * An unresolvable `var()` (no declared fallback, undefined token) returns the raw
 * expression rather than a guessed color — the honest result of a genuinely missing token.
 */
export function resolveColor(color: string, el: Element): string {
    if (!/^var\(/.test(color.trim())) return color;
    return resolveThemeColor(color, el)?.css ?? color;
}

/** Long labels are truncated on the node; the full text shows in a hover tooltip. */
const MAX_LABEL_CHARS = 22;
function truncateLabel(label: string): string {
    return label.length > MAX_LABEL_CHARS ? label.slice(0, MAX_LABEL_CHARS - 1) + "\u2026" : label;
}

// Stable empty defaults so omitted array props don't create a new reference each render
// (which would destabilize the layout effect's dependency list and loop setState).
const NO_NODES: readonly GraphNode[] = [];
const NO_EDGES: readonly GraphEdge[] = [];
const NO_SIM: readonly GraphSimilarity[] = [];

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
    title,
    nodes: propNodes = NO_NODES,
    edges: propEdges = NO_EDGES,
    proposedEdges = NO_EDGES,
    similarity: propSimilarity = NO_SIM,
    height = 400,
    showLabels = true,
    interactive = true,
    draggable = true,
    actions,
    onNodeClick,
    onMarkClick,
    onNodeDoubleClick,
    onBadgeClick,
    nodeClickEvent,
    selectedNodeId,
    repulsion = 800,
    linkDistance = 100,
    nodeSpacing = 28,
    linkOpacity = 0.18,
    layout = "force",
    isLoading = false,
    error,
    className,
    description,
    ...rest
}) => {
    const descId = React.useId();
    const eventBus = useEventBus();
    const { t } = useTranslate();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { theme: canvasTheme } = useCanvasTheme(canvasRef);
    const animRef = useRef<number>(0);
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    // Mirror zoom/offset into refs so gesture handlers read current values without stale closures.
    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;
    const offsetRef = useRef(offset);
    offsetRef.current = offset;
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);
    const nodesRef = useRef<SimNode[]>([]);
    const laidOutRef = useRef(false);
    const [, forceUpdate] = useState(0);
    // Logical drawing width in CSS px (the canvas backing store is this × devicePixelRatio for crisp text).
    const [logicalW, setLogicalW] = useState(800);
    // Ambient pulse for proposed (uncommitted) nodes — a rAF phase, advanced only while any is visible.
    const hasProposed = useMemo(() => propNodes.some(n => n.mark?.kind === 'proposed'), [propNodes]);
    const [pulseTick, setPulseTick] = useState(0);
    const motionOn = canvasTheme?.motion.enabled !== false;
    useEffect(() => {
        if (!hasProposed || !motionOn) return;
        let raf = 0;
        const loop = () => { setPulseTick(t => (t + 1) % 1_000_000); raf = requestAnimationFrame(loop); };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [hasProposed, motionOn]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || typeof ResizeObserver === "undefined") return;
        const measure = () => {
            const width = Math.round(canvas.clientWidth);
            if (width > 0) setLogicalW(width);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(canvas);
        return () => ro.disconnect();
    }, []);

    /** Pointer-interaction state (mutable refs to avoid re-render churn during drag/pan) */
    const interactionRef = useRef<{
        mode: "none" | "panning" | "dragging";
        dragNodeId: string | null;
        pressedNodeId: string | null;
        startMouse: { x: number; y: number };
        startOffset: { x: number; y: number };
        downPos: { x: number; y: number };
    }>({
        mode: "none",
        dragNodeId: null,
        pressedNodeId: null,
        startMouse: { x: 0, y: 0 },
        startOffset: { x: 0, y: 0 },
        downPos: { x: 0, y: 0 },
    });

    /** Convert a mouse event to screen-space (relative to canvas) and graph-space coords. */
    const toCoords = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>) => {
            const canvas = canvasRef.current;
            if (!canvas) return null;
            const rect = canvas.getBoundingClientRect();
            // Canvas is drawn in CSS-px logical space (the ctx is pre-scaled by devicePixelRatio),
            // so client px relative to the rect already match the drawing coords — no extra scaling.
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;
            return {
                screenX,
                screenY,
                graphX: (screenX - offset.x) / zoom,
                graphY: (screenY - offset.y) / zoom,
            };
        },
        [offset, zoom],
    );

    /** Hit-test the topmost node at the given graph coords. */
    const nodeAt = useCallback((graphX: number, graphY: number): SimNode | undefined => {
        return nodesRef.current.find((n) => {
            const dist = Math.sqrt((n.x! - graphX) ** 2 + (n.y! - graphY) ** 2);
            return dist < (n.size || 8) + 4;
        });
    }, []);

    const handleAction = useCallback(
        (action: GraphAction) => {
            if (action.event) {
                eventBus.emit(`UI:${action.event}`, {});
            }
        },
        [eventBus],
    );

    const handleNodeClick = useCallback(
        (node: GraphNode) => {
            if (nodeClickEvent) {
                eventBus.emit(`UI:${nodeClickEvent}`, { id: node.id, row: node });
            }
            onNodeClick?.(node);
        },
        [nodeClickEvent, eventBus, onNodeClick],
    );

    const groups = useMemo(
        () => [...new Set(propNodes.map((n) => n.group).filter(Boolean))] as string[],
        [propNodes],
    );

    // Stable content signatures so the layout effect doesn't re-fire when the parent passes a
    // fresh array reference with identical contents (which would loop setState forever).
    const nodesKey = useMemo(() => propNodes.map((n) => n.id).join("\u0001"), [propNodes]);
    const edgesKey = useMemo(
        () => propEdges.map((e) => `${e.source}\u0001${e.target}`).join("\u0001"),
        [propEdges],
    );

    // Initialize node positions
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || propNodes.length === 0) return;

        const viewW = logicalW;
        const viewH = height;
        // Virtual canvas: dense graphs (45 nodes + labels) need far more room than the visible
        // card. Lay out in a larger virtual space, then auto-fit the result back into view.
        const layoutScale = Math.max(1, Math.min(3, Math.sqrt(propNodes.length / 12)));
        const w = viewW * layoutScale;
        const h = viewH * layoutScale;
        // Theme font the labels render in — used to size the collision boxes so they match the text on screen.
        const labelFont = canvasTheme ? canvasTheme.faces[canvasTheme.label.font] : "system-ui";
        const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

        // Preserve settled positions across data changes so the graph doesn't re-explode
        // and re-settle every time nodes/edges change (e.g. expanding a merge badge).
        const prevPos = new Map<string, { x: number; y: number }>();
        for (const pn of nodesRef.current) if (pn.x != null && pn.y != null) prevPos.set(pn.id, { x: pn.x!, y: pn.y! });

        const simNodes: SimNode[] = propNodes.map((n, idx) => {
            const prev = prevPos.get(n.id);
            let x = prev?.x ?? n.x ?? 0;
            let y = prev?.y ?? n.y ?? 0;

            if (!prev && (!n.x || !n.y)) {
                if (layout === "circular") {
                    const angle = (idx / propNodes.length) * 2 * Math.PI;
                    const radius = Math.min(w, h) * 0.35;
                    x = w / 2 + radius * Math.cos(angle);
                    y = h / 2 + radius * Math.sin(angle);
                } else if (layout === "grid") {
                    const cols = Math.ceil(Math.sqrt(propNodes.length));
                    const gapX = w / (cols + 1);
                    const gapY = h / (Math.ceil(propNodes.length / cols) + 1);
                    x = gapX * ((idx % cols) + 1);
                    y = gapY * (Math.floor(idx / cols) + 1);
                } else {
                    // Force layout: deterministic seeded initial positions (stable per node id,
                    // so the same graph settles into the same layout on every load).
                    const rand = mulberry32(hashSeed(n.id));
                    x = w * 0.2 + rand() * w * 0.6;
                    y = h * 0.2 + rand() * h * 0.6;
                }
            }

            return { ...n, x, y, vx: 0, vy: 0 };
        });

        nodesRef.current = simNodes;

        // Relayout only on the very first layout, or when the node set changes substantially
        // (e.g. an L1→L2 drill is a different graph). React-Query refetches, window resize, and
        // badge-expand all preserve every settled position so the graph never "shifts around".
        const prevIds = new Set<string>([...prevPos.keys()]);
        const newIdList = simNodes.map((n) => n.id);
        const kept = newIdList.filter((id) => prevIds.has(id)).length;
        const overlap = prevIds.size === 0 ? 0 : kept / Math.max(prevIds.size, newIdList.length);
        const fullRelayout = !laidOutRef.current || overlap < 0.5;

        if (layout === "force") {
            if (fullRelayout) {
                const LABEL_GAP = 12; // label sits below the circle (matches render)
                const LABEL_H = 16; // one line of 12px text

                // Cache each node's TRUNCATED label width so the collide radius and the
                // rectangle cleanup keep rendered text from overlapping.
                for (const n of simNodes) n.labelW = showLabels && n.label ? measureLabelWidth(truncateLabel(n.label), labelFont) : 0;

                // Sparse similarity: each node keeps only its top-K strongest non-edge neighbors.
                // A dense full-matrix (45 paths → 990 pairs) makes every node attract every other,
                // collapsing clusters into a single hairball.
                const SIMILARITY_NEIGHBORS = 5;
                const SIMILARITY_MIN_WEIGHT = 0.25;
                const drawnPairs = new Set<string>();
                for (const edge of propEdges) drawnPairs.add(edgeKeyOf(edge.source, edge.target));
                const similarityNeighbors = new Map<string, Set<string>>();
                const bySource = new Map<string, GraphSimilarity[]>();
                for (const pair of propSimilarity) {
                    if (pair.weight < SIMILARITY_MIN_WEIGHT) continue;
                    if (drawnPairs.has(edgeKeyOf(pair.source, pair.target))) continue;
                    const arr = bySource.get(pair.source) ?? [];
                    arr.push(pair);
                    bySource.set(pair.source, arr);
                }
                for (const [id, arr] of bySource) {
                    arr.sort((a, b) => b.weight - a.weight);
                    similarityNeighbors.set(id, new Set(arr.slice(0, SIMILARITY_NEIGHBORS).map((p) => p.target)));
                }
                const activeSimilarity = propSimilarity.filter((pair) => {
                    if (drawnPairs.has(edgeKeyOf(pair.source, pair.target))) return false;
                    const a = similarityNeighbors.get(pair.source);
                    const b = similarityNeighbors.get(pair.target);
                    return (a?.has(pair.target) ?? false) || (b?.has(pair.source) ?? false);
                });

                // Per-group sector targets so same-group nodes form visible islands (deterministic,
                // arranged on a ring). A single-cluster graph falls back to gentle global centering.
                const groupTarget = new Map<string, { x: number; y: number }>();
                const multiCluster = groups.length > 1;
                if (multiCluster) {
                    const ring = Math.min(w, h) * 0.34;
                    groups.forEach((g, i) => {
                        const a = (i / groups.length) * 2 * Math.PI;
                        groupTarget.set(g, { x: w / 2 + ring * Math.cos(a), y: h / 2 + ring * Math.sin(a) });
                    });
                }

                const present = new Set(simNodes.map((n) => n.id));
                interface D3Link { source: string | SimNode; target: string | SimNode; weight: number }
                const edgeLinks: D3Link[] = propEdges
                    .filter((e) => present.has(e.source) && present.has(e.target))
                    .map((e) => ({ source: e.source, target: e.target, weight: clamp01(e.weight ?? 1) }));
                const simLinks: D3Link[] = activeSimilarity
                    .filter((p) => present.has(p.source) && present.has(p.target))
                    .map((p) => ({ source: p.source, target: p.target, weight: clamp01(p.weight) }));

                const collideRadius = (n: SimNode) => Math.max(n.size || 8, (n.labelW ?? 0) / 2) + nodeSpacing / 2;

                const simulation = forceSimulation<SimNode>(simNodes)
                    // Drawn edges are the PRIMARY structure: a strong, tight link (higher weight ⇒ shorter).
                    .force("edge", forceLink<SimNode, D3Link>(edgeLinks).id((d) => d.id).distance((l) => linkDistance * (0.35 + (1 - l.weight) * 0.3)).strength(0.9))
                    // Top-K similarity is the SECONDARY macro-layout: weak links so clusters arrange
                    // relative to each other without collapsing the whole graph.
                    .force("similarity", forceLink<SimNode, D3Link>(simLinks).id((d) => d.id).distance((l) => linkDistance * (1.35 - 0.55 * l.weight)).strength(0.03))
                    // Charge keeps unconnected nodes apart.
                    .force("charge", forceManyBody<SimNode>().strength(-repulsion * 0.5))
                    // Collide keeps node circles AND their (truncated) labels from overlapping.
                    .force("collide", forceCollide<SimNode>().radius(collideRadius).strength(0.9))
                    // Per-group sector gravity: grouped nodes are pulled toward their group's ring
                    // sector hard enough that same-color islands beat cross-cluster springs (see
                    // GROUP_GRAVITY); ungrouped nodes only get gentle global centering.
                    .force("x", forceX<SimNode>((n) => groupTarget.get(n.group ?? "")?.x ?? w / 2).strength((n) => (multiCluster && n.group ? GROUP_GRAVITY : UNGROUPED_GRAVITY)))
                    .force("y", forceY<SimNode>((n) => groupTarget.get(n.group ?? "")?.y ?? h / 2).strength((n) => (multiCluster && n.group ? GROUP_GRAVITY : UNGROUPED_GRAVITY)))
                    .stop();

                // Settle synchronously (no per-frame animation).
                for (let i = 0; i < 300; i++) simulation.tick();

                // d3's collide is circular, so it misses vertical label↔circle / label↔label
                // overlaps. A short rectangle pass resolves those without springs pulling back.
                const pad = nodeSpacing / 2;
                type Rect = readonly [number, number, number, number];
                const rectsOf = (n: SimNode): { circle: Rect; label: Rect } => {
                    const r = n.size || 8;
                    const lw = showLabels ? (n.labelW ?? 0) : 0;
                    return {
                        circle: [n.x! - r - pad, n.y! - r - pad, n.x! + r + pad, n.y! + r + pad],
                        label: [n.x! - lw / 2 - pad, n.y! + r + LABEL_GAP - 8, n.x! + lw / 2 + pad, n.y! + r + LABEL_GAP + LABEL_H],
                    };
                };
                const sep = (r1: Rect, r2: Rect): { axis: "x" | "y"; depth: number; sign: number } | null => {
                    const ox = Math.min(r1[2], r2[2]) - Math.max(r1[0], r2[0]);
                    const oy = Math.min(r1[3], r2[3]) - Math.max(r1[1], r2[1]);
                    if (ox <= 0 || oy <= 0) return null;
                    return ox <= oy
                        ? { axis: "x", depth: ox, sign: r1[0] + r1[2] < r2[0] + r2[2] ? 1 : -1 }
                        : { axis: "y", depth: oy, sign: r1[1] + r1[3] < r2[1] + r2[3] ? 1 : -1 };
                };
                for (let pass = 0; pass < 24; pass++) {
                    let moved = false;
                    for (let i = 0; i < simNodes.length; i++) {
                        for (let j = i + 1; j < simNodes.length; j++) {
                            const a = simNodes[i];
                            const b = simNodes[j];
                            const ra = rectsOf(a);
                            const rb = rectsOf(b);
                            let best: { axis: "x" | "y"; depth: number; sign: number } | null = null;
                            for (const [r1, r2] of [[ra.circle, rb.circle], [ra.circle, rb.label], [ra.label, rb.circle], [ra.label, rb.label]] as const) {
                                const s = sep(r1, r2);
                                if (s && (!best || s.depth < best.depth)) best = s;
                            }
                            if (best) {
                                moved = true;
                                const push = best.depth / 2;
                                if (best.axis === "x") {
                                    a.x = Math.max(30, Math.min(w - 30, a.x! - push * best.sign));
                                    b.x = Math.max(30, Math.min(w - 30, b.x! + push * best.sign));
                                } else {
                                    a.y = Math.max(30, Math.min(h - 30, a.y! - push * best.sign));
                                    b.y = Math.max(30, Math.min(h - 30, b.y! + push * best.sign));
                                }
                            }
                        }
                    }
                    if (!moved) break;
                }

                // Auto-fit the virtual layout into the visible viewport so dense graphs don't
                // appear cramped and the user sees the whole picture on first load.
                const fitPad = 40;
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const node of nodesRef.current) {
                    const r = node.size || 8;
                    const lw = showLabels ? (node.labelW ?? 0) : 0;
                    minX = Math.min(minX, node.x! - r, node.x! - lw / 2);
                    minY = Math.min(minY, node.y! - r);
                    maxX = Math.max(maxX, node.x! + r, node.x! + lw / 2);
                    maxY = Math.max(maxY, node.y! + r + LABEL_GAP + LABEL_H);
                }
                const bboxW = Math.max(1, maxX - minX + fitPad * 2);
                const bboxH = Math.max(1, maxY - minY + fitPad * 2);
                const nextZoom = Math.min(1, viewW / bboxW, viewH / bboxH);
                setZoom(nextZoom);
                setOffset({ x: fitPad - minX * nextZoom, y: fitPad - minY * nextZoom });

                laidOutRef.current = true;
            } else {
                // Patch only: keep every settled node where it is and place newly-appeared nodes
                // in a spiral around their cluster centroid (or canvas center if none).
                const centroids = new Map<string, { x: number; y: number; n: number }>();
                for (const node of simNodes) {
                    if (!prevPos.has(node.id)) continue;
                    const g = node.group ?? "__none__";
                    let c = centroids.get(g);
                    if (!c) { c = { x: 0, y: 0, n: 0 }; centroids.set(g, c); }
                    c.x += node.x!; c.y += node.y!; c.n += 1;
                }
                const ringCount = new Map<string, number>();
                for (const node of simNodes) {
                    if (prevPos.has(node.id)) continue;
                    const g = node.group ?? "__none__";
                    const c = centroids.get(g);
                    const cx = c && c.n > 0 ? c.x / c.n : w / 2;
                    const cy = c && c.n > 0 ? c.y / c.n : h / 2;
                    const k = ringCount.get(g) ?? 0;
                    ringCount.set(g, k + 1);
                    const angle = k * 2.399963; // golden-angle sunflower spiral
                    const r = 22 + k * 8;
                    node.x = Math.max(30, Math.min(w - 30, cx + r * Math.cos(angle)));
                    node.y = Math.max(30, Math.min(h - 30, cy + r * Math.sin(angle)));
                }
            }
            forceUpdate((n) => n + 1);
        } else {
            forceUpdate((n) => n + 1);
        }

        return () => {
            cancelAnimationFrame(animRef.current);
        };
    }, [nodesKey, edgesKey, propSimilarity, layout, repulsion, linkDistance, nodeSpacing, showLabels]);

    // Render
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const w = logicalW;
        const h = height;
        const nodes = nodesRef.current;
        if (!canvasTheme) return;
        const theme = canvasTheme;
        const accentColor = theme.tones.highlight;
        const fgColor = theme.tones.ink;
        const mutedColor = theme.tones.guide;
        const bgColor = theme.ground;
        const accentFg = theme.ground;
        const strokes = theme.strokes;
        const font = (role: "xs" | "sm", weight?: string) => {
            const f = themeLabelFont(theme, { textSize: role });
            return weight ? f.font.replace(/^\S+/, weight) : f.font;
        };
        // A translucent ink ring keeps unselected nodes crisp against crossing edges.
        const fgResolved = resolveThemeColor("var(--color-diagram-ink)", canvas);
        const nodeRingColor = fgResolved ? `rgba(${fgResolved.r}, ${fgResolved.g}, ${fgResolved.b}, 0.13)` : fgColor;
        const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;

        // Pre-scale by devicePixelRatio so the backing store renders crisp on HiDPI displays.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.translate(offset.x, offset.y);
        ctx.scale(zoom, zoom);

        // When hovering a node, the connected nodes/edges stay lit and the rest dim.
        const neighbors = new Set<string>();
        if (hoveredNode) {
            neighbors.add(hoveredNode);
            for (const edge of propEdges) {
                if (edge.source === hoveredNode) neighbors.add(String(edge.target));
                else if (edge.target === hoveredNode) neighbors.add(String(edge.source));
            }
        }

        // Draw edges
        for (const edge of propEdges) {
            const source = nodes.find((n) => n.id === edge.source);
            const target = nodes.find((n) => n.id === edge.target);
            if (!source || !target) continue;

            const incident = !!hoveredNode && (edge.source === hoveredNode || edge.target === hoveredNode);
            // Links stay faint by default so a dense graph reads as a backdrop; the edges
            // incident to a hovered node light up while the rest drop further back.
            const stroke = edgeStroke(edge.weight, linkOpacity, strokes);
            ctx.globalAlpha = hoveredNode ? (incident ? 1 : 0.05) : stroke.alpha;
            ctx.beginPath();
            ctx.moveTo(source.x!, source.y!);
            ctx.lineTo(target.x!, target.y!);
            const edgeColor = incident ? accentColor : (edge.color ? markColor(theme, edge.color, canvas, "guide") : mutedColor);
            applyLineCharacter(ctx, theme, edgeColor);
            ctx.strokeStyle = edgeColor;
            ctx.lineWidth = incident ? strokes.bold : stroke.width;
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Edge label
            if (edge.label && showLabels) {
                const mx = (source.x! + target.x!) / 2;
                const my = (source.y! + target.y!) / 2;
                ctx.fillStyle = mutedColor;
                ctx.font = font("xs");
                ctx.textAlign = "center";
                ctx.textBaseline = "alphabetic";
                fillLabel(ctx, theme, labelText(theme, edge.label), mx, my - 4);
            }
        }
        ctx.globalAlpha = 1;

        // Proposed (uncommitted) edges — dashed/faint, never part of the layout springs.
        ctx.setLineDash([...theme.dash]);
        for (const edge of proposedEdges) {
            const source = nodes.find(n => n.id === edge.source);
            const target = nodes.find(n => n.id === edge.target);
            if (!source || !target) continue;
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.moveTo(source.x!, source.y!);
            ctx.lineTo(target.x!, target.y!);
            ctx.strokeStyle = edge.color ? markColor(theme, edge.color, canvas, "guide") : mutedColor;
            ctx.lineWidth = strokes.thin;
            ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        // Draw nodes
        for (const node of nodes) {
            const size = node.size || 8;
            const color = markColor(theme, node.color || getGroupColor(node.group, groups), canvas, "series-1");
            const isHovered = hoveredNode === node.id;
            const isSelected = selectedNodeId !== undefined && node.id === selectedNodeId;
            const mark = node.mark;

            ctx.globalAlpha = hoveredNode && !neighbors.has(node.id) ? 0.2 : (mark?.kind === 'proposed' ? 0.55 : 1);
            const radius = isSelected ? size + 4 : isHovered ? size + 2 : size;

            // Node circle
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, radius, 0, Math.PI * 2);
            ctx.fillStyle = mark?.kind === 'proposed' ? mutedColor : color;
            ctx.fill();
            if (mark?.kind === 'proposed') {
                ctx.setLineDash([...theme.dot]);
                ctx.strokeStyle = markColor(theme, mark.tint, canvas, "warning");
                ctx.lineWidth = strokes.normal;
            } else if (isSelected) {
                ctx.strokeStyle = accentColor;
                ctx.lineWidth = strokes.bold;
            } else {
                ctx.strokeStyle = isHovered ? bgColor : nodeRingColor;
                ctx.lineWidth = isHovered ? strokes.normal : strokes.thin;
            }
            ctx.stroke();
            ctx.setLineDash([]);

            // Suggestion/proposal overlay decoration.
            if (mark?.kind === 'suggested') {
                // Accent ring + indicator dot (distinct from the merge-cluster badge slot).
                ctx.beginPath();
                ctx.arc(node.x!, node.y!, radius + 3, 0, Math.PI * 2);
                ctx.strokeStyle = accentColor;
                ctx.lineWidth = strokes.normal;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(node.x! + radius * 0.7, node.y! - radius * 0.7, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = accentColor;
                ctx.fill();
            } else if (mark?.kind === 'proposed') {
                // Ambient pulse ring — phase advances only while a proposed node is on screen.
                const phase = (pulseTick % 60) / 60;
                const baseAlpha = hoveredNode && !neighbors.has(node.id) ? 0.2 : 0.55;
                ctx.globalAlpha = baseAlpha * (0.4 + 0.4 * (1 - Math.abs(phase * 2 - 1)));
                ctx.beginPath();
                ctx.arc(node.x!, node.y!, radius + 6 + Math.sin(phase * Math.PI * 2) * 3, 0, Math.PI * 2);
                ctx.strokeStyle = markColor(theme, mark.tint, canvas, "warning");
                ctx.lineWidth = strokes.normal;
                ctx.stroke();
                ctx.globalAlpha = baseAlpha;
            }

            if (showLabels && node.label) {
                const displayLabel = labelText(theme, truncateLabel(node.label));
                ctx.font = font("sm", isSelected || isHovered ? "700" : undefined);
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = fgColor;
                fillLabel(ctx, theme, displayLabel, node.x!, node.y! + radius + 14);
            }

            // Merge-count badge (top-right) — click expands the cluster.
            if (node.badge && node.badge > 1) {
                const bx = node.x! + radius * 0.7;
                const by = node.y! - radius * 0.7;
                const br = Math.max(7, Math.min(11, radius * 0.45));
                ctx.beginPath();
                ctx.arc(bx, by, br, 0, Math.PI * 2);
                ctx.fillStyle = accentColor;
                ctx.fill();
                ctx.strokeStyle = bgColor;
                ctx.lineWidth = strokes.normal;
                ctx.stroke();
                ctx.fillStyle = accentFg;
                ctx.font = font("xs", "600");
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(String(node.badge), bx, by + 0.5);
            }
        }

        ctx.restore();
    });

    const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z * 1.2, 3)), []);
    const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z / 1.2, 0.3)), []);
    const handleReset = useCallback(() => {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
    }, []);

    // Zoom by `factor` keeping the canvas point (cx,cy) fixed. Shared by wheel + pinch
    // (via useCanvasGestures). Refs avoid stale zoom/offset inside the gesture callbacks.
    const applyZoom = useCallback((factor: number, cx: number, cy: number) => {
        if (!interactive) return;
        const oldZoom = zoomRef.current;
        const newZoom = Math.max(0.3, Math.min(3, oldZoom * factor));
        if (newZoom === oldZoom) return;
        const o = offsetRef.current;
        setOffset({
            x: cx - (cx - o.x) * (newZoom / oldZoom),
            y: cy - (cy - o.y) * (newZoom / oldZoom),
        });
        setZoom(newZoom);
    }, [interactive]);

    const applyPanDelta = useCallback((dx: number, dy: number) => {
        if (!interactive) return;
        setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
    }, [interactive]);

    // A second finger started a pinch — abandon any single-pointer pan/drag in progress.
    const cancelSinglePointer = useCallback(() => {
        interactionRef.current.mode = "none";
        interactionRef.current.dragNodeId = null;
        interactionRef.current.pressedNodeId = null;
    }, []);

    const handlePointerDown = useCallback(
        (e: React.PointerEvent<HTMLCanvasElement>) => {
            const coords = toCoords(e);
            if (!coords) return;
            const node = nodeAt(coords.graphX, coords.graphY);
            const state = interactionRef.current;
            state.downPos = { x: e.clientX, y: e.clientY };
            state.startMouse = { x: e.clientX, y: e.clientY };
            state.startOffset = { ...offset };

            state.pressedNodeId = node?.id ?? null;
            if (draggable && node) {
                state.mode = "dragging";
                state.dragNodeId = node.id;
            } else if (interactive) {
                state.mode = "panning";
                state.dragNodeId = null;
            } else {
                state.mode = "none";
                state.dragNodeId = null;
            }
        },
        [toCoords, nodeAt, draggable, interactive, offset],
    );

    const handlePointerMove = useCallback(
        (e: React.PointerEvent<HTMLCanvasElement>) => {
            const state = interactionRef.current;

            if (state.mode === "panning") {
                const dx = e.clientX - state.startMouse.x;
                const dy = e.clientY - state.startMouse.y;
                setOffset({ x: state.startOffset.x + dx, y: state.startOffset.y + dy });
                return;
            }

            if (state.mode === "dragging" && state.dragNodeId) {
                const coords = toCoords(e);
                if (!coords) return;
                const node = nodesRef.current.find((n) => n.id === state.dragNodeId);
                if (node) {
                    node.x = coords.graphX;
                    node.y = coords.graphY;
                    node.vx = 0;
                    node.vy = 0;
                    forceUpdate((n) => n + 1);
                }
                return;
            }

            // Hover hit-test when idle
            const coords = toCoords(e);
            if (!coords) return;
            const node = nodeAt(coords.graphX, coords.graphY);
            setHoveredNode(node?.id ?? null);
        },
        [toCoords, nodeAt],
    );

    const handlePointerUp = useCallback(
        (e: React.PointerEvent<HTMLCanvasElement>) => {
            const state = interactionRef.current;
            const moved =
                Math.abs(e.clientX - state.downPos.x) + Math.abs(e.clientY - state.downPos.y);
            state.mode = "none";
            state.dragNodeId = null;

            // Treat as a click only if the pointer barely moved (not a drag/pan).
            if (moved < 4) {
                const coords = toCoords(e);
                if (!coords) return;
                // Resolve to the node pressed at pointer-down: the force sim may have
                // drifted it by release, so a fresh hit-test would miss it.
                const node = (state.pressedNodeId
                    ? nodesRef.current.find((n) => n.id === state.pressedNodeId)
                    : undefined) ?? nodeAt(coords.graphX, coords.graphY);
                state.pressedNodeId = null;
                if (node) {
                    // Badge (top-right) takes priority when present.
                    if (node.badge && node.badge > 1 && onBadgeClick) {
                        const r = (node.size || 8) + (selectedNodeId === node.id ? 4 : 0);
                        const bx = node.x! + r * 0.7;
                        const by = node.y! - r * 0.7;
                        const br = Math.max(7, Math.min(11, r * 0.45)) + 3;
                        if (Math.hypot(coords.graphX - bx, coords.graphY - by) <= br) {
                            onBadgeClick(node);
                            return;
                        }
                    }
                    // Marked node (suggestion/proposal target) takes priority over a plain click.
                    if (node.mark && onMarkClick) {
                        onMarkClick(node);
                        return;
                    }
                    handleNodeClick(node);
                }
            }
        },
        [toCoords, nodeAt, handleNodeClick, onBadgeClick, onMarkClick, selectedNodeId],
    );

    const handlePointerLeave = useCallback(() => {
        setHoveredNode(null);
        interactionRef.current.pressedNodeId = null;
    }, []);

    const gestureHandlers = useCanvasGestures({
        canvasRef,
        enabled: interactive || draggable,
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
        onZoom: applyZoom,
        onPanDelta: applyPanDelta,
        onMultiTouchStart: cancelSinglePointer,
    });

    // Attach wheel as a NATIVE non-passive listener so preventDefault() inside
    // the gesture handler actually fires (React's onWheel is passive → the page
    // would scroll while zooming the canvas).
    const wheelHandler = gestureHandlers.onWheel;
    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        el.addEventListener('wheel', wheelHandler, { passive: false });
        return () => el.removeEventListener('wheel', wheelHandler);
    }, [wheelHandler]);

    const handleDoubleClick = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement>) => {
            const coords = toCoords(e);
            if (!coords) return;
            const node = nodeAt(coords.graphX, coords.graphY);
            if (node) onNodeDoubleClick?.(node);
        },
        [toCoords, nodeAt, onNodeDoubleClick],
    );

    // Canvas has no per-node DOM nodes, so a truncated label's full text is shown in a
    // theme-matching tooltip positioned at the hovered node's screen coordinates.
    const hoveredObj = hoveredNode ? nodesRef.current.find((n) => n.id === hoveredNode) : undefined;
    const canvasEl = canvasRef.current;
    const showLabelTooltip = Boolean(
        hoveredObj?.label && hoveredObj.label.length > MAX_LABEL_CHARS && hoveredObj.x != null && canvasEl
    );
    const labelTooltipStyle: React.CSSProperties | undefined = (() => {
        if (!showLabelTooltip || !canvasEl || !hoveredObj || hoveredObj.x == null || hoveredObj.y == null) return undefined;
        const rect = canvasEl.getBoundingClientRect();
        return {
            left: rect.left + offset.x + hoveredObj.x * zoom,
            top: rect.top + offset.y + hoveredObj.y * zoom - 10,
            transform: "translate(-50%, -100%)",
        };
    })();

    if (isLoading) {
        return <LoadingState message={t('common.loading')} className={className} />;
    }

    if (error) {
        return (
            <ErrorState
                title={t('display.graphError')}
                message={error.message}
                className={className}
            />
        );
    }

    if (propNodes.length === 0) {
        return (
            <EmptyState
                title={t('display.noGraphData')}
                description={t('graphCanvas.noNodes')}
                className={className}
            />
        );
    }

    return (
        <Card className={cn("overflow-hidden", className)}>
            <VStack gap="none">
                {/* Header */}
                {(title || (actions && actions.length > 0) || interactive) && (
                    <HStack
                        gap="sm"
                        align="center"
                        justify="between"
                        className="px-4 py-2 border-b border-border"
                    >
                        {title && (
                            <Typography variant="h6">
                                {title}
                            </Typography>
                        )}
                        <HStack gap="xs" align="center">
                            {interactive && (
                                <>
                                    <Button variant="ghost" size="sm" icon={ZoomOut} onClick={handleZoomOut} aria-label={t('avl.zoomOut')} />
                                    <Button variant="ghost" size="sm" icon={ZoomIn} onClick={handleZoomIn} aria-label={t('avl.zoomIn')} />
                                    <Button variant="ghost" size="sm" icon={RotateCcw} onClick={handleReset} aria-label={t('common.reset')} />
                                </>
                            )}
                            {actions?.map((action, idx) => (
                                <Badge
                                    key={idx}
                                    variant="default"
                                    className="cursor-pointer hover:opacity-80 transition-opacity"
                                    onClick={() => handleAction(action)}
                                >
                                    {action.label}
                                </Badge>
                            ))}
                        </HStack>
                    </HStack>
                )}

                {/* Canvas — necessary for performant graph rendering */}
                <Box className="w-full bg-background">
                    <canvas
                        ref={canvasRef}
                        width={Math.round(logicalW * ((typeof window !== "undefined" && window.devicePixelRatio) || 1))}
                        height={Math.round(height * ((typeof window !== "undefined" && window.devicePixelRatio) || 1))}
                        className="w-full cursor-grab active:cursor-grabbing touch-none"
                        style={{ height }}
                        onPointerDown={gestureHandlers.onPointerDown}
                        onPointerMove={gestureHandlers.onPointerMove}
                        onPointerUp={gestureHandlers.onPointerUp}
                        onPointerCancel={gestureHandlers.onPointerCancel}
                        onPointerLeave={handlePointerLeave}
                        onDoubleClick={handleDoubleClick}
                        role="img"
                        aria-label={title ?? t('aria.graphCanvas')}
                        aria-describedby={description ? descId : undefined}
                        {...domPassthrough(rest)}
                    />
                    {description && <Box id={descId} className="sr-only">{description}</Box>}
                    {typeof window !== "undefined" && showLabelTooltip && labelTooltipStyle && (<ThemedPortal>{
                        <div
                            className={cn(
                                "fixed z-50 px-3 py-2 max-w-xs",
                                "bg-primary text-primary-foreground",
                                "shadow-elevation-popover rounded-container",
                                "text-sm pointer-events-none",
                                "break-words whitespace-normal"
                            )}
                            style={labelTooltipStyle}
                            role="tooltip"
                        >
                            {hoveredObj?.label}
                        </div>}</ThemedPortal>)}
                </Box>

                {/* Legend */}
                {groups.length > 1 && (
                    <HStack gap="md" className="px-4 py-2 border-t border-border" wrap>
                        {groups.map((group, idx) => (
                            <HStack key={group} gap="xs" align="center">
                                <Box
                                    className="w-3 h-3 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: GROUP_COLORS[idx % GROUP_COLORS.length] }}
                                />
                                <Typography variant="caption" color="secondary">
                                    {group}
                                </Typography>
                            </HStack>
                        ))}
                    </HStack>
                )}
            </VStack>
        </Card>
    );
};

GraphCanvas.displayName = "GraphCanvas";
