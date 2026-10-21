/**
 * `computeInsertionIndex` regression: `resolveL2Path` in OrbPreviewNode.tsx
 * used to feed it raw `getBoundingClientRect()` rects off UISlotRenderer's
 * `display:contents` child wrappers — those are always 0x0, so `mid` was
 * always 0 and the pointer position never won a `pos < mid` comparison,
 * meaning every drop appended to the end. The fix moved rect resolution to
 * the caller (union boxes via `absUnion`); this pure function just does the
 * geometry, so these tests exercise it directly with hand-built rects.
 */
import { describe, it, expect } from 'vitest';
import { computeInsertionIndex, type DOMRectLike } from '../../src/lib/compute-insertion-index';

function rect(top: number, left: number, width: number, height: number): DOMRectLike {
  return { top, left, right: left + width, bottom: top + height, width, height };
}

describe('computeInsertionIndex', () => {
  it('returns 0 for an empty container', () => {
    expect(computeInsertionIndex([], { x: 0, y: 0 }, 'vertical')).toBe(0);
  });

  it('vertical: pointer above the first child resolves to index 0', () => {
    const rects = [rect(0, 0, 100, 100), rect(100, 0, 100, 100), rect(200, 0, 100, 100)];
    expect(computeInsertionIndex(rects, { x: 10, y: -20 }, 'vertical')).toBe(0);
  });

  it('vertical: pointer between two middle children resolves between them', () => {
    const rects = [rect(0, 0, 100, 100), rect(100, 0, 100, 100), rect(200, 0, 100, 100)];
    // mids: 50, 150, 250 — y=160 is past mid(1)=150 but before mid(2)=250.
    expect(computeInsertionIndex(rects, { x: 10, y: 160 }, 'vertical')).toBe(2);
  });

  it('vertical: pointer below the last child resolves past the end', () => {
    const rects = [rect(0, 0, 100, 100), rect(100, 0, 100, 100), rect(200, 0, 100, 100)];
    expect(computeInsertionIndex(rects, { x: 10, y: 999 }, 'vertical')).toBe(3);
  });

  it('horizontal: pointer before the first child resolves to index 0', () => {
    const rects = [rect(0, 0, 100, 50), rect(0, 100, 100, 50), rect(0, 200, 100, 50)];
    expect(computeInsertionIndex(rects, { x: -10, y: 10 }, 'horizontal')).toBe(0);
  });

  it('horizontal: pointer between two middle children resolves between them', () => {
    const rects = [rect(0, 0, 100, 50), rect(0, 100, 100, 50), rect(0, 200, 100, 50)];
    // mids: 50, 150, 250 — x=160 is past mid(1)=150 but before mid(2)=250.
    expect(computeInsertionIndex(rects, { x: 160, y: 10 }, 'horizontal')).toBe(2);
  });

  it('horizontal: pointer past the last child resolves past the end', () => {
    const rects = [rect(0, 0, 100, 50), rect(0, 100, 100, 50), rect(0, 200, 100, 50)];
    expect(computeInsertionIndex(rects, { x: 999, y: 10 }, 'horizontal')).toBe(3);
  });

  it('zero-height rects at distinct positions still resolve by their top', () => {
    // height=0 collapses each mid to its `top` — positions still differ, so
    // the comparison stays meaningful even though every rect is degenerate.
    const rects = [rect(0, 0, 100, 0), rect(50, 0, 100, 0), rect(100, 0, 100, 0)];
    expect(computeInsertionIndex(rects, { x: 10, y: 60 }, 'vertical')).toBe(2);
  });

  it('regression: identical all-zero rects (pre-fix raw display:contents rects) always append to the end', () => {
    // This is exactly what resolveL2Path used to feed the resolver before
    // the fix: raw getBoundingClientRect() on display:contents wrappers, all
    // collapsed to {0,0,0,0}. Every mid is 0, so `pos < mid` never fires for
    // a positive pointer y, regardless of where the pointer visually sits.
    const zeroRects = [rect(0, 0, 0, 0), rect(0, 0, 0, 0), rect(0, 0, 0, 0)];
    expect(computeInsertionIndex(zeroRects, { x: 0, y: 150 }, 'vertical')).toBe(3);
  });

  it('regression: union rects (post-fix, via absUnion) resolve to a real middle index for the same pointer', () => {
    // Same visual layout as the previous test's intent (three 100px-tall
    // rows, pointer over the second row) but with the real unioned boxes
    // the fix now supplies instead of the wrappers' own 0x0 rects.
    const unionRects = [rect(0, 0, 100, 100), rect(100, 0, 100, 100), rect(200, 0, 100, 100)];
    expect(computeInsertionIndex(unionRects, { x: 0, y: 140 }, 'vertical')).toBe(1);
  });
});
