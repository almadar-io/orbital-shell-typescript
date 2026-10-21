'use client';

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../lib/domPassthrough';
import React from 'react';

export interface SvgMeshProps extends A11yProps {
  cx?: number;
  cy?: number;
  nodes?: number;
  radius?: number;
  color?: string;
  connectionDensity?: number;
  opacity?: number;
  className?: string;
  /** When true (default), wraps in a standalone <svg> so the shape is visible without a parent SVG context. */
  asRoot?: boolean;
  width?: number;
  height?: number;
}

function getNodePositions(
  cx: number,
  cy: number,
  count: number,
  radius: number
): Array<{ x: number; y: number }> {
  return Array.from({ length: count }).map((_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });
}

function getConnections(
  count: number,
  density: number
): Array<[number, number]> {
  const allPairs: Array<[number, number]> = [];

  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      allPairs.push([i, j]);
    }
  }

  const connectCount = Math.round(allPairs.length * Math.max(0, Math.min(1, density)));

  return allPairs.slice(0, connectCount);
}

export const SvgMesh: React.FC<SvgMeshProps> = ({
  cx = 60,
  cy = 60,
  nodes = 6,
  radius = 50,
  color = 'var(--color-primary)',
  connectionDensity = 0.5,
  opacity = 1,
  className,
  asRoot = true,
  width = 120,
  height = 120,
  ...rest
}) => {
  const a11y = domPassthrough(rest);
  const positions = getNodePositions(cx, cy, nodes, radius);
  const connections = getConnections(nodes, connectionDensity);

  const inner = (
    <g {...(asRoot ? undefined : a11y)} className={className} opacity={opacity}>
      {connections.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={positions[a].x}
          y1={positions[a].y}
          x2={positions[b].x}
          y2={positions[b].y}
          stroke={color}
          strokeWidth={1}
          opacity={0.3}
        />
      ))}
      {positions.map((pos, i) => (
        <circle
          key={i}
          cx={pos.x}
          cy={pos.y}
          r={4}
          fill={color}
        />
      ))}
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

SvgMesh.displayName = 'SvgMesh';
