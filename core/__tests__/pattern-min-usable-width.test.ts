import { describe, it, expect } from 'vitest';
import { getPatternMinUsableWidths } from '../src/patterns/index';

describe('getPatternMinUsableWidths — declared @minWidth per pattern', () => {
  it('carries the widths the components declare', () => {
    const widths = getPatternMinUsableWidths();
    expect(widths.get('search-input')).toBe(160);
    expect(widths.get('table-view')).toBe(240);
  });

  it('control: a pattern with no declaration is absent, not defaulted', () => {
    expect(getPatternMinUsableWidths().has('stack')).toBe(false);
  });
});
