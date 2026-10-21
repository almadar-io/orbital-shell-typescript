import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Lightbox } from '../Lightbox';
import { Modal } from '../Modal';
import { EventBusProvider } from '../../../../core';

const IMAGES = [
  { src: 'https://example.com/1.png', alt: 'One' },
  { src: 'https://example.com/2.png', alt: 'Two', caption: 'Second' },
  { src: 'https://example.com/3.png', alt: 'Three' },
];

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}><div data-testid="host">{ui}</div></EventBusProvider>);

describe('Lightbox', () => {
  it('portals out of its host container', () => {
    wrap(<Lightbox images={IMAGES} isOpen />);
    expect(screen.getByTestId('host').contains(screen.getByRole('dialog'))).toBe(false);
  });

  it('moves focus inside on open and traps Tab', () => {
    wrap(<Lightbox images={IMAGES} isOpen currentIndex={1} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    const buttons = screen.getAllByRole('button');
    buttons[buttons.length - 1].focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('ArrowRight / ArrowLeft page through images', () => {
    const onIndexChange = vi.fn();
    wrap(<Lightbox images={IMAGES} isOpen onIndexChange={onIndexChange} />);
    act(() => { fireEvent.keyDown(document, { key: 'ArrowRight' }); });
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    act(() => { fireEvent.keyDown(document, { key: 'ArrowLeft' }); });
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
  });

  it('shows a translated counter', () => {
    wrap(<Lightbox images={IMAGES} isOpen currentIndex={1} />);
    expect(screen.getByText('2 / 3')).toBeTruthy();
  });

  it('Escape inside a modal closes only the lightbox', () => {
    const modalClose = vi.fn();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <Modal isOpen onClose={modalClose} title="Gallery">
          <Lightbox images={IMAGES} isOpen={open} onClose={() => setOpen(false)} />
        </Modal>
      );
    }
    wrap(<Host />);
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(modalClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'One' })).toBeNull();
  });

  it('control: closed renders nothing', () => {
    wrap(<Lightbox images={IMAGES} isOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
