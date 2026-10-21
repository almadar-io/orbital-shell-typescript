/**
 * A canvas with an animated drawable repaints every frame only while someone can see it:
 * off screen (or in a hidden tab) the animation clock stops, and it resumes when the
 * canvas comes back. A repaint never reallocates the backing store unless the size changed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { Canvas2D } from '../Canvas2D';
import type { DrawShapeProps } from '../../atoms/DrawShape';

type IoCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const pulse: DrawShapeProps = {
  type: 'draw-shape', shape: 'rect', position: { x: 0, y: 0 }, width: 10, height: 10, fill: '#f00',
  animation: { durationMs: 1000, keyframes: [{ at: 0, opacity: 0 }, { at: 1, opacity: 1 }] },
};
const still: DrawShapeProps = { type: 'draw-shape', shape: 'rect', position: { x: 0, y: 0 }, width: 10, height: 10, fill: '#f00' };

function setup(drawable: DrawShapeProps) {
  const observers: IoCallback[] = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: IoCallback) { observers.push(cb); }
    observe() { /* driven by the test */ }
    disconnect() { /* nothing held */ }
  });
  let widthWrites = 0;
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop) {
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (prop === 'measureText') return () => ({ width: 0 });
      return () => undefined;
    },
    set() { return true; },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
  const widthSetter = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
  vi.spyOn(HTMLCanvasElement.prototype, 'width', 'set').mockImplementation(function (this: HTMLCanvasElement, v: number) {
    widthWrites += 1;
    widthSetter?.set?.call(this, v);
  });
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { nextId += 1; frames.set(nextId, cb); return nextId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  render(<Canvas2D projection="side" drawables={[drawable]} />);
  const runFrames = (n: number) => { for (let i = 0; i < n; i++) { const next = frames.entries().next(); if (next.done) return; const [id, cb] = next.value; frames.delete(id); act(() => cb(performance.now())); } };
  const setVisible = (v: boolean) => act(() => { observers.forEach((cb) => cb([{ isIntersecting: v }])); });
  return { frames, runFrames, setVisible, widthWrites: () => widthWrites };
}

describe('Canvas2D animates only while on screen', () => {
  it('an on-screen animated drawable keeps requesting frames', () => {
    const t = setup(pulse);
    t.runFrames(3);
    expect(t.frames.size).toBeGreaterThan(0);
  });

  it('off screen, the animation stops requesting frames', () => {
    const t = setup(pulse);
    t.setVisible(false);
    t.runFrames(5);
    expect(t.frames.size).toBe(0);
  });

  it('coming back on screen resumes the animation', () => {
    const t = setup(pulse);
    t.setVisible(false);
    t.runFrames(5);
    t.setVisible(true);
    expect(t.frames.size).toBeGreaterThan(0);
  });

  it('control: a static scene never runs a frame loop', () => {
    const t = setup(still);
    t.runFrames(5);
    expect(t.frames.size).toBe(0);
  });

  it('animation frames repaint without resizing the backing store', () => {
    const t = setup(pulse);
    const before = t.widthWrites();
    t.runFrames(5);
    expect(t.widthWrites()).toBe(before);
  });
});
