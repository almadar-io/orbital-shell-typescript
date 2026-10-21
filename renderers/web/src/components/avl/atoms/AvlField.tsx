'use client';

import React from 'react';
import { type AvlBaseProps } from '../../../lib/avl-theme';

export interface AvlFieldProps extends AvlBaseProps {
  /** Angle in radians from entity center. */
  angle?: number;
  length?: number;
  required?: boolean;
  label?: string;
}

export const AvlField: React.FC<AvlFieldProps> = ({
  x = 0,
  y = 0,
  angle = 0,
  length = 30,
  required = true,
  label,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  const x2 = x + length * Math.cos(angle);
  const y2 = y + length * Math.sin(angle);

  return (
    <g className={className} opacity={opacity}>
      <line
        x1={x}
        y1={y}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={required ? undefined : '3 2'}
      />
      {/* End dot */}
      <circle cx={x2} cy={y2} r={2.5} fill={color} opacity={0.6} />
      {label && (
        <text
          x={x2 + 6 * Math.cos(angle)}
          y={y2 + 6 * Math.sin(angle)}
          textAnchor={Math.cos(angle) >= 0 ? 'start' : 'end'}
          dominantBaseline="central"
          fill={color}
          fontSize={8}
          fontFamily="inherit"
          opacity={0.7}
        >
          {label}
        </text>
      )}
    </g>
  );
};

AvlField.displayName = 'AvlField';
