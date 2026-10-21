'use client';

/**
 * AvlBackwardEdge — Dashed backward/retry transition edge.
 *
 * Uses CONNECTION_COLORS.backward styling: dashed, lighter color.
 */

import React from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { CONNECTION_COLORS } from '../../../lib/avl-theme';

export const AvlBackwardEdge: React.FC<EdgeProps> = ({
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
        stroke: CONNECTION_COLORS.backward.color,
        strokeWidth: CONNECTION_COLORS.backward.width,
        strokeDasharray: CONNECTION_COLORS.backward.dash,
        ...style,
      }}
    />
  );
};

AvlBackwardEdge.displayName = 'AvlBackwardEdge';
