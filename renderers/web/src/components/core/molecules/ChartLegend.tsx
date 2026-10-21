'use client';
/**
 * ChartLegend Molecule Component
 *
 * Color-coded legend for chart data series.
 * Pure UI molecule with no entity binding.
 */

import type { A11yProps } from '@almadar/core';
import React from 'react';
import { cn } from '../../../core';
import { Box, HStack, VStack, Typography } from '../../../core';

import { domPassthrough } from '../../../core';
export interface ChartLegendItem {
  label: string;
  color: string;
}

export interface ChartLegendProps extends A11yProps {
  /** Legend items with label and color */
  items: ChartLegendItem[];
  /** Additional CSS classes */
  className?: string;
  /** Layout direction */
  direction?: 'horizontal' | 'vertical';
}

export const ChartLegend: React.FC<ChartLegendProps> = ({
  items,
  className,
  direction = 'horizontal',
  ...rest
}) => {
  const Wrapper = direction === 'horizontal' ? HStack : VStack;

  return (
    <Wrapper {...domPassthrough(rest)} gap="md" className={cn('flex-wrap', className)}>
      {items.map((item) => (
        <HStack key={item.label} gap="xs" align="center">
          <Box
            className="rounded-full shrink-0"
            style={{
              width: 10,
              height: 10,
              backgroundColor: item.color,
            }}
          />
          <Typography variant="small" className="text-muted-foreground">
            {item.label}
          </Typography>
        </HStack>
      ))}
    </Wrapper>
  );
};

ChartLegend.displayName = 'ChartLegend';
