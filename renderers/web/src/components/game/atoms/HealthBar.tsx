import * as React from 'react';
import type { A11yProps, Asset } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { cn } from '../../../core';
import { Box } from '../../../core';
import { Typography } from '../../../core';

// Generic ratio/progress bar — covers health (hearts/bar/numeric) and XP/progress (progress format with optional level badge).
export interface HealthBarProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Current value */
  current: number;
  /** Maximum value */
  max: number;
  /** Display format.
   * - `hearts` / `bar` / `numeric` — health display
   * - `progress` — XP / generic progress bar with optional level badge and value label */
  format?: 'hearts' | 'bar' | 'numeric' | 'progress';
  /** Current level — shown as "Lv.N" badge when format="progress" */
  level?: number;
  /** Show value label below bar when format="progress" */
  showLabel?: boolean;
  /** Label suffix shown next to the value (e.g. "XP") when showLabel=true */
  labelSuffix?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional CSS classes */
  className?: string;
  /** Animation on change */
  animated?: boolean;
  /** Sprite image used as the bar track/frame border for bar/progress formats. Falls back to CSS rounded bg-muted. */
  frameAsset?: Asset;
  /** Sprite image tiled across the filled portion of bar/progress formats. Falls back to CSS color gradient. */
  fillAsset?: Asset;
}

const heartIcon = (filled: boolean, size: string) => (
  <svg
    className={cn('transition-all duration-200', size, filled ? 'text-error' : 'text-muted-foreground')}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={filled ? 0 : 2}
  >
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
);

const sizeMap = {
  sm: { heart: 'w-4 h-4', bar: 'h-2', text: 'text-sm', label: 'text-xs', badge: 'text-xs px-1.5 py-0.5' },
  md: { heart: 'w-6 h-6', bar: 'h-3', text: 'text-base', label: 'text-xs', badge: 'text-xs px-2 py-0.5' },
  lg: { heart: 'w-8 h-8', bar: 'h-4', text: 'text-lg', label: 'text-sm', badge: 'text-sm px-2.5 py-1' },
};

export function HealthBar({
  current = 3,
  max = 5,
  format = 'hearts',
  level,
  showLabel = true,
  labelSuffix,
  size = 'md',
  className,
  animated = true,
  frameAsset,
  fillAsset,
  ...rest
}: HealthBarProps) {
  const sizes = sizeMap[size];
  const percentage = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;

  if (format === 'hearts') {
    return (
      <Box {...domPassthrough(rest)} className={cn('flex items-center gap-1', className)}>
        {Array.from({ length: max }).map((_, i) => (
          <Box
            as="span"
            key={i}
            className={cn(animated && 'transition-transform hover:scale-110')}
          >
            {heartIcon(i < current, sizes.heart)}
          </Box>
        ))}
      </Box>
    );
  }

  if (format === 'bar') {
    return (
      <Box
        {...domPassthrough(rest)}
        position="relative"
        overflow="hidden"
        className={cn(
          'rounded-full',
          !frameAsset && 'bg-muted',
          sizes.bar,
          'w-24',
          className
        )}
        style={frameAsset ? { backgroundImage: `url(${frameAsset.url})`, backgroundSize: '100% 100%' } : undefined}
      >
        <Box
          position="absolute"
          className={cn(
            'inset-y-0 left-0 rounded-full',
            !fillAsset && (percentage > 66 ? 'bg-success' : percentage > 33 ? 'bg-warning' : 'bg-error'),
            animated && 'transition-all duration-300'
          )}
          style={{
            width: `${percentage}%`,
            ...(fillAsset ? { backgroundImage: `url(${fillAsset.url})`, backgroundSize: 'auto 100%' } : {}),
          }}
        />
      </Box>
    );
  }

  if (format === 'progress') {
    return (
      <Box {...domPassthrough(rest)} className={cn('flex items-center gap-2', className)}>
        {level != null && (
          <Typography
            as="span"
            className={cn(
              'flex-shrink-0 rounded-interactive font-bold',
              'bg-accent text-accent-foreground border border-accent',
              sizes.badge,
            )}
          >
            Lv.{level}
          </Typography>
        )}
        <Box className="flex-1 flex flex-col gap-0.5">
          <Box
            position="relative"
            className={cn(
              'w-full overflow-hidden rounded-full',
              !frameAsset && 'bg-muted border border-muted',
              sizes.bar,
            )}
            style={frameAsset ? { backgroundImage: `url(${frameAsset.url})`, backgroundSize: '100% 100%' } : undefined}
          >
            <Box
              position="absolute"
              className={cn(
                'inset-y-0 left-0 rounded-full',
                !fillAsset && 'bg-gradient-to-r from-accent to-info',
                animated && 'transition-all duration-500 ease-out',
              )}
              style={{
                width: `${percentage}%`,
                ...(fillAsset ? { backgroundImage: `url(${fillAsset.url})`, backgroundSize: 'auto 100%' } : {}),
              }}
            />
          </Box>
          {showLabel && (
            <Typography as="span" className={cn('text-foreground/70 tabular-nums', sizes.label)}>
              {current} / {max}{labelSuffix ? ` ${labelSuffix}` : ''}
            </Typography>
          )}
        </Box>
      </Box>
    );
  }

  // Numeric format
  return (
    <Typography as="span" {...domPassthrough(rest)} className={cn('font-mono font-bold', sizes.text, className)}>
      {current}/{max}
    </Typography>
  );
}

HealthBar.displayName = 'HealthBar';
