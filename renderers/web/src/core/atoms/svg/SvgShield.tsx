'use client';

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../lib/domPassthrough';
import React from 'react';

export interface SvgShieldProps extends A11yProps {
  x?: number;
  y?: number;
  size?: number;
  variant?: 'outline' | 'filled' | 'check';
  color?: string;
  opacity?: number;
  className?: string;
  /** When true (default), wraps in a standalone <svg> so the shape is visible without a parent SVG context. */
  asRoot?: boolean;
  width?: number;
  height?: number;
}

const SHIELD_PATH =
  'M15,2 C15,2 5,5 2,6 C2,6 2,18 5,24 C8,30 15,34 15,34 C15,34 22,30 25,24 C28,18 28,6 28,6 C25,5 15,2 15,2 Z';

const CHECK_PATH = 'M10,18 L14,22 L21,13';

export const SvgShield: React.FC<SvgShieldProps> = ({
  x = 50,
  y = 50,
  size = 1,
  variant = 'outline',
  color = 'var(--color-primary)',
  opacity = 1,
  className,
  asRoot = true,
  width = 100,
  height = 100,
  ...rest
}) => {
  const a11y = domPassthrough(rest);
  const inner = (
    <g {...(asRoot ? undefined : a11y)}
      className={className}
      opacity={opacity}
      transform={`translate(${x - 15 * size}, ${y - 18 * size}) scale(${size})`}
    >
      <path
        d={SHIELD_PATH}
        fill={variant === 'filled' || variant === 'check' ? color : 'none'}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {variant === 'check' && (
        <path
          d={CHECK_PATH}
          fill="none"
          stroke="var(--surface-diagram)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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

SvgShield.displayName = 'SvgShield';
