'use client';

import React from 'react';
import { type AvlBaseProps } from '../../../lib/avl-theme';
import { type FieldTag, type FieldType, isTypeVariable } from '@almadar/core';

export interface AvlFieldTypeProps extends AvlBaseProps {
  kind: FieldType;
  size?: number;
  label?: string;
}

export type FieldTypeShape = 'circle' | 'triangle' | 'square' | 'diamond' | 'ring' | 'hexagon' | 'bars' | 'link' | 'variable';

/** Every @almadar/core field type drawn as the shape of its data family. */
export const FIELD_TYPE_SHAPES: Record<FieldTag, FieldTypeShape> = {
  string: 'circle', email: 'circle', url: 'circle', phone: 'circle', uuid: 'circle',
  number: 'triangle', int: 'triangle', money: 'triangle',
  boolean: 'square',
  date: 'diamond', timestamp: 'diamond', datetime: 'diamond',
  enum: 'ring', union: 'ring',
  object: 'hexagon', image: 'hexagon', file: 'hexagon', bytes: 'hexagon', trait: 'hexagon', orbital: 'hexagon', behavior: 'hexagon', slot: 'hexagon', pattern: 'hexagon', node: 'hexagon', event: 'hexagon', EventAddress: 'hexagon', CallKey: 'hexagon', SExpr: 'hexagon',
  array: 'bars', tuple: 'bars',
  relation: 'link',
};

/** A tag's family shape; an unbound type variable (`$t`) has no family. */
export function fieldTypeShape(kind: FieldType): FieldTypeShape {
  return isTypeVariable(kind) ? 'variable' : FIELD_TYPE_SHAPES[kind];
}

function drawShape(shape: FieldTypeShape, x: number, y: number, s: number, color: string): React.ReactNode {
  switch (shape) {
    case 'circle':
      return <circle cx={x} cy={y} r={s} fill={color} />;
    case 'triangle':
      return <polygon points={`${x},${y - s} ${x + s},${y + s * 0.7} ${x - s},${y + s * 0.7}`} fill={color} />;
    case 'square':
      return <rect x={x - s * 0.8} y={y - s * 0.8} width={s * 1.6} height={s * 1.6} fill={color} />;
    case 'diamond':
      return <polygon points={`${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`} fill={color} />;
    case 'ring':
      return <circle cx={x} cy={y} r={s} fill="none" stroke={color} strokeWidth={1.5} />;
    case 'variable':
      return <circle cx={x} cy={y} r={s} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="2 2" />;
    case 'hexagon':
      return (
        <polygon
          points={Array.from({ length: 6 }, (_, i) => {
            const a = (Math.PI * 2 * i) / 6 - Math.PI / 6;
            return `${x + s * Math.cos(a)},${y + s * Math.sin(a)}`;
          }).join(' ')}
          fill={color}
          opacity={0.8}
        />
      );
    case 'bars':
      return (
        <g>
          <line x1={x - s} y1={y - s * 0.6} x2={x + s} y2={y - s * 0.6} stroke={color} strokeWidth={2} />
          <line x1={x - s} y1={y} x2={x + s} y2={y} stroke={color} strokeWidth={2} />
          <line x1={x - s} y1={y + s * 0.6} x2={x + s} y2={y + s * 0.6} stroke={color} strokeWidth={2} />
        </g>
      );
    case 'link':
      return (
        <g>
          <circle cx={x - s * 0.45} cy={y} r={s * 0.55} fill="none" stroke={color} strokeWidth={1.5} />
          <circle cx={x + s * 0.45} cy={y} r={s * 0.55} fill="none" stroke={color} strokeWidth={1.5} />
        </g>
      );
  }
}

export const AvlFieldType: React.FC<AvlFieldTypeProps> = ({
  x = 0,
  y = 0,
  kind,
  size = 5,
  label,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
}) => {
  return (
    <g className={className} opacity={opacity}>
      {drawShape(fieldTypeShape(kind), x, y, size, color)}
      {label && (
        <text
          x={x}
          y={y + size + 10}
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

AvlFieldType.displayName = 'AvlFieldType';
