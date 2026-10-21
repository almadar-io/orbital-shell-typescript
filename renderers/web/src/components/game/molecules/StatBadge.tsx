import * as React from 'react';
import { cn } from '../../../core';
import { Icon, type IconInput } from '../../../core';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { GameIcon } from '../../../core';
import { HealthBar } from '../atoms/HealthBar';
import { ScoreDisplay } from '../atoms/ScoreDisplay';
import type { A11yProps, Asset } from '@almadar/core';
import { domPassthrough } from '../../../core';

/**
 * StatBadge — game stat display molecule (distinct from core Badge atom).
 * Badge shows a text label/status token. StatBadge shows a numeric value
 * with optional HealthBar (hearts/bar) or ScoreDisplay (animated number) and
 * a named label — purpose-built for HUD stat rows, not general status tags.
 */
export interface StatBadgeProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Sprite asset — takes precedence over icon when provided */
  assetUrl?: Asset;
  /** Asset image (board ui/ PNG); takes precedence over the Lucide icon. */
  iconUrl?: Asset;
  /** Stat label */
  label: string;
  /** Current value (defaults to 0 if not provided) */
  value?: number | string;
  /** Maximum value (for bar/hearts format) */
  max?: number;
  /** Data source entity name (for schema config) */
  source?: string;
  /** Field name in the source (for schema config) */
  field?: string;
  /** Display format */
  format?: 'number' | 'hearts' | 'bar' | 'text' | string;
  /** Icon component or emoji */
  icon?: IconInput;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg' | string;
  /** Visual variant */
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | string;
  /** Additional CSS classes */
  className?: string;
}

const sizeMap = {
  xs: 'text-xs px-1.5 py-0.5',
  sm: 'text-xs px-2 py-1',
  md: 'text-sm px-3 py-1.5',
  lg: 'text-base px-4 py-2',
};

const variantMap = {
  default: 'bg-card/80 border-border text-foreground',
  primary: 'bg-primary/15 border-primary/40 text-foreground',
  success: 'bg-success/15 border-success/40 text-foreground',
  warning: 'bg-warning/15 border-warning/40 text-foreground',
  danger: 'bg-error/15 border-error/40 text-foreground',
};

export function StatBadge({
  assetUrl,
  iconUrl,
  label,
  value,
  max,
  format = 'number',
  icon,
  size = 'md',
  variant = 'default',
  className,
  // Ignored config props (used for schema binding)
  source: _source,
  field: _field,
  ...rest
}: StatBadgeProps) {
  const hasValue = value !== undefined && value !== null;
  const numValue = typeof value === 'number' ? value : parseInt(String(value), 10) || 0;
  const resolvedAsset = iconUrl ?? assetUrl;

  return (
    <Box
      {...domPassthrough(rest)}
      className={cn(
        'inline-flex items-center gap-2 rounded-container border backdrop-blur-sm',
        sizeMap[size as keyof typeof sizeMap] ?? sizeMap.md,
        variantMap[variant as keyof typeof variantMap] ?? variantMap.default,
        className
      )}
    >
      {resolvedAsset ? (
        <GameIcon assetUrl={resolvedAsset} icon="image" size={16} className="flex-shrink-0" />
      ) : icon ? (
        <Box as="span" className="flex-shrink-0 text-lg">{typeof icon === 'string' ? <Icon name={icon} className="w-4 h-4" /> : <Icon icon={icon} className="w-4 h-4" />}</Box>
      ) : null}

      <Typography as="span" className="text-muted-foreground font-medium text-xs">{label}</Typography>

      {hasValue && format === 'hearts' && max && (
        <HealthBar
          current={numValue}
          max={max}
          format="hearts"
          size={size === 'lg' ? 'md' : 'sm'}
        />
      )}

      {hasValue && format === 'bar' && max && (
        <HealthBar
          current={numValue}
          max={max}
          format="bar"
          size={size === 'lg' ? 'md' : 'sm'}
        />
      )}

      {hasValue && format === 'number' && (
        <ScoreDisplay
          value={numValue}
          size={size === 'lg' ? 'md' : 'sm'}
          className="font-display"
        />
      )}

      {hasValue && format === 'text' && (
        <Typography as="span" className="font-bold text-foreground">{value}</Typography>
      )}
    </Box>
  );
}

StatBadge.displayName = 'StatBadge';
