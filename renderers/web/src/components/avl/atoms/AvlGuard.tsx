'use client';

import React from 'react';
import { type AvlBaseProps } from '../../../lib/avl-theme';

export interface AvlGuardProps extends AvlBaseProps {
  size?: number;
  label?: string;
}

export const AvlGuard: React.FC<AvlGuardProps> = ({
  x = 0,
  y = 0,
  size = 24,
  label,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  const h = size / 2;
  const points = `${x},${y - h} ${x + h},${y} ${x},${y + h} ${x - h},${y}`;

  return (
    <g className={className} opacity={opacity}>
      <polygon
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {label && (
        <text
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
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

AvlGuard.displayName = 'AvlGuard';
