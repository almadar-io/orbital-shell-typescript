'use client';

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../lib/domPassthrough';
import React from 'react';

export interface SvgBranchProps extends A11yProps {
  x?: number;
  y?: number;
  variant?: 'fork' | 'merge' | 'diamond';
  branches?: number;
  size?: number;
  color?: string;
  opacity?: number;
  className?: string;
  /** When true (default), wraps in a standalone <svg> so the shape is visible without a parent SVG context. */
  asRoot?: boolean;
  width?: number;
  height?: number;
}

function buildForkPaths(
  x: number,
  y: number,
  branches: number,
  scale: number
): string[] {
  const inLength = 30 * scale;
  const outLength = 30 * scale;
  const fanSpread = 20 * scale;
  const junctionX = x + inLength;
  const paths: string[] = [];

  paths.push(`M ${x} ${y} L ${junctionX} ${y}`);

  for (let i = 0; i < branches; i++) {
    const fraction = branches === 1 ? 0 : (i / (branches - 1)) * 2 - 1;
    const endY = y + fraction * fanSpread;
    const endX = junctionX + outLength;
    const cpX = junctionX + outLength * 0.5;
    paths.push(`M ${junctionX} ${y} C ${cpX} ${y} ${cpX} ${endY} ${endX} ${endY}`);
  }

  return paths;
}

function buildMergePaths(
  x: number,
  y: number,
  branches: number,
  scale: number
): string[] {
  const inLength = 30 * scale;
  const outLength = 30 * scale;
  const fanSpread = 20 * scale;
  const junctionX = x + inLength;
  const paths: string[] = [];

  for (let i = 0; i < branches; i++) {
    const fraction = branches === 1 ? 0 : (i / (branches - 1)) * 2 - 1;
    const startY = y + fraction * fanSpread;
    const cpX = x + inLength * 0.5;
    paths.push(`M ${x} ${startY} C ${cpX} ${startY} ${cpX} ${y} ${junctionX} ${y}`);
  }

  paths.push(`M ${junctionX} ${y} L ${junctionX + outLength} ${y}`);

  return paths;
}

function buildDiamondPoints(x: number, y: number, scale: number): string {
  const w = 20 * scale;
  const h = 14 * scale;
  return [
    `${x + w} ${y}`,
    `${x + w * 2} ${y + h}`,
    `${x + w} ${y + h * 2}`,
    `${x} ${y + h}`,
  ].join(' ');
}

export const SvgBranch: React.FC<SvgBranchProps> = ({
  x = 5,
  y = 50,
  variant = 'fork',
  branches = 2,
  size = 1,
  color = 'var(--color-primary)',
  opacity = 1,
  className,
  asRoot = true,
  width = 100,
  height = 100,
  ...rest
}) => {
  const a11y = domPassthrough(rest);
  let inner: React.ReactNode;

  if (variant === 'diamond') {
    const points = buildDiamondPoints(x, y, size);
    inner = (
      <g {...(asRoot ? undefined : a11y)} className={className} opacity={opacity}>
        <polygon
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </g>
    );
  } else {
    const paths =
      variant === 'fork'
        ? buildForkPaths(x, y, branches, size)
        : buildMergePaths(x, y, branches, size);

    inner = (
      <g {...(asRoot ? undefined : a11y)} className={className} opacity={opacity}>
        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}
        {variant === 'fork' && <circle cx={x + 30 * size} cy={y} r={3} fill={color} />}
        {variant === 'merge' && (
          <circle cx={x + 30 * size} cy={y} r={3} fill={color} />
        )}
      </g>
    );
  }

  if (asRoot) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} {...a11y}>
        {inner}
      </svg>
    );
  }

  return <>{inner}</>;
};

SvgBranch.displayName = 'SvgBranch';
