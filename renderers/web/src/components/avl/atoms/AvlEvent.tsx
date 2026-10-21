'use client';

import React from 'react';
import { type AvlBaseProps } from '../../../lib/avl-theme';

export interface AvlEventProps extends AvlBaseProps {
  size?: number;
  label?: string;
}

export const AvlEvent: React.FC<AvlEventProps> = ({
  x = 0,
  y = 0,
  size = 16,
  label,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  // Lightning bolt shape centered at (x, y)
  const s = size / 16;
  const bolt = [
    `M${x - 2 * s},${y - 8 * s}`,
    `L${x + 4 * s},${y - 8 * s}`,
    `L${x + 1 * s},${y - 1 * s}`,
    `L${x + 5 * s},${y - 1 * s}`,
    `L${x - 3 * s},${y + 8 * s}`,
    `L${x},${y + 1 * s}`,
    `L${x - 4 * s},${y + 1 * s}`,
    'Z',
  ].join(' ');

  return (
    <g className={className} opacity={opacity}>
      <path d={bolt} fill={color} />
      {label && (
        <text
          x={x}
          y={y + size / 2 + 12}
          textAnchor="middle"
          fill={color}
          fontSize={9}
          fontFamily="inherit"
        >
          {label}
        </text>
      )}
    </g>
  );
};

AvlEvent.displayName = 'AvlEvent';
