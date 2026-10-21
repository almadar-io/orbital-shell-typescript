import type { EntityRow } from '@almadar/core';
import type { DisplayFieldFormat } from '../core';
import { formatValue, type FormatContext } from '../core';
import { getNestedValue } from './getNestedValue';

/**
 * Buckets rows by a field, in first-seen order. With `format`, the formatted value is both the
 * bucket and its label (`date` = one bucket per day); without it, the raw value is.
 */
export function groupRows(
  items: readonly EntityRow[],
  field: string,
  format?: DisplayFieldFormat,
  fmt: FormatContext = {},
): { label: string; items: EntityRow[] }[] {
  const groups = new Map<string, EntityRow[]>();
  for (const item of items) {
    const raw = getNestedValue(item, field);
    const key = format ? formatValue(raw ?? undefined, format, fmt) : String(raw ?? '');
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return Array.from(groups.entries()).map(([label, groupItems]) => ({ label, items: groupItems }));
}
