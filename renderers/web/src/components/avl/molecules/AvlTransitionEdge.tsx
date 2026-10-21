'use client';

/**
 * AvlTransitionEdge — React Flow edge for state machine transitions.
 *
 * Bezier path with event label at midpoint. Guard diamond and effect
 * dot indicators shown inline. Forward transitions are solid dark,
 * backward transitions are dashed lighter.
 */

import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { useTranslate } from '../../../core';
import { CONNECTION_COLORS } from '../../../lib/avl-theme';

export interface AvlTransitionEdgeData {
  [key: string]: string | boolean | undefined;
  event: string;
  hasGuard?: boolean;
  hasEffects?: boolean;
}

export type AvlTransitionFlowEdge = Edge<AvlTransitionEdgeData, 'transition'>;

export const AvlTransitionEdge: React.FC<EdgeProps<AvlTransitionFlowEdge>> = ({
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
  const { t } = useTranslate();
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });

  const isBackward = targetX < sourceX;
  const connStyle = isBackward ? CONNECTION_COLORS.backward : CONNECTION_COLORS.forward;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: connStyle.color,
          strokeWidth: connStyle.width,
          strokeDasharray: connStyle.dash,
          ...style,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="absolute pointer-events-all nodrag nopan flex items-center gap-1"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {data?.hasGuard && (
            <div className="w-3 h-3 rotate-45 border border-warning bg-warning/10 shrink-0" title={t('avl.guard')} />
          )}
          <div className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-foreground)] truncate max-w-[160px]">
            {data?.event ?? ''}
          </div>
          {data?.hasEffects && (
            <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" title={t('avl.effects')} />
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

AvlTransitionEdge.displayName = 'AvlTransitionEdge';
