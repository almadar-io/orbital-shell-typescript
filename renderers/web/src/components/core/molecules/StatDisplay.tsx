'use client';
/**
 * StatDisplay Molecule
 *
 * A compact stat display: label + value + optional icon.
 * Molecule-level replacement for the stats (StatCard) organism in behavior schemas.
 * No entity prop, no data fetching, no hooks beyond icon resolution.
 */
import type { A11yProps, SkeletonSpec } from '@almadar/core';
import { Skeleton } from "./Skeleton";
import React, { useCallback } from 'react';
import { cn } from '../../../core';
import { pressableProps } from '../../../core';
import { useContentSurface } from '../../../core';
import type { SurfaceMode } from '@almadar/core';
import { Typography } from '../../../core';
import { Box } from '../../../core';
import { HStack, VStack } from '../../../core';
import { Sparkline } from '../../../core';
import { resolveIcon } from '../../../core';
import type { IconInput } from '../../../core';
import { useEventBus } from '../../../core';
import type { UiError } from '../../../core';
import { formatValue, type FormatContext } from '../../../core';
import { useFormatContext } from '../../../core';

import { domPassthrough } from '../../../core';
export type StatDisplayLook =
  | 'elevated'
  | 'flat'
  | 'progress-backed'
  | 'gauge'
  | 'sparkline';

const lookStyles: Record<StatDisplayLook, string> = {
  elevated: '',
  flat: 'shadow-none',
  'progress-backed': '',
  gauge: '',
  sparkline: '',
};

export interface StatDisplayProps extends A11yProps {
  /** Display label (e.g., "Total", "Remaining") */
  label: string;
  /** Primary value (number or formatted string) */
  value: number | string;
  /** Optional denominator. >0 renders "value / max"; 0 or omitted hides the divider. */
  max?: number;
  /** Optional progress target. >0 renders a progress bar at value/target. */
  target?: number;
  /** Signed delta vs previous period. >0 renders ↑ green, <0 renders ↓ red, 0 hides. Polarity reversal via `trendPolarity`. */
  trend?: number;
  /** Controls whether `trend > 0` is "good" (default) or "bad". `lower-is-better` inverts the color logic. */
  trendPolarity?: 'higher-is-better' | 'lower-is-better';
  /** When `'percent'`, renders trend with a `%` suffix (e.g. `↓ 3.3%`); default is `'absolute'`. */
  trendFormat?: 'absolute' | 'percent';
  /** Optional inline sparkline data appended to the trend row. Length < 2 renders nothing. */
  sparklineData?: readonly number[];
  /** Event name emitted as `UI:{clickEvent}` with `{ metricLabel }` when the card is clicked. */
  clickEvent?: string;
  /** Prefix prepended to the formatted value (e.g. "≈ "). */
  prefix?: string;
  /** Suffix appended to the formatted value (e.g. " /mo", " ms"). */
  suffix?: string;
  /** Lucide icon name or component */
  icon?: IconInput;
  /** Icon background color class */
  iconBg?: string;
  /** Icon color class */
  iconColor?: string;
  /** Display format: "number", "currency", "percent" */
  format?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Color variant */
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info';
  /** Compact mode (inline, no card wrapper) */
  compact?: boolean;
  /** Layer 2 visual treatment. */
  look?: StatDisplayLook;
  /** Content surface: `auto` paints the theme's surface behind this block unless it already sits on one (a card, dialog or another block); `none` opts out. */
  surface?: SurfaceMode;
  /** Additional CSS classes */
  className?: string;
  /** Loading state */
  isLoading?: boolean;
  /** Skeleton drawn while loading, and the shape an empty slot shows while this element's server render is in flight (`none` opts out). */
  skeleton?: SkeletonSpec;
  /** Error state */
  error?: UiError | null;
}

// Compose `prefix + formattedValue + (" / " + max if max>0) + suffix`. max:0
// is the lolo default for std-stats's optional denominator and means "no max"
// — we hide the divider so plain count cards don't render "10 / 0".
function composeDisplayValue(
  value: number | string | null | undefined,
  format?: string,
  max?: number,
  prefix?: string,
  suffix?: string,
  fmt: FormatContext = {},
): string {
  const formatted = value == null ? '0' : formatValue(value, format, fmt);
  const withMax = max != null && max > 0 ? `${formatted} / ${new Intl.NumberFormat(fmt.locale).format(max)}` : formatted;
  return `${prefix ?? ''}${withMax}${suffix ?? ''}`;
}

const variantColor: Record<string, string> = {
  default: 'text-foreground',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  info: 'text-info',
};

export const StatDisplay: React.FC<StatDisplayProps> = ({
  label,
  value,
  max,
  target,
  trend,
  trendPolarity = 'higher-is-better',
  trendFormat = 'absolute',
  sparklineData,
  clickEvent,
  prefix,
  suffix,
  icon: iconProp,
  iconBg = 'bg-muted',
  iconColor = 'text-foreground',
  format,
  size = 'md',
  variant = 'default',
  compact = false,
  look = 'elevated',
  className,
  isLoading = false,
  skeleton = { variant: 'stats', columns: 1 },
  error = null,
  surface = 'auto',
  ...rest
}) => {
  const contentSurface = useContentSurface(surface);
  const eventBus = useEventBus();
  const fmt = useFormatContext();
  const handleClick = useCallback(() => {
    if (clickEvent) eventBus.emit(`UI:${clickEvent}`, { metricLabel: label });
  }, [clickEvent, eventBus, label]);
  const ResolvedIcon = typeof iconProp === 'string'
    ? resolveIcon(iconProp)
    : (typeof iconProp === 'function' ? iconProp : null);

  const iconSizes = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' };
  const valueSizes = { sm: 'text-lg', md: 'text-2xl', lg: 'text-3xl' };
  const padSizes = { sm: 'p-3', md: 'p-4', lg: 'p-6' };

  const displayValue = composeDisplayValue(value, format, max, prefix, suffix, fmt);
  const numericValue = typeof value === 'number' ? value : Number(value);
  const showTarget = typeof target === 'number' && target > 0 && Number.isFinite(numericValue);
  const targetPct = showTarget ? Math.max(0, Math.min(100, (numericValue / (target as number)) * 100)) : 0;
  const showTrend = typeof trend === 'number' && trend !== 0 && Number.isFinite(trend);
  const trendUp = showTrend && (trend as number) > 0;
  const trendIsGood = trendPolarity === 'lower-is-better' ? !trendUp : trendUp;
  const trendMagnitude = Math.abs(trend as number);
  const trendSuffix = trendFormat === 'percent' ? '%' : '';
  const trendLabel = showTrend ? `${trendUp ? '↑' : '↓'} ${trendMagnitude}${trendSuffix}` : '';

  if (error) {
    return contentSurface.provide(
      <Box {...domPassthrough(rest)} className={cn(contentSurface.className, 'rounded-container', padSizes[size], className)}>
        <Typography variant="small" color="error">{error.message}</Typography>
      </Box>,
    );
  }

  if (isLoading) {
    return <Skeleton spec={skeleton} className={className} />;
  }

  // Compact mode: inline badge style
  if (compact) {
    return (
      <HStack
        {...domPassthrough(rest)}
        gap="sm"
        className={cn('items-center', clickEvent && 'cursor-pointer hover:opacity-80', className)}
        {...pressableProps(clickEvent ? handleClick : undefined)}
      >
        {ResolvedIcon && <ResolvedIcon className={cn(iconSizes[size], iconColor)} />}
        <Typography variant="caption" color="secondary">{label}</Typography>
        <Typography variant="h4" className={cn('', valueSizes[size], variantColor[variant])}>
          {displayValue}
        </Typography>
        {showTrend && (
          <Typography variant="caption" className={cn('font-semibold', trendIsGood ? 'text-success' : 'text-error')}>
            {trendLabel}
          </Typography>
        )}
        {sparklineData && sparklineData.length > 1 && (
          <Sparkline data={sparklineData} color="auto" width={60} height={20} />
        )}
      </HStack>
    );
  }

  // Card mode (default)
  return contentSurface.provide(
    <Box
      {...domPassthrough(rest)}
      className={cn(contentSurface.className, 'rounded-container', padSizes[size], lookStyles[look], clickEvent && 'cursor-pointer hover:shadow-elevation-dialog transition-shadow', className)}
      {...pressableProps(clickEvent ? handleClick : undefined)}
    >
      <HStack align="start" justify="between">
        <VStack gap="none" className="space-y-1 flex-1">
          <Typography variant="overline" color="secondary">{label}</Typography>
          <HStack gap="sm" align="end">
            <Typography variant="h4" className={cn('', valueSizes[size], variantColor[variant])}>
              {displayValue}
            </Typography>
            {showTrend && (
              <Typography
                variant="caption"
                className={cn('font-semibold pb-1', trendIsGood ? 'text-success' : 'text-error')}
              >
                {trendLabel}
              </Typography>
            )}
          </HStack>
          {showTarget && (
            <Box className="mt-2 h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <Box
                className={cn('h-full rounded-full transition-all', `bg-${variant === 'default' ? 'primary' : variant}`)}
                style={{ width: `${targetPct}%` }}
              />
            </Box>
          )}
        </VStack>
        <VStack gap="xs" align="end">
          {ResolvedIcon && (
            <Box className={cn('p-3 rounded-container', iconBg)}>
              <ResolvedIcon className={cn(iconSizes[size], iconColor)} />
            </Box>
          )}
          {sparklineData && sparklineData.length > 1 && (
            <Sparkline data={sparklineData} color="auto" />
          )}
        </VStack>
      </HStack>
    </Box>,
  );
};

StatDisplay.displayName = 'StatDisplay';
