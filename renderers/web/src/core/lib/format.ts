/**
 * Shared value formatting — the single owner of the locale-aware format
 * vocabulary used by every data display. Labels are never derived from names:
 * a display shows the declared label, or the name/value as stored.
 */
import type { FieldValue } from '@almadar/core';
import coreLocaleRaw from '../locales/en.json';

const { $meta: _meta, ...coreMessages } = coreLocaleRaw;
const coreLocale: Record<string, string> = coreMessages;

export type ValueFormat =
  | 'none'
  | 'date'
  | 'time'
  | 'datetime'
  | 'number'
  | 'currency'
  | 'percent'
  | 'boolean';

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * A `YYYY-MM-DD` value is a calendar day with no time zone. `new Date(s)`
 * reads it as UTC midnight, which shows the previous day west of UTC; this
 * parses it as local midnight instead. Returns null for any other shape.
 */
export function parseCalendarDate(value: string): Date | null {
  const m = CALENDAR_DATE.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

function toDate(value: FieldValue | undefined): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value);
  const d = parseCalendarDate(s) ?? new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Value for an `<input type="date">`: the LOCAL calendar day. */
export function toDateInputValue(value: FieldValue | undefined): string {
  if (!value) return '';
  if (typeof value === 'string' && CALENDAR_DATE.test(value)) return value;
  const d = toDate(value);
  if (!d) return typeof value === 'string' ? value : '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Value for an `<input type="datetime-local">`: LOCAL wall-clock time. */
export function toDateTimeInputValue(value: FieldValue | undefined): string {
  if (!value) return '';
  if (typeof value === 'string' && LOCAL_DATETIME.test(value)) return value;
  const d = toDate(value);
  if (!d) return typeof value === 'string' ? value : '';
  return `${toDateInputValue(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatDate(value: FieldValue | undefined, locale?: string): string {
  if (!value) return '';
  const d = parseCalendarDate(String(value)) ?? new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatTime(value: FieldValue | undefined, locale?: string): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(value: FieldValue | undefined, locale?: string): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  return `${formatDate(value, locale)} ${formatTime(value, locale)}`;
}

/** Translated boolean words, resolved by the caller (`t('common.yes')` / `t('common.no')`). */
export interface BooleanLabels {
  yes: string;
  no: string;
}

const DEFAULT_BOOLEAN_LABELS: BooleanLabels = { yes: coreLocale['common.yes'], no: coreLocale['common.no'] };

function asYesNo(value: FieldValue, labels: BooleanLabels): string {
  return value === false || value === 0 || String(value) === 'false' ? labels.no : labels.yes;
}

/** The app's formatting settings (see `useFormatContext`). */
export interface FormatContext {
  /** BCP 47 locale; omitted, the runtime default */
  locale?: string;
  /** ISO 4217 currency for `currency` values */
  currency?: string;
  /** Translated Yes/No */
  booleanLabels?: BooleanLabels;
}

/** Money is USD unless the host declares the app's currency (I18nContext `currency`). */
export const DEFAULT_CURRENCY = 'USD';

/**
 * Format a field value for display. Booleans always render Yes/No regardless
 * of the declared format (a raw `true`/`false` cell is never intended output).
 */
export function formatValue(value: FieldValue | undefined, format?: string, fmt: FormatContext = {}): string {
  if (value === undefined || value === null) return '';
  const { locale, currency = DEFAULT_CURRENCY, booleanLabels = DEFAULT_BOOLEAN_LABELS } = fmt;
  if (typeof value === 'boolean') return asYesNo(value, booleanLabels);
  switch (format) {
    case 'date': return formatDate(value, locale);
    case 'time': return formatTime(value, locale);
    case 'datetime': return formatDateTime(value, locale);
    case 'currency': return typeof value === 'number' ? new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value) : String(value);
    case 'number': return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : String(value);
    case 'percent': return typeof value === 'number' ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100) : String(value);
    case 'boolean': return asYesNo(value, booleanLabels);
    default: return String(value);
  }
}

/** Sort direction for {@link sortRows}. */
export type SortDirection = 'asc' | 'desc';

/**
 * Order two cell values by their own type, never by what the field is called.
 *
 * Numbers compare numerically, date-like strings chronologically, everything
 * else by locale string order. `null`/`undefined` sort last in both directions
 * so empty cells never displace real data at the top of a list.
 */
export function compareCellValues(a: FieldValue | undefined, b: FieldValue | undefined): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);

  // Numeric strings before dates: `Date.parse('2020')` succeeds as a year, so a
  // string column holding "9" and "2020" would otherwise sort as dates.
  const aNum = Number(a);
  const bNum = Number(b);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;

  const aTime = dateLikeTime(a);
  const bTime = dateLikeTime(b);
  if (aTime !== null && bTime !== null) return aTime - bTime;

  return String(a).localeCompare(String(b));
}

/**
 * Milliseconds for a value that is genuinely date-shaped, else `null`.
 * Requires a date separator, so bare tokens never reach `Date.parse` — this
 * reads the value's own form, never the field's name.
 */
function dateLikeTime(value: FieldValue): number | null {
  if (value instanceof Date) return value.getTime();
  const text = String(value);
  if (!/\d/.test(text) || !/[-/:T]/.test(text)) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
}

/**
 * Return a new array ordered by `field`. Non-mutating, and a no-op without a
 * field so callers can pass the prop through unconditionally.
 *
 * NOTE: this orders only the rows already fetched. A collection larger than its
 * `limit` still needs ordering at the data layer — see `L-NO-COLLECTION-ORDERING`.
 */
export function sortRows<T extends Record<string, FieldValue | undefined>>(
  rows: readonly T[],
  field?: string,
  direction: SortDirection = 'asc',
): readonly T[] {
  if (!field) return rows;
  const dir = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => dir * compareCellValues(a?.[field], b?.[field]));
}
