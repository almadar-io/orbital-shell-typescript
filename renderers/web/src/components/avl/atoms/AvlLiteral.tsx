'use client';

import React from 'react';
import { type AvlBaseProps } from '../../../lib/avl-theme';

export interface AvlLiteralProps extends AvlBaseProps {
  value: string;
  size?: number;
}

export const AvlLiteral: React.FC<AvlLiteralProps> = ({
  x = 0,
  y = 0,
  value,
  size = 12,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  return (
    <g className={className} opacity={opacity}>
      {/* Simple circle leaf */}
      <circle
        cx={x}
        cy={y}
        r={size}
        fill="none"
        stroke={color}
        strokeWidth={1}
        opacity={0.5}
      />
      <text
        x={x}
        y={y + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize={size > 10 ? 9 : 7}
        fontFamily="inherit"
      >
        {value}
      </text>
    </g>
  );
};

AvlLiteral.displayName = 'AvlLiteral';
