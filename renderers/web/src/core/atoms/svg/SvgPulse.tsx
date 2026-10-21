'use client';

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../lib/domPassthrough';
import { svgMotionClass } from '../../lib/svgMotion';
import React from 'react';

export interface SvgPulseProps extends A11yProps {
  cx?: number;
  cy?: number;
  rings?: number;
  maxRadius?: number;
  color?: string;
  animated?: boolean;
  opacity?: number;
  className?: string;
  /** When true (default), wraps in a standalone <svg> so the shape is visible without a parent SVG context. */
  asRoot?: boolean;
  width?: number;
  height?: number;
}

export const SvgPulse: React.FC<SvgPulseProps> = ({
  cx = 70,
  cy = 70,
  rings = 3,
  maxRadius = 60,
  color = 'var(--color-primary)',
  animated = true,
  opacity = 1,
  className,
  asRoot = true,
  width = 140,
  height = 140,
  ...rest
}) => {
  const a11y = domPassthrough(rest);
  const pulseClass = svgMotionClass('pulseExpand', animated);
  const inner = (
    <g {...(asRoot ? undefined : a11y)} className={className} opacity={opacity}>
      {Array.from({ length: rings }).map((_, i) => {
        const ringRadius = ((i + 1) / rings) * maxRadius;
        const ringOpacity = 1 - (i / rings) * 0.6;
        const delay = i * 0.6;

        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={ringRadius}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            opacity={pulseClass ? undefined : ringOpacity * 0.4}
            className={pulseClass}
            style={pulseClass ? { animationDelay: `${delay}s` } : undefined}
          />
        );
      })}
      <circle cx={cx} cy={cy} r={3} fill={color} />
    </g>
  );

  if (asRoot) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} {...a11y}>
        {inner}
      </svg>
    );
  }

  return inner;
};

SvgPulse.displayName = 'SvgPulse';
