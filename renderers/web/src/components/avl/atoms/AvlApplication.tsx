'use client';

import React from 'react';
import { type AvlBaseProps } from '../../../lib/avl-theme';

export interface AvlApplicationProps extends AvlBaseProps {
  width?: number;
  height?: number;
  label?: string;
}

export const AvlApplication: React.FC<AvlApplicationProps> = ({
  x = 0,
  y = 0,
  width = 500,
  height = 350,
  label,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  return (
    <g className={className} opacity={opacity}>
      {/* Heavy rounded rectangle boundary */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={12}
        ry={12}
        fill="none"
        stroke={color}
        strokeWidth={3}
      />

      {/* Subtle fill */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={12}
        ry={12}
        fill={color}
        opacity={0.02}
      />

      {/* Label at top-left */}
      {label && (
        <text
          x={x + 16}
          y={y + 20}
          fill={color}
          fontSize={12}
          fontFamily="inherit"
          fontWeight="bold"
        >
          {label}
        </text>
      )}
    </g>
  );
};

AvlApplication.displayName = 'AvlApplication';
