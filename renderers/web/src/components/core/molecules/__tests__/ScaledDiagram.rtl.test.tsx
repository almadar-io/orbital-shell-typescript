/**
 * In RTL the oversized content starts at the right edge and overflows to the
 * left, so it scales from the top-right corner; scaling from the top-left
 * shrinks it toward an off-screen point and clips its left side.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ScaledDiagram } from '../ScaledDiagram';
import { I18nProvider, createTranslate } from '../../../../core';

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

async function scaledContent(direction: 'ltr' | 'rtl'): Promise<HTMLElement> {
  const view = render(
    <I18nProvider value={{ locale: direction === 'rtl' ? 'ar' : 'en', direction, t: createTranslate({}) }}>
      <ScaledDiagram><div data-name="page">page</div></ScaledDiagram>
    </I18nProvider>,
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  const page = view.container.querySelector<HTMLElement>('[data-name="page"]');
  const content = page?.parentElement;
  if (!content) throw new Error('no scaled content');
  return content;
}

describe('ScaledDiagram scales from the reading-start corner', () => {
  it('scales RTL content from the top right', async () => {
    const content = await scaledContent('rtl');
    expect(content.style.transform).toBe('scale(0.5)');
    expect(content.style.transformOrigin).toBe('top right');
  });

  it('control: LTR content still scales from the top left', async () => {
    const content = await scaledContent('ltr');
    expect(content.style.transform).toBe('scale(0.5)');
    expect(content.style.transformOrigin).toBe('top left');
  });

  it('control: without a provider the default direction is LTR', async () => {
    const view = render(<ScaledDiagram><div data-name="page">page</div></ScaledDiagram>);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(view.container.querySelector<HTMLElement>('[data-name="page"]')?.parentElement?.style.transformOrigin).toBe('top left');
  });
});
