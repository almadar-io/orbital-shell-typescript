/**
 * `animateChanges` also eases the box's own height: when its content grows or
 * shrinks (a board column empties, a wizard step swaps), the frame resizes over
 * the theme's duration instead of snapping, so everything below it moves too.
 * jsdom has no layout or ResizeObserver: heights and size reports are driven here.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { Box } from '../../index';
import { EventBusProvider } from '../../index';

type Frames = Keyframe[];
const heightGlides: Array<{ from: string; to: string }> = [];
const cancelled: string[] = [];
let rootHeight = 300;
let frameScale = 1;
let report: (() => void) | undefined;

const observed: Element[] = [];

class FakeResizeObserver {
  constructor(private readonly cb: () => void) { report = () => this.cb(); }
  observe(el: Element): void { observed.push(el); }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  heightGlides.length = 0;
  cancelled.length = 0;
  rootHeight = 300;
  frameScale = 1;
  report = undefined;
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 400; } });
  observed.length = 0;
  document.documentElement.style.setProperty('--duration-normal', '250ms');
  document.documentElement.style.setProperty('--easing-emphasized', 'cubic-bezier(0.2, 0, 0, 1)');
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.hasAttribute('data-frame') ? new DOMRect(0, 0, 400 * frameScale, rootHeight * frameScale) : new DOMRect(0, 0, 0, 0);
  });
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(this: Element, frames: Frames) {
      if (!this.hasAttribute('data-frame')) return undefined;
      heightGlides.push({ from: String(frames[0]?.height), to: String(frames[1]?.height) });
      const anim = { playState: 'running', cancel: () => { cancelled.push('frame'); } };
      return anim;
    },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const resize = (height: number) => act(() => { rootHeight = height; report?.(); });

function Frame({ on }: { on: boolean }) {
  return (
    <EventBusProvider debug={false}>
      <Box animateChanges={on} data-frame="">
        <div>content</div>
      </Box>
    </EventBusProvider>
  );
}

describe('Box animateChanges: height', () => {
  it('content inside a display:contents wrapper is watched through it', () => {
    render(
      <EventBusProvider debug={false}>
        <Box animateChanges data-frame="">
          <div style={{ display: 'contents' }} data-name="wrapper"><div data-name="card">card</div></div>
        </Box>
      </EventBusProvider>,
    );
    expect(observed.map((el) => el.getAttribute('data-name'))).toEqual(['card']);
  });

  it('a content resize eases the frame from its old height to the new one', async () => {
    render(<Frame on />);
    resize(300);
    resize(128);
    expect(heightGlides).toEqual([{ from: '300px', to: '128px' }]);
  });

  it('inside a frame scaled to half size the ease runs in layout pixels', () => {
    frameScale = 0.5;
    render(<Frame on />);
    resize(300);
    resize(128);
    expect(heightGlides).toEqual([{ from: '300px', to: '128px' }]);
  });

  it('control: the first size report only records the height', () => {
    render(<Frame on />);
    resize(300);
    expect(heightGlides).toEqual([]);
  });

  it('control: an unchanged height animates nothing', () => {
    render(<Frame on />);
    resize(300);
    resize(300);
    expect(heightGlides).toEqual([]);
  });

  it('control: off by default', () => {
    render(<Frame on={false} />);
    resize(300);
    resize(128);
    expect(heightGlides).toEqual([]);
  });
});
