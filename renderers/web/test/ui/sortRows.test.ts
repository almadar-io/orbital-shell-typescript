import { describe, expect, it } from 'vitest';

import { compareCellValues, sortRows } from '../../src/core';

/**
 * Ordering compares a value by its OWN shape — never by what the field is
 * called. The chat thread that motivated this rendered Jul 2 → Jul 20 → Jul 7,
 * because nothing in the stack ordered anything.
 */
describe('compareCellValues', () => {
    it('orders numbers numerically, not lexically', () => {
        expect(compareCellValues(9, 10)).toBeLessThan(0);
    });

    it('orders NUMERIC STRINGS numerically too', () => {
        // '10' < '9' lexically; the numeric branch must win.
        expect(compareCellValues('9', '10')).toBeLessThan(0);
    });

    it('does not treat a bare 4-digit token as a year', () => {
        // `Date.parse('2020')` succeeds as a date. A string column holding
        // '9' and '2020' must still compare as numbers.
        expect(compareCellValues('2020', '9')).toBeGreaterThan(0);
    });

    it('orders ISO datetimes chronologically', () => {
        expect(compareCellValues('2026-07-02T10:00:00Z', '2026-07-20T10:00:00Z')).toBeLessThan(0);
    });

    it('falls back to locale string order', () => {
        expect(compareCellValues('apple', 'banana')).toBeLessThan(0);
    });

    it('sorts empty cells LAST regardless of direction', () => {
        expect(compareCellValues(null, 'a')).toBeGreaterThan(0);
        expect(compareCellValues('', 'a')).toBeGreaterThan(0);
        expect(compareCellValues(undefined, undefined)).toBe(0);
    });
});

describe('sortRows', () => {
    const thread = [
        { id: '1', timestamp: '2026-07-02T09:00:00Z' },
        { id: '2', timestamp: '2026-07-20T09:00:00Z' },
        { id: '3', timestamp: '2026-07-07T09:00:00Z' },
    ];

    it('reorders a thread chronologically', () => {
        expect(sortRows(thread, 'timestamp').map((r) => r.id)).toEqual(['1', '3', '2']);
    });

    it('honours descending', () => {
        expect(sortRows(thread, 'timestamp', 'desc').map((r) => r.id)).toEqual(['2', '3', '1']);
    });

    it('is a no-op without a field, so callers pass the prop through unconditionally', () => {
        expect(sortRows(thread)).toBe(thread);
    });

    it('does not mutate the input', () => {
        const copy = [...thread];
        sortRows(thread, 'timestamp', 'desc');
        expect(thread).toEqual(copy);
    });
});
