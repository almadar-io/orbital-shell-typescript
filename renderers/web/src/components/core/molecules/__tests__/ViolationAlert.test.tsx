import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ViolationAlert, type ViolationRecord } from '../ViolationAlert';

const V: ViolationRecord = { id: 'v1', law: 'ZVZD', article: '12', message: 'Guard missing', actionType: 'penalty' };

describe('ViolationAlert', () => {
  it.each([false, true])('an error violation interrupts (compact=%s) and cites through the locale table', (compact) => {
    render(<ViolationAlert violation={V} compact={compact} />);
    expect(screen.getByRole('alert').textContent).toContain('ZVZD Art. 12');
  });

  it('a corrective measure is a warning, announced like every Alert warning', async () => {
    const { container } = render(<ViolationAlert violation={{ ...V, actionType: 'measure' }} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    await waitFor(() => expect(container.querySelector('svg.lucide-alert-triangle, svg.lucide-triangle-alert')).not.toBeNull());
  });

  it.each([false, true])('the dismiss control is named (compact=%s)', (compact) => {
    const onDismiss = vi.fn();
    render(<ViolationAlert violation={V} compact={compact} dismissible onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss alert' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('ViolationAlert composes Alert', () => {
  it('renders through the Alert pattern with its action-type icon', async () => {
    const { container } = render(<ViolationAlert violation={V} />);
    expect(container.querySelector('[data-pattern="alert"]')).not.toBeNull();
    await waitFor(() => expect(container.querySelector('svg.lucide-shield-alert')).not.toBeNull());
    expect(screen.getByRole('alert').textContent).toContain('Guard missing');
  });

  it('shows admin and penalty actions and navigates to the field', () => {
    const onNavigateToField = vi.fn();
    render(<ViolationAlert violation={{ ...V, adminAction: 'Suspend', penaltyAction: 'Fine', fieldId: 'f1' }} onNavigateToField={onNavigateToField} />);
    expect(screen.getByText('Suspend')).toBeTruthy();
    expect(screen.getByText('Fine')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Go to field/ }));
    expect(onNavigateToField).toHaveBeenCalledWith('f1');
  });
});
