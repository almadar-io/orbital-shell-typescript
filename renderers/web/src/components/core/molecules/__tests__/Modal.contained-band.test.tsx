// @vitest-environment jsdom
/**
 * A contained modal in a frame taller than its scroller (the review page grows the
 * app to its full height so pins stay put) opens in the part of the frame on screen,
 * not at the top of the frame where the viewer cannot see it.
 */
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Modal } from '../Modal';
import { EventBusProvider } from '../../../../core';

type Rect = { top: number; bottom: number; height: number };

function rectOf(r: Rect): DOMRect {
  return { x: 0, y: r.top, left: 0, right: 1000, width: 1000, top: r.top, bottom: r.bottom, height: r.height, toJSON: () => ({}) };
}

function mountInFrame(frame: { scroller: Rect; content: Rect }, contained: boolean) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testScroller !== undefined) return rectOf(frame.scroller);
    if (this.dataset.testContent !== undefined || this.classList.contains('bg-scrim')) return rectOf(frame.content);
    return original.call(this);
  });
  render(
    <EventBusProvider debug={false}>
      <div data-test-scroller="" style={{ overflowY: 'auto' }}>
        <div data-test-content="" style={{ position: 'relative' }}>
          <Modal isOpen contained={contained} title="Add subtask">
            <p>Body</p>
          </Modal>
        </div>
      </div>
    </EventBusProvider>,
  );
  return screen.getByRole('dialog');
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.style.overflow = '';
});

describe('Modal — contained in a frame taller than the screen', () => {
  it('places the dialog in the band of the frame that is scrolled into view', () => {
    vi.stubGlobal('innerHeight', 900);
    const dialog = mountInFrame({ scroller: { top: 14, bottom: 818, height: 804 }, content: { top: -741, bottom: 1698, height: 2439 } }, true);
    const band = dialog.closest('[data-modal-band]') as HTMLElement;
    expect(band).not.toBeNull();
    expect(band.style.top).toBe('755px');
    expect(band.style.height).toBe('804px');
  });

  it('control: a frame that fits on screen gives the whole frame as the band', () => {
    vi.stubGlobal('innerHeight', 900);
    const dialog = mountInFrame({ scroller: { top: 0, bottom: 900, height: 900 }, content: { top: 0, bottom: 600, height: 600 } }, true);
    const band = dialog.closest('[data-modal-band]') as HTMLElement;
    expect(band.style.top).toBe('0px');
    expect(band.style.height).toBe('600px');
  });

  it('control: an uncontained modal keeps the window overlay with no band', () => {
    const dialog = mountInFrame({ scroller: { top: 0, bottom: 900, height: 900 }, content: { top: 0, bottom: 600, height: 600 } }, false);
    expect(dialog.closest('[data-modal-band]')).toBeNull();
    expect(dialog.parentElement?.className).toContain('fixed inset-0');
  });
});
