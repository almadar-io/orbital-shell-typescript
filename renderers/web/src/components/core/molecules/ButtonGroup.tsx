'use client';
/**
 * ButtonGroup Molecule Component
 *
 * A component for grouping buttons together with connected styling.
 * Supports both children-based and form-actions pattern (primary/secondary) usage.
 * Uses Button atoms.
 */

import React from 'react';
import { cn } from '../../../core';
import { Button } from '../../../core';
import { useEventBus } from '../../../core';
import { createLogger } from '@almadar/logger';
import type { FilterDefinition } from './FilterGroup';
import type { EventKey, A11yProps } from "@almadar/core";

import { domPassthrough } from '../../../core';
const log = createLogger('almadar:ui:button-group');

export type ButtonGroupVariant = 'default' | 'segmented' | 'toggle';

/**
 * Layer 2 visual treatment for the action-cluster (form-actions) pattern —
 * orthogonal to the semantic `variant` (which conveys grouping shape).
 */
export type ActionClusterLook =
  | 'right-aligned-buttons'
  | 'floating-bar'
  | 'inline-row'
  | 'dropdown-menu'
  | 'command-palette-trigger';

/** Action button config for form-actions pattern */
export interface ActionButton {
  label: string;
  /** Action type - 'submit' renders as submit button, others render as button */
  actionType?: string;
  event?: EventKey;
  navigatesTo?: string;
  /** Button variant - matches Button component variants. Accepts string for schema compatibility. */
  variant?: string;
}

export interface ButtonGroupProps extends A11yProps {
  /**
   * Button group content (Button components) - use this OR primary/secondary
   */
  children?: React.ReactNode;

  /**
   * Primary action button config (for form-actions pattern)
   * Accepts Readonly for compatibility with generated const objects
   */
  primary?: Readonly<ActionButton>;

  /**
   * Secondary action buttons config (for form-actions pattern)
   * Accepts readonly array for compatibility with generated const arrays
   */
  secondary?: readonly Readonly<ActionButton>[];

  /**
   * Visual variant
   * @default 'default'
   */
  variant?: ButtonGroupVariant;

  /**
   * Orientation
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical';

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Entity type for filter-group pattern (schema metadata)
   */
  entity?: string;

  /**
   * Filter definitions for filter-group pattern
   */
  filters?: readonly FilterDefinition[];

  /**
   * Layer 2 visual treatment for the action-cluster (form-actions) pattern.
   * @default 'right-aligned-buttons'
   */
  look?: ActionClusterLook;
}

// Layer 2 look styles for the form-actions pattern — applied as a delta on the
// baseline inline-flex container. `right-aligned-buttons` is the default and
// leaves the baseline untouched. `dropdown-menu` and `command-palette-trigger`
// collapse the cluster to a single trigger; the dropdown/palette body itself
// is the consumer's responsibility (no clean DOM fit here yet).
const lookStyles: Record<ActionClusterLook, string> = {
  'right-aligned-buttons': '',
  'floating-bar':
    'fixed bottom-section left-1/2 -translate-x-1/2 shadow-elevation-toast bg-card p-card-sm rounded-container',
  'inline-row': 'gap-2 inline-flex',
  'dropdown-menu': '[&>button:not(:first-child)]:hidden',
  'command-palette-trigger': '[&>button:not(:first-child)]:hidden',
};

/**
 * Safe event bus hook that works outside EventBusProvider context.
 * Returns a no-op emit function if not in EventBusProvider context.
 */
function useSafeEventBus() {
  try {
    return useEventBus();
  } catch {
    // Outside EventBusProvider context - return no-op
    return { emit: () => {}, on: () => () => {}, once: () => {} };
  }
}

export const ButtonGroup: React.FC<ButtonGroupProps> = ({
  children,
  primary,
  secondary,
  variant = 'default',
  orientation = 'horizontal',
  className,
  // Filter-group pattern props (entity and filters are used for schema-driven filtering)
  entity: _entity,
  filters,
  look = 'right-aligned-buttons',
  ...rest
}) => {
  const eventBus = useSafeEventBus();
  const variantClasses = {
    default: 'gap-0',
    segmented: 'gap-0 [&>button]:rounded-none [&>button:first-child]:rounded-l-interactive [&>button:last-child]:rounded-r-interactive [&>button:not(:first-child)]:border-l-0',
    toggle: 'gap-0 [&>button]:rounded-none [&>button:first-child]:rounded-l-interactive [&>button:last-child]:rounded-r-interactive [&>button:not(:first-child)]:border-l-0',
  };

  const orientationClasses = {
    horizontal: 'flex-row',
    vertical: 'flex-col [&>button:first-child]:rounded-t-interactive [&>button:last-child]:rounded-b-interactive [&>button:not(:first-child)]:border-t-0 [&>button:not(:first-child)]:border-l',
  };

  // Handle action button click
  const handleActionClick = (action: ActionButton) => {
    // Emit event via event bus if specified
    if (action.event) {
      eventBus.emit('UI:DISPATCH', { event: action.event });
    }
    // Navigate if specified
    if (action.navigatesTo) {
      eventBus.emit('UI:NAVIGATE', { url: action.navigatesTo });
    }
  };

  // Button variant type for type assertions
  type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning';

  // Render buttons from primary/secondary config when no children
  const renderFormActions = () => {
    const buttons: React.ReactNode[] = [];

    // Render secondary buttons first (typically on the left)
    if (secondary) {
      secondary.forEach((action, index) => {
        buttons.push(
          <Button
            key={`secondary-${index}`}
            type={action.actionType === 'submit' ? 'submit' : 'button'}
            variant={(action.variant || 'ghost') as ButtonVariant}
            onClick={() => handleActionClick(action)}
          >
            {action.label}
          </Button>
        );
      });
    }

    // Render primary button (typically on the right)
    if (primary) {
      const isSubmit = primary.actionType === 'submit';
      buttons.push(
        <Button
          key="primary"
          type={isSubmit ? 'submit' : 'button'}
          variant={(primary.variant || 'primary') as ButtonVariant}
          onClick={() => handleActionClick(primary)}
          data-testid={isSubmit ? 'form-submit' : undefined}
        >
          {primary.label}
        </Button>
      );
    }

    return buttons;
  };

  // Render filter buttons from filters config (filter-group pattern)
  const renderFilters = () => {
    if (!filters || filters.length === 0) return null;

    return filters.map((filter, index) => (
      <Button
        key={`filter-${filter.field}-${index}`}
        variant="ghost"
        onClick={() => {
          // Filter click handling would be connected to state management
          log.debug('Filter clicked', { field: filter.field });
        }}
      >
        {filter.label}
      </Button>
    ));
  };

  return (
    <div
      {...domPassthrough(rest)}
      className={cn(
        'inline-flex gap-2',
        variantClasses[variant],
        orientationClasses[orientation],
        lookStyles[look],
        className
      )}
      role="group"
    >
      {children || renderFilters() || renderFormActions()}
    </div>
  );
};

ButtonGroup.displayName = 'ButtonGroup';

