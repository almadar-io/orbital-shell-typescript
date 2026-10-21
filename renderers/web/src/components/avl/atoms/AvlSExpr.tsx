'use client';

import React from 'react';
import { type AvlBaseProps } from '../../../lib/avl-theme';

export interface AvlSExprProps extends AvlBaseProps {
  width?: number;
  height?: number;
  label?: string;
}

export const AvlSExpr: React.FC<AvlSExprProps> = ({
  x = 0,
  y = 0,
  width = 140,
  height = 80,
  label,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  return (
    <g className={className} opacity={opacity}>
      {/* Expression tree container - rounded rectangle with tree icon */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={6}
        ry={6}
        fill={color}
        fillOpacity={0.05}
        stroke={color}
        strokeWidth={1}
        strokeDasharray="6 3"
      />
      {/* Tree glyph in corner */}
      <circle cx={x + 12} cy={y + 12} r={3} fill={color} opacity={0.4} />
      <line x1={x + 12} y1={y + 15} x2={x + 8} y2={y + 22} stroke={color} strokeWidth={0.8} opacity={0.3} />
      <line x1={x + 12} y1={y + 15} x2={x + 16} y2={y + 22} stroke={color} strokeWidth={0.8} opacity={0.3} />

      {label && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
          fontSize={9}
          fontFamily="inherit"
          opacity={0.6}
        >
          {label}
        </text>
      )}
    </g>
  );
};

AvlSExpr.displayName = 'AvlSExpr';
