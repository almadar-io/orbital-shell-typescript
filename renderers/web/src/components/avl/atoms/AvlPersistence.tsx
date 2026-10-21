'use client';

import React from 'react';
import { type AvlBaseProps } from '../../../lib/avl-theme';
import { type EntityPersistence } from '@almadar/core';

export interface AvlPersistenceProps extends AvlBaseProps {
  kind: EntityPersistence;
  size?: number;
  label?: string;
}

const PERSISTENCE_STROKE: Record<EntityPersistence, { strokeDasharray?: string; strokeWidth: number }> = {
  persistent: { strokeWidth: 2.5 },
  runtime: { strokeDasharray: '6 3', strokeWidth: 2 },
};

export const AvlPersistence: React.FC<AvlPersistenceProps> = ({
  x = 0,
  y = 0,
  kind,
  size = 20,
  label,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  const half = size / 2;

  const strokeProps = PERSISTENCE_STROKE[kind];

  return (
    <g className={className} opacity={opacity}>
      {/* Decorative line sample showing the persistence style */}
      <line
        x1={x - half}
        y1={y}
        x2={x + half}
        y2={y}
        stroke={color}
        strokeWidth={strokeProps.strokeWidth}
        strokeDasharray={strokeProps.strokeDasharray}
        strokeLinecap="round"
      />


      {label && (
        <text
          x={x}
          y={y + 14}
          textAnchor="middle"
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

AvlPersistence.displayName = 'AvlPersistence';
