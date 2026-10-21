'use client';

import React from 'react';
import { type AvlBaseProps } from '../../../lib/avl-theme';
import { type EntityPersistence } from '@almadar/core';

export interface AvlEntityProps extends AvlBaseProps {
  r?: number;
  fieldCount?: number;
  persistence?: EntityPersistence;
  label?: string;
}

const PERSISTENCE_STROKE: Record<EntityPersistence, { strokeDasharray?: string; strokeWidth: number }> = {
  persistent: { strokeWidth: 2.5 },
  runtime: { strokeDasharray: '6 3', strokeWidth: 2 },
};

export const AvlEntity: React.FC<AvlEntityProps> = ({
  x = 0,
  y = 0,
  r = 18,
  fieldCount = 0,
  persistence = 'persistent',
  label,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  const strokeProps = PERSISTENCE_STROKE[persistence];

  // Radiating facet lines
  const facets = Array.from({ length: fieldCount }, (_, i) => {
    const angle = (Math.PI * 2 * i) / fieldCount - Math.PI / 2;
    const innerR = r + 2;
    const outerR = r + 10;
    return {
      x1: x + innerR * Math.cos(angle),
      y1: y + innerR * Math.sin(angle),
      x2: x + outerR * Math.cos(angle),
      y2: y + outerR * Math.sin(angle),
    };
  });

  return (
    <g className={className} opacity={opacity}>
      {/* Nucleus fill */}
      <circle cx={x} cy={y} r={r} fill={color} opacity={0.15} />

      {/* Nucleus border with persistence treatment */}
      <circle
        cx={x}
        cy={y}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeProps.strokeWidth}
        strokeDasharray={strokeProps.strokeDasharray}
      />


      {/* Radiating field lines */}
      {facets.map((f, i) => (
        <line
          key={i}
          x1={f.x1}
          y1={f.y1}
          x2={f.x2}
          y2={f.y2}
          stroke={color}
          strokeWidth={1}
          opacity={0.6}
        />
      ))}

      {/* Label below nucleus to avoid clipping inside small circles */}
      {label && (
        <text
          x={x}
          y={y + r + (fieldCount > 0 ? 18 : 14)}
          textAnchor="middle"
          fill={color}
          fontSize={10}
          fontFamily="inherit"
          fontWeight="bold"
        >
          {label}
        </text>
      )}
    </g>
  );
};

AvlEntity.displayName = 'AvlEntity';
