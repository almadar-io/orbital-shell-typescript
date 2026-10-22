import { describe, expect, it } from 'vitest';
import { buildWideSchema, percentile, stat, wideRow, wideRows, WIDE_FIELDS } from '../src/wide-table.js';

describe('wide-table fixture', () => {
  it('rows have 40 fields with strings between 8 and 200 characters and are deterministic', () => {
    const row = wideRow(7);
    expect(Object.keys(row)).toHaveLength(WIDE_FIELDS);
    const strings = Object.values(row).filter((v): v is string => typeof v === 'string');
    expect(Math.min(...strings.map((s) => s.length))).toBeGreaterThanOrEqual(2);
    expect(Math.max(...strings.map((s) => s.length))).toBeLessThanOrEqual(200);
    expect(wideRows(3)).toEqual(wideRows(3));
  });

  it('the ids schema carries only ids, the rows schema every field', () => {
    expect(JSON.stringify(buildWideSchema('ids', [20]))).not.toContain('"s1"');
    expect(JSON.stringify(buildWideSchema('rows', [20]))).toContain('"s1"');
  });

  it('percentile and stat handle one sample and ordering', () => {
    expect(percentile([5], 0.95)).toBe(5);
    expect(stat([3, 1, 2]).p50).toBe(2);
  });
});
