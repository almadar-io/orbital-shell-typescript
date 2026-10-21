/**
 * Layout Pattern Components
 *
 * Pattern wrappers for layout components that support recursive rendering
 * of nested patterns via the `children` prop.
 *
 * These components bridge the shell's layout primitives (Stack, Box, Grid, etc.)
 * with the pattern system's recursive rendering capability.
 *
 * @packageDocumentation
 */

import React from 'react';
import type { UiError } from '../../../core';
import { Box, type BoxProps, type BoxPadding, type BoxRounded } from '../../../core';
import { Spacer } from '../../../core';
import { Divider, type DividerVariant, type DividerOrientation } from '../../../core';

// ============================================================================
// Pattern Props Interface
// ============================================================================

/**
 * Base props for all layout patterns with children support.
 */
export interface LayoutPatternProps {
  /** Nested pattern configurations - rendered recursively */
  children?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
  /** Entity name */
  entity?: string;
}


// ============================================================================
// Box Pattern
// ============================================================================

export interface BoxPatternProps extends BoxProps {
  /** Padding shorthand (alias of padding) */
  p?: BoxPadding;
  /** Margin shorthand (alias of margin) */
  m?: BoxPadding;
  /** Border radius shorthand (alias of rounded) */
  radius?: BoxRounded;
  /** Loading state (framework-injected; not a DOM prop) */
  isLoading?: boolean;
  /** Error state (framework-injected; not a DOM prop) */
  error?: UiError | null;
  /** Entity name (framework-injected; not a DOM prop) */
  entity?: string;
}

/**
 * Box pattern component.
 *
 * Generic styled container with theming support. Forwards the full `box`
 * registry surface to Box — the pattern's declared props (`data-theme`,
 * `padding`, `fullHeight`, `action`, …) must reach the atom, not stop at
 * this adapter. Only the framework-injected render-state props and the
 * legacy `p`/`m`/`radius` aliases are translated away.
 */
export function BoxPattern({
  p,
  m,
  radius,
  isLoading: _isLoading,
  error: _error,
  entity: _entity,
  ...boxProps
}: BoxPatternProps): React.ReactElement {
  return (
    <Box
      padding={boxProps.padding ?? p}
      margin={boxProps.margin ?? m}
      rounded={boxProps.rounded ?? radius}
      {...boxProps}
    />
  );
}

BoxPattern.displayName = 'BoxPattern';


// ============================================================================
// Spacer Pattern
// ============================================================================

export interface SpacerPatternProps {
  /** Size or 'flex' for flexible */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'flex';
  /** Additional CSS classes */
  className?: string;
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
  /** Entity name */
  entity?: string;
}

/**
 * Spacer pattern component.
 *
 * Flexible space that expands or has fixed size.
 */
export function SpacerPattern({ size = 'flex' }: SpacerPatternProps): React.ReactElement {
  if (size === 'flex') {
    return <Spacer />;
  }

  const sizeMap: Record<string, string> = {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
  };

  return <Box style={{ width: sizeMap[size], height: sizeMap[size], flexShrink: 0 }} />;
}

SpacerPattern.displayName = 'SpacerPattern';

// ============================================================================
// Divider Pattern
// ============================================================================

export interface DividerPatternProps {
  /** Orientation */
  orientation?: DividerOrientation;
  /** Line style */
  variant?: DividerVariant;
  /** Color token */
  color?: string;
  /** Spacing around divider */
  spacing?: 'xs' | 'sm' | 'md' | 'lg';
  /** Additional CSS classes */
  className?: string;
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
  /** Entity name */
  entity?: string;
}

/**
 * Divider pattern component.
 *
 * Visual separator between sections.
 */
export function DividerPattern({
  orientation = 'horizontal',
  variant = 'solid',
  spacing = 'md',
}: DividerPatternProps): React.ReactElement {
  const spacingMap: Record<string, string> = {
    xs: 'my-1',
    sm: 'my-2',
    md: 'my-4',
    lg: 'my-6',
  };

  const verticalSpacingMap: Record<string, string> = {
    xs: 'mx-1',
    sm: 'mx-2',
    md: 'mx-4',
    lg: 'mx-6',
  };

  return (
    <Divider
      orientation={orientation}
      variant={variant}
      className={orientation === 'horizontal' ? spacingMap[spacing] : verticalSpacingMap[spacing]}
    />
  );
}

DividerPattern.displayName = 'DividerPattern';

// ============================================================================
// Exports
// ============================================================================


export const LAYOUT_PATTERNS = {
  'box': BoxPattern,
  'spacer': SpacerPattern,
  'divider': DividerPattern,
} as const;
