'use client';

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../lib/domPassthrough';
import React from 'react';

export interface SvgRingProps extends A11yProps {
  cx?: number;
  cy?: number;
  r?: number;
  variant?: 'solid' | 'dashed' | 'glow';
  color?: string;
  strokeWidth?: number;
  opacity?: number;
  className?: string;
  label?: string;
  /** When true (default), wraps in a standalone <svg> so the shape is visible without a parent SVG context. */
  asRoot?: boolean;
  width?: number;
  height?: number;
}

let ringIdCounter = 0;

export const SvgRing: React.FC<SvgRingProps> = ({
  cx = 50,
  cy = 50,
  r = 40,
  variant = 'solid',
  color = 'var(--color-primary)',
  strokeWidth = 1.5,
  opacity = 1,
  className,
  label,
  asRoot = true,
  width = 100,
  height = 100,
  ...rest
}) => {
  const a11y = domPassthrough(rest);
  const gradientId = React.useMemo(() => {
    ringIdCounter += 1;
    return `almadar-ring-glow-${ringIdCounter}`;
  }, []);

  const inner = (
    <g {...(asRoot ? undefined : a11y)} className={className} opacity={opacity}>
      {variant === 'glow' && (
        <>
          <defs>
            <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={color} stopOpacity={0.15} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={cx} cy={cy} r={r} fill={`url(#${gradientId})`} />
        </>
      )}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={variant === 'dashed' ? '6 4' : undefined}
      />
      {label && (
        <text
          x={cx}
          y={cy - r - 6}
          textAnchor="middle"
          fill={color}
          fontSize={11}
          fontFamily="inherit"
        >
          {label}
        </text>
      )}
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

SvgRing.displayName = 'SvgRing';
