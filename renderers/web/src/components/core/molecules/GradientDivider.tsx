'use client';
/**
 * GradientDivider Molecule Component
 *
 * A horizontal line that fades from transparent at edges to primary color at center.
 * Used between major sections for visual separation without hard background-color breaks.
 */

import type { A11yProps } from '@almadar/core';
import React from 'react';
import { cn } from '../../../core';
import { Box } from '../../../core';
import type { ColorToken } from '../../../core';

import { domPassthrough } from '../../../core';
const colorTokenVars: Record<ColorToken, string> = {
  primary: 'var(--color-primary)',
  secondary: 'var(--color-secondary)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
  muted: 'var(--color-muted)',
};

export interface GradientDividerProps extends A11yProps {
  /** Semantic palette token or a raw CSS color value. Defaults to 'primary'. */
  color?: ColorToken | string;
  /** Additional class names */
  className?: string;
}

export const GradientDivider: React.FC<GradientDividerProps> = ({
  color,
  className,
  ...rest
}) => {
  const centerColor = color
    ? (color in colorTokenVars
        ? colorTokenVars[color as ColorToken]
        : color)
    : 'var(--color-primary)';

  return (
    <Box
      {...domPassthrough(rest)}
      className={cn('w-full h-px', className)}
      style={{
        background: `linear-gradient(to right, transparent, ${centerColor}, transparent)`,
      }}
    />
  );
};

GradientDivider.displayName = 'GradientDivider';
