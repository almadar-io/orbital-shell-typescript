import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';
import { EventBusProvider } from '../../../../core';

function renderDialog(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  return render(
    <EventBusProvider debug={false}>
      <ConfirmDialog title="Delete item" message="Sure?" confirmText="Delete" cancelText="Keep" onConfirm={() => {}} onClose={() => {}} {...props} />
    </EventBusProvider>,
  );
}

describe('ConfirmDialog while loading', () => {
  it('the focused confirm button keeps focus and is not natively disabled', () => {
    const view = renderDialog({ isLoading: false });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    confirm.focus();
    view.rerender(
      <EventBusProvider debug={false}>
        <ConfirmDialog title="Delete item" message="Sure?" confirmText="Delete" cancelText="Keep" onConfirm={() => {}} onClose={() => {}} isLoading />
      </EventBusProvider>,
    );
    const busy = screen.getAllByRole('button').find((b) => b.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(busy);
  });

  it('the focused cancel button keeps focus and ignores activation when loading starts', () => {
    const onClose = vi.fn();
    const view = renderDialog({ onClose });
    const cancel = screen.getByRole('button', { name: 'Keep' });
    cancel.focus();
    view.rerender(
      <EventBusProvider debug={false}>
        <ConfirmDialog title="Delete item" message="Sure?" confirmText="Delete" cancelText="Keep" onConfirm={() => {}} onClose={onClose} isLoading />
      </EventBusProvider>,
    );
    expect(cancel).not.toBeDisabled();
    expect(cancel).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(cancel);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(cancel);
  });

  it('control: idle buttons are enabled and cancel closes', () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    const cancel = screen.getByRole('button', { name: 'Keep' });
    expect(cancel).not.toHaveAttribute('aria-disabled');
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
