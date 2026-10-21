'use client';

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../lib/domPassthrough';
import { svgMotionClass } from '../../lib/svgMotion';
import React from 'react';

export interface SvgFlowProps extends A11yProps {
  points?: Array<[number, number]>;
  color?: string;
  strokeWidth?: number;
  animated?: boolean;
  opacity?: number;
  className?: string;
  /** When true (default), wraps in a standalone <svg> so the shape is visible without a parent SVG context. */
  asRoot?: boolean;
  width?: number;
  height?: number;
}

let flowIdCounter = 0;

const DEFAULT_POINTS: Array<[number, number]> = [[10, 50], [50, 20], [90, 50]];

export const SvgFlow: React.FC<SvgFlowProps> = ({
  points = DEFAULT_POINTS,
  color = 'var(--color-primary)',
  strokeWidth = 1.5,
  animated = false,
  opacity = 1,
  className,
  asRoot = true,
  width = 100,
  height = 100,
  ...rest
}) => {
  const a11y = domPassthrough(rest);
  const markerId = React.useMemo(() => {
    flowIdCounter += 1;
    return `almadar-flow-arrow-${flowIdCounter}`;
  }, []);

  if (points.length < 2) {
    return null;
  }

  const pathData = points
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`)
    .join(' ');

  const inner = (
    <g {...(asRoot ? undefined : a11y)} className={className} opacity={opacity}>
      <defs>
        <marker
          id={markerId}
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
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        markerEnd={`url(#${markerId})`}
        className={svgMotionClass('flowDash', animated)}
        strokeDasharray={animated ? '8 6' : undefined}
      />
    </g>
  );

  if (asRoot) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} {...a11y}>
        {inner}
      </svg>
    );
  }

  return inner;
};

SvgFlow.displayName = 'SvgFlow';
