import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Toast } from '../Toast';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('Toast role by severity', () => {
  it.each(['error', 'warning'] as const)('%s interrupts: role=alert', (variant) => {
    wrap(<Toast variant={variant} message="Disk almost full" />);
    expect(screen.getByRole('alert').textContent).toContain('Disk almost full');
  });

  it.each(['info', 'success'] as const)('control: %s is polite: role=status', (variant) => {
    wrap(<Toast variant={variant} message="Saved" />);
    expect(screen.getByRole('status').textContent).toContain('Saved');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = wrap(<Toast variant="success" message="Saved" />);
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });
});

describe('Toast auto-dismiss timing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const dismissed = (onDismiss: ReturnType<typeof vi.fn>) => {
    fireEvent.animationEnd(document.querySelector('[class*="animate-toast"]') as Element);
    return onDismiss.mock.calls.length > 0;
  };

  it('control: dismisses after the duration', () => {
    const onDismiss = vi.fn();
    wrap(<Toast message="m" duration={1000} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(dismissed(onDismiss)).toBe(true);
  });

  it('hover pauses the timer and leaving resumes with the remaining time', () => {
    const onDismiss = vi.fn();
    wrap(<Toast message="m" duration={1000} onDismiss={onDismiss} />);
    const toast = screen.getByRole('status');
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.mouseEnter(toast);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(dismissed(onDismiss)).toBe(false);
    fireEvent.mouseLeave(toast);
    act(() => { vi.advanceTimersByTime(399); });
    expect(dismissed(onDismiss)).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(dismissed(onDismiss)).toBe(true);
  });

  it('focus inside pauses the timer and blur resumes it', () => {
    const onDismiss = vi.fn();
    wrap(<Toast message="m" duration={1000} onDismiss={onDismiss} dismissible />);
    const close = screen.getByRole('button');
    fireEvent.focus(close);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(dismissed(onDismiss)).toBe(false);
    fireEvent.blur(close);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(dismissed(onDismiss)).toBe(true);
  });

  it('a toast with an action never auto-dismisses', () => {
    const onDismiss = vi.fn();
    wrap(<Toast message="m" duration={1000} onDismiss={onDismiss} actionLabel="Undo" onAction={() => {}} />);
    act(() => { vi.advanceTimersByTime(60000); });
    expect(dismissed(onDismiss)).toBe(false);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('edge: an action label without a handler does not suppress auto-dismiss', () => {
    const onDismiss = vi.fn();
    wrap(<Toast message="m" duration={1000} onDismiss={onDismiss} actionLabel="Undo" />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(dismissed(onDismiss)).toBe(true);
  });
});
