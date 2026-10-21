import { describe, it, expect, afterAll } from 'vitest';
import { toDateInputValue, toDateTimeInputValue, parseCalendarDate, formatDate } from '../../core';

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => { process.env.TZ = ORIGINAL_TZ; });

describe.each(['Asia/Riyadh', 'America/Los_Angeles', 'UTC'])('local calendar dates in %s', (tz) => {
  it('the zone is live for this block', () => {
    process.env.TZ = tz;
    const offset = new Date(2026, 0, 1).getTimezoneOffset();
    expect(tz === 'UTC' ? offset === 0 : offset !== 0).toBe(true);
  });

  it('a local-midnight Date keeps its calendar day', () => {
    process.env.TZ = tz;
    expect(toDateInputValue(new Date(2026, 8, 1))).toBe('2026-09-01');
  });

  it('a date-only string passes through unchanged', () => {
    process.env.TZ = tz;
    expect(toDateInputValue('2026-09-01')).toBe('2026-09-01');
  });

  it('a date-only string parses to local midnight of that day', () => {
    process.env.TZ = tz;
    const d = parseCalendarDate('2026-09-01');
    expect([d?.getFullYear(), d?.getMonth(), d?.getDate(), d?.getHours()]).toEqual([2026, 8, 1, 0]);
  });

  it('formatDate shows the stored calendar day for a date-only value', () => {
    process.env.TZ = tz;
    expect(formatDate('2026-09-01')).toBe(new Date(2026, 8, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
  });

  it('datetime-local shows local wall time, so an edit round-trip never shifts the instant', () => {
    process.env.TZ = tz;
    const instant = new Date(Date.UTC(2026, 8, 1, 14, 30));
    const shown = toDateTimeInputValue(instant.toISOString());
    expect(new Date(shown).getTime()).toBe(instant.getTime());
  });

  it('control: a zone-less local datetime string passes through unchanged', () => {
    process.env.TZ = tz;
    expect(toDateTimeInputValue('2026-09-01T09:05')).toBe('2026-09-01T09:05');
  });

  it('control: empty and unparseable values', () => {
    process.env.TZ = tz;
    expect(toDateInputValue('')).toBe('');
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue('soon')).toBe('soon');
    expect(toDateTimeInputValue('soon')).toBe('soon');
    expect(parseCalendarDate('2026-13-40')).toBeNull();
  });
});
