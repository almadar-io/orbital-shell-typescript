'use client';

import React from 'react';
import { type AvlBaseProps } from '../../../lib/avl-theme';

export interface AvlBindingRefProps extends AvlBaseProps {
  path: string;
  size?: number;
}

export const AvlBindingRef: React.FC<AvlBindingRefProps> = ({
  x = 0,
  y = 0,
  path,
  size = 12,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  // Auto-size circle to fit the text
  const fullLabel = `@${path}`;
  const autoR = Math.max(size, fullLabel.length * 3.5 + 4);

  return (
    <g className={className} opacity={opacity}>
      {/* Dotted circle for binding reference - auto-sized */}
      <circle
        cx={x}
        cy={y}
        r={autoR}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="3 2"
      />
      {/* @ prefix + path as single label */}
      <text
        x={x}
        y={y + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize={10}
        fontFamily="inherit"
      >
        {fullLabel}
      </text>
    </g>
  );
};

AvlBindingRef.displayName = 'AvlBindingRef';
