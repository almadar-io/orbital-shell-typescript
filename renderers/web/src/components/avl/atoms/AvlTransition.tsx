'use client';

import React from 'react';

export interface AvlTransitionProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  curved?: boolean;
  /** Center point to curve away from (curves outward if provided). */
  curveAwayFrom?: { x: number; y: number };
  label?: string;
  color?: string;
  opacity?: number;
  className?: string;
}

let avlTransitionId = 0;

export const AvlTransition: React.FC<AvlTransitionProps> = ({
  x1,
  y1,
  x2,
  y2,
  curved = false,
  curveAwayFrom,
  label,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  const ids = React.useMemo(() => {
    avlTransitionId += 1;
    return { arrow: `avl-tr-${avlTransitionId}-arrow` };
  }, []);

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  // Perpendicular offset for curved paths
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const curvature = len * 0.2;
  let perpX = -dy / len;
  let perpY = dx / len;

  // If curveAwayFrom is given, ensure the curve bows away from that point
  if (curveAwayFrom) {
    const testX = mx + perpX * curvature;
    const testY = my + perpY * curvature;
    const distTest = Math.sqrt((testX - curveAwayFrom.x) ** 2 + (testY - curveAwayFrom.y) ** 2);
    const distMid = Math.sqrt((mx - curveAwayFrom.x) ** 2 + (my - curveAwayFrom.y) ** 2);
    if (distTest < distMid) {
      perpX = -perpX;
      perpY = -perpY;
    }
  }

  const cpx = mx + perpX * curvature;
  const cpy = my + perpY * curvature;

  const d = curved
    ? `M${x1},${y1} Q${cpx},${cpy} ${x2},${y2}`
    : `M${x1},${y1} L${x2},${y2}`;

  const labelX = curved ? (x1 + 2 * cpx + x2) / 4 : mx;
  const labelY = curved ? (y1 + 2 * cpy + y2) / 4 : my;

  return (
    <g className={className} opacity={opacity}>
      <defs>
        <marker
          id={ids.arrow}
          markerWidth="8"
          markerHeight="6"
          refX="7"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L8,3 L0,6 Z" fill={color} />
        </marker>
      </defs>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        markerEnd={`url(#${ids.arrow})`}
      />
      {label && (
        <text
          x={labelX}
          y={labelY - 6}
          textAnchor="middle"
          fill={color}
          fontSize={9}
          fontFamily="inherit"
          opacity={0.8}
        >
          {label}
        </text>
      )}
    </g>
  );
};

AvlTransition.displayName = 'AvlTransition';
