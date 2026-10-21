'use client';
/**
 * FlipContainer — CSS 3D perspective atom (distinct from FlipCard molecule).
 * Owns perspective/preserve-3d/rotateY only. Children are the raw face elements.
 * Use FlipCard when you need standard card chrome; use FlipContainer when you
 * need the flip mechanic around custom face content.
 */
import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../lib/domPassthrough';
import React from 'react';
import { cn } from '../lib/cn';
import { pressableProps } from '../lib/pressable';
import { Box } from './Box';

export interface FlipContainerProps extends A11yProps {
  /** Whether the container is flipped (rotateY 180deg) */
  flipped: boolean;
  /** Optional className for the outer wrapper */
  className?: string;
  /** The two face elements (front and back) */
  children: React.ReactNode;
  /** Click handler on the outer wrapper */
  onClick?: () => void;
}

export const FlipContainer = ({
  flipped,
  className,
  children,
  onClick,
  ...rest
}: FlipContainerProps) => {
  return (
    <Box
      className={cn('relative w-full cursor-pointer', className)}
      style={{ perspective: '1000px' }}
      {...domPassthrough(rest)}
      {...pressableProps(onClick)}
    >
      <Box
        className="relative w-full h-full transition-transform duration-slow"
        style={{
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {children}
      </Box>
    </Box>
  );
};

FlipContainer.displayName = 'FlipContainer';
