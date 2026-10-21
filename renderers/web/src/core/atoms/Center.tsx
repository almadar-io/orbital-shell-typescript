/**
 * Center Component
 * 
 * A layout utility that centers its children horizontally and/or vertically.
 */
import { domPassthrough } from '../lib/domPassthrough';
import type { A11yProps } from '@almadar/core';
import React from 'react';
import { cn } from '../lib/cn';

export interface CenterProps extends A11yProps {
  /** Center inline (width fits content) vs block (full width) */
  inline?: boolean;
  /** Center only horizontally */
  horizontal?: boolean;
  /** Center only vertically */
  vertical?: boolean;
  /** Minimum height (useful for vertical centering) */
  minHeight?: string | number;
  /** Fill available height */
  fullHeight?: boolean;
  /** Fill available width */
  fullWidth?: boolean;
  /** Custom class name */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
  /** Children elements */
  children: React.ReactNode;
  /** HTML element to render as */
  as?: React.ElementType;
}

/**
 * Center - Centers content horizontally and/or vertically
 */
export const Center: React.FC<CenterProps> = ({
  inline = false,
  horizontal = true,
  vertical = true,
  minHeight,
  fullHeight = false,
  fullWidth = false,
  className,
  style,
  children,
  as: Component = 'div',
  ...rest
}) => {
  const mergedStyle = minHeight ? { minHeight, ...style } : style;
  return React.createElement(Component, {
    ...domPassthrough(rest),
    className: cn(
      inline ? 'inline-flex' : 'flex',
      horizontal && 'justify-center',
      vertical && 'items-center',
      fullHeight && 'h-full',
      fullWidth && 'w-full',
      className
    ),
    style: mergedStyle,
    children,
  });
};

export default Center;

