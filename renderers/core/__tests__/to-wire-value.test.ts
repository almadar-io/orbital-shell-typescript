import { describe, expect, it } from 'vitest';
import { toWireValue } from '../src/kernel-evaluator';

describe('toWireValue', () => {
  it('sends a date as its ISO string and drops an absent key', () => {
    const at = new Date('2026-10-17T12:00:00.000Z');
    expect(toWireValue({ when: at, gone: undefined, list: [at, 1, 'a'], nested: { n: null } })).toEqual({
      when: '2026-10-17T12:00:00.000Z',
      list: ['2026-10-17T12:00:00.000Z', 1, 'a'],
      nested: { n: null },
    });
  });

  it('control: JSON passes through unchanged and an absent value is null', () => {
    expect(toWireValue({ a: 1, b: ['x', true], c: { d: 'e' } })).toEqual({ a: 1, b: ['x', true], c: { d: 'e' } });
    expect(toWireValue(undefined)).toBeNull();
    expect(toWireValue(0)).toBe(0);
    expect(toWireValue('')).toBe('');
  });
});
