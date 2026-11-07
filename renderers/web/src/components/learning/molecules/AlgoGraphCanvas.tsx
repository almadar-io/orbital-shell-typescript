'use client';

/**
 * AlgoGraphCanvas
 *
 * A field-scoped learning molecule for graph algorithms: nodes in a deterministic layout, edges and node badges,
 * mapped and drawn by orbital-canvas.
 *
 * @packageDocumentation
 */

import * as React from 'react';
import { useMemo } from 'react';
import type { A11yProps, EventKey, PatternConfig } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { Card, Typography } from '../../../core';
import { VStack } from '../../../core';
import { LearningCanvasState, shapeClickCallbacks } from '../atoms/LearningCanvas';
import type { LearningPoint, LearningReadout, LearningShape, LearningTracePanel } from '../atoms/LearningCanvas';
import type { UiError } from '../../../core';
import { OrbitalSceneCanvas } from '../../../lib/drawable/orbital/OrbitalSceneCanvas';
import { nodeClickPayload } from '../../../lib/drawable/orbital/sceneConfig';

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


export const AlgoGraphCanvas: React.FC<AlgoGraphCanvasProps> = ({
  className,
  title,
  width = 600,
  height = 400,
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
  const config = useMemo<PatternConfig<'algo-graph-canvas'>>(
    () => ({
      type: 'algo-graph-canvas',
      width,
      height,
      backgroundColor,
      series,
      keyMap,
      keyUpMap,
      nodes,
      edges,
      layout,
      root,
      shapes,
      interactive,
      animate,
    }),
    [width, height, backgroundColor, series, keyMap, keyUpMap, nodes, edges, layout, root, shapes, interactive, animate],
  );
  const callbacks = useMemo(
    () => ({
      ...shapeClickCallbacks(onShapeClick),
      ...(onNodeClick
        ? {
            onNodeClick: (delivered: Parameters<typeof nodeClickPayload>[0]) => {
              const payload = nodeClickPayload(delivered);
              if (payload) onNodeClick(payload);
            },
          }
        : {}),
    }),
    [onShapeClick, onNodeClick],
  );

  if (isLoading || error) {
    return (
      <Card {...domPassthrough(rest)} className={className}>
        <VStack gap="sm">
          {title ? <Typography variant="h4">{title}</Typography> : null}
          <LearningCanvasState width={width ?? 600} height={height ?? 400} isLoading={isLoading} error={error} />
        </VStack>
      </Card>
    );
  }

  return (
    <Card {...domPassthrough(rest)} className={className}>
      <VStack gap="sm">
        {title ? <Typography variant="h4">{title}</Typography> : null}
        <OrbitalSceneCanvas pattern="algo-graph-canvas" config={config} width={width ?? 600} height={height ?? 400} callbacks={callbacks} keyMap={keyMap} keyUpMap={keyUpMap} />
      </VStack>
    </Card>
  );
};
