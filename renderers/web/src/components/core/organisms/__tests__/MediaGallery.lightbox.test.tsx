import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MediaGallery } from '../MediaGallery';
import { EventBusProvider } from '../../../../core';

const ITEMS = [
  { id: 'a', src: 'https://example.com/a.png', alt: 'Harbor at dusk', caption: 'Harbor' },
  { id: 'b', src: 'https://example.com/b.png', alt: 'Market', caption: 'Market' },
];

function renderGallery(props: Partial<React.ComponentProps<typeof MediaGallery>> = {}) {
  return render(
    <EventBusProvider debug={false}>
      <MediaGallery items={ITEMS} {...props} />
    </EventBusProvider>,
  );
}

describe('MediaGallery lightbox', () => {
  it('opens as a portaled dialog, outside the gallery container', () => {
    const { container } = renderGallery();
    fireEvent.click(screen.getByRole('button', { name: 'Harbor at dusk' }));
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png');
  });

  it('closes on Escape', () => {
    renderGallery();
    fireEvent.click(screen.getByRole('button', { name: 'Harbor at dusk' }));
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    const dialog = screen.queryByRole('dialog');
    if (dialog) fireEvent.animationEnd(dialog);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens from the keyboard (Enter on a focused tile)', () => {
    renderGallery();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Market' }), { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('control: a selectable gallery selects instead of opening the lightbox', () => {
    renderGallery({ selectable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Harbor at dusk' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('MediaGallery entity fields are declared', () => {
  it('reads the declared src and caption fields', () => {
    renderGallery({ items: undefined, entity: [{ id: 'p1', photo: 'https://example.com/p.png', title: 'Pier' }], srcField: 'photo', captionField: 'title' });
    expect(screen.getByRole('button', { name: 'Pier' }).querySelector('img')?.getAttribute('src')).toBe('https://example.com/p.png');
  });

  it('control: an undeclared `url`/`title` pair is not guessed', () => {
    renderGallery({ items: undefined, entity: [{ id: 'p1', url: 'https://example.com/p.png', title: 'Pier' }] });
    expect(screen.queryByRole('button', { name: 'Pier' })).toBeNull();
  });
});
