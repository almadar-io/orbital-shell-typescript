// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { gapHandleRects, insertionLineRect, paddingHandleRects, renderedAlignment, renderedSpacing, spacingScaleOf, layoutBoxOf, marqueeRect, marqueeHits, offsetWithin, axisPositionFrom, snapMove, distanceLines } from '../selection-geometry';

const row = (left: number, width: number) => ({ top: 10, left, width, height: 20 });
const col = (top: number, height: number) => ({ top, left: 10, width: 80, height });

describe('gapHandleRects', () => {
  it('one handle per gap in a row, spanning the gap', () => {
    expect(gapHandleRects([row(0, 40), row(56, 40), row(112, 40)], 'horizontal')).toEqual([
      { top: 10, left: 40, width: 16, height: 20 },
      { top: 10, left: 96, width: 16, height: 20 },
    ]);
  });

  it('in a column the handle spans the widest of the two children', () => {
    expect(gapHandleRects([col(0, 20), { top: 28, left: 0, width: 100, height: 20 }], 'vertical')).toEqual([
      { top: 20, left: 0, width: 100, height: 8 },
    ]);
  });

  it('touching or overlapping children give a zero-size handle, never negative', () => {
    expect(gapHandleRects([row(0, 40), row(30, 40)], 'horizontal')[0].width).toBe(0);
  });

  it('fewer than two children means no gap', () => {
    expect(gapHandleRects([row(0, 40)], 'horizontal')).toEqual([]);
    expect(gapHandleRects([], 'vertical')).toEqual([]);
  });
});

describe('paddingHandleRects', () => {
  const container = { top: 0, left: 0, width: 200, height: 100 };

  it('bands between the container edge and the union of its children', () => {
    const bands = paddingHandleRects(container, [{ top: 16, left: 24, width: 100, height: 20 }, { top: 44, left: 24, width: 152, height: 40 }]);
    expect(bands.top).toEqual({ top: 0, left: 0, width: 200, height: 16 });
    expect(bands.left).toEqual({ top: 0, left: 0, width: 24, height: 100 });
    expect(bands.right).toEqual({ top: 0, left: 176, width: 24, height: 100 });
    expect(bands.bottom).toEqual({ top: 84, left: 0, width: 200, height: 16 });
  });

  it('an empty container has zero-size bands', () => {
    const bands = paddingHandleRects(container, []);
    expect(bands.top.height).toBe(0);
    expect(bands.right.width).toBe(0);
  });
});


describe('insertionLineRect', () => {
  const container = { top: 0, left: 0, width: 200, height: 100 };
  const column = [
    { top: 10, left: 10, width: 100, height: 20 },
    { top: 40, left: 10, width: 120, height: 20 },
  ];

  it('between two children, centred in the gap', () => {
    expect(insertionLineRect(container, column, 1, 'vertical')).toEqual({ top: 34, left: 10, width: 120, height: 2 });
  });

  it('before the first and after the last child', () => {
    expect(insertionLineRect(container, column, 0, 'vertical').top).toBe(9);
    expect(insertionLineRect(container, column, 2, 'vertical').top).toBe(59);
  });

  it('a row draws a vertical line', () => {
    const row = [{ top: 5, left: 0, width: 40, height: 30 }, { top: 5, left: 60, width: 40, height: 30 }];
    expect(insertionLineRect(container, row, 1, 'horizontal')).toEqual({ top: 5, left: 49, width: 2, height: 30 });
  });

  it('an empty container draws along its leading edge; an out-of-range index clamps', () => {
    expect(insertionLineRect(container, [], 3, 'vertical')).toEqual({ top: 0, left: 0, width: 200, height: 2 });
    expect(insertionLineRect(container, column, 9, 'vertical').top).toBe(59);
  });
});

describe('renderedAlignment (computed flex style → alignment grid)', () => {
  it('maps flex and logical keywords to grid positions', () => {
    expect(renderedAlignment({ alignItems: 'flex-start', justifyContent: 'flex-end' })).toEqual({ align: 'start', justify: 'end' });
    expect(renderedAlignment({ alignItems: 'center', justifyContent: 'center' })).toEqual({ align: 'center', justify: 'center' });
    expect(renderedAlignment({ alignItems: 'end', justifyContent: 'start' })).toEqual({ align: 'end', justify: 'start' });
  });

  it('flex defaults (normal) read as start on the main axis', () => {
    expect(renderedAlignment({ alignItems: 'normal', justifyContent: 'normal' }).justify).toBe('start');
  });

  it('space-between reads as space-between on the main axis', () => {
    expect(renderedAlignment({ alignItems: 'center', justifyContent: 'space-between' })).toEqual({ align: 'center', justify: 'between' });
  });

  it('stretch, baseline and the other space-* values are not a grid position', () => {
    expect(renderedAlignment({ alignItems: 'stretch', justifyContent: 'space-evenly' })).toEqual({ align: null, justify: null });
    expect(renderedAlignment({ alignItems: 'baseline', justifyContent: 'space-around' })).toEqual({ align: null, justify: null });
  });
});

describe('spacingScaleOf (what each spacing step renders at, on this element)', () => {
  function themed(vars: string): Element {
    const el = document.createElement('div');
    el.setAttribute('style', vars);
    document.body.appendChild(el);
    return el;
  }

  it('token-backed steps read the theme token in scope', () => {
    const pxOf = spacingScaleOf(themed('--space-4: 14px; --space-10: 60px'));
    expect(pxOf(4)).toBe(14);
    expect(pxOf(10)).toBe(60);
  });

  it('a token given in rem converts through the root font size', () => {
    expect(spacingScaleOf(themed('--space-4: 0.875rem'))(4)).toBe(14);
  });

  it('steps without a token (or an unset one) are Tailwind rem steps', () => {
    const pxOf = spacingScaleOf(themed(''));
    expect(pxOf(4)).toBe(16);
    expect(pxOf(0.5)).toBe(2);
    expect(pxOf(14)).toBe(56);
  });
});

describe('renderedSpacing (computed style → gap + padding px)', () => {
  const style = { rowGap: '14px', columnGap: '7px', paddingTop: '3.5px', paddingRight: '0px', paddingBottom: '7px', paddingLeft: '' };

  it('the gap follows the layout direction', () => {
    expect(renderedSpacing(style, 'vertical').gap).toBe(14);
    expect(renderedSpacing(style, 'horizontal').gap).toBe(7);
  });

  it('reads each padding side; unreadable values are 0', () => {
    expect(renderedSpacing({ ...style, rowGap: 'normal' }, 'vertical')).toEqual({ gap: 0, top: 3.5, right: 0, bottom: 7, left: 0 });
  });
});

describe('layoutBoxOf (the element that actually lays out a container)', () => {
  function tree(html: string): Element {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    return host.firstElementChild as Element;
  }

  it('walks through display:contents wrappers to the box that renders', () => {
    const wrapper = tree('<div style="display: contents"><div style="display: contents"><div id="stack" style="display: flex; row-gap: 14px"></div></div></div>');
    expect(layoutBoxOf(wrapper).id).toBe('stack');
  });

  it('a wrapper that renders its own box is itself', () => {
    const el = tree('<div id="self" style="display: flex"><div></div></div>');
    expect(layoutBoxOf(el).id).toBe('self');
  });

  it('an empty contents wrapper falls back to itself', () => {
    const el = tree('<div id="empty" style="display: contents"></div>');
    expect(layoutBoxOf(el).id).toBe('empty');
  });
});

describe('marquee selection', () => {
  it('the box between the press point and the pointer, whichever way it was dragged', () => {
    expect(marqueeRect({ x: 50, y: 40 }, { x: 10, y: 10 })).toEqual({ top: 10, left: 10, width: 40, height: 30 });
  });

  it('hits every child the box touches, in order', () => {
    const children = [row(0, 40), row(56, 40), row(112, 40)];
    expect(marqueeHits({ top: 0, left: 30, width: 40, height: 40 }, children)).toEqual([0, 1]);
    expect(marqueeHits({ top: 0, left: 97, width: 10, height: 40 }, children)).toEqual([]);
    expect(marqueeHits({ top: 100, left: 0, width: 200, height: 10 }, children)).toEqual([]);
  });
});

describe('offsetWithin (distances from the parent sides)', () => {
  const parent = { top: 10, left: 20, width: 200, height: 100 };

  it('measures each side and carries the parent size', () => {
    expect(offsetWithin({ top: 18, left: 32, width: 50, height: 30 }, parent)).toEqual({
      left: 12, top: 8, right: 138, bottom: 62, parentWidth: 200, parentHeight: 100,
    });
  });

  it('an element flush with the parent is all zeros', () => {
    expect(offsetWithin(parent, parent)).toEqual({ left: 0, top: 0, right: 0, bottom: 0, parentWidth: 200, parentHeight: 100 });
  });

  it('an element sticking out of its parent gets negative distances', () => {
    expect(offsetWithin({ top: 0, left: 10, width: 220, height: 20 }, parent)).toEqual({
      left: -10, top: -10, right: -10, bottom: 90, parentWidth: 200, parentHeight: 100,
    });
  });
});

describe('axisPositionFrom (where an element is now → its offsets under a constraint)', () => {
  const offset = { left: 12, top: 10, right: 38, bottom: 30, parentWidth: 200, parentHeight: 100 };

  it('start / end / both keep the pixel distance to the pinned side(s)', () => {
    expect(axisPositionFrom('x', 'start', offset)).toEqual({ constraint: 'start', start: 12, end: 38 });
    expect(axisPositionFrom('y', 'end', offset)).toEqual({ constraint: 'end', start: 10, end: 30 });
    expect(axisPositionFrom('x', 'both', offset)).toEqual({ constraint: 'both', start: 12, end: 38 });
  });

  it('center is the offset of its centre from the parent centre', () => {
    expect(axisPositionFrom('x', 'center', offset)).toEqual({ constraint: 'center', start: -13, end: 0 });
    expect(axisPositionFrom('y', 'center', { ...offset, top: 30, bottom: 30 })).toEqual({ constraint: 'center', start: 0, end: 0 });
  });

  it('scale is the distances as % of the parent', () => {
    expect(axisPositionFrom('y', 'scale', offset)).toEqual({ constraint: 'scale', start: 10, end: 30 });
  });

  it('edge: a zero-size parent scales to 0 instead of dividing by zero', () => {
    expect(axisPositionFrom('x', 'scale', { ...offset, parentWidth: 0 })).toEqual({ constraint: 'scale', start: 0, end: 0 });
  });
});

describe('snapMove (smart guides)', () => {
  const sibling = { top: 100, left: 100, width: 50, height: 20 };

  it('snaps an edge within the threshold and draws the guide across both boxes', () => {
    const moving = { top: 0, left: 102, width: 30, height: 10 };
    const r = snapMove(moving, [sibling], 4);
    expect(r.dx).toBe(-2);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ orientation: 'vertical', at: 100, from: 0, to: 120 }]);
  });

  it('centres snap to centres', () => {
    const moving = { top: 105, left: 0, width: 20, height: 12 };
    const r = snapMove(moving, [sibling], 4);
    expect(r.dy).toBe(-1);
    expect(r.guides).toEqual([{ orientation: 'horizontal', at: 110, from: 0, to: 150 }]);
  });

  it('the nearest target wins on each axis, independently', () => {
    const other = { top: 0, left: 203, width: 10, height: 10 };
    const moving = { top: 97, left: 170, width: 30, height: 10 };
    const r = snapMove(moving, [sibling, other], 4);
    // x: its right edge (200) to the other box's left (203); y: its centre (102) to the sibling's top (100).
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(-2);
  });

  it('nothing within the threshold: no correction, no guides', () => {
    const r = snapMove({ top: 300, left: 300, width: 10, height: 10 }, [sibling], 4);
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('exactly at the threshold still snaps; just past it does not', () => {
    expect(snapMove({ top: 0, left: 104, width: 30, height: 10 }, [sibling], 4).dx).toBe(-4);
    expect(snapMove({ top: 0, left: 104.5, width: 30, height: 10 }, [sibling], 4).dx).toBe(0);
  });
});

describe('distanceLines (Alt-hover measurements)', () => {
  const selected = { top: 40, left: 40, width: 20, height: 20 };

  it('inside a container: one line from each side to the container', () => {
    const lines = distanceLines(selected, { top: 0, left: 0, width: 100, height: 80 });
    expect(lines).toEqual([
      { x1: 50, y1: 40, x2: 50, y2: 0, length: 40 },
      { x1: 60, y1: 50, x2: 100, y2: 50, length: 40 },
      { x1: 50, y1: 60, x2: 50, y2: 80, length: 20 },
      { x1: 40, y1: 50, x2: 0, y2: 50, length: 40 },
    ]);
  });

  it('a sibling to the right: the horizontal gap, at the middle of where they overlap vertically', () => {
    expect(distanceLines(selected, { top: 50, left: 90, width: 10, height: 30 })).toEqual([
      { x1: 60, y1: 55, x2: 90, y2: 55, length: 30 },
    ]);
  });

  it('a sibling below-left (no overlap on either axis): both gaps', () => {
    expect(distanceLines(selected, { top: 70, left: 0, width: 10, height: 10 })).toEqual([
      { x1: 40, y1: 50, x2: 10, y2: 50, length: 30 },
      { x1: 50, y1: 60, x2: 50, y2: 70, length: 10 },
    ]);
  });

  it('overlapping boxes, or the same box, measure nothing', () => {
    expect(distanceLines(selected, { top: 50, left: 50, width: 30, height: 30 })).toEqual([]);
    expect(distanceLines(selected, selected)).toEqual([]);
  });

  it('lengths are rounded to whole pixels', () => {
    expect(distanceLines(selected, { top: 40, left: 72.6, width: 10, height: 20 })[0].length).toBe(13);
  });
});
