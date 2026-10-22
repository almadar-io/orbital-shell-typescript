// `object/get` indexes arrays by a numeric path segment in both evaluators
// (orbital-core `get_path`, JS `evalObjectGet`). The compiled path reads through
// `getNestedValue`, so it must too: std-graphs reads an `object/entries` pair's
// label and rows as `(object/get @entry "0")` / `"1"`.
import { describe, it, expect } from 'vitest';
import { getNestedValue } from '../src/lib/get-nested-value.js';

describe('getNestedValue indexes arrays by numeric segments', () => {
  it('reads a tuple element', () => {
    expect(getNestedValue(['Sales', 'rows'], '0')).toBe('Sales');
  });

  it('reads through an array mid-path', () => {
    expect(getNestedValue({ rows: [{ name: 'Maja' }] }, 'rows.0.name')).toBe('Maja');
  });

  it('an out-of-range index is undefined', () => {
    expect(getNestedValue(['a'], '3')).toBeUndefined();
  });

  it('a non-numeric segment on an array is undefined', () => {
    expect(getNestedValue(['a'], 'name')).toBeUndefined();
  });

  it('control: object keys still resolve', () => {
    expect(getNestedValue({ company: { name: 'Acme' } }, 'company.name')).toBe('Acme');
  });

  it('control: a string is not traversed', () => {
    expect(getNestedValue('abc', '0')).toBeUndefined();
  });
});
