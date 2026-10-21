import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfirmDialog, type ConfirmDialogVariant } from '../ConfirmDialog';
import { EventBusProvider } from '../../../../core';

function renderDialog(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  return render(
    <EventBusProvider debug={false}>
      <ConfirmDialog title="Delete item" message="This cannot be undone." confirmText="Delete" cancelText="Keep" {...props} />
    </EventBusProvider>,
  );
}

describe('ConfirmDialog', () => {
  it('styles the danger confirm as a destructive action, not the primary default', () => {
    renderDialog({ variant: 'danger' });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm.className).toContain('border-error');
    expect(confirm.className).not.toContain('bg-primary');
  });

  it.each<[ConfirmDialogVariant, string]>([
    ['warning', 'border-warning'],
    ['info', 'bg-primary'],
    ['default', 'bg-primary'],
  ])('control: %s confirm keeps its own emphasis', (variant, cls) => {
    renderDialog({ variant });
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain(cls);
  });

  it('puts initial focus on Cancel, so Enter never confirms a destructive action by accident', () => {
    renderDialog({ variant: 'danger' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep' }));
  });

  it('renders the error message as an alert', () => {
    renderDialog({ error: { message: 'Could not delete: item is locked' } });
    expect(screen.getByRole('alert').textContent).toContain('Could not delete: item is locked');
  });

  it('control: no alert without an error', () => {
    renderDialog({ error: null });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
