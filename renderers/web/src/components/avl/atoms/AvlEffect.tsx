'use client';

import React from 'react';
import { createLogger } from '@almadar/logger';
import type { EffectOperator } from '@almadar/core';
import { EFFECT_CATEGORY_COLORS, asEffectOperator, effectCategoryOf, type AvlBaseProps, type EffectCategory } from '../../../lib/avl-theme';

const log = createLogger('almadar:ui:avl:effect');

export interface AvlEffectProps extends AvlBaseProps {
  /** Effect operator as it appears in the program (`set`, `emit`, `llm/generate`, …). */
  effectType: string;
  size?: number;
  label?: string;
  /** V2: Render a category-colored background circle behind the icon. */
  showBackground?: boolean;
}

type Glyph = (x: number, y: number, s: number, color: string) => React.ReactNode;

function headIcon(type: EffectOperator, x: number, y: number, s: number, color: string): React.ReactNode | null {
  switch (type) {
    case 'render-ui':
      // Grid: ⊞
      return (
        <g>
          <rect x={x - s} y={y - s} width={s * 2} height={s * 2} fill="none" stroke={color} strokeWidth={1.5} rx={1} />
          <line x1={x} y1={y - s} x2={x} y2={y + s} stroke={color} strokeWidth={1} />
          <line x1={x - s} y1={y} x2={x + s} y2={y} stroke={color} strokeWidth={1} />
        </g>
      );
    case 'set':
      // Pencil: ✎
      return (
        <path
          d={`M${x - s * 0.6},${y + s} L${x - s},${y + s * 0.4} L${x + s * 0.4},${y - s} L${x + s},${y - s * 0.4} Z`}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      );
    case 'persist':
      // Cylinder: ⛁
      return (
        <g>
          <ellipse cx={x} cy={y - s * 0.6} rx={s} ry={s * 0.4} fill="none" stroke={color} strokeWidth={1.5} />
          <line x1={x - s} y1={y - s * 0.6} x2={x - s} y2={y + s * 0.4} stroke={color} strokeWidth={1.5} />
          <line x1={x + s} y1={y - s * 0.6} x2={x + s} y2={y + s * 0.4} stroke={color} strokeWidth={1.5} />
          <ellipse cx={x} cy={y + s * 0.4} rx={s} ry={s * 0.4} fill="none" stroke={color} strokeWidth={1.5} />
        </g>
      );
    case 'fetch':
      // Down arrow: ⇣
      return (
        <g>
          <line x1={x} y1={y - s} x2={x} y2={y + s * 0.6} stroke={color} strokeWidth={1.5} />
          <polyline points={`${x - s * 0.5},${y + s * 0.1} ${x},${y + s} ${x + s * 0.5},${y + s * 0.1}`} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        </g>
      );
    case 'emit':
      // Antenna: 📡
      return (
        <g>
          <circle cx={x} cy={y} r={s * 0.3} fill={color} />
          <path d={`M${x - s * 0.7},${y - s * 0.7} A${s},${s} 0 0,1 ${x + s * 0.7},${y - s * 0.7}`} fill="none" stroke={color} strokeWidth={1.5} />
          <path d={`M${x - s},${y - s} A${s * 1.4},${s * 1.4} 0 0,1 ${x + s},${y - s}`} fill="none" stroke={color} strokeWidth={1} opacity={0.6} />
        </g>
      );
    case 'navigate':
      // Right arrow: ⇢
      return (
        <g>
          <line x1={x - s} y1={y} x2={x + s * 0.6} y2={y} stroke={color} strokeWidth={1.5} />
          <polyline points={`${x + s * 0.1},${y - s * 0.5} ${x + s},${y} ${x + s * 0.1},${y + s * 0.5}`} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        </g>
      );
    case 'call-service':
      // Bidirectional: ⇄
      return (
        <g>
          <line x1={x - s} y1={y - s * 0.3} x2={x + s} y2={y - s * 0.3} stroke={color} strokeWidth={1.5} />
          <polyline points={`${x + s * 0.5},${y - s * 0.7} ${x + s},${y - s * 0.3} ${x + s * 0.5},${y + s * 0.1}`} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
          <line x1={x + s} y1={y + s * 0.3} x2={x - s} y2={y + s * 0.3} stroke={color} strokeWidth={1.5} />
          <polyline points={`${x - s * 0.5},${y - s * 0.1} ${x - s},${y + s * 0.3} ${x - s * 0.5},${y + s * 0.7}`} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        </g>
      );
    case 'spawn':
      // Plus circle: ⊕
      return (
        <g>
          <circle cx={x} cy={y} r={s} fill="none" stroke={color} strokeWidth={1.5} />
          <line x1={x - s * 0.5} y1={y} x2={x + s * 0.5} y2={y} stroke={color} strokeWidth={1.5} />
          <line x1={x} y1={y - s * 0.5} x2={x} y2={y + s * 0.5} stroke={color} strokeWidth={1.5} />
        </g>
      );
    case 'despawn':
      // Minus circle: ⊖
      return (
        <g>
          <circle cx={x} cy={y} r={s} fill="none" stroke={color} strokeWidth={1.5} />
          <line x1={x - s * 0.5} y1={y} x2={x + s * 0.5} y2={y} stroke={color} strokeWidth={1.5} />
        </g>
      );
    case 'do':
      // Execute: ⫘
      return (
        <g>
          <circle cx={x} cy={y} r={s} fill="none" stroke={color} strokeWidth={1.5} />
          <polygon points={`${x - s * 0.3},${y - s * 0.5} ${x + s * 0.5},${y} ${x - s * 0.3},${y + s * 0.5}`} fill={color} />
        </g>
      );
    case 'if':
      // Conditional diamond: ◇
      return (
        <polygon
          points={`${x},${y - s} ${x + s * 0.7},${y} ${x},${y + s} ${x - s * 0.7},${y}`}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      );
    case 'log':
      // Paragraph: ¶
      return (
        <text
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
          fontSize={s * 2.2}
          fontFamily="serif"
        >
          ¶
        </text>
      );
    default:
      return null;
  }
}

const clock: Glyph = (x, y, s, color) => (
  <g>
    <circle cx={x} cy={y} r={s} fill="none" stroke={color} strokeWidth={1.5} />
    <polyline points={`${x},${y - s * 0.6} ${x},${y} ${x + s * 0.5},${y + s * 0.3}`} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
  </g>
);

const neuron: Glyph = (x, y, s, color) => (
  <g>
    <line x1={x - s} y1={y - s * 0.6} x2={x + s * 0.8} y2={y} stroke={color} strokeWidth={1} />
    <line x1={x - s} y1={y + s * 0.6} x2={x + s * 0.8} y2={y} stroke={color} strokeWidth={1} />
    <circle cx={x - s} cy={y - s * 0.6} r={s * 0.3} fill={color} />
    <circle cx={x - s} cy={y + s * 0.6} r={s * 0.3} fill={color} />
    <circle cx={x + s * 0.8} cy={y} r={s * 0.35} fill={color} />
  </g>
);

const gear: Glyph = (x, y, s, color) => (
  <g>
    <circle cx={x} cy={y} r={s * 0.75} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray={`${s * 0.5} ${s * 0.3}`} />
    <circle cx={x} cy={y} r={s * 0.3} fill={color} />
  </g>
);

const unknown: Glyph = (x, y, s, color) => (
  <g>
    <circle cx={x} cy={y} r={s} fill="none" stroke={color} strokeWidth={1.2} strokeDasharray="2 2" />
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill={color} fontSize={s * 1.4}>?</text>
  </g>
);

const CATEGORY_GLYPH: Record<EffectCategory, Glyph> = {
  ui: (x, y, s, c) => headIcon('render-ui', x, y, s, c),
  data: (x, y, s, c) => headIcon('set', x, y, s, c),
  communication: (x, y, s, c) => headIcon('emit', x, y, s, c),
  lifecycle: (x, y, s, c) => headIcon('spawn', x, y, s, c),
  control: (x, y, s, c) => headIcon('if', x, y, s, c),
  async: clock,
  compute: neuron,
  system: gear,
};

function effectIcon(type: string, x: number, y: number, s: number, color: string): React.ReactNode {
  const op = asEffectOperator(type);
  const own = op ? headIcon(op, x, y, s, color) : null;
  if (own) return own;
  const category = effectCategoryOf(type);
  if (category) return CATEGORY_GLYPH[category](x, y, s, color);
  log.error('unknown-effect-operator', { effectType: type });
  return unknown(x, y, s, color);
}

export const AvlEffect: React.FC<AvlEffectProps> = ({
  x = 0,
  y = 0,
  effectType,
  size = 8,
  label,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
  showBackground = false,
}) => {
  const category = effectCategoryOf(effectType);
  const catColors = category ? EFFECT_CATEGORY_COLORS[category] : null;
  const iconColor = showBackground && catColors ? catColors.color : color;

  return (
    <g className={className} opacity={opacity}>
      {showBackground && catColors && (
        <>
          <circle cx={x} cy={y} r={size * 1.2} fill={catColors.bg} />
          <circle cx={x} cy={y} r={size * 1.2} fill="none" stroke={catColors.color} strokeWidth={0.5} opacity={0.3} />
        </>
      )}
      {effectIcon(effectType, x, y, size, iconColor)}
      {label && (
        <text
          x={x}
          y={y + size + 10}
          textAnchor="middle"
          fill={iconColor}
          fontSize={11}
          fontWeight={500}
          fontFamily="inherit"
          opacity={0.7}
        >
          {label}
        </text>
      )}
    </g>
  );
};

AvlEffect.displayName = 'AvlEffect';
