/**
 * Where a drop lands among a container's children. A horizontal container
 * can wrap (flex-wrap): children on a line above the cursor come before it,
 * children on a line below come after it, and x decides only within the
 * cursor's own line.
 */
import { describe, it, expect } from 'vitest';
import { computeInsertionIndex, type DOMRectLike } from '../compute-insertion-index';

const rect = (left: number, right: number, top: number, bottom: number): DOMRectLike => ({
  left, right, top, bottom, width: right - left, height: bottom - top,
});

// std-crm's contact toolbar after zooming in: Search, Filter, Create on the
// first line, Email Send wrapped onto the second.
const WRAPPED = [rect(-991, -415, 402, 490), rect(-387, 475, 402, 490), rect(503, 781, 402, 490), rect(-991, -703, 500, 588)];

describe('computeInsertionIndex', () => {
  it('control: vertical containers order by y', () => {
    const rows = [rect(0, 100, 0, 20), rect(0, 100, 30, 50), rect(0, 100, 60, 80)];
    expect(computeInsertionIndex(rows, { x: 50, y: 5 }, 'vertical')).toBe(0);
    expect(computeInsertionIndex(rows, { x: 50, y: 45 }, 'vertical')).toBe(2);
    expect(computeInsertionIndex(rows, { x: 50, y: 200 }, 'vertical')).toBe(3);
  });

  it('control: a single-line horizontal container orders by x', () => {
    const line = [rect(0, 100, 0, 20), rect(110, 210, 0, 20), rect(220, 320, 0, 20)];
    expect(computeInsertionIndex(line, { x: 150, y: 10 }, 'horizontal')).toBe(1);
    expect(computeInsertionIndex(line, { x: 300, y: 10 }, 'horizontal')).toBe(3);
  });

  it('a wrapped line: dropping at the right of the last item on line one lands before the wrapped item', () => {
    expect(computeInsertionIndex(WRAPPED, { x: 778, y: 445 }, 'horizontal')).toBe(3);
  });

  it('a wrapped line: x decides only within the cursor\'s own line', () => {
    expect(computeInsertionIndex(WRAPPED, { x: -950, y: 540 }, 'horizontal')).toBe(3);
    expect(computeInsertionIndex(WRAPPED, { x: -600, y: 540 }, 'horizontal')).toBe(4);
    expect(computeInsertionIndex(WRAPPED, { x: 0, y: 445 }, 'horizontal')).toBe(1);
    expect(computeInsertionIndex(WRAPPED, { x: 600, y: 445 }, 'horizontal')).toBe(2);
  });

  it('above every line uses the first line, below every line lands last', () => {
    expect(computeInsertionIndex(WRAPPED, { x: -950, y: 300 }, 'horizontal')).toBe(0);
    expect(computeInsertionIndex(WRAPPED, { x: 700, y: 300 }, 'horizontal')).toBe(3);
    expect(computeInsertionIndex(WRAPPED, { x: 700, y: 900 }, 'horizontal')).toBe(4);
  });

  it('items of different heights on one line are still one line', () => {
    const line = [rect(0, 100, 0, 60), rect(110, 210, 20, 40), rect(220, 320, 0, 60)];
    expect(computeInsertionIndex(line, { x: 150, y: 50 }, 'horizontal')).toBe(1);
    expect(computeInsertionIndex(line, { x: 250, y: 50 }, 'horizontal')).toBe(2);
  });
});
