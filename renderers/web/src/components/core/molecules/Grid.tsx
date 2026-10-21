/**
 * Grid Component
 * 
 * A CSS Grid wrapper with responsive column support.
 * Useful for creating multi-column layouts.
 */
import type { A11yProps } from '@almadar/core';
import React from 'react';
import { cn } from '../../../core';

import { domPassthrough } from '../../../core';
export type GridCols = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 'none';
export type GridGap = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type GridAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type GridJustify = 'start' | 'center' | 'end' | 'stretch';

export interface ResponsiveGridCols {
  /** Base/mobile columns */
  base?: GridCols;
  /** Small screens (640px+) */
  sm?: GridCols;
  /** Medium screens (768px+) */
  md?: GridCols;
  /** Large screens (1024px+) */
  lg?: GridCols;
  /** Extra large screens (1280px+) */
  xl?: GridCols;
}

export interface GridProps extends A11yProps {
  /** Number of columns (can be responsive object) */
  cols?: GridCols | ResponsiveGridCols;
  /** Number of rows */
  rows?: number;
  /** Gap between items */
  gap?: GridGap;
  /** Row gap (overrides gap for rows) */
  rowGap?: GridGap;
  /** Column gap (overrides gap for columns) */
  colGap?: GridGap;
  /** Align items on block axis */
  alignItems?: GridAlign;
  /** Justify items on inline axis */
  justifyItems?: GridJustify;
  /** Auto-flow direction */
  flow?: 'row' | 'col' | 'row-dense' | 'col-dense';
  /** Custom class name */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
  /** Children elements */
  children: React.ReactNode;
  /** HTML element to render as */
  as?: React.ElementType;
}

const colStyles: Record<GridCols, string> = {
  none: 'grid-cols-none',
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
  7: 'grid-cols-7',
  8: 'grid-cols-8',
  9: 'grid-cols-9',
  10: 'grid-cols-10',
  11: 'grid-cols-11',
  12: 'grid-cols-12',
};

// Written out in full: Tailwind only generates the classes it can read here.
const smColStyles: Record<GridCols, string> = {
  none: 'sm:grid-cols-none',
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
  6: 'sm:grid-cols-6',
  7: 'sm:grid-cols-7',
  8: 'sm:grid-cols-8',
  9: 'sm:grid-cols-9',
  10: 'sm:grid-cols-10',
  11: 'sm:grid-cols-11',
  12: 'sm:grid-cols-12',
};

const mdColStyles: Record<GridCols, string> = {
  none: 'md:grid-cols-none',
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
  6: 'md:grid-cols-6',
  7: 'md:grid-cols-7',
  8: 'md:grid-cols-8',
  9: 'md:grid-cols-9',
  10: 'md:grid-cols-10',
  11: 'md:grid-cols-11',
  12: 'md:grid-cols-12',
};

const lgColStyles: Record<GridCols, string> = {
  none: 'lg:grid-cols-none',
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
  7: 'lg:grid-cols-7',
  8: 'lg:grid-cols-8',
  9: 'lg:grid-cols-9',
  10: 'lg:grid-cols-10',
  11: 'lg:grid-cols-11',
  12: 'lg:grid-cols-12',
};

const xlColStyles: Record<GridCols, string> = {
  none: 'xl:grid-cols-none',
  1: 'xl:grid-cols-1',
  2: 'xl:grid-cols-2',
  3: 'xl:grid-cols-3',
  4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5',
  6: 'xl:grid-cols-6',
  7: 'xl:grid-cols-7',
  8: 'xl:grid-cols-8',
  9: 'xl:grid-cols-9',
  10: 'xl:grid-cols-10',
  11: 'xl:grid-cols-11',
  12: 'xl:grid-cols-12',
};

const gapStyles: Record<GridGap, string> = {
  none: 'gap-0',
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-6',
  xl: 'gap-8',
  '2xl': 'gap-12',
};

const rowGapStyles: Record<GridGap, string> = {
  none: 'gap-y-0',
  xs: 'gap-y-1',
  sm: 'gap-y-2',
  md: 'gap-y-4',
  lg: 'gap-y-6',
  xl: 'gap-y-8',
  '2xl': 'gap-y-12',
};

const colGapStyles: Record<GridGap, string> = {
  none: 'gap-x-0',
  xs: 'gap-x-1',
  sm: 'gap-x-2',
  md: 'gap-x-4',
  lg: 'gap-x-6',
  xl: 'gap-x-8',
  '2xl': 'gap-x-12',
};

const alignStyles: Record<GridAlign, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
};

const justifyStyles: Record<GridJustify, string> = {
  start: 'justify-items-start',
  center: 'justify-items-center',
  end: 'justify-items-end',
  stretch: 'justify-items-stretch',
};

const flowStyles = {
  row: 'grid-flow-row',
  col: 'grid-flow-col',
  'row-dense': 'grid-flow-row-dense',
  'col-dense': 'grid-flow-col-dense',
};

function getColsClass(cols: GridCols | ResponsiveGridCols): string {
  if (typeof cols === 'number' || cols === 'none') {
    return colStyles[cols];
  }

  const classes: string[] = [];
  
  if (cols.base !== undefined) {
    classes.push(colStyles[cols.base]);
  }
  if (cols.sm !== undefined) {
    classes.push(smColStyles[cols.sm]);
  }
  if (cols.md !== undefined) {
    classes.push(mdColStyles[cols.md]);
  }
  if (cols.lg !== undefined) {
    classes.push(lgColStyles[cols.lg]);
  }
  if (cols.xl !== undefined) {
    classes.push(xlColStyles[cols.xl]);
  }

  return classes.join(' ');
}

/**
 * Grid - CSS Grid layout wrapper
 */
export const Grid: React.FC<GridProps> = ({
  cols = 1,
  rows,
  gap = 'md',
  rowGap,
  colGap,
  alignItems,
  justifyItems,
  flow,
  className,
  style,
  children,
  as: Component = 'div',
  ...rest
}) => {
  const mergedStyle = rows
    ? { gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, ...style }
    : style;
  // Polymorphic render via React.createElement. JSX with `<Comp />` where
  // Comp is a bare React.ElementType collapses prop inference to `never`
  // and forces a cast; createElement's generic signature accepts the
  // props verbatim without a type lie.
  return React.createElement(
    Component,
    {
      ...domPassthrough(rest),
      className: cn(
        'grid',
        getColsClass(cols),
        rowGap ? rowGapStyles[rowGap] : colGap ? undefined : gapStyles[gap],
        colGap ? colGapStyles[colGap] : rowGap ? undefined : undefined,
        rowGap && colGap ? `${rowGapStyles[rowGap]} ${colGapStyles[colGap]}` : undefined,
        alignItems && alignStyles[alignItems],
        justifyItems && justifyStyles[justifyItems],
        flow && flowStyles[flow],
        className,
      ),
      style: mergedStyle,
    },
    children,
  );
};

Grid.displayName = 'Grid';

export default Grid;

