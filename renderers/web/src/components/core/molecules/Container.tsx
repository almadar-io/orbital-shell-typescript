/**
 * Container — max-width centering wrapper (distinct from Box).
 * Box controls padding/margin/bg/shadow on an arbitrary element.
 * Container constrains page width and centers; use it at the layout level,
 * not as a generic div replacement.
 */
import type { A11yProps } from '@almadar/core';
import React from 'react';
import { cn } from '../../../core';

import { domPassthrough } from '../../../core';
export type ContainerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
export type ContainerPadding = 'none' | 'sm' | 'md' | 'lg' | 'xl';

export interface ContainerProps extends A11yProps {
  /** Maximum width */
  size?: ContainerSize;
  /** Alias for size (pattern compatibility) */
  maxWidth?: ContainerSize;
  /** Horizontal padding */
  padding?: ContainerPadding;
  /** Center horizontally */
  center?: boolean;
  /** Custom class name */
  className?: string;
  /** Children elements */
  children?: React.ReactNode;
  /** HTML element to render as */
  as?: React.ElementType;
}

const sizeStyles: Record<ContainerSize, string> = {
  xs: 'max-w-xs',        // 320px
  sm: 'max-w-screen-sm', // 640px
  md: 'max-w-screen-md', // 768px
  lg: 'max-w-screen-lg', // 1024px
  xl: 'max-w-screen-xl', // 1280px
  '2xl': 'max-w-screen-2xl', // 1536px
  full: 'max-w-full',
};

const paddingStyles: Record<ContainerPadding, string> = {
  none: 'px-0',
  // Mobile-tighter, desktop-identical: fixed px-6 on a 360px phone eats ~13% of
  // the viewport, so each token steps down below the sm breakpoint.
  sm: 'px-3 sm:px-4',
  md: 'px-4 sm:px-6',
  lg: 'px-4 sm:px-6 md:px-8',
  xl: 'px-4 sm:px-8 md:px-12',
};

/**
 * Container - Centers and constrains content width
 */
export const Container: React.FC<ContainerProps> = ({
  size,
  maxWidth,
  padding = 'md',
  center = true,
  className,
  children,
  as: Component = 'div',
  ...rest
}) => {
  // Use maxWidth if provided, otherwise fall back to size, then default to 'lg'
  const resolvedSize = maxWidth ?? size ?? 'lg';
  return React.createElement(
    Component,
    {
      ...domPassthrough(rest),
      className: cn(
        'w-full',
        sizeStyles[resolvedSize],
        paddingStyles[padding],
        center && 'mx-auto',
        className
      ),
    },
    children
  );
};

Container.displayName = 'Container';

export default Container;

