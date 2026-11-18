// @vitest-environment jsdom
/**
 * On phones a modal is a bottom sheet (anchored to the bottom edge, full width,
 * round top corners, internal scroll, page behind locked); on desktop it stays
 * the centered card.
 */
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Modal } from '../Modal';
import { EventBusProvider, MOBILE_MEDIA_QUERY } from '../../../../core';

function stubViewport(mobile: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: mobile && q === MOBILE_MEDIA_QUERY,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function mount(props: Partial<React.ComponentProps<typeof Modal>> = {}) {
  render(
    <EventBusProvider debug={false}>
      <Modal isOpen title="Edit task" footer={<button type="button">Save</button>} {...props}>
        <p>Body</p>
      </Modal>
    </EventBusProvider>,
  );
  const dialog = screen.getByRole('dialog');
  return { dialog, layer: dialog.parentElement as HTMLElement };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.style.overflow = '';
});

describe('Modal — phone bottom sheet', () => {
  it('anchors to the bottom edge, full width, round top corners, capped at 90vh', () => {
    stubViewport(true);
    const { dialog, layer } = mount();
    expect(layer.className).toContain('items-end');
    expect(layer.className).not.toContain('items-start');
    expect(layer.className).toContain('fixed');
    expect(dialog.className).toContain('w-full');
    expect(dialog.className).toContain('max-w-none');
    expect(dialog.className).toContain('rounded-t-container');
    expect(dialog.className).toContain('rounded-b-none');
    expect(dialog.className).toContain('max-h-[90dvh]');
  });

  it('shows the drag handle and keeps the body as the only scroll area, header and footer fixed', () => {
    stubViewport(true);
    const { dialog } = mount();
    expect(dialog.querySelector('[data-sheet-handle]')?.className).toContain('flex');
    const body = screen.getByText('Body').closest('.overflow-y-auto') as HTMLElement;
    expect(body.className).toContain('min-h-0');
    expect(screen.getByRole('heading', { name: 'Edit task' }).parentElement?.className).toContain('shrink-0');
    expect(screen.getByRole('button', { name: 'Save' }).parentElement?.className).toContain('shrink-0');
    expect(body.contains(screen.getByRole('button', { name: 'Save' }))).toBe(false);
  });

  it('slides up from the bottom edge', () => {
    stubViewport(true);
    const { dialog } = mount();
    expect(dialog.className).toContain('animate-sheet-in');
    expect(dialog.className).not.toContain('animate-modal-in');
  });

  it('locks the page behind it, also when contained in a frame', () => {
    stubViewport(true);
    const { layer } = mount({ contained: true });
    expect(document.body.style.overflow).toBe('hidden');
    expect(layer.className).toContain('items-end');
  });

  it('a sheet contained in a frame sizes to the frame, not the phone screen', () => {
    stubViewport(true);
    const { layer, dialog } = mount({ contained: true });
    expect(layer.className).toContain('absolute');
    expect(dialog.className).toContain('max-h-[90%]');
    expect(dialog.className).not.toContain('max-h-[90dvh]');
  });

  it('control: a page-level sheet sizes to the phone screen', () => {
    stubViewport(true);
    const { layer, dialog } = mount();
    expect(layer.className).toContain('fixed');
    expect(dialog.className).toContain('max-h-[90dvh]');
  });

  it('control: desktop keeps the centered card', () => {
    stubViewport(false);
    const { dialog, layer } = mount();
    expect(layer.className).toContain('items-start');
    expect(layer.className).not.toContain('items-end');
    expect(dialog.className).not.toContain('rounded-t-container');
    expect(dialog.className).not.toContain('max-w-none');
    expect(dialog.className).toContain('animate-modal-in');
    expect(dialog.querySelector('[data-sheet-handle]')?.className).toContain('hidden');
  });

  it('control: a contained modal on desktop stays inside its frame', () => {
    stubViewport(false);
    const { layer } = mount({ contained: true });
    expect(layer.className).toContain('absolute');
    expect(document.body.style.overflow).toBe('');
  });
});
