/**
 * Modal Component Tests
 *
 * Regression coverage for MODAL-DIALOG-ARIA-HIDDEN: the portal root must
 * never carry `aria-hidden="true"` while it contains the open Dialog, or
 * the whole modal (title, content, close button) drops out of the
 * accessibility tree even though its raw HTML looks correct.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Modal } from '../Modal';
import { EventBusProvider } from '../../../../core';

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <EventBusProvider debug={false}>{children}</EventBusProvider>
);

describe('Modal', () => {
  it('exposes the open dialog on the accessibility tree (no aria-hidden ancestor)', () => {
    render(
      <TestWrapper>
        <Modal isOpen title="Settings">
          <p>Body content</p>
        </Modal>
      </TestWrapper>
    );

    // getByRole without `{ hidden: true }` walks the accessibility tree the
    // way real assistive tech does — it fails whenever an aria-hidden
    // ancestor blankets the dialog, which is exactly the regression.
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog).toBeInTheDocument();
  });

  it('keeps the close button reachable by role on an open modal', () => {
    render(
      <TestWrapper>
        <Modal isOpen title="Settings" showCloseButton>
          <p>Body content</p>
        </Modal>
      </TestWrapper>
    );

    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('fires onClose when the close button is activated', () => {
    const onClose = vi.fn();
    render(
      <TestWrapper>
        <Modal isOpen title="Settings" onClose={onClose}>
          <p>Body content</p>
        </Modal>
      </TestWrapper>
    );

    screen.getByRole('button').click();
    expect(onClose).toHaveBeenCalled();
  });

  it('has no aria-hidden ancestor on the portal root while open', () => {
    render(
      <TestWrapper>
        <Modal isOpen title="Settings">
          <p>Body content</p>
        </Modal>
      </TestWrapper>
    );

    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('its width floor never exceeds the container (contained previews narrower than the floor)', () => {
    render(
      <TestWrapper>
        <Modal isOpen contained size="sm" title="Narrow">
          <p>Body</p>
        </Modal>
      </TestWrapper>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('min-w-[min(theme(minWidth.modal-sm),100%)]');
    expect(dialog.className).not.toMatch(/min-w-\[(min\()?\d+px/);
  });

  it('on phones it is a bottom sheet capped below full height, so its drag handle means something', () => {
    render(
      <TestWrapper>
        <Modal isOpen title="Sheet">
          <p>Body</p>
        </Modal>
      </TestWrapper>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('max-sm:max-h-[90vh]');
    expect(dialog.className).not.toContain('max-sm:h-full');
    expect(dialog.parentElement?.className).toContain('max-sm:items-end');
  });

  it.each([
    ['sm', 'modal-sm'],
    ['md', 'modal-md'],
    ['lg', 'modal-lg'],
    ['xl', 'modal-xl'],
  ] as const)('size %s floors at the %s token and drops the floor below sm', (size, token) => {
    render(
      <TestWrapper>
        <Modal isOpen contained size={size} title="Sized">
          <p>Body</p>
        </Modal>
      </TestWrapper>
    );
    const { className } = screen.getByRole('dialog');
    expect(className).toContain(`min-w-[min(theme(minWidth.${token}),100%)]`);
    expect(className).toContain('max-sm:min-w-0');
  });

  it('size full has no width floor (control)', () => {
    render(
      <TestWrapper>
        <Modal isOpen contained size="full" title="Full">
          <p>Body</p>
        </Modal>
      </TestWrapper>
    );
    const { className } = screen.getByRole('dialog');
    expect(className).not.toContain('minWidth.modal');
    expect(className).toContain('min-w-0');
  });
});
