'use client';

/**
 * EventFlowEdge
 *
 * React Flow edge for the V3 FlowCanvas. Shows the event name and
 * optionally the trigger element (button label) that fires it.
 *
 * When the edge originates from a specific event source handle,
 * the label shows "Button Label \u2192 EVENT" to make the connection
 * between UI element and transition clear.
 */

import React from 'react';
import {
  getBezierPath,
  EdgeLabelRenderer,
  type EdgeProps,
} from '@xyflow/react';
import { avlTint } from '../../../lib/avl-theme';
import { createLogger } from '@almadar/logger';
import { type EventEdgeData } from '../../../lib/avl-preview-converter';
import { CONNECTION_COLORS } from '../../../lib/avl-theme';

const edgeLog = createLogger('almadar:ui:nan-coord');

const EventFlowEdgeInner: React.FC<EdgeProps> = (props) => {
  const {
    id,
    source,
    target,
    sourceHandleId,
    targetHandleId,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
  } = props;
  const data = props.data as EventEdgeData | undefined;
  const isBackward = data?.isBackward ?? false;
  const isCrossOrbital = data?.isCrossOrbital ?? false;

  if (
    !Number.isFinite(sourceX) ||
    !Number.isFinite(sourceY) ||
    !Number.isFinite(targetX) ||
    !Number.isFinite(targetY)
  ) {
    edgeLog.warn('event-flow-edge: non-finite edge coordinates', {
      edgeId: id,
      source,
      target,
      sourceHandleId,
      targetHandleId,
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      eventName: data?.event,
      fromState: data?.fromState,
      toState: data?.toState,
    });
  }

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const strokeColor = isCrossOrbital
    ? CONNECTION_COLORS.emitListen.color
    : isBackward
    ? CONNECTION_COLORS.backward.color
    : CONNECTION_COLORS.forward.color;
  const strokeDash = isCrossOrbital ? '6 4' : isBackward ? '6 3' : 'none';
  const strokeWidth = isCrossOrbital ? 1.5 : 2;

  // Build label: show trigger element if available
  let labelText = data?.event ?? '';
  if (data?.triggerLabel) {
    labelText = `${data.triggerLabel} \u2192 ${data.event}`;
  }

  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDash}
        markerEnd={markerEnd}
        style={{ pointerEvents: 'stroke' }}
      />
      {labelText && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              fontSize: isCrossOrbital ? 11 : 12,
              fontWeight: 600,
              color: strokeColor,
              backgroundColor: 'var(--color-card)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${avlTint(strokeColor, 19)}`,
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            className="nodrag nopan"
          >
            {data?.triggerPatternType && (
              <span style={{ opacity: 0.5, fontSize: 10 }}>
                [{data.triggerPatternType}]
              </span>
            )}
            {labelText}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export const EventFlowEdge = React.memo(EventFlowEdgeInner);
EventFlowEdge.displayName = 'EventFlowEdge';
