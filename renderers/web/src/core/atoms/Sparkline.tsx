/**
 * Sparkline Atom Component
 *
 * Minimal inline trend chart. Pure SVG polyline over a numeric series.
 * Extracted from StatCard's sparkline path so any KPI or list row can
 * include a trend visualization without compositing the whole card.
 */

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../lib/domPassthrough';
import React from "react";
import { cn } from "../lib/cn";

export type SparklineColor =
  | "auto"
  | "primary"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "muted";

export interface SparklineProps extends A11yProps {
  /** Numeric series to plot. Length < 2 renders nothing. */
  data: readonly number[];
  /**
   * Stroke color.
   * `auto` (default): success when the series trends up (last ≥ first),
   * error when it trends down.
   */
  color?: SparklineColor;
  /** SVG width in px. Default 80. */
  width?: number;
  /** SVG height in px. Default 32. */
  height?: number;
  /** Stroke width in px. Default 2. */
  strokeWidth?: number;
  /** Fill the area under the line with the stroke color at low opacity. */
  fill?: boolean;
  /** Additional CSS classes. */
  className?: string;
}

const COLOR_VAR: Record<Exclude<SparklineColor, "auto">, string> = {
  primary: "var(--color-primary)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error: "var(--color-error)",
  info: "var(--color-info)",
  muted: "var(--color-muted-foreground)",
};

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  color = "auto",
  width = 80,
  height = 32,
  strokeWidth = 2,
  fill = false,
  className,
  ...rest
}) => {
  if (data.length < 2) return null;

  const pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (width - pad * 2);
      const y = pad + (1 - (v - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const resolvedColor =
    color === "auto"
      ? data[data.length - 1] >= data[0]
        ? COLOR_VAR.success
        : COLOR_VAR.error
      : COLOR_VAR[color];

  const areaPath = fill
    ? `M ${pad},${height - pad} L ${points.split(" ").join(" L ")} L ${width - pad},${height - pad} Z`
    : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("flex-shrink-0", className)}
      {...domPassthrough(rest)}
      aria-hidden={rest['aria-hidden'] ?? true}
    >
      {areaPath && <path d={areaPath} fill={resolvedColor} opacity={0.15} />}
      <polyline
        fill="none"
        stroke={resolvedColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
};

Sparkline.displayName = "Sparkline";
