/**
 * G-ORBITAL-SHELL-TYPESCRIPT-051: a following camera tweens through requestAnimationFrame,
 * so it must stand still when the user asks for reduced motion.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Canvas2D } from '../Canvas2D';

afterEach(() => vi.restoreAllMocks());

function mockMedia(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  }));
}

function followCameraFrames(reduce: boolean): number {
  mockMedia(reduce);
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
  const live = new Set<number>();
  let next = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
    next += 1;
    live.add(next);
    return next;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    live.delete(id);
  });
  render(
    <Canvas2D
      projection="side"
      camera="follow"
      followTarget={{ x: 40, y: 40 }}
      drawables={[{ type: 'draw-sprite-layer', items: [] }]}
    />,
  );
  expect(screen.getByTestId('canvas-2d')).toBeTruthy();
  return live.size;
}

describe('Canvas2D follow camera honors reduced motion', () => {
  it('leaves no animation frame pending when the user prefers reduced motion', () => {
    expect(followCameraFrames(true)).toBe(0);
  });

  it('control: the same scene schedules the camera tween when motion is allowed', () => {
    expect(followCameraFrames(false)).toBeGreaterThan(0);
  });
});
