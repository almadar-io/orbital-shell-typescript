/**
 * A playing demo inside the frame rewrites attributes on every tick. Measuring
 * reads layout, so the frame re-measures only when its content changes size,
 * never per DOM mutation.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ScaledDiagram } from '../ScaledDiagram';

let widthReads = 0;
let resize: (() => void) | undefined;

beforeEach(() => {
  widthReads = 0;
  resize = undefined;
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.getAttribute('data-name') !== 'page') return 0;
      widthReads += 1;
      return 1280;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.getAttribute('data-name') === 'page' ? 800 : 0; },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) { return 640; },
  });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: () => void) { resize = cb; }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

describe('ScaledDiagram measures on size changes only', () => {
  it('an attribute change inside the content does not re-measure', async () => {
    const view = render(<ScaledDiagram><div data-name="page" data-tick="0">page</div></ScaledDiagram>);
    await settle();
    const before = widthReads;
    view.container.querySelector('[data-name="page"]')?.setAttribute('data-tick', '1');
    await settle();
    expect(widthReads).toBe(before);
  });

  it('control: a resize re-measures', async () => {
    render(<ScaledDiagram><div data-name="page">page</div></ScaledDiagram>);
    await settle();
    const before = widthReads;
    act(() => { resize?.(); });
    expect(widthReads).toBeGreaterThan(before);
  });

  it('control: the first measurement still scales the content', async () => {
    const view = render(<ScaledDiagram><div data-name="page">page</div></ScaledDiagram>);
    await settle();
    expect(view.container.innerHTML).toContain('scale(0.5)');
  });
});
