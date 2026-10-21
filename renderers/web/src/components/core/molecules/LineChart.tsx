'use client';
/**
 * LineChart Molecule Component
 *
 * SVG-based line/area chart for time-series data.
 * Pure UI molecule with no entity binding.
 */

import type { A11yProps } from '@almadar/core';
import React, { useMemo, useId } from 'react';
import { cn } from '../../../core';
import { Box } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export interface ChartDataPoint {
  /** Optional: chronological x-axis. Absent for a categorical line chart
   * (label-as-x), which plots points in author order. Sorts the points but
   * does NOT space them proportionally to elapsed time — use `x` for a
   * numeric axis that needs true linear spacing. */
  date?: string | Date;
  /** Optional: numeric x-axis (e.g. volume, distance, dosage). Points are
   * sorted AND spaced proportionally to their true numeric position, unlike
   * `date` (sort only) or the index-based categorical fallback. Ignored
   * when `date` is present. */
  x?: number;
  value: number;
  label?: string;
}

export interface LineChartProps extends A11yProps {
  /** Data points to plot */
  data: ChartDataPoint[];
  /** SVG viewBox width */
  width?: number;
  /** SVG viewBox height */
  height?: number;
  /** Show horizontal grid lines at 25/50/75% */
  showGrid?: boolean;
  /** Show value labels near data points */
  showValues?: boolean;
  /** Fill area under line with gradient */
  showArea?: boolean;
  /** Line stroke color */
  lineColor?: string;
  /** Area fill color (used for gradient) */
  areaColor?: string;
  /** Additional CSS classes */
  className?: string;
}

interface NormalizedPoint {
  x: number;
  y: number;
  value: number;
  label?: string;
}

export const LineChart: React.FC<LineChartProps> = ({
  data,
  width = 400,
  height = 200,
  showGrid = true,
  showValues = false,
  showArea = true,
  lineColor = 'var(--color-primary)',
  areaColor = 'var(--color-primary)',
  className,
  ...rest
}) => {
  const { t } = useTranslate();
  const gradientId = useId();

  const safeData = data ?? [];

  const sortedData = useMemo(() => {
    if (safeData.length === 0) return [];
    // Chronological x-axis wins when present. Otherwise a numeric x-axis
    // sorts by value. A categorical line chart (neither) plots in author
    // order (x is the point index).
    if (safeData.some((d) => d.date != null)) {
      return [...safeData].sort(
        (a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime()
      );
    }
    if (safeData.some((d) => d.x != null)) {
      return [...safeData].sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
    }
    return [...safeData];
  }, [safeData]);

  const points: NormalizedPoint[] = useMemo(() => {
    if (sortedData.length === 0) return [];

    const values = sortedData.map((d) => d.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;

    const padding = 20;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    // A numeric `x` (and no `date`, which only sorts) spaces points at their
    // true linear position instead of evenly by index — a titration curve
    // mixing 1mL/0.1mL increments needs volume-linear spacing, not just
    // volume-correct order.
    const hasNumericX = !sortedData.some((d) => d.date != null) && sortedData.some((d) => d.x != null);
    const xValues = hasNumericX ? sortedData.map((d) => d.x ?? 0) : [];
    const minX = hasNumericX ? Math.min(...xValues) : 0;
    const xRange = hasNumericX ? Math.max(...xValues) - minX || 1 : 1;

    // A lone point has no line or scale to place it by: it sits mid-plot and carries its value.
    if (sortedData.length === 1) {
      const only = sortedData[0];
      return [{ x: width / 2, y: height / 2, value: only.value, label: only.label }];
    }

    return sortedData.map((point, index) => ({
      x: hasNumericX
        ? padding + ((point.x ?? 0) - minX) / xRange * chartWidth
        : padding + (index / (sortedData.length - 1 || 1)) * chartWidth,
      y: padding + chartHeight - ((point.value - minVal) / range) * chartHeight,
      value: point.value,
      label: point.label,
    }));
  }, [sortedData, width, height]);

  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    return points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');
  }, [points]);

  const areaPath = useMemo(() => {
    if (points.length === 0 || !showArea) return '';
    const bottom = height - 20;
    const first = points[0];
    const last = points[points.length - 1];
    return `${linePath} L ${last.x} ${bottom} L ${first.x} ${bottom} Z`;
  }, [linePath, points, height, showArea]);

  if (safeData.length === 0) {
    return (
      <Box {...domPassthrough(rest)} className={cn('flex items-center justify-center text-muted-foreground', className)} style={{ width, height }}>
        {t('empty.noData')}
      </Box>
    );
  }

  return (
    <Box {...domPassthrough(rest)} className={cn(className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={areaColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={areaColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        {showGrid && (
          <>
            <line x1="20" y1={height * 0.25} x2={width - 20} y2={height * 0.25} stroke="var(--color-border, #e5e7eb)" strokeWidth="1" />
            <line x1="20" y1={height * 0.5} x2={width - 20} y2={height * 0.5} stroke="var(--color-border, #e5e7eb)" strokeWidth="1" />
            <line x1="20" y1={height * 0.75} x2={width - 20} y2={height * 0.75} stroke="var(--color-border, #e5e7eb)" strokeWidth="1" />
          </>
        )}

        {showArea && areaPath && (
          <path d={areaPath} fill={`url(#${gradientId})`} />
        )}

        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke={lineColor}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {points.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r="4"
            fill={lineColor}
            stroke="var(--color-background, white)"
            strokeWidth="2"
          />
        ))}

        {points.length === 1 && (
          <text
            x={points[0].x}
            y={points[0].y - 12}
            textAnchor="middle"
            fontSize="12"
            fill="var(--color-foreground, currentColor)"
          >
            {points[0].label !== undefined ? `${points[0].label}: ${points[0].value}` : points[0].value}
          </text>
        )}

        {showValues && points.length > 1 &&
          points.map((point, index) => (
            <text
              key={`label-${index}`}
              x={point.x}
              y={point.y - 10}
              textAnchor="middle"
              fontSize="11"
              fill="var(--color-foreground, currentColor)"
            >
              {point.label ?? point.value}
            </text>
          ))}
      </svg>
    </Box>
  );
};

LineChart.displayName = 'LineChart';
