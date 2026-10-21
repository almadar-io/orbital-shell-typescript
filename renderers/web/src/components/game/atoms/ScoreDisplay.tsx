import * as React from 'react';
import { cn } from '../../../core';
import { Icon, type IconInput } from '../../../core';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { GameIcon } from '../../../core';
import type { A11yProps, Asset } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { useTranslate } from '../../../core';

export interface ScoreDisplayProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Sprite asset — takes precedence over icon when provided */
  assetUrl?: Asset;
  /** Current score value */
  value: number;
  /** Alias for value — common schema binding name */
  score?: number;
  /** Label to display before score */
  label?: string;
  /** Icon component or emoji */
  icon?: IconInput;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Additional CSS classes */
  className?: string;
  /** Number formatting locale */
  locale?: string;
}

const sizeMap = {
  sm: 'text-sm',
  md: 'text-lg',
  lg: 'text-2xl',
  xl: 'text-4xl',
};

export function ScoreDisplay({
  assetUrl,
  value,
  score,
  label,
  icon,
  size = 'md',
  className,
  locale: localeProp,
  ...rest
}: ScoreDisplayProps) {
  const { locale: appLocale } = useTranslate();
  const locale = localeProp ?? appLocale;
  // Accept "score" as alias for "value" (common schema binding)
  const resolvedValue = typeof value === 'number' && !Number.isNaN(value)
    ? value
    : typeof score === 'number' && !Number.isNaN(score)
      ? score
      : 0;

  const formattedValue = new Intl.NumberFormat(locale).format(resolvedValue);

  return (
    <Box
      {...domPassthrough(rest)}
      className={cn(
        'flex items-center gap-2 font-bold',
        sizeMap[size],
        className
      )}
    >
      {assetUrl ? (
        <GameIcon assetUrl={assetUrl} icon="image" size={20} className="flex-shrink-0" />
      ) : icon ? (
        <Box as="span" className="flex-shrink-0">
          {typeof icon === 'string' ? <Icon name={icon} /> : <Icon icon={icon} />}
        </Box>
      ) : null}
      {label && <Typography as="span" className="text-muted-foreground">{label}</Typography>}
      <Typography as="span" className="tabular-nums">{formattedValue}</Typography>
    </Box>
  );
}

ScoreDisplay.displayName = 'ScoreDisplay';
