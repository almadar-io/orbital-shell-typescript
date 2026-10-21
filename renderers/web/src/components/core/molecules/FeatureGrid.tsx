'use client';
/**
 * FeatureGrid Molecule Component
 *
 * A responsive grid layout for displaying multiple FeatureCards.
 * Composes SimpleGrid and FeatureCard molecules.
 */

import type { A11yProps } from '@almadar/core';
import React from 'react';
import { cn } from '../../../core';
import { SimpleGrid } from './SimpleGrid';
import { FeatureCard, type FeatureCardProps } from './FeatureCard';

import { domPassthrough } from '../../../core';
export interface FeatureGridProps extends A11yProps {
  /** Array of feature card configurations */
  items: FeatureCardProps[];
  /** Number of grid columns */
  columns?: 2 | 3 | 4 | 6;
  /** Gap between grid items */
  gap?: 'sm' | 'md' | 'lg';
  /** Additional class names */
  className?: string;
}

export const FeatureGrid: React.FC<FeatureGridProps> = ({
  items,
  columns = 3,
  gap = 'md',
  className,
  ...rest
}) => {
  return (
    <SimpleGrid
      {...domPassthrough(rest)}
      cols={columns}
      gap={gap}
      className={cn(className)}
    >
      {(Array.isArray(items) ? items : []).map((item, index) => (
        <FeatureCard key={`${item.title}-${index}`} {...item} />
      ))}
    </SimpleGrid>
  );
};

FeatureGrid.displayName = 'FeatureGrid';
