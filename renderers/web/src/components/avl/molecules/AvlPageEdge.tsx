'use client';

/**
 * AvlPageEdge — Thin solid page-reference edge.
 *
 * Slate colored, 1px, used for page-to-trait references.
 */

import React from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

const PAGE_EDGE_COLOR = 'var(--color-muted-foreground)';

export const AvlPageEdge: React.FC<EdgeProps> = ({
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
  const [path] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={{
        stroke: PAGE_EDGE_COLOR,
        strokeWidth: 1,
        ...style,
      }}
    />
  );
};

AvlPageEdge.displayName = 'AvlPageEdge';
