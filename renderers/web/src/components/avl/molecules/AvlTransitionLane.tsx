'use client';

import React from 'react';
import { AvlEffect } from '../atoms/AvlEffect';
import { CONNECTION_COLORS } from '../../../lib/avl-theme';

export interface AvlTransitionLaneEffect {
  type: string | string;
}

export interface AvlTransitionLaneProps {
  event: string;
  guard?: string;
  effects: AvlTransitionLaneEffect[];
  width: number;
  x?: number;
  y?: number;
  isBackward?: boolean;
  isSelfLoop?: boolean;
  color?: string;
  onTransitionClick?: () => void;
}

const MAX_VISIBLE_EFFECTS = 6;

export const AvlTransitionLane: React.FC<AvlTransitionLaneProps> = ({
  event,
  guard,
  effects,
  width,
  x = 0,
  y = 0,
  isBackward = false,
  isSelfLoop = false,
  color = 'var(--color-primary)',
  onTransitionClick,
}) => {
  const rowHeight = 22;
  const padding = 8;
  const eventRow = padding;
  const guardRow = guard ? eventRow + rowHeight : eventRow;
  const effectsRow = (guard ? guardRow + rowHeight : eventRow + rowHeight);
  const totalHeight = effectsRow + (effects.length > 0 ? rowHeight + padding : padding);

  const connStyle = isSelfLoop
    ? CONNECTION_COLORS.selfLoop
    : isBackward
      ? CONNECTION_COLORS.backward
      : CONNECTION_COLORS.forward;

  const visibleEffects = effects.slice(0, MAX_VISIBLE_EFFECTS);
  const overflow = effects.length - MAX_VISIBLE_EFFECTS;
  const effectSpacing = 28;

  return (
    <g
      transform={`translate(${x},${y})`}
      style={{ cursor: onTransitionClick ? 'pointer' : 'default' }}
      onClick={onTransitionClick}
      role={onTransitionClick ? 'button' : undefined}
    >
      {/* Background band */}
      <rect
        x={0}
        y={0}
        width={width}
        height={totalHeight}
        rx={6}
        fill={connStyle.color}
        fillOpacity={0.03}
        stroke={connStyle.color}
        strokeWidth={0.5}
        strokeOpacity={0.15}
        strokeDasharray={connStyle.dash === 'none' ? undefined : connStyle.dash}
      />

      {/* Row 1: Event name */}
      <text
        x={padding + 14}
        y={eventRow + rowHeight * 0.65}
        fontSize={14}
        fontWeight={600}
        fill={color}
        fontFamily="inherit"
      >
        {event}
      </text>
      {/* Lightning bolt indicator */}
      <text
        x={padding + 4}
        y={eventRow + rowHeight * 0.65}
        fontSize={10}
        fill={color}
        opacity={0.5}
      >
        ⚡
      </text>

      {/* Row 2: Guard (optional) */}
      {guard && (
        <g>
          <polygon
            points={`${padding + 6},${guardRow + rowHeight * 0.35} ${padding + 10},${guardRow + rowHeight * 0.15} ${padding + 14},${guardRow + rowHeight * 0.35} ${padding + 10},${guardRow + rowHeight * 0.55}`}
            fill="none"
            stroke={color}
            strokeWidth={1}
            opacity={0.5}
          />
          <text
            x={padding + 20}
            y={guardRow + rowHeight * 0.6}
            fontSize={12}
            fontWeight={400}
            fill={color}
            opacity={0.6}
            fontFamily="inherit"
          >
            {guard}
          </text>
        </g>
      )}

      {/* Row 3: Effect icon strip */}
      {visibleEffects.length > 0 && (
        <g>
          {visibleEffects.map((eff, i) => (
            <AvlEffect
              key={i}
              x={padding + 12 + i * effectSpacing}
              y={effectsRow + rowHeight * 0.5}
              effectType={eff.type}
              size={10}
              showBackground
            />
          ))}
          {overflow > 0 && (
            <text
              x={padding + 12 + visibleEffects.length * effectSpacing}
              y={effectsRow + rowHeight * 0.6}
              fontSize={10}
              fill={color}
              opacity={0.5}
              fontFamily="inherit"
            >
              +{overflow}
            </text>
          )}
        </g>
      )}
    </g>
  );
};

AvlTransitionLane.displayName = 'AvlTransitionLane';
