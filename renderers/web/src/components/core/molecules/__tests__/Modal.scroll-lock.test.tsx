// @vitest-environment jsdom
/**
 * An open modal holds the page still: a contained modal sits in the app's own
 * scroller, not the document, so locking only <body> left the page behind it
 * scrolling and Project Friday's time-off dialog showed two scrollbars.
 */
import React from 'react';
import { afterEach, describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Modal } from '../Modal';
import { EventBusProvider } from '../../../../core';

function mount(open: boolean, contained: boolean) {
  const view = (isOpen: boolean) => (
    <EventBusProvider debug={false}>
      <div data-testid="scroller" style={{ overflowY: 'auto' }}>
        <div style={{ position: 'relative' }}>
          <Modal isOpen={isOpen} contained={contained} title="Request time off">
            <p>Body</p>
          </Modal>
        </div>
      </div>
    </EventBusProvider>
  );
  const r = render(view(open));
  const scroller = r.getByTestId('scroller');
  return { scroller, reopen: (isOpen: boolean) => r.rerender(view(isOpen)), unmount: r.unmount };
}

afterEach(() => {
  document.body.style.overflow = '';
});

describe('Modal scroll lock', () => {
  it('an open contained modal stops the scroller it sits in', () => {
    const { scroller } = mount(true, true);
    expect(scroller.style.overflowY).toBe('hidden');
  });

  it('closing the contained modal gives the scroller its scrolling back', () => {
    const { scroller, reopen } = mount(true, true);
    reopen(false);
    expect(scroller.style.overflowY).toBe('auto');
  });

  it('unmounting an open contained modal gives the scroller its scrolling back', () => {
    const { scroller, unmount } = mount(true, true);
    const kept = scroller;
    unmount();
    expect(kept.style.overflowY).toBe('auto');
  });

  it('control: a closed contained modal leaves the scroller alone', () => {
    const { scroller } = mount(false, true);
    expect(scroller.style.overflowY).toBe('auto');
  });

  it('control: a page-level modal locks the document body', () => {
    mount(true, false);
    expect(document.body.style.overflow).toBe('hidden');
  });
});
