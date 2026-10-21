'use client';

/**
 * AvlBindingEdge — Dotted violet binding edge with @ marker.
 *
 * Used for data binding connections. Dotted line at 1px with
 * a small @ label at the midpoint.
 */

import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

const BINDING_COLOR = 'var(--color-accent)';

export const AvlBindingEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}) => {
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: BINDING_COLOR,
          strokeWidth: 1,
          strokeDasharray: '3 2',
          ...style,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="absolute pointer-events-none nodrag nopan"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <span
            className="text-[9px] font-mono font-medium"
            style={{ color: BINDING_COLOR }}
          >
            @
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

AvlBindingEdge.displayName = 'AvlBindingEdge';
