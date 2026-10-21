/**
 * SimpleGrid Component
 * 
 * A simplified grid that automatically adjusts columns based on available space.
 * Perfect for card layouts and item collections.
 */
import type { A11yProps } from '@almadar/core';
import React from 'react';
import { Box } from '../../../core';
import { cn } from '../../../core';
import { domPassthrough } from '../../../core';

export type SimpleGridGap = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface SimpleGridProps extends A11yProps {
  /** Minimum width of each child (e.g., 200, "200px", "15rem") */
  minChildWidth?: number | string;
  /** Maximum number of columns */
  maxCols?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Exact number of columns (disables auto-fit) */
  cols?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Gap between items */
  gap?: SimpleGridGap;
  /** Custom class name */
  className?: string;
  /** Children elements */
  children: React.ReactNode;
  /** Element id forwarded to the grid element. */
  id?: string;
  /** DOM attributes forwarded to the grid element (aria-*, data-*, role, id). */
  [attr: `aria-${string}` | `data-${string}`]: string | number | boolean | undefined;
}

const gapStyles: Record<SimpleGridGap, string> = {
  none: 'gap-0',
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-6',
  xl: 'gap-8',
};

/** The same gaps as CSS lengths, for the column-cap track. */
const gapLengths: Record<SimpleGridGap, string> = {
  none: '0px',
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
};

// Responsive column ladders. Every multi-column entry climbs through
// every Tailwind breakpoint (sm → md → lg → xl) so a 3-col grid at
// laptop becomes 2-col at tablet and 1-col at mobile, instead of the
// previous "1 → 2 → 3" jump that skipped tablet entirely.
// Viewport queries drive the grid in real-world app usage where the host
// viewport equals the rendered viewport. `@max-*` container-query
// overrides only fire when SimpleGrid renders inside an `@container`
// ancestor (e.g. OrbPreviewNode's `@container/preview`) whose own width
// is narrower than the host viewport — that's the OrbPreview
// "Mobile/Tablet/Laptop/Wide" simulation case. The `!` keeps them
// winning over the matching viewport rule when both fire. Ordered
// largest-to-smallest so the smallest matching tier wins via source order.
const colStyles = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2 @max-sm:!grid-cols-1',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 @max-lg:!grid-cols-2 @max-sm:!grid-cols-1',
  4: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 @max-lg:!grid-cols-3 @max-md:!grid-cols-2 @max-sm:!grid-cols-1',
  5: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 @max-xl:!grid-cols-4 @max-lg:!grid-cols-3 @max-md:!grid-cols-2 @max-sm:!grid-cols-1',
  6: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 @max-xl:!grid-cols-4 @max-lg:!grid-cols-3 @max-md:!grid-cols-2 @max-sm:!grid-cols-1',
};

/**
 * SimpleGrid - Auto-responsive grid layout
 */
export const SimpleGrid: React.FC<SimpleGridProps> = ({
  minChildWidth = 250,
  maxCols,
  cols,
  gap = 'md',
  className,
  children,
  ...rest
}) => {
  const passthrough = domPassthrough(rest);
  // If exact cols specified, use fixed grid
  if (cols) {
    return (
      <Box className={cn('grid', colStyles[cols], gapStyles[gap], className)} {...passthrough}>
        {children}
      </Box>
    );
  }

  // Otherwise use auto-fit with minChildWidth
  const minWidth = typeof minChildWidth === 'number'
    ? `${minChildWidth}px`
    : minChildWidth;

  // maxCols caps the COLUMN COUNT: each track is at least 1/maxCols of the row
  // (minus the gaps), so the grid still fills its container — capping the
  // grid's width instead left wide cards with an empty right third.
  const templateColumns = maxCols
    ? `repeat(auto-fit, minmax(max(min(${minWidth}, 100%), calc((100% - ${maxCols - 1} * ${gapLengths[gap]}) / ${maxCols})), 1fr))`
    : `repeat(auto-fit, minmax(${minWidth}, 1fr))`;

  return (
    <Box
      {...domPassthrough(rest)}
      className={cn('grid', gapStyles[gap], className)}
      style={{ gridTemplateColumns: templateColumns }}
      {...passthrough}
    >
      {children}
    </Box>
  );
};

SimpleGrid.displayName = 'SimpleGrid';

export default SimpleGrid;

