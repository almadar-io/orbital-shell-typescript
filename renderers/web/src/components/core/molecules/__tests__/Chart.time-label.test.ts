/**
 * Time-axis labels follow the bucket period. std-cicd-pipeline "Deployments per
 * day" rendered every bar as "Oct 26" (month + 2-digit year) whatever the
 * period; buckets start at 00:00 UTC, so labels read in UTC.
 */
import { describe, it, expect } from 'vitest';
import { formatTimeLabel as formatLabel } from '../Chart';

const i18n = {
  locale: 'en',
  t: (key: string, p?: Record<string, string | number>) =>
    key === 'chart.weekOf' ? `Week of ${p?.date}` : key === 'chart.quarterOf' ? `Q${p?.quarter} ${p?.year}` : key,
};
const formatTimeLabel = (raw: string, period: Parameters<typeof formatLabel>[1]) => formatLabel(raw, period, i18n);

const OCT_2_2026 = '2026-10-02T00:00:00.000Z';

describe('formatTimeLabel', () => {
  it('labels each period by its own granularity', () => {
    expect(formatTimeLabel(OCT_2_2026, 'day')).toBe('Oct 2');
    expect(formatTimeLabel('2026-09-28T00:00:00.000Z', 'week')).toBe('Week of Sep 28');
    expect(formatTimeLabel('2026-10-01T00:00:00.000Z', 'month')).toBe('Oct 2026');
    expect(formatTimeLabel('2026-10-01T00:00:00.000Z', 'quarter')).toBe('Q4 2026');
    expect(formatTimeLabel('2026-01-01T00:00:00.000Z', 'year')).toBe('2026');
  });

  it('control: no period keeps the month label', () => {
    expect(formatTimeLabel('2026-10-01T00:00:00.000Z', undefined)).toBe('Oct 2026');
  });

  it('edge: a UTC bucket start never slips to the previous day or month', () => {
    expect(formatTimeLabel('2026-03-01T00:00:00.000Z', 'month')).toBe('Mar 2026');
    expect(formatTimeLabel('2026-03-01T00:00:00.000Z', 'day')).toBe('Mar 1');
  });

  it('edge: an epoch-ms bucket key (a grouped key is a string) reads as its date', () => {
    expect(formatTimeLabel(String(Date.UTC(2026, 9, 2)), 'day')).toBe('Oct 2');
  });

  it('control: without a period a digit label keeps its date-string reading (a year stays a year)', () => {
    expect(formatTimeLabel('2026', undefined)).toBe('Jan 2026');
  });

  it('edge: a label that is not a date passes through', () => {
    expect(formatTimeLabel('undated', 'day')).toBe('undated');
  });
});
