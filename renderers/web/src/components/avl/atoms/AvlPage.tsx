'use client';

import React from 'react';
import { type AvlBaseProps } from '../../../lib/avl-theme';

export interface AvlPageProps extends AvlBaseProps {
  size?: number;
  label?: string;
}

export const AvlPage: React.FC<AvlPageProps> = ({
  x = 0,
  y = 0,
  size = 12,
  label,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  const half = size / 2;

  return (
    <g className={className} opacity={opacity}>
      {/* Small square on boundary */}
      <rect
        x={x - half}
        y={y - half}
        width={size}
        height={size}
        fill={color}
        opacity={0.3}
        stroke={color}
        strokeWidth={1.5}
      />

      {/* Label */}
      {label && (
        <text
          x={x}
          y={y + half + 12}
          textAnchor="middle"
          fill={color}
          fontSize={8}
          fontFamily="inherit"
        >
          {label}
        </text>
      )}
    </g>
  );
};

AvlPage.displayName = 'AvlPage';
