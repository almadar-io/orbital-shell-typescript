'use client';
/**
 * DateRangeSelector — preset period button-group (e.g. 1W / 1M / 3M / 1Y).
 * Distinct from DateRangePicker: no calendar inputs, no custom dates.
 * Use DateRangePicker when the user needs to enter an arbitrary from/to range.
 */

import type { A11yProps } from '@almadar/core';
import React from 'react';
import { cn } from '../../../core';
import { Button, HStack } from '../../../core';

import { domPassthrough } from '../../../core';
export interface DateRangeSelectorOption {
  label: string;
  value: string;
}

const DEFAULT_OPTIONS: DateRangeSelectorOption[] = [
  { label: '1W', value: 'week' },
  { label: '1M', value: 'month' },
  { label: '3M', value: '3months' },
  { label: '1Y', value: 'year' },
];

export interface DateRangeSelectorProps extends A11yProps {
  /** Available range options */
  options?: DateRangeSelectorOption[];
  /** Currently selected value */
  selected?: string;
  /** Callback when a range is selected */
  onSelect?: (value: string) => void;
  /** Additional CSS classes */
  className?: string;
}

export const DateRangeSelector: React.FC<DateRangeSelectorProps> = ({
  options = DEFAULT_OPTIONS,
  selected = 'month',
  onSelect,
  className,
  ...rest
}) => {
  return (
    <HStack {...domPassthrough(rest)} gap="xs" className={cn(className)}>
      {options.map((option) => (
        <Button
          key={option.value}
          variant={selected === option.value ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => onSelect?.(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </HStack>
  );
};

DateRangeSelector.displayName = 'DateRangeSelector';
