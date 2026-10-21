'use client';

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../lib/domPassthrough';
import React from 'react';

export interface SvgGridProps extends A11yProps {
  x?: number;
  y?: number;
  cols?: number;
  rows?: number;
  spacing?: number;
  nodeRadius?: number;
  color?: string;
  opacity?: number;
  className?: string;
  highlights?: number[];
  /** When true (default), wraps in a standalone <svg> so the shape is visible without a parent SVG context. */
  asRoot?: boolean;
  width?: number;
  height?: number;
}

export const SvgGrid: React.FC<SvgGridProps> = ({
  x = 10,
  y = 10,
  cols = 4,
  rows = 3,
  spacing = 20,
  nodeRadius = 3,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
  highlights = [],
  asRoot = true,
  width = 100,
  height = 100,
  ...rest
}) => {
  const a11y = domPassthrough(rest);
  const highlightSet = new Set(highlights);

  const inner = (
    <g {...(asRoot ? undefined : a11y)} className={className} opacity={opacity}>
      {Array.from({ length: rows }).map((_, row) =>
        Array.from({ length: cols }).map((_, col) => {
          const index = row * cols + col;
          const isHighlighted = highlightSet.has(index);
          const cx = x + col * spacing;
          const cy = y + row * spacing;

          return (
            <circle
              key={index}
              cx={cx}
              cy={cy}
              r={isHighlighted ? nodeRadius * 1.6 : nodeRadius}
              fill={color}
              opacity={isHighlighted ? 1 : 0.4}
            />
          );
        })
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

SvgGrid.displayName = 'SvgGrid';
