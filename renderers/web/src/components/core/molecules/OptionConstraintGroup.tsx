/**
 * OptionConstraintGroup Molecule Component
 *
 * Generic constrained option selector (radio for "single", checkbox for "multi") with required/optional/multi
 * constraints. Renders radio inputs for `single` constraint and checkboxes for
 * `multi`. Reports validation errors inline when the current selection
 * violates the constraint.
 *
 * **Atomic Design**: Composed using Typography atom and native form controls.
 */

import React, { useCallback } from 'react';
import type { EventEmit, A11yProps } from '@almadar/core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate, type TranslateFunction } from '../../../core';
import { Typography } from '../../../core';
import { Box } from '../../../core';
import { Label } from '../../../core';
import { Radio } from '../../../core';
import { Checkbox } from '../../../core';

import { domPassthrough } from '../../../core';
export type OptionConstraintOption = {
  id: string;
  label: string;
  priceDelta?: number;
  disabled?: boolean;
  outOfStock?: boolean;
};

export type OptionConstraint =
  | { type: 'single'; required?: boolean }
  | { type: 'multi'; min?: number; max?: number };

export interface OptionConstraintGroupProps extends A11yProps {
  groupId: string;
  title: string;
  description?: string;
  options: OptionConstraintOption[];
  /** Selection constraint. Optional — defaults to single-select (the generic
   *  factory can't author a discriminated-union value; an author overrides it). */
  constraint?: OptionConstraint;
  selected?: string[];
  onChange?: (selected: string[]) => void;
  changeEvent?: EventEmit<{ selected: string[] }>;
  size?: 'sm' | 'md';
  className?: string;
}

const formatPriceDelta = (delta: number): string => {
  const sign = delta >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(delta).toFixed(2)}`;
};

const constraintHint = (constraint: OptionConstraint, t: TranslateFunction): string => {
  if (constraint.type === 'single') {
    return constraint.required ? t('optionConstraint.requiredOne') : t('optionConstraint.optionalOne');
  }
  const { min, max } = constraint;
  if (min && max) {
    return min === max ? t('optionConstraint.pickExactly', { count: min }) : t('optionConstraint.pickRange', { min, max });
  }
  if (min) return t('optionConstraint.pickAtLeast', { count: min });
  if (max) return t('optionConstraint.pickUpTo', { count: max });
  return t('optionConstraint.optional');
};

const validateSelection = (
  selected: string[],
  constraint: OptionConstraint,
  t: TranslateFunction,
): string | undefined => {
  if (constraint.type === 'single') {
    if (constraint.required && selected.length === 0) {
      return t('optionConstraint.error.pickOne');
    }
    if (selected.length > 1) {
      return t('optionConstraint.error.pickOnlyOne');
    }
    return undefined;
  }
  const { min, max } = constraint;
  if (min !== undefined && selected.length < min) {
    const remaining = min - selected.length;
    return t('optionConstraint.error.pickMore', { count: remaining });
  }
  if (max !== undefined && selected.length > max) {
    const excess = selected.length - max;
    return t('optionConstraint.error.removeOptions', { count: excess });
  }
  return undefined;
};

export const OptionConstraintGroup: React.FC<OptionConstraintGroupProps> = ({
  groupId,
  title,
  description,
  options,
  constraint = { type: 'single' },
  selected = [],
  onChange,
  changeEvent,
  size = 'md',
  className,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const hint = constraintHint(constraint, t);
  const error = validateSelection(selected, constraint, t);
  const inputName = `option-${groupId}`;
  const labelTextSize = size === 'sm' ? 'text-sm' : 'text-base';
  const optionGap = size === 'sm' ? 'gap-2' : 'gap-2.5';

  const emitChange = useCallback((next: string[]): void => {
    onChange?.(next);
    if (changeEvent) {
      eventBus.emit(`UI:${changeEvent}`, { selected: next });
    }
  }, [onChange, changeEvent, eventBus]);

  const toggle = (optionId: string, checked: boolean): void => {
    if (constraint.type === 'single') {
      emitChange(checked ? [optionId] : []);
      return;
    }
    if (checked) {
      if (selected.includes(optionId)) return;
      emitChange([...selected, optionId]);
    } else {
      emitChange(selected.filter((id) => id !== optionId));
    }
  };

  return (
    <Box
      {...domPassthrough(rest)}
      as="fieldset"
      className={cn('space-y-2', className)}
      aria-describedby={[rest['aria-describedby'], `${groupId}-hint`].filter(Boolean).join(' ')}
    >
      <Box className="flex items-baseline justify-between gap-2">
        <Typography as="legend" variant="label" weight="semibold">
          {title}
        </Typography>
        <Typography
          id={`${groupId}-hint`}
          variant="caption"
          color={constraint.type === 'single' && constraint.required ? 'error' : 'muted'}
        >
          {hint}
        </Typography>
      </Box>

      {description && (
        <Typography variant="caption" color="muted">
          {description}
        </Typography>
      )}

      <Box className={cn('flex flex-col', optionGap)}>
        {options.map((option) => {
          const isChecked = selected.includes(option.id);
          const isDisabled = option.disabled || option.outOfStock;
          const optionId = `${inputName}-${option.id}`;
          return (
            <Label
              key={option.id}
              htmlFor={optionId}
              className={cn(
                'flex items-center gap-2.5 cursor-pointer select-none font-normal',
                isDisabled && 'cursor-not-allowed opacity-60',
              )}
            >
              {constraint.type === 'single' ? (
                <Radio
                  id={optionId}
                  name={inputName}
                  value={option.id}
                  checked={isChecked}
                  disabled={isDisabled}
                  onChange={(e) => toggle(option.id, e.target.checked)}
                  className="h-4 w-4 accent-primary"
                  aria-invalid={!!error}
                />
              ) : (
                <Checkbox
                  id={optionId}
                  name={inputName}
                  value={option.id}
                  checked={isChecked}
                  disabled={isDisabled}
                  onChange={(e) => toggle(option.id, e.target.checked)}
                  className="h-4 w-4 accent-primary"
                  aria-invalid={!!error}
                />
              )}
              <Typography
                as="span"
                className={cn(
                  'flex-1',
                  labelTextSize,
                  'text-foreground',
                  option.outOfStock && 'line-through',
                )}
              >
                {option.label}
              </Typography>
              {option.priceDelta !== undefined && option.priceDelta !== 0 && (
                <Typography variant="caption" color="muted">
                  {formatPriceDelta(option.priceDelta)}
                </Typography>
              )}
              {option.outOfStock && (
                <Typography
                  variant="caption"
                  color="warning"
                  className="rounded-interactive border border-warning/40 px-1.5 py-0.5"
                >
                  {t('optionConstraint.outOfStock')}
                </Typography>
              )}
            </Label>
          );
        })}
      </Box>

      {error && (
        <Box role="alert">
          <Typography variant="caption" color="error">
            {error}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

OptionConstraintGroup.displayName = 'OptionConstraintGroup';
