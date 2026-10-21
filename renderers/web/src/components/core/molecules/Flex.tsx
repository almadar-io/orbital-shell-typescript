/**
 * Flex — full-surface flexbox primitive (distinct from Stack).
 * Stack covers the 95% case (VStack/HStack with gap/align/justify).
 * Flex exposes direction, wrap, grow, shrink, basis individually; use it
 * when you need those extra axes or inline-flex behavior.
 */
import type { A11yProps } from '@almadar/core';
import React from 'react';
import { cn } from '../../../core';

import { domPassthrough } from '../../../core';
export type FlexDirection = 'row' | 'row-reverse' | 'col' | 'col-reverse';
export type FlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse';
export type FlexAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type FlexJustify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
export type FlexGap = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export interface FlexProps extends A11yProps {
  /** Flex direction */
  direction?: FlexDirection;
  /** Flex wrap */
  wrap?: FlexWrap;
  /** Align items */
  align?: FlexAlign;
  /** Justify content */
  justify?: FlexJustify;
  /** Gap between items */
  gap?: FlexGap;
  /** Inline flex */
  inline?: boolean;
  /** Flex grow */
  grow?: boolean | number;
  /** Flex shrink */
  shrink?: boolean | number;
  /** Flex basis */
  basis?: string | number;
  /** Custom class name */
  className?: string;
  /** Children elements */
  children: React.ReactNode;
  /** HTML element to render as */
  as?: React.ElementType;
}

const directionStyles: Record<FlexDirection, string> = {
  row: 'flex-row',
  'row-reverse': 'flex-row-reverse',
  col: 'flex-col',
  'col-reverse': 'flex-col-reverse',
};

const wrapStyles: Record<FlexWrap, string> = {
  nowrap: 'flex-nowrap',
  wrap: 'flex-wrap',
  'wrap-reverse': 'flex-wrap-reverse',
};

const alignStyles: Record<FlexAlign, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
};

const justifyStyles: Record<FlexJustify, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
  around: 'justify-around',
  evenly: 'justify-evenly',
};

const gapStyles: Record<FlexGap, string> = {
  none: 'gap-0',
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-6',
  xl: 'gap-8',
  '2xl': 'gap-12',
};

/**
 * Flex - Full-featured flexbox container
 */
export const Flex: React.FC<FlexProps> = ({
  direction = 'row',
  wrap = 'nowrap',
  align = 'stretch',
  justify = 'start',
  gap = 'none',
  inline = false,
  grow,
  shrink,
  basis,
  className,
  children,
  as: Component = 'div',
  ...rest
}) => {
  // Build flex shorthand for grow/shrink/basis
  const flexStyle: React.CSSProperties = {};
  if (grow !== undefined || shrink !== undefined || basis !== undefined) {
    const growValue = grow === true ? 1 : grow === false ? 0 : grow;
    const shrinkValue = shrink === true ? 1 : shrink === false ? 0 : shrink;
    flexStyle.flexGrow = growValue;
    flexStyle.flexShrink = shrinkValue;
    if (basis !== undefined) {
      flexStyle.flexBasis = typeof basis === 'number' ? `${basis}px` : basis;
    }
  }

  return React.createElement(Component, {
    ...domPassthrough(rest),
    className: cn(
      inline ? 'inline-flex' : 'flex',
      directionStyles[direction],
      wrapStyles[wrap],
      alignStyles[align],
      justifyStyles[justify],
      gapStyles[gap],
      className
    ),
    style: Object.keys(flexStyle).length > 0 ? flexStyle : undefined,
    children,
  });
};

Flex.displayName = 'Flex';

export default Flex;

