import { describe, it, expect } from 'vitest';
import { entityRows } from '../entityRows';

describe('entityRows', () => {
  it('passes a collection through unchanged', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(entityRows(rows)).toBe(rows);
  });
  it('wraps a single row', () => {
    expect(entityRows({ id: 'a', title: 'x' })).toEqual([{ id: 'a', title: 'x' }]);
  });
  it('edge: null, undefined and an empty collection all yield no rows', () => {
    expect(entityRows(null)).toEqual([]);
    expect(entityRows(undefined)).toEqual([]);
    expect(entityRows([])).toEqual([]);
  });
});
