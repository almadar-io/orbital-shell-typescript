'use client';

import React from 'react';

export interface AvlBindingProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  color?: string;
  opacity?: number;
  className?: string;
}

export const AvlBinding: React.FC<AvlBindingProps> = ({
  x1,
  y1,
  x2,
  y2,
  label,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  return (
    <g className={className} opacity={opacity}>
      {/* Dotted binding line */}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={1}
        strokeDasharray="2 3"
        opacity={0.6}
      />
      {/* @ symbol at midpoint */}
      <text
        x={mx}
        y={my - 4}
        textAnchor="middle"
        fill={color}
        fontSize={10}
        fontFamily="inherit"
        fontWeight="bold"
      >
        @
      </text>
      {label && (
        <text
          x={mx}
          y={my + 10}
          textAnchor="middle"
          fill={color}
          fontSize={8}
          fontFamily="inherit"
          opacity={0.6}
        >
          {label}
        </text>
      )}
    </g>
  );
};

AvlBinding.displayName = 'AvlBinding';
