/**
 * `guardHolds` — the one rule for a guard that throws, shared by the JS runtime and the
 * code the TypeScript shell generates: it blocks like a false guard (drift D-7, G-CROSS-158).
 */
import { describe, it, expect } from 'vitest';
import { guardHolds } from '../src/types/index.js';

describe('guardHolds', () => {
  it('a guard that throws does not hold, and its error is reported', () => {
    const reported: Error[] = [];
    const holds = guardHolds(() => {
      throw new Error('boom');
    }, (error) => reported.push(error));
    expect(holds).toBe(false);
    expect(reported.map((e) => e.message)).toEqual(['boom']);
  });

  it('a thrown non-Error is reported as an Error', () => {
    const reported: Error[] = [];
    expect(guardHolds(() => { throw 'text'; }, (error) => reported.push(error))).toBe(false);
    expect(reported[0]).toBeInstanceOf(Error);
    expect(reported[0].message).toBe('text');
  });

  it('control: a guard that returns holds exactly when it is truthy, with nothing reported', () => {
    const reported: Error[] = [];
    expect(guardHolds(() => true, (error) => reported.push(error))).toBe(true);
    expect(guardHolds(() => false, (error) => reported.push(error))).toBe(false);
    expect(reported).toEqual([]);
  });
});
