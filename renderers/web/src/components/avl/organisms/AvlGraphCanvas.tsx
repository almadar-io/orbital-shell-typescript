'use client';
/**
 * AvlGraphCanvas — the chrome every AVL graph shares: the zoom range, fitting the graph with
 * a lens's padding, the dotted background, and zoom controls (hidden on compact screens,
 * which pinch-zoom). A lens supplies its nodes, node types and handlers. Must sit inside a
 * `ReactFlowProvider`.
 */
import React from 'react';
import { ReactFlow, Controls, Background, BackgroundVariant, type Edge, type Node, type NodeTypes, type ReactFlowProps } from '@xyflow/react';
import { DependencyNode, DependencyColumnNode } from '../molecules/SystemNode';

/** Node types for a layered graph (`layeredGraph`): pills and their column headers. */
export const AVL_GRAPH_NODE_TYPES: NodeTypes = {
  dependency: DependencyNode,
  dependencyColumn: DependencyColumnNode,
};

export type AvlGraphCanvasProps<N extends Node = Node, E extends Edge = Edge> = ReactFlowProps<N, E> & {
  /** Space around the fitted graph, as a fraction of the viewport. */
  fitPadding: number;
  /** Compact screens pinch-zoom, so the zoom controls are hidden. */
  compact?: boolean;
};

export function AvlGraphCanvas<N extends Node = Node, E extends Edge = Edge>({ fitPadding, compact = false, children, ...flow }: AvlGraphCanvasProps<N, E>): React.ReactElement {
  return (
  <ReactFlow<N, E>
    zoomOnDoubleClick={false}
    minZoom={0.1}
    maxZoom={2.0}
    fitView
    fitViewOptions={{ padding: fitPadding }}
    proOptions={{ hideAttribution: true }}
    style={{ background: 'var(--color-background)' }}
    {...flow}
  >
    {!compact && (
      <Controls
        showInteractive={false}
        style={{
          background: 'var(--color-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
        }}
      />
    )}
    <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-border)" />
    {children}
  </ReactFlow>
  );
}
