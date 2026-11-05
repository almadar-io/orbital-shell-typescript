/**
 * An open drawer covers the page's floating chrome (tool strips, chat pills —
 * z-50), like SidePanel does.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Drawer } from '../Drawer';

describe('Drawer layer', () => {
  it('its panel sits above z-50 floating chrome', () => {
    render(<Drawer isOpen onClose={() => undefined} title="Menu"><div data-testid="content" /></Drawer>);
    const panel = screen.getByTestId('content').closest('.fixed') as HTMLElement;
    expect(panel.className).toMatch(/z-\[60\]/);
  });

  it('a non-modal drawer leaves the page usable: no overlay, no scroll lock, not aria-modal', () => {
    render(<Drawer isOpen modal={false} onClose={() => undefined} title="Trace"><div data-testid="content" /></Drawer>);
    const panel = screen.getByRole('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('false');
    expect(document.body.style.overflow).toBe('');
    expect(document.querySelectorAll('.fixed').length).toBe(1);
  });

  it('control: a modal drawer keeps its overlay and locks the page scroll', () => {
    render(<Drawer isOpen onClose={() => undefined} title="Menu"><div data-testid="content" /></Drawer>);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.querySelectorAll('.fixed').length).toBeGreaterThan(1);
  });
});
