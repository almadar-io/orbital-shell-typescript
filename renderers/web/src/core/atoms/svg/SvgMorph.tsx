'use client';

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../lib/domPassthrough';
import React from 'react';

export interface SvgMorphProps extends A11yProps {
  x?: number;
  y?: number;
  size?: number;
  variant?: 'text-to-code' | 'code-to-app' | 'generic';
  color?: string;
  opacity?: number;
  className?: string;
  /** When true (default), wraps in a standalone <svg> so the shape is visible without a parent SVG context. */
  asRoot?: boolean;
  width?: number;
  height?: number;
}

const TextLines: React.FC<{ x: number; y: number; scale: number; color: string }> = ({
  x,
  y,
  scale,
  color,
}) => {
  const widths = [28, 22, 26];
  return (
    <g>
      {widths.map((w, i) => (
        <rect
          key={i}
          x={x}
          y={y + i * 8 * scale}
          width={w * scale}
          height={3 * scale}
          rx={1.5 * scale}
          fill={color}
          opacity={0.7 - i * 0.1}
        />
      ))}
    </g>
  );
};

TextLines.displayName = 'TextLines';

const CodeBrackets: React.FC<{ x: number; y: number; scale: number; color: string }> = ({
  x,
  y,
  scale,
  color,
}) => {
  const h = 20 * scale;
  const w = 8 * scale;
  return (
    <g>
      <path
        d={`M ${x + w} ${y} L ${x} ${y + h / 2} L ${x + w} ${y + h}`}
        fill="none"
        stroke={color}
        strokeWidth={2 * scale}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={`M ${x + w * 2} ${y} L ${x + w * 3} ${y + h / 2} L ${x + w * 2} ${y + h}`}
        fill="none"
        stroke={color}
        strokeWidth={2 * scale}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
};

CodeBrackets.displayName = 'CodeBrackets';

const AppRect: React.FC<{ x: number; y: number; scale: number; color: string }> = ({
  x,
  y,
  scale,
  color,
}) => {
  const w = 22 * scale;
  const h = 20 * scale;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={4 * scale}
        fill="none"
        stroke={color}
        strokeWidth={2 * scale}
      />
      <rect
        x={x + 4 * scale}
        y={y + 4 * scale}
        width={w - 8 * scale}
        height={3 * scale}
        rx={1 * scale}
        fill={color}
        opacity={0.5}
      />
      <rect
        x={x + 4 * scale}
        y={y + 10 * scale}
        width={(w - 8 * scale) * 0.6}
        height={3 * scale}
        rx={1 * scale}
        fill={color}
        opacity={0.3}
      />
    </g>
  );
};

AppRect.displayName = 'AppRect';

const FlowArrow: React.FC<{
  x1: number;
  y: number;
  x2: number;
  scale: number;
  color: string;
}> = ({ x1, y, x2, scale, color }) => {
  const arrowSize = 4 * scale;
  return (
    <g>
      <line
        x1={x1}
        y1={y}
        x2={x2 - arrowSize}
        y2={y}
        stroke={color}
        strokeWidth={1.5 * scale}
        strokeDasharray={`${3 * scale} ${3 * scale}`}
        opacity={0.5}
      />
      <polygon
        points={`${x2} ${y}, ${x2 - arrowSize} ${y - arrowSize / 2}, ${x2 - arrowSize} ${y + arrowSize / 2}`}
        fill={color}
        opacity={0.6}
      />
    </g>
  );
};

FlowArrow.displayName = 'FlowArrow';

export const SvgMorph: React.FC<SvgMorphProps> = ({
  x = 5,
  y = 10,
  size = 1,
  variant = 'generic',
  color = 'var(--color-primary)',
  opacity = 1,
  className,
  asRoot = true,
  width = 130,
  height = 50,
  ...rest
}) => {
  const a11y = domPassthrough(rest);
  const gap = 40 * size;
  const midY = y + 10 * size;

  let inner: React.ReactNode;

  if (variant === 'text-to-code') {
    const leftEnd = x + 30 * size;
    const rightStart = leftEnd + gap;
    inner = (
      <g {...(asRoot ? undefined : a11y)} className={className} opacity={opacity}>
        <TextLines x={x} y={y} scale={size} color={color} />
        <FlowArrow x1={leftEnd} y={midY} x2={rightStart} scale={size} color={color} />
        <CodeBrackets x={rightStart} y={y} scale={size} color={color} />
      </g>
    );
  } else if (variant === 'code-to-app') {
    const leftEnd = x + 26 * size;
    const rightStart = leftEnd + gap;
    inner = (
      <g {...(asRoot ? undefined : a11y)} className={className} opacity={opacity}>
        <CodeBrackets x={x} y={y} scale={size} color={color} />
        <FlowArrow x1={leftEnd} y={midY} x2={rightStart} scale={size} color={color} />
        <AppRect x={rightStart} y={y} scale={size} color={color} />
      </g>
    );
  } else {
    const circleR = 10 * size;
    const circleX = x + circleR;
    const squareStart = x + circleR * 2 + gap;
    const squareSize = circleR * 2;

    inner = (
      <g {...(asRoot ? undefined : a11y)} className={className} opacity={opacity}>
        <circle
          cx={circleX}
          cy={midY}
          r={circleR}
          fill="none"
          stroke={color}
          strokeWidth={2 * size}
        />
        <FlowArrow
          x1={circleX + circleR + 2 * size}
          y={midY}
          x2={squareStart}
          scale={size}
          color={color}
        />
        <rect
          x={squareStart}
          y={midY - circleR}
          width={squareSize}
          height={squareSize}
          rx={3 * size}
          fill="none"
          stroke={color}
          strokeWidth={2 * size}
        />
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

SvgMorph.displayName = 'SvgMorph';
