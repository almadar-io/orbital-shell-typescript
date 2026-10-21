'use client';

import React from 'react';
import { type AvlBaseProps, STATE_COLORS, type StateRole } from '../../../lib/avl-theme';

export interface AvlStateProps extends AvlBaseProps {
  name?: string;
  isInitial?: boolean;
  isTerminal?: boolean;
  width?: number;
  height?: number;
  /** V2: Role-based fill color. When set, overrides monochrome rendering. */
  role?: StateRole;
  /** V2: Number of transitions touching this state. Drives proportional width. */
  transitionCount?: number;
}

function computeWidth(explicit: number | undefined, transitionCount?: number): number {
  if (explicit != null) return explicit;
  if (transitionCount == null) return 100;
  if (transitionCount >= 5) return 160;
  if (transitionCount >= 3) return 130;
  return 100;
}

export const AvlState: React.FC<AvlStateProps> = ({
  x = 0,
  y = 0,
  name,
  isInitial = false,
  isTerminal = false,
  width: explicitWidth,
  height = 40,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
  role,
  transitionCount,
}) => {
  const width = computeWidth(explicitWidth, transitionCount);
  const rx = height / 2;

  const roleColors = role ? STATE_COLORS[role] : null;
  const fillColor = roleColors ? roleColors.fill : 'none';
  const strokeColor = roleColors ? roleColors.border : color;
  const textColor = roleColors ? roleColors.border : color;

  return (
    <g className={className} opacity={opacity} transform={`translate(${x},${y})`}>
      {/* Initial state: filled circle marker to the left */}
      {isInitial && (
        <circle
          cx={-16}
          cy={height / 2}
          r={6}
          fill={strokeColor}
        />
      )}

      {/* Terminal state: double border */}
      {isTerminal && (
        <rect
          x={-4}
          y={-4}
          width={width + 8}
          height={height + 8}
          rx={rx + 4}
          ry={rx + 4}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1}
          opacity={0.5}
        />
      )}

      {/* Main rounded rectangle */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={rx}
        ry={rx}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={2}
      />

      {/* State name */}
      {name && (
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={textColor}
          fontSize={role ? 14 : 11}
          fontWeight={role ? 600 : 400}
          fontFamily="inherit"
        >
          {name}
        </text>
      )}
    </g>
  );
};

AvlState.displayName = 'AvlState';
