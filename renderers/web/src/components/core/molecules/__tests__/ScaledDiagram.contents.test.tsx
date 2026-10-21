/**
 * A page rendered through the slot renderer reaches ScaledDiagram inside
 * `display: contents` wrappers, which have no width of their own. The diagram
 * is the first real box under them (the almadar.io desktop-size demo frame).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ScaledDiagram } from '../ScaledDiagram';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) { return this.getAttribute('data-name') === 'page' ? 1280 : 0; },
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
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('ScaledDiagram looks through display:contents wrappers', () => {
  it('scales a page wrapped in a contents wrapper to the container', async () => {
    const view = render(
      <ScaledDiagram>
        <div style={{ display: 'contents' }}><div data-name="page">page</div></div>
      </ScaledDiagram>,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(view.container.innerHTML).toContain('scale(0.5)');
  });

  it('control: content narrower than the minimum is left unscaled', async () => {
    const view = render(<ScaledDiagram><div style={{ display: 'contents' }}><span>tiny</span></div></ScaledDiagram>);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(view.container.innerHTML).not.toContain('scale(');
  });
});
