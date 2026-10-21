/**
 * SplitPane Tests
 *
 * Controlled vs. uncontrolled `ratio` behavior via the resize-handle drag.
 *
 * jsdom has no PointerEvent and no Element.setPointerCapture — both are
 * polyfilled below so the real pointerdown/pointermove drag path (not a
 * simulated ratio change) exercises the component the way a browser does.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SplitPane } from '../SplitPane';

class PointerEventPolyfill extends MouseEvent {
  pointerId: number;
  constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
    super(type, params);
    this.pointerId = params.pointerId ?? 0;
  }
}

beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: PointerEventPolyfill,
    });
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
});

/**
 * Container rect used by every test: 0,0 -> 1000x500. Large relative to the
 * default `minSize` (100px) so the min/max ratio clamp doesn't pin the drag —
 * a 200x100 rect would clamp every ratio to exactly 50% (100/200 == 50%).
 */
function mockContainerRect(container: HTMLElement) {
  const outer = container.firstChild as HTMLElement;
  outer.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    right: 1000,
    bottom: 500,
    width: 1000,
    height: 500,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return outer;
}

function dragHandle(outer: HTMLElement, selectorClass: string, clientX: number, clientY: number) {
  const handle = outer.querySelector(`.${selectorClass}`) as HTMLElement;
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent(document, new PointerEventPolyfill('pointermove', { pointerId: 1, clientX, clientY, bubbles: true }));
  fireEvent(document, new PointerEventPolyfill('pointerup', { pointerId: 1, bubbles: true }));
  return handle;
}

describe('SplitPane', () => {
  describe('uncontrolled ratio', () => {
    it('tracks its own ratio state while dragging, seeded from the `ratio` prop', () => {
      const { container } = render(
        <SplitPane ratio={50} left={<div>Left</div>} right={<div>Right</div>} />,
      );
      const outer = mockContainerRect(container);
      const left = outer.firstChild as HTMLElement;
      expect(left.style.width).toBe('50%');

      // Drag to x=750 of a 1000-wide container -> 75%.
      dragHandle(outer, 'cursor-col-resize', 750, 0);
      expect(left.style.width).toBe('75%');
    });

    it('does not call onRatioChange when the prop is absent', () => {
      const { container } = render(
        <SplitPane ratio={50} left={<div>Left</div>} right={<div>Right</div>} />,
      );
      const outer = mockContainerRect(container);
      expect(() => dragHandle(outer, 'cursor-col-resize', 750, 0)).not.toThrow();
    });
  });

  describe('controlled ratio', () => {
    it('fires onRatioChange from the drag instead of updating an internal ratio', () => {
      const onRatioChange = vi.fn();
      const { container } = render(
        <SplitPane ratio={50} onRatioChange={onRatioChange} left={<div>Left</div>} right={<div>Right</div>} />,
      );
      const outer = mockContainerRect(container);
      const left = outer.firstChild as HTMLElement;
      expect(left.style.width).toBe('50%');

      dragHandle(outer, 'cursor-col-resize', 750, 0);

      expect(onRatioChange).toHaveBeenCalled();
      const lastRatio = onRatioChange.mock.calls[onRatioChange.mock.calls.length - 1][0] as number;
      expect(lastRatio).toBeCloseTo(75, 5);
      // Controlled: the rendered ratio stays at the `ratio` prop until the
      // parent re-renders with the new value — it does not self-update.
      expect(left.style.width).toBe('50%');
    });

    it('re-syncs to a new `ratio` prop on the next render (controlled)', () => {
      const onRatioChange = vi.fn();
      const { container, rerender } = render(
        <SplitPane ratio={30} onRatioChange={onRatioChange} left={<div>Left</div>} right={<div>Right</div>} />,
      );
      const outer = container.firstChild as HTMLElement;
      const left = outer.firstChild as HTMLElement;
      expect(left.style.width).toBe('30%');

      rerender(
        <SplitPane ratio={65} onRatioChange={onRatioChange} left={<div>Left</div>} right={<div>Right</div>} />,
      );
      expect(left.style.width).toBe('65%');
    });
  });

  describe('vertical direction', () => {
    it('computes ratio from the y axis and reports it via onRatioChange', () => {
      const onRatioChange = vi.fn();
      const { container } = render(
        <SplitPane
          direction="vertical"
          ratio={50}
          onRatioChange={onRatioChange}
          left={<div>Top</div>}
          right={<div>Bottom</div>}
        />,
      );
      const outer = mockContainerRect(container);

      dragHandle(outer, 'cursor-row-resize', 0, 125);

      expect(onRatioChange).toHaveBeenCalled();
      const lastRatio = onRatioChange.mock.calls[onRatioChange.mock.calls.length - 1][0] as number;
      expect(lastRatio).toBeCloseTo(25, 5);
    });
  });
});
