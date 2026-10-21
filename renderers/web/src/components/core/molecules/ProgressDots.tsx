'use client';
/**
 * ProgressDots Molecule Component
 *
 * Step indicator dots for multi-step flows.
 * Pure UI molecule with no entity binding.
 */

import React, { useCallback } from 'react';
import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { cn } from '../../../core';
import { pressableProps } from '../../../core';
import { useTranslate } from '../../../core';
import { Box, HStack } from '../../../core';

export type DotState = 'active' | 'complete' | 'pending';
export type DotSize = 'sm' | 'md' | 'lg';

export interface ProgressDotsProps extends A11yProps {
  /** Total number of dots */
  count: number;
  /** Current active index (0-based) */
  currentIndex: number;
  /** Custom state resolver per dot index */
  getState?: (index: number) => DotState;
  /** Callback when a dot is clicked */
  onDotClick?: (index: number) => void;
  /** Additional CSS classes */
  className?: string;
  /** Dot size */
  size?: DotSize;
}

const sizeMap: Record<DotSize, { dot: number; active: number }> = {
  sm: { dot: 6, active: 8 },
  md: { dot: 8, active: 10 },
  lg: { dot: 10, active: 14 },
};

const stateColors: Record<DotState, string> = {
  active: 'var(--color-primary)',
  complete: 'var(--color-success, #22c55e)',
  pending: 'var(--color-muted, #d4d4d8)',
};

export const ProgressDots: React.FC<ProgressDotsProps> = ({
  count,
  currentIndex,
  getState,
  onDotClick,
  className,
  size = 'md',
  ...rest
}) => {
  const { t } = useTranslate();
  const defaultGetState = useCallback(
    (index: number): DotState => {
      if (index === currentIndex) return 'active';
      return 'pending';
    },
    [currentIndex]
  );

  const resolveState = getState ?? defaultGetState;
  const dims = sizeMap[size];

  return (
    <HStack gap="xs" align="center" className={cn(className)} {...domPassthrough(rest)}>
      {Array.from({ length: count }, (_, index) => {
        const state = resolveState(index);
        const isActive = state === 'active';
        const dotSize = isActive ? dims.active : dims.dot;

        return (
          <Box
            key={index}
            className={cn(
              'flex items-center justify-center',
              onDotClick && 'cursor-pointer'
            )}
            style={onDotClick ? { minWidth: 24, minHeight: 24 } : undefined}
            {...pressableProps(onDotClick ? () => onDotClick(index) : undefined)}
            aria-current={isActive ? 'step' : undefined}
            aria-label={onDotClick ? t('wizard.stepOf', { current: String(index + 1), total: String(count) }) : undefined}
          >
            <Box
              className="rounded-full transition-all duration-fast"
              style={{
                width: dotSize,
                height: dotSize,
                backgroundColor: stateColors[state],
                transform: isActive ? 'scale(1.2)' : 'scale(1)',
              }}
            />
          </Box>
        );
      })}
    </HStack>
  );
};

ProgressDots.displayName = 'ProgressDots';
