/**
 * A learning canvas shrinks to its container (keeping its aspect ratio) on narrow
 * screens, and a click on the shrunken canvas still hits the shape drawn under it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { LearningCanvas } from '../LearningCanvas';

afterEach(() => vi.restoreAllMocks());

function mount(onShapeClick: (p: { index: number }) => void): HTMLCanvasElement {
  // resolveColor (LearningCanvas.tsx) reads `ctx.canvas` to resolve a shape's var()
  // color/fallback against the real element — the mock must answer that with the
  // actual canvas, not fall through to the catch-all no-op.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const canvasEl = this;
    return new Proxy({} as CanvasRenderingContext2D, {
      get(_t, prop) {
        if (prop === 'canvas') return canvasEl;
        if (prop === 'measureText') return () => ({ width: 0 });
        if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        return () => undefined;
      },
      set() {
        return true;
      },
    });
  });
  const { container } = render(
    <LearningCanvas
      width={600}
      height={400}
      shapes={[{ type: 'rect', x: 300, y: 100, width: 100, height: 100 }]}
      interactive
      onShapeClick={onShapeClick}
    />,
  );
  return container.querySelector('canvas') as HTMLCanvasElement;
}

function displayAt(canvas: HTMLCanvasElement, width: number, height: number): void {
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}),
  });
}

describe('LearningCanvas on narrow screens', () => {
  it('fills its container width, keeps its aspect ratio, and never grows taller than 70% of the viewport', () => {
    const canvas = mount(() => undefined);
    expect(canvas.style.width).toBe('100%');
    expect(canvas.style.maxWidth).toBe('min(100%, calc(70vh * 600 / 400))');
    expect(canvas.style.height).toBe('auto');
    expect(canvas.style.aspectRatio).toBe('600 / 400');
  });

  it('a click on the canvas shown at half size hits the shape under it', () => {
    const onShapeClick = vi.fn();
    const canvas = mount(onShapeClick);
    displayAt(canvas, 300, 200);
    fireEvent.click(canvas, { clientX: 175, clientY: 75 });
    expect(onShapeClick).toHaveBeenCalledWith(expect.objectContaining({ index: 0 }));
  });

  it('control: a click beside the shape at half size misses', () => {
    const onShapeClick = vi.fn();
    const canvas = mount(onShapeClick);
    displayAt(canvas, 300, 200);
    fireEvent.click(canvas, { clientX: 100, clientY: 75 });
    expect(onShapeClick).not.toHaveBeenCalled();
  });

  it('control: at full size, clicks map one to one', () => {
    const onShapeClick = vi.fn();
    const canvas = mount(onShapeClick);
    displayAt(canvas, 600, 400);
    fireEvent.click(canvas, { clientX: 350, clientY: 150 });
    expect(onShapeClick).toHaveBeenCalledWith(expect.objectContaining({ index: 0 }));
  });
});
