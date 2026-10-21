'use client';

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../lib/domPassthrough';
import { svgMotionClass } from '../../lib/svgMotion';
import React from 'react';

export interface SvgConnectionProps extends A11yProps {
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  variant?: 'solid' | 'dashed' | 'animated';
  color?: string;
  strokeWidth?: number;
  opacity?: number;
  className?: string;
  /** When true (default), wraps in a standalone <svg> so the shape is visible without a parent SVG context. */
  asRoot?: boolean;
  width?: number;
  height?: number;
}

export const SvgConnection: React.FC<SvgConnectionProps> = ({
  x1 = 10,
  y1 = 50,
  x2 = 90,
  y2 = 50,
  variant = 'solid',
  color = 'var(--color-primary)',
  strokeWidth = 1.5,
  opacity = 1,
  className,
  asRoot = true,
  width = 100,
  height = 100,
  ...rest
}) => {
  const a11y = domPassthrough(rest);
  const dashProps: React.SVGAttributes<SVGLineElement> =
    variant === 'solid'
      ? {}
      : {
          strokeDasharray: '8 6',
        };

  const inner = (
    <line {...(asRoot ? undefined : a11y)}
      className={
        [
          svgMotionClass('flowDash', variant === 'animated'),
          className,
        ]
          .filter(Boolean)
          .join(' ') || undefined
      }
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      opacity={opacity}
      {...dashProps}
    />
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

SvgConnection.displayName = 'SvgConnection';
