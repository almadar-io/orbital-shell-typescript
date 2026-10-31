'use client';
/**
 * GraphView Molecule Component
 *
 * Pure presentational force-directed graph visualization using SVG.
 * Entity-less, no event bus, no translations. Accepts raw nodes and edges.
 *
 * Uses a simple force simulation (repulsion + attraction + centering)
 * to lay out nodes, then renders via SVG circles and lines.
 */

import React, { useRef, useEffect, useState, useCallback, useMemo, useId } from 'react';
import { cn } from '../../../core';
import { Box } from '../../../core';
import { useTranslate } from '../../../core';
import { useContentSurface } from '../../../core';
import type { SurfaceMode } from '@almadar/core';
import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { pressableProps } from '../../../core';
import { computeStaticLayout, type GraphViewLayout } from '../../../lib/graphViewLayouts';
import { THEME_SERIES } from '../../../lib/theme-color';

export type GraphViewNode = {
  id: string;
  label?: string;
  color?: string;
  size?: number;
  group?: string;
};

export interface GraphViewEdge {
  source: string;
  target: string;
  color?: string;
  label?: string;
}

export interface GraphViewProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Graph nodes */
  nodes: GraphViewNode[];
  /** Graph edges */
  edges: GraphViewEdge[];
  /** Callback when a node is clicked */
  onNodeClick?: (node: GraphViewNode) => void;
  /**
   * Callback when a node is hovered (null on leave)
   * @notification
   */
  onNodeHover?: (node: GraphViewNode | null) => void;
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
  /** Content surface: `auto` paints the theme's surface behind this block unless it already sits on one (a card, dialog or another block); `none` opts out. */
  surface?: SurfaceMode;
  /** Additional CSS classes */
  className?: string;
  /** Show node labels (default true) */
  showLabels?: boolean;
  /** Auto zoom-to-fit after layout settles (default true) */
  zoomToFit?: boolean;
  /**
   * Layout mode. force = physics simulation (default); flow = layered
   * left-to-right process flow; tree = top-down hierarchy tiers from the
   * roots; radial = concentric rings by depth (a pure cycle renders as a
   * single ring). Non-force layouts are deterministic.
   * @tier domain
   * @synonyms layout mode, flow layout, tree layout, radial layout, hierarchy layout
   */
  layout?: 'force' | 'flow' | 'tree' | 'radial';
}

/** Default group colors — the shared semantic series every chart/diagram draws from. SVG evaluates var() directly. */
export const GROUP_COLORS = THEME_SERIES;

export const DEFAULT_NODE_COLOR = 'var(--color-muted-foreground)';
export const DEFAULT_EDGE_COLOR = 'var(--color-border)';
const DEFAULT_NODE_SIZE = 8;

interface SimNode {
  id: string;
  label?: string;
  color: string;
  size: number;
  group?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
}

/** Space between an arrowhead's tip and the target node's rim. */
export const EDGE_ARROW_GAP = 3;

/** An edge drawn rim to rim, so the arrowhead at its end is not painted over by the target circle. */
export function edgeEndpoints(
  source: { x: number; y: number; size: number },
  target: { x: number; y: number; size: number },
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const d = Math.hypot(dx, dy);
  if (d <= source.size + target.size + EDGE_ARROW_GAP) {
    return { x1: source.x, y1: source.y, x2: target.x, y2: target.y };
  }
  const ux = dx / d;
  const uy = dy / d;
  return {
    x1: source.x + ux * source.size,
    y1: source.y + uy * source.size,
    x2: target.x - ux * (target.size + EDGE_ARROW_GAP),
    y2: target.y - uy * (target.size + EDGE_ARROW_GAP),
  };
}

function resolveNodeColor(node: GraphViewNode, groups: string[]): string {
  if (node.color) return node.color;
  if (node.group) {
    const idx = groups.indexOf(node.group);
    return GROUP_COLORS[idx % GROUP_COLORS.length];
  }
  return DEFAULT_NODE_COLOR;
}

export const GraphView: React.FC<GraphViewProps> = ({
  nodes,
  edges,
  onNodeClick,
  onNodeHover,
  width: propWidth,
  height: propHeight,
  className,
  showLabels = true,
  zoomToFit = true,
  layout = 'force',
  surface = 'auto',
  ...rest
}) => {
  const contentSurface = useContentSurface(surface);
  const { t } = useTranslate();
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const arrowMarkerId = useId();
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const [settled, setSettled] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: propWidth ?? 600, height: propHeight ?? 400 });

  const w = propWidth ?? dimensions.width;
  const h = propHeight ?? dimensions.height;

  // Collect unique groups for color assignment
  const groups = useMemo(
    () => [...new Set(nodes.map((n) => n.group).filter((g): g is string => Boolean(g)))],
    [nodes],
  );

  // Build edge lookup for hover highlighting
  const connectedIds = useMemo(() => {
    if (!hoveredId) return new Set<string>();
    const connected = new Set<string>([hoveredId]);
    for (const edge of edges) {
      if (edge.source === hoveredId) connected.add(edge.target);
      if (edge.target === hoveredId) connected.add(edge.source);
    }
    return connected;
  }, [hoveredId, edges]);

  // Auto-size to container when no explicit dimensions
  useEffect(() => {
    if (propWidth && propHeight) return;
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      setDimensions({
        width: el.clientWidth || 600,
        height: el.clientHeight || 400,
      });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [propWidth, propHeight]);

  // Force simulation
  useEffect(() => {
    if (nodes.length === 0) {
      setSimNodes([]);
      setSettled(true);
      return;
    }

    const initialNodes: SimNode[] = nodes.map((n, idx) => {
      const angle = (idx / nodes.length) * 2 * Math.PI;
      const radius = Math.min(w, h) * 0.3;
      return {
        id: n.id,
        label: n.label,
        color: resolveNodeColor(n, groups),
        size: n.size ?? DEFAULT_NODE_SIZE,
        group: n.group,
        x: w / 2 + radius * Math.cos(angle) + (Math.random() - 0.5) * 20,
        y: h / 2 + radius * Math.sin(angle) + (Math.random() - 0.5) * 20,
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
      };
    });

    if (layout !== 'force') {
      const points = computeStaticLayout(layout, {
        nodeIds: nodes.map((n) => n.id),
        edges,
        width: w,
        height: h,
      });
      const pointById = new Map(points.map((p) => [p.id, p]));
      const laidOut = initialNodes.map((node) => {
        const point = pointById.get(node.id);
        return point ? { ...node, x: point.x, y: point.y } : node;
      });
      setSimNodes(laidOut);
      setSettled(true);
      return;
    }

    let iterations = 0;
    const maxIterations = 120;
    let currentNodes = initialNodes;

    const tick = () => {
      const centerX = w / 2;
      const centerY = h / 2;

      // Reset forces
      for (const node of currentNodes) {
        node.fx = 0;
        node.fy = 0;
      }

      // Repulsion between all node pairs
      for (let i = 0; i < currentNodes.length; i++) {
        for (let j = i + 1; j < currentNodes.length; j++) {
          const a = currentNodes[i];
          const b = currentNodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 800 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.fx -= fx;
          a.fy -= fy;
          b.fx += fx;
          b.fy += fy;
        }
      }

      // Attraction along edges
      for (const edge of edges) {
        const source = currentNodes.find((n) => n.id === edge.source);
        const target = currentNodes.find((n) => n.id === edge.target);
        if (!source || !target) continue;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 100) * 0.05;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        source.fx += fx;
        source.fy += fy;
        target.fx -= fx;
        target.fy -= fy;
      }

      // Center gravity
      for (const node of currentNodes) {
        node.fx += (centerX - node.x) * 0.01;
        node.fy += (centerY - node.y) * 0.01;
      }

      // Apply forces with damping
      const damping = 0.85;
      const margin = 40;
      for (const node of currentNodes) {
        node.vx = (node.vx + node.fx) * damping;
        node.vy = (node.vy + node.fy) * damping;
        node.x += node.vx;
        node.y += node.vy;
        node.x = Math.max(margin, Math.min(w - margin, node.x));
        node.y = Math.max(margin, Math.min(h - margin, node.y));
      }

      iterations++;
      setSimNodes([...currentNodes]);

      if (iterations < maxIterations) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        setSettled(true);
      }
    };

    setSettled(false);
    animRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [nodes, edges, w, h, groups, layout]);

  // Compute viewBox for zoom-to-fit
  const viewBox = useMemo(() => {
    if (!zoomToFit || !settled || simNodes.length === 0) {
      return `0 0 ${w} ${h}`;
    }
    const pad = 60;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of simNodes) {
      minX = Math.min(minX, node.x - node.size);
      minY = Math.min(minY, node.y - node.size);
      maxX = Math.max(maxX, node.x + node.size);
      maxY = Math.max(maxY, node.y + node.size);
    }
    const fitW = maxX - minX + pad * 2;
    const fitH = maxY - minY + pad * 2;
    return `${minX - pad} ${minY - pad} ${fitW} ${fitH}`;
  }, [zoomToFit, settled, simNodes, w, h]);

  // Build a node lookup map for edge rendering
  const nodeMap = useMemo(() => {
    const map = new Map<string, SimNode>();
    for (const n of simNodes) {
      map.set(n.id, n);
    }
    return map;
  }, [simNodes]);

  const handleNodeMouseEnter = useCallback(
    (node: SimNode) => {
      setHoveredId(node.id);
      if (onNodeHover) {
        onNodeHover({ id: node.id, label: node.label, color: node.color, size: node.size, group: node.group });
      }
    },
    [onNodeHover],
  );

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredId(null);
    if (onNodeHover) {
      onNodeHover(null);
    }
  }, [onNodeHover]);

  const handleNodeClickInternal = useCallback(
    (node: SimNode) => {
      if (onNodeClick) {
        onNodeClick({ id: node.id, label: node.label, color: node.color, size: node.size, group: node.group });
      }
    },
    [onNodeClick],
  );

  // Touch/pen has no hover: a tap fires the SAME hover + click callbacks the mouse path uses.
  const handleNodePointerDown = useCallback(
    (e: React.PointerEvent, node: SimNode) => {
      if (e.pointerType === 'mouse') return;
      handleNodeMouseEnter(node);
      handleNodeClickInternal(node);
    },
    [handleNodeMouseEnter, handleNodeClickInternal],
  );

  if (nodes.length === 0) {
    return (
      <Box className={cn('flex items-center justify-center', className)} style={{ width: w, height: h }}>
        <Box className="text-muted-foreground text-sm">{t('display.noGraphData')}</Box>
      </Box>
    );
  }

  return contentSurface.provide(
    <Box
      ref={containerRef}
      role={onNodeClick ? 'group' : 'img'}
      aria-label={rest['aria-label'] ?? t('aria.graph')}
      {...domPassthrough(rest)}
      className={cn('relative overflow-hidden', contentSurface.className, className)}
      style={{ width: propWidth ?? '100%', height: h }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
      >
        {layout !== 'force' && (
          <defs>
            <marker
              id={arrowMarkerId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
            </marker>
          </defs>
        )}

        {/* Edges */}
        {edges.map((edge, idx) => {
          const source = nodeMap.get(edge.source);
          const target = nodeMap.get(edge.target);
          if (!source || !target) return null;

          const isHighlighted = hoveredId
            ? connectedIds.has(edge.source) && connectedIds.has(edge.target)
            : true;
          const ends = layout !== 'force'
            ? edgeEndpoints(source, target)
            : { x1: source.x, y1: source.y, x2: target.x, y2: target.y };

          return (
            <g key={`edge-${idx}`}>
              <line
                x1={ends.x1}
                y1={ends.y1}
                x2={ends.x2}
                y2={ends.y2}
                stroke={edge.color ?? DEFAULT_EDGE_COLOR}
                color={edge.color ?? DEFAULT_EDGE_COLOR}
                strokeWidth={1.5}
                opacity={isHighlighted ? 0.8 : 0.15}
                markerEnd={layout !== 'force' ? `url(#${arrowMarkerId})` : undefined}
              />
              {showLabels && edge.label && (
                <text
                  x={(source.x + target.x) / 2}
                  y={(source.y + target.y) / 2 - 6}
                  textAnchor="middle"
                  fill="var(--color-muted-foreground)"
                  fontSize={9}
                  opacity={isHighlighted ? 0.9 : 0.2}
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {simNodes.map((node) => {
          const isHighlighted = hoveredId ? connectedIds.has(node.id) : true;
          const isHovered = hoveredId === node.id;

          return (
            <g
              key={node.id}
              style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
              onMouseEnter={() => handleNodeMouseEnter(node)}
              onMouseLeave={handleNodeMouseLeave}
              {...pressableProps<SVGGElement>(onNodeClick ? () => handleNodeClickInternal(node) : undefined)}
              {...(onNodeClick
                ? {
                    'aria-label': node.group ? `${node.label ?? node.id}, ${node.group}` : (node.label ?? node.id),
                    onFocus: () => handleNodeMouseEnter(node),
                    onBlur: handleNodeMouseLeave,
                  }
                : undefined)}
              onPointerDown={(e) => handleNodePointerDown(e, node)}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={isHovered ? node.size * 1.4 : node.size}
                fill={node.color}
                opacity={isHighlighted ? 1 : 0.3}
                stroke={isHovered ? 'var(--color-background)' : 'none'}
                strokeWidth={isHovered ? 2 : 0}
              />
              {showLabels && (
                <text
                  x={node.x}
                  y={node.y + node.size + 12}
                  textAnchor="middle"
                  fill="var(--color-foreground)"
                  fontSize={11}
                  fontWeight={isHovered ? 'bold' : 'normal'}
                  opacity={isHighlighted ? 0.9 : 0.2}
                >
                  {node.label ?? node.id}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </Box>,
  );
};

GraphView.displayName = 'GraphView';

export default GraphView;
