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

  it('header actions sit beside the close button, outside the title heading', () => {
    render(
      <Drawer isOpen modal={false} onClose={() => undefined} title="Trace" headerActions={<button type="button">Full screen</button>}>
        <div />
      </Drawer>,
    );
    const action = screen.getByRole('button', { name: 'Full screen' });
    expect(screen.getByRole('heading', { name: 'Trace' }).contains(action)).toBe(false);
    expect(action.closest('[role="dialog"]')).not.toBeNull();
  });

  it('control: without header actions the header holds only the title and the close button', () => {
    render(<Drawer isOpen modal={false} onClose={() => undefined} title="Trace"><div /></Drawer>);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('data-event'))).toEqual(['CLOSE']);
  });

  it('G-ORBITAL-SHELL-TYPESCRIPT-056: an uncontained drawer escapes a stacking-context ancestor through the portal', () => {
    const { container } = render(
      <div data-testid="sticky" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
        <Drawer isOpen onClose={() => undefined} title="Menu"><div data-testid="content" /></Drawer>
      </div>,
    );
    expect(container.contains(screen.getByRole('dialog'))).toBe(false);
  });

  it('G-ORBITAL-SHELL-TYPESCRIPT-056 control: a contained drawer stays inside its frame', () => {
    const { container } = render(
      <div data-testid="frame" style={{ position: 'relative' }}>
        <Drawer isOpen contained onClose={() => undefined} title="Menu"><div data-testid="content" /></Drawer>
      </div>,
    );
    expect(container.contains(screen.getByRole('dialog'))).toBe(true);
  });
});
