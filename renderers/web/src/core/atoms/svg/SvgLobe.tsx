'use client';

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../lib/domPassthrough';
import React from 'react';

export interface SvgLobeProps extends A11yProps {
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  rotation?: number;
  shells?: number;
  color?: string;
  opacity?: number;
  className?: string;
  /** When true (default), wraps in a standalone <svg> so the shape is visible without a parent SVG context. */
  asRoot?: boolean;
  width?: number;
  height?: number;
}

export const SvgLobe: React.FC<SvgLobeProps> = ({
  cx = 50,
  cy = 50,
  rx = 14,
  ry = 20,
  rotation = 0,
  shells = 2,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
  asRoot = true,
  width = 100,
  height = 100,
  ...rest
}) => {
  const a11y = domPassthrough(rest);
  const clampedShells = Math.max(1, Math.min(3, shells));

  const renderShell = (shellIndex: number) => {
    const scale = shellIndex === 0 ? 1 : 1 - shellIndex * 0.3;
    const shellOpacity = shellIndex === 0 ? 1 : 0.5;
    const sRx = rx * scale;
    const sRy = ry * scale;

    return (
      <g key={shellIndex} opacity={shellOpacity}>
        <ellipse
          cx={cx}
          cy={cy - sRy}
          rx={sRx}
          ry={sRy}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
        />
        <ellipse
          cx={cx}
          cy={cy + sRy}
          rx={sRx}
          ry={sRy}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
        />
      </g>
    );
  };

  const inner = (
    <g {...(asRoot ? undefined : a11y)}
      className={className}
      opacity={opacity}
      transform={`rotate(${rotation}, ${cx}, ${cy})`}
    >
      {Array.from({ length: clampedShells }, (_, i) => renderShell(i))}
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

SvgLobe.displayName = 'SvgLobe';
