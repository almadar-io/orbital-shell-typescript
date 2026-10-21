'use client';

/**
 * AvlEventWireEdge — React Flow edge for emit/listen event wiring.
 *
 * Dashed orange Bezier path with event name label at midpoint.
 * Uses AVL CONNECTION_COLORS.emitListen styling.
 */

import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { avlTint } from '../../../lib/avl-theme';
import { CONNECTION_COLORS } from '../../../lib/avl-theme';

export interface AvlEventWireEdgeData {
  [key: string]: string | boolean | undefined;
  event: string;
  compatible?: boolean;
}

export type AvlEventWireFlowEdge = Edge<AvlEventWireEdgeData, 'eventWire'>;

export const AvlEventWireEdge: React.FC<EdgeProps<AvlEventWireFlowEdge>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  style,
}) => {
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });

  const isCompatible = data?.compatible !== false;
  const wireColor = isCompatible ? CONNECTION_COLORS.emitListen.color : 'var(--color-error)';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: wireColor,
          strokeWidth: CONNECTION_COLORS.emitListen.width,
          strokeDasharray: CONNECTION_COLORS.emitListen.dash,
          ...style,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="absolute pointer-events-all nodrag nopan"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <div
            className="px-2 py-0.5 text-xs font-medium rounded-full border truncate max-w-[180px]"
            style={{
              color: wireColor,
              borderColor: wireColor,
              backgroundColor: avlTint(wireColor, 8),
            }}
          >
            {data?.event ?? ''}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

AvlEventWireEdge.displayName = 'AvlEventWireEdge';
