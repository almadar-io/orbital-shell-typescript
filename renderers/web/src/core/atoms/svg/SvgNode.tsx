'use client';

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../lib/domPassthrough';
import { svgMotionClass } from '../../lib/svgMotion';
import React from 'react';

export interface SvgNodeProps extends A11yProps {
  x?: number;
  y?: number;
  r?: number;
  variant?: 'filled' | 'stroked' | 'pulse';
  color?: string;
  opacity?: number;
  className?: string;
  label?: string;
  /** When true (default), wraps in a standalone <svg> so the shape is visible without a parent SVG context. */
  asRoot?: boolean;
  width?: number;
  height?: number;
}

export const SvgNode: React.FC<SvgNodeProps> = ({
  x = 50,
  y = 50,
  r = 6,
  variant = 'filled',
  color = 'var(--color-primary)',
  opacity = 1,
  className,
  label,
  asRoot = true,
  width = 100,
  height = 100,
  ...rest
}) => {
  const a11y = domPassthrough(rest);
  const inner = (
    <g {...(asRoot ? undefined : a11y)} className={className} opacity={opacity}>
      {variant === 'pulse' && (
        <circle
          cx={x}
          cy={y}
          r={r * 2}
          fill="none"
          stroke={color}
          strokeWidth={1}
          opacity={0.3}
          className={svgMotionClass('pulseRing', true)}
        />
      )}
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={variant === 'stroked' ? 'none' : color}
        stroke={variant === 'stroked' ? color : 'none'}
        strokeWidth={variant === 'stroked' ? 2 : 0}
      />
      {label && (
        <text
          x={x}
          y={y + r + 14}
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

SvgNode.displayName = 'SvgNode';
