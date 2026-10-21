/**
 * The canvas must never hold its container open: the container is allowed to
 * shrink below the canvas's current pixel width (so the ResizeObserver reports
 * the real available width on a phone), and the canvas is capped at its
 * container's width until the resize lands.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Canvas2D } from '../Canvas2D';

afterEach(() => vi.restoreAllMocks());

function mount(): HTMLCanvasElement {
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop) {
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (prop === 'measureText') return () => ({ width: 0 });
      return () => undefined;
    },
    set() {
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
  render(<Canvas2D projection="side" drawables={[{ type: 'draw-sprite-layer', items: [] }]} />);
  return screen.getByTestId('canvas-2d') as HTMLCanvasElement;
}

describe('Canvas2D shrinks to its container', () => {
  it('the container can shrink below the canvas width', () => {
    const container = mount().parentElement as HTMLElement;
    expect(container.className).toContain('min-w-0');
    expect(container.className).toContain('max-w-full');
  });

  it('the canvas is capped at the container width', () => {
    expect(mount().className).toContain('max-w-full');
  });

  it('control: the canvas still sets its pixel size from the measured viewport', () => {
    const canvas = mount();
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
  });
});
