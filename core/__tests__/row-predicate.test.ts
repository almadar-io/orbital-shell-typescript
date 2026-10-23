import { describe, expect, it } from 'vitest';
import { parseFetchOrder } from '../src/row-predicate.js';

describe('parseFetchOrder', () => {
  it('reads field and direction, ascending by default', () => {
    expect(parseFetchOrder('priority')).toEqual({ field: 'priority', direction: 'asc' });
    expect(parseFetchOrder('priority:desc')).toEqual({ field: 'priority', direction: 'desc' });
  });
  it('is absent for no order', () => {
    expect(parseFetchOrder(undefined)).toBeUndefined();
    expect(parseFetchOrder('')).toBeUndefined();
  });
});
