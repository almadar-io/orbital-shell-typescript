'use client';
/**
 * DateRangePicker Molecule Component
 *
 * Two date inputs plus an optional preset row. Emits `{ from, to }` ISO
 * strings on the event bus whenever the range changes. Falls back to a
 * standard callback for direct consumers.
 *
 * Bus contract: caller passes `event` prop with a string key; the molecule
 * emits `UI:{event}` with `{ from, to }` as the payload — mirrors the
 * FilterGroup / MapView / DataGrid pattern.
 */

import React, { useCallback, useMemo, useState } from 'react';
import type { EventEmit, A11yProps } from '@almadar/core';
import { cn } from '../../../core';
import { toDateInputValue } from '../../../core';
import { Button } from '../../../core';
import { Input } from '../../../core';
import { HStack, VStack } from '../../../core';
import { Typography } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export interface DateRange {
  from: string;
  to: string;
}

export interface DateRangePickerPreset {
  /** Display label (e.g. "Last 30 days"). */
  label: string;
  /** Stable key used for highlighting the active preset. */
  value: string;
  /**
   * Range resolver: a function (JS callers), a literal `{ from, to }`
   * fixed range, or omitted — then `value` must be a built-in token
   * ('7d' | '30d' | 'month' | 'quarter' | 'ytd') resolved at click time.
   * Declarative (.orb) presets use a literal or a token; functions are
   * not expressible in config data.
   */
  range?: (() => DateRange) | DateRange;
}

export interface DateRangePickerProps extends A11yProps {
  /** Controlled `from` (ISO date YYYY-MM-DD). */
  from?: string;
  /** Controlled `to` (ISO date YYYY-MM-DD). */
  to?: string;
  /**
   * Event name emitted as `UI:{event}` with payload `{ from, to }`.
   * Optional — when omitted, only the `onChange` callback fires.
   */
  event?: EventEmit<{ from: string; to: string }>;
  /** Callback fired alongside the bus emit. */
  onChange?: (range: { from: string; to: string }) => void;
  /**
   * Preset shortcuts. Defaults to the translated standard finance set
   * (Last 7d / Last 30d / This Month / This Quarter / YTD).
   * Pass an empty array to hide presets entirely.
   */
  presets?: DateRangePickerPreset[];
  /** From-input label. */
  fromLabel?: string;
  /** To-input label. */
  toLabel?: string;
  /** Additional CSS classes. */
  className?: string;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfQuarter(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** Built-in relative ranges, resolved at click time. Declarative presets
 *  reference these by `value` when they carry no `range` of their own. */
const TOKEN_RANGES: Record<string, () => DateRange> = {
  '7d': () => ({ from: toDateInputValue(daysAgo(7)), to: toDateInputValue(new Date()) }),
  '30d': () => ({ from: toDateInputValue(daysAgo(30)), to: toDateInputValue(new Date()) }),
  month: () => ({ from: toDateInputValue(startOfMonth(new Date())), to: toDateInputValue(new Date()) }),
  quarter: () => ({ from: toDateInputValue(startOfQuarter(new Date())), to: toDateInputValue(new Date()) }),
  ytd: () => ({ from: toDateInputValue(startOfYear(new Date())), to: toDateInputValue(new Date()) }),
};

const DEFAULT_PRESET_KEYS: ReadonlyArray<{ value: string; labelKey: string }> = [
  { value: '7d', labelKey: 'dateRange.last7Days' },
  { value: '30d', labelKey: 'dateRange.last30Days' },
  { value: 'month', labelKey: 'dateRange.thisMonth' },
  { value: 'quarter', labelKey: 'dateRange.thisQuarter' },
  { value: 'ytd', labelKey: 'dateRange.yearToDate' },
];

function resolvePresetRange(preset: DateRangePickerPreset): DateRange | null {
  if (typeof preset.range === 'function') return preset.range();
  if (preset.range) return preset.range;
  return TOKEN_RANGES[preset.value]?.() ?? null;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  from: fromProp,
  to: toProp,
  event,
  onChange,
  presets: presetsProp,
  fromLabel,
  toLabel,
  className,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const presets = useMemo<DateRangePickerPreset[]>(
    () => presetsProp ?? DEFAULT_PRESET_KEYS.map((p) => ({ value: p.value, label: t(p.labelKey) })),
    [presetsProp, t],
  );
  const [from, setFrom] = useState(fromProp ?? '');
  const [to, setTo] = useState(toProp ?? '');
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const emit = useCallback(
    (range: { from: string; to: string }) => {
      onChange?.(range);
      if (event) eventBus.emit(`UI:${event}`, range);
    },
    [onChange, event, eventBus],
  );

  const handleFromChange = useCallback(
    (next: string) => {
      setFrom(next);
      setActivePreset(null);
      emit({ from: next, to });
    },
    [to, emit],
  );

  const handleToChange = useCallback(
    (next: string) => {
      setTo(next);
      setActivePreset(null);
      emit({ from, to: next });
    },
    [from, emit],
  );

  const handlePreset = useCallback(
    (preset: DateRangePickerPreset) => {
      const range = resolvePresetRange(preset);
      if (range === null) return;
      setFrom(range.from);
      setTo(range.to);
      setActivePreset(preset.value);
      emit(range);
    },
    [emit],
  );

  // A preset with no resolvable range would be a dead button — never render it.
  const renderablePresets = useMemo(
    () => presets.filter((p) => p.range !== undefined || TOKEN_RANGES[p.value] !== undefined),
    [presets],
  );

  const presetButtons = useMemo(
    () =>
      renderablePresets.map((preset) => (
        <Button
          key={preset.value}
          variant={activePreset === preset.value ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => handlePreset(preset)}
        >
          {preset.label}
        </Button>
      )),
    [renderablePresets, activePreset, handlePreset],
  );

  return (
    <VStack {...domPassthrough(rest)} gap="sm" className={cn(className)}>
      <HStack gap="md" align="end">
        <VStack gap="xs">
          <Typography variant="caption" color="secondary">
            {fromLabel ?? t('dateRange.from')}
          </Typography>
          <Input
            type="date"
            value={from}
            onChange={(e) => handleFromChange(e.target.value)}
          />
        </VStack>
        <VStack gap="xs">
          <Typography variant="caption" color="secondary">
            {toLabel ?? t('dateRange.to')}
          </Typography>
          <Input
            type="date"
            value={to}
            onChange={(e) => handleToChange(e.target.value)}
          />
        </VStack>
      </HStack>
      {renderablePresets.length > 0 && (
        <HStack gap="xs" wrap>
          {presetButtons}
        </HStack>
      )}
    </VStack>
  );
};

DateRangePicker.displayName = 'DateRangePicker';
