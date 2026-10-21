/**
 * The backdrop colour is the base layer: it paints whether or not a
 * `backgroundImage` is set, loading, or unresolvable. `ui-platformer-board`
 * authored `backgroundImage: { url: "" }` + `bgColor: "#5c94fc"` and the canvas
 * stayed fully transparent — the image branch skipped the colour fill.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { Canvas2D } from '../Canvas2D';

function recordingContext(): { ctx: CanvasRenderingContext2D; fills: string[] } {
  const fills: string[] = [];
  let fillStyle = '';
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop) {
      if (prop === 'fillStyle') return fillStyle;
      if (prop === 'fillRect') return () => { fills.push(fillStyle); };
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (prop === 'measureText') return () => ({ width: 0 });
      return () => undefined;
    },
    set(_t, prop, value) {
      if (prop === 'fillStyle') fillStyle = String(value);
      return true;
    },
  });
  return { ctx, fills };
}

afterEach(() => vi.restoreAllMocks());

function paintedFills(props: Partial<React.ComponentProps<typeof Canvas2D>>): string[] {
  const { ctx, fills } = recordingContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
  render(<Canvas2D projection="side" drawables={[{ type: 'draw-sprite-layer', items: [] }]} bgColor="#5c94fc" {...props} />);
  return fills;
}

describe('Canvas2D backdrop', () => {
  it('paints bgColor when backgroundImage has no url', () => {
    expect(paintedFills({ backgroundImage: { url: '', role: 'decoration', category: 'ground' } })).toContain('#5c94fc');
  });

  it('paints bgColor while a backgroundImage is still loading', () => {
    expect(paintedFills({ backgroundImage: 'https://cdn.example/bg.png' })).toContain('#5c94fc');
  });

  it('control: paints bgColor with no backgroundImage', () => {
    expect(paintedFills({})).toContain('#5c94fc');
  });
});
