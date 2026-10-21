'use client';

import React from 'react';

export interface AvlOrbitalProps {
  cx?: number;
  cy?: number;
  r?: number;
  label?: string;
  color?: string;
  opacity?: number;
  className?: string;
}

export const AvlOrbital: React.FC<AvlOrbitalProps> = ({
  cx = 0,
  cy = 0,
  r = 80,
  label,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  return (
    <g className={className} opacity={opacity}>
      {/* Outer shell circle */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={2}
      />

      {/* Subtle inner glow */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={color}
        opacity={0.03}
      />

      {/* Label at top */}
      {label && (
        <text
          x={cx}
          y={cy - r - 8}
          textAnchor="middle"
          fill={color}
          fontSize={11}
          fontFamily="inherit"
          fontWeight="bold"
        >
          {label}
        </text>
      )}
    </g>
  );
};

AvlOrbital.displayName = 'AvlOrbital';
