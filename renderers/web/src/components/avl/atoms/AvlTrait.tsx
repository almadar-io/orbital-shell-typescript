'use client';

import React from 'react';

export interface AvlTraitProps {
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  rotation?: number;
  label?: string;
  color?: string;
  opacity?: number;
  className?: string;
}

export const AvlTrait: React.FC<AvlTraitProps> = ({
  cx = 0,
  cy = 0,
  rx = 60,
  ry = 30,
  rotation = 0,
  label,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  return (
    <g className={className} opacity={opacity} transform={`rotate(${rotation},${cx},${cy})`}>
      {/* Elliptical orbital ring */}
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="4 2"
      />

      {/* Label at the leftmost point of the ellipse (away from center clutter) */}
      {label && (
        <text
          x={cx - rx - 6}
          y={cy}
          textAnchor="end"
          dominantBaseline="central"
          fill={color}
          fontSize={9}
          fontFamily="inherit"
          opacity={0.8}
          transform={`rotate(${-rotation},${cx - rx - 6},${cy})`}
        >
          {label}
        </text>
      )}
    </g>
  );
};

AvlTrait.displayName = 'AvlTrait';
