'use client';

/**
 * AvlLegend - Compact legend showing AVL symbol definitions.
 *
 * Each scene passes the set of symbol types it uses, and
 * the legend renders only those symbols with labels.
 */

import React from 'react';
import { useTranslate } from '../../../core';
import type { ZoomLevel } from '../../../lib/avl-zoom-state';

export interface AvlLegendProps {
  level: ZoomLevel;
  color?: string;
  x?: number;
  y?: number;
}

interface LegendItem {
  labelKey: string;
  render: (x: number, y: number, color: string) => React.ReactElement;
}

const APPLICATION_ITEMS: LegendItem[] = [
  {
    labelKey: 'avl.glyph.orbital',
    render: (x, y, c) => <circle cx={x} cy={y} r={8} fill="none" stroke={c} strokeWidth={1.5} />,
  },
  {
    labelKey: 'avl.glyph.entity',
    render: (x, y, c) => (
      <g>
        <circle cx={x} cy={y} r={5} fill={c} opacity={0.2} />
        <circle cx={x} cy={y} r={5} fill="none" stroke={c} strokeWidth={1.5} />
      </g>
    ),
  },
  {
    labelKey: 'avl.glyph.trait',
    render: (x, y, c) => <ellipse cx={x} cy={y} rx={10} ry={5} fill="none" stroke={c} strokeWidth={1} strokeDasharray="3 1.5" />,
  },
  {
    labelKey: 'avl.glyph.page',
    render: (x, y, c) => <rect x={x - 3} y={y - 3} width={6} height={6} fill={c} opacity={0.3} stroke={c} strokeWidth={1} />,
  },
  {
    labelKey: 'avlLegend.eventFlow',
    render: (x, y, c) => (
      <g>
        <line x1={x - 10} y1={y} x2={x + 10} y2={y} stroke={c} strokeWidth={1} strokeDasharray="4 2" />
        <polygon points={`${x + 10},${y} ${x + 6},${y - 3} ${x + 6},${y + 3}`} fill={c} opacity={0.5} />
      </g>
    ),
  },
];

const ORBITAL_ITEMS: LegendItem[] = [
  {
    labelKey: 'avlLegend.orbitalBoundary',
    render: (x, y, c) => <circle cx={x} cy={y} r={8} fill="none" stroke={c} strokeWidth={1.5} />,
  },
  {
    labelKey: 'avlLegend.entityNucleus',
    render: (x, y, c) => (
      <g>
        <circle cx={x} cy={y} r={5} fill={c} opacity={0.15} />
        <circle cx={x} cy={y} r={5} fill="none" stroke={c} strokeWidth={2} />
        <line x1={x} y1={y - 7} x2={x} y2={y - 9} stroke={c} strokeWidth={0.8} opacity={0.5} />
      </g>
    ),
  },
  {
    labelKey: 'avlLegend.traitRing',
    render: (x, y, c) => <ellipse cx={x} cy={y} rx={10} ry={5} fill="none" stroke={c} strokeWidth={1} strokeDasharray="3 1.5" />,
  },
  {
    labelKey: 'avl.glyph.page',
    render: (x, y, c) => <rect x={x - 3} y={y - 3} width={6} height={6} fill={c} opacity={0.3} stroke={c} strokeWidth={1} />,
  },
  {
    labelKey: 'avlLegend.externalLink',
    render: (x, y, c) => <line x1={x - 8} y1={y} x2={x + 8} y2={y} stroke={c} strokeWidth={1} strokeDasharray="4 2" opacity={0.4} />,
  },
];

const TRAIT_ITEMS: LegendItem[] = [
  {
    labelKey: 'avl.glyph.state',
    render: (x, y, c) => <rect x={x - 12} y={y - 6} width={24} height={12} rx={6} fill="none" stroke={c} strokeWidth={1.5} />,
  },
  {
    labelKey: 'avlLegend.initialState',
    render: (x, y, c) => (
      <g>
        <circle cx={x - 10} cy={y} r={3} fill={c} />
        <rect x={x - 4} y={y - 6} width={20} height={12} rx={6} fill="none" stroke={c} strokeWidth={1.5} />
      </g>
    ),
  },
  {
    labelKey: 'avl.glyph.transition',
    render: (x, y, c) => (
      <g>
        <line x1={x - 10} y1={y} x2={x + 8} y2={y} stroke={c} strokeWidth={1.2} opacity={0.5} />
        <polygon points={`${x + 10},${y} ${x + 6},${y - 3} ${x + 6},${y + 3}`} fill={c} opacity={0.5} />
      </g>
    ),
  },
  {
    labelKey: 'avlLegend.eventEffects',
    render: (x, y, c) => (
      <rect x={x - 14} y={y - 7} width={28} height={14} rx={3} fill="var(--color-surface, white)" stroke={c} strokeWidth={0.8} />
    ),
  },
  {
    labelKey: 'avlLegend.emitExternal',
    render: (x, y, c) => (
      <circle cx={x} cy={y} r={3} fill={c} opacity={0.5}>
        <animate attributeName="r" values="2;4;2" dur="1.5s" repeatCount="indefinite" />
      </circle>
    ),
  },
];

const TRANSITION_ITEMS: LegendItem[] = [
  {
    labelKey: 'avl.glyph.state',
    render: (x, y, c) => <rect x={x - 12} y={y - 6} width={24} height={12} rx={6} fill="none" stroke={c} strokeWidth={1.5} />,
  },
  {
    labelKey: 'avl.glyph.effect',
    render: (x, y, c) => (
      <g>
        <circle cx={x} cy={y} r={5} fill={c} opacity={0.15} />
        <circle cx={x} cy={y} r={5} fill="none" stroke={c} strokeWidth={1} />
      </g>
    ),
  },
  {
    labelKey: 'avlLegend.slotTarget',
    render: (x, y, c) => <rect x={x - 10} y={y - 5} width={20} height={10} rx={2} fill={c} opacity={0.1} stroke={c} strokeWidth={0.8} />,
  },
  {
    labelKey: 'avlLegend.bindingPath',
    render: (x, y, c) => <circle cx={x} cy={y} r={5} fill="none" stroke={c} strokeWidth={1} strokeDasharray="2 1.5" opacity={0.6} />,
  },
];

const ITEMS_BY_LEVEL: Record<ZoomLevel, LegendItem[]> = {
  application: APPLICATION_ITEMS,
  orbital: ORBITAL_ITEMS,
  trait: TRAIT_ITEMS,
  transition: TRANSITION_ITEMS,
};

export const AvlLegend: React.FC<AvlLegendProps> = ({
  level,
  color = 'var(--color-primary)',
  x = 10,
  y = 360,
}) => {
  const { t } = useTranslate();
  const items = ITEMS_BY_LEVEL[level];
  const itemSpacing = 16;
  const legendH = items.length * itemSpacing + 16;

  return (
    <g opacity={0.6}>
      {/* Background */}
      <rect
        x={x}
        y={y - legendH + 10}
        width={130}
        height={legendH}
        rx={6}
        fill="var(--color-surface, white)"
        stroke={color}
        strokeWidth={0.5}
        opacity={0.8}
      />

      {/* Items */}
      {items.map((item, i) => {
        const iy = y - legendH + 22 + i * itemSpacing;
        return (
          <g key={item.labelKey}>
            {item.render(x + 18, iy, color)}
            <text
              x={x + 35}
              y={iy + 4}
              fill={color}
              fontSize={8}
              opacity={0.8}
            >
              {t(item.labelKey)}
            </text>
          </g>
        );
      })}
    </g>
  );
};

AvlLegend.displayName = 'AvlLegend';
