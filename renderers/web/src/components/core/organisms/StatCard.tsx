'use client';
import { actionTestId } from '@almadar/core';
import React from "react";
import { cn } from '../../../core';
import { Typography } from '../../../core';
import { useContentSurface } from '../../../core';
import type { SurfaceMode } from '@almadar/core';
import { Box } from '../../../core';
import { HStack, VStack } from '../../../core';
import { Button } from '../../../core';
import { Sparkline } from '../../../core';
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { IconInput } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate, useFormatContext } from '../../../core';
import { resolveIcon } from '../../../core';
import type { DisplayStateProps } from "./types";
import type { A11yProps, EntityRow } from "@almadar/core";
import { domPassthrough } from '../../../core';
import { formatValue } from '../../../core';

/**
 * Schema metric definition
 * Supports both computed metrics (with field) and static metrics (with value)
 */
export interface MetricDefinition {
  /** Field name for computed metrics (optional if value is provided) */
  field?: string;
  /** Display label */
  label: string;
  /** Static value for display (alternative to field-based computation) */
  value?: string | number;
  /** Icon name or component for display */
  icon?: IconInput;
  /** Value format (e.g., 'currency', 'percent', 'number') */
  format?: "currency" | "percent" | "number" | string;
  /** How rows become the value: `count` rows, or `sum` the numeric `field` (default `sum` when `field` is set) */
  aggregate?: "count" | "sum";
  /** Only rows whose `field` equals `equals` are aggregated */
  filter?: { field: string; equals: string | number | boolean };
}

export interface StatCardProps extends DisplayStateProps, Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Entity data (single record or collection) used to compute metrics. */
  entity?: EntityRow | readonly EntityRow[];
  /** Main label */
  label?: string;
  /** Title (alias for label) */
  title?: string;
  /** Primary value - accepts array from generated code (will use first element or length) */
  value?: string | number | (string | number | undefined)[];
  /** Previous value for comparison */
  previousValue?: number;
  /** Current value as number for trend calculation */
  currentValue?: number;
  /** Manual trend percentage (overrides calculation) */
  trend?: number;
  /** Trend direction (overrides calculation) */
  trendDirection?: "up" | "down" | "neutral";
  /** Whether up is good (green) or bad (red) */
  invertTrend?: boolean;
  /** Icon to display (Lucide component or icon name string) */
  icon?: IconInput;
  /** Icon background color */
  iconBg?: string;
  /** Icon color */
  iconColor?: string;
  /** Subtitle or description */
  subtitle?: string;
  /** Action button */
  action?: {
    label: string;
    /** Event to dispatch via event bus (for trait state machine integration) */
    event?: string;
    /** Navigation URL - supports template interpolation */
    navigatesTo?: string;
    /** Legacy onClick callback */
    onClick?: () => void;
  };
  /** Metrics to display (schema format) - accepts readonly for compatibility with generated const arrays */
  metrics?: readonly MetricDefinition[];
  /** Compact display mode */
  compact?: boolean;
  /** Sparkline data points for an inline trend chart */
  sparklineData?: readonly number[];
  /** Content surface: `auto` paints the theme's surface behind this block unless it already sits on one (a card, dialog or another block); `none` opts out. */
  surface?: SurfaceMode;
}

export const StatCard: React.FC<StatCardProps> = ({
  label: propLabel,
  title: propTitle,
  value: propValue,
  previousValue,
  currentValue,
  trend: manualTrend,
  trendDirection: manualDirection,
  invertTrend = false,
  icon: iconProp,
  iconBg = "bg-muted",
  iconColor = "text-foreground",
  subtitle,
  action,
  className,
  // Schema-based props
  entity,
  metrics,
  sparklineData,
  isLoading: externalLoading,
  error: externalError,
  surface = 'auto',
  ...rest
}) => {
  const contentSurface = useContentSurface(surface);
  const tileClass = cn(contentSurface.className ?? 'rounded-container border border-border', 'p-4');
  // Resolve icon: accept both LucideIcon components and string names
  const Icon = typeof iconProp === "string" ? resolveIcon(iconProp) ?? undefined : iconProp;

  // Use title as fallback for label
  const labelToUse = propLabel ?? propTitle;
  const eventBus = useEventBus();
  const { t, locale } = useTranslate();
  const fmt = useFormatContext();

  // Handle action click with event bus integration
  const handleActionClick = React.useCallback(() => {
    if (action?.event) {
      eventBus.emit(`UI:${action.event}`, {});
    }
    if (action?.onClick) {
      action.onClick();
    }
  }, [action, eventBus]);

  // Normalize entity data to array
  const data: readonly EntityRow[] = Array.isArray(entity) ? entity : entity ? [entity] : [];

  // Determine loading and error state
  const isLoading = externalLoading ?? false;
  const error = externalError;

  // Helper to compute a single metric value
  const computeMetricValue = React.useCallback(
    (metric: MetricDefinition, items: readonly EntityRow[]) => {
      if (metric.value !== undefined) return metric.value;
      const rows = metric.filter
        ? items.filter((item) => item[metric.filter!.field] === metric.filter!.equals)
        : items;
      if (metric.aggregate === "count") return rows.length;
      if (!metric.field) return 0;
      const field = metric.field;
      return rows.reduce((acc, item) => {
        const val = item[field];
        return acc + (typeof val === "number" ? val : 0);
      }, 0);
    },
    [],
  );

  // Schema-driven: calculate stats from data and metrics (supports multiple metrics)
  const schemaStats = React.useMemo(() => {
    if (!metrics || metrics.length === 0) return null;

    // Compute all metrics
    return metrics.map((metric) => ({
      label: metric.label,
      value: computeMetricValue(metric, data),
      format: metric.format,
    }));
  }, [metrics, data, computeMetricValue]);

  // Calculate trend (must be before early returns per Rules of Hooks)
  const calculatedTrend = React.useMemo(() => {
    if (manualTrend !== undefined) return manualTrend;
    if (previousValue === undefined || currentValue === undefined)
      return undefined;
    if (previousValue === 0) return currentValue > 0 ? 100 : 0;
    return ((currentValue - previousValue) / previousValue) * 100;
  }, [manualTrend, previousValue, currentValue]);

  // If multiple metrics, render them as a row of stats
  if (schemaStats && schemaStats.length > 1) {
    if (isLoading) {
      return contentSurface.provide(
        <Box {...domPassthrough(rest)} className={cn("grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(10rem,100%),1fr))]", className)}>
          {schemaStats.map((_, idx) => (
            <Box key={idx} className={tileClass}>
              <VStack gap="xs" className="animate-pulse">
                <Box className="h-3 bg-muted rounded w-16" />
                <Box className="h-6 bg-muted rounded w-12" />
              </VStack>
            </Box>
          ))}
        </Box>,
      );
    }

    return contentSurface.provide(
      <Box {...domPassthrough(rest)} className={cn("grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(10rem,100%),1fr))]", className)}>
        {schemaStats.map((stat, idx) => (
          <Box key={idx} className={tileClass}>
            <Typography variant="overline" color="secondary">
              {stat.label}
            </Typography>
            <Typography variant="h4" className="text-xl tabular-nums">
              {formatValue(stat.value, stat.format ?? "number", fmt)}
            </Typography>
          </Box>
        ))}
      </Box>,
    );
  }

  // Use schema stats if available (single metric), otherwise use props
  const label = schemaStats?.[0]?.label || labelToUse || t('statCard.defaultLabel');
  // Handle array values (use first element or array length)
  const normalizedPropValue = Array.isArray(propValue)
    ? (propValue[0] ?? propValue.length)
    : propValue;
  const value = schemaStats?.[0]?.value ?? normalizedPropValue ?? 0;

  const trendDirection =
    manualDirection ||
    (calculatedTrend === undefined || calculatedTrend === 0
      ? "neutral"
      : calculatedTrend > 0
        ? "up"
        : "down");

  const isPositive = invertTrend
    ? trendDirection === "down"
    : trendDirection === "up";

  const TrendIcon =
    trendDirection === "up"
      ? TrendingUp
      : trendDirection === "down"
        ? TrendingDown
        : Minus;

  // Show error state
  if (error) {
    return contentSurface.provide(
      <Box {...domPassthrough(rest)} className={cn(contentSurface.className, "p-6 rounded-container", className)}>
        <VStack gap="none" className="space-y-1">
          <Typography variant="overline" color="secondary">
            {label}
          </Typography>
          <Typography variant="small" color="error">
            {t('error.generic') + ": " + error.message}
          </Typography>
        </VStack>
      </Box>,
    );
  }

  if (isLoading) {
    return contentSurface.provide(
      <Box {...domPassthrough(rest)} className={cn(contentSurface.className, "p-6 rounded-container", className)}>
        <VStack gap="sm" className="animate-pulse">
          <Box className="h-4 bg-muted rounded w-24" />
          <Box className="h-8 bg-muted rounded w-32" />
          <Box className="h-4 bg-muted rounded w-20" />
        </VStack>
      </Box>,
    );
  }

  return contentSurface.provide(
    <Box {...domPassthrough(rest)} className={cn(contentSurface.className, "p-6 rounded-container", className)}>
      <HStack align="start" justify="between">
        <VStack gap="none" className="space-y-1">
          <Typography variant="overline" color="secondary">
            {label}
          </Typography>
          <Typography variant="h4" className="text-2xl tabular-nums">
            {typeof value === "number" ? formatValue(value, schemaStats?.[0]?.format ?? "number", fmt) : value}
          </Typography>

          {/* Trend indicator */}
          {calculatedTrend !== undefined && (
            <HStack align="center" gap="xs">
              <HStack
                align="center"
                gap="none"
                className={cn(
                  "gap-0.5 text-sm font-bold",
                  isPositive
                    ? "text-success"
                    : trendDirection === "neutral"
                      ? "text-muted-foreground"
                      : "text-error",
                )}
              >
                <TrendIcon className="h-4 w-4" />
                <Typography variant="caption" as="span">{new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(Math.abs(calculatedTrend) / 100)}</Typography>
              </HStack>
              <Typography variant="small" color="secondary" as="span">
                {t('statCard.vsLastPeriod')}
              </Typography>
            </HStack>
          )}

          {subtitle && !calculatedTrend && (
            <Typography variant="small" color="secondary">
              {subtitle}
            </Typography>
          )}
        </VStack>

        <VStack gap="xs" align="end">
          {Icon && (
            <Box className={cn("p-3", iconBg)}>
              <Icon className={cn("h-6 w-6", iconColor)} />
            </Box>
          )}

          {sparklineData && sparklineData.length > 1 && (
            <Sparkline data={sparklineData} color="auto" />
          )}
        </VStack>
      </HStack>

      {action && (
        <Button
          variant="ghost"
          onClick={handleActionClick}
          className="mt-4 text-sm font-bold text-foreground hover:underline"
          data-testid={action.event ? actionTestId(action.event) : undefined}
        >
          {action.label} →
        </Button>
      )}
    </Box>,
  );
};

StatCard.displayName = "StatCard";
