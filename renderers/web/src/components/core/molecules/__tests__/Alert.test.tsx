import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Alert } from '../Alert';
import { Button } from '../../../../core';
import { EventBusProvider } from '../../../../core';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('Alert', () => {
  it.each(['error', 'warning'] as const)('%s interrupts: role=alert', (variant) => {
    wrap(<Alert variant={variant} message="Disk almost full" />);
    expect(screen.getByRole('alert').textContent).toContain('Disk almost full');
  });

  it.each(['info', 'success'] as const)('control: %s is polite: role=status', (variant) => {
    wrap(<Alert variant={variant} message="Saved" />);
    expect(screen.getByRole('status').textContent).toContain('Saved');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('its action row wraps on narrow widths', () => {
    wrap(<Alert message="m" actions={<><Button>Retry</Button><Button>Details</Button></>} />);
    expect(screen.getByRole('button', { name: 'Retry' }).parentElement?.className).toContain('flex-wrap');
  });

  it('the dismiss control is a named button', () => {
    const onDismiss = vi.fn();
    wrap(<Alert message="m" dismissible onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss alert' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('Alert icon', () => {
  it('a declared icon replaces the variant icon', async () => {
    const { container } = wrap(<Alert variant="error" icon="shield-alert" message="m" />);
    await waitFor(() => expect(container.querySelector('svg.lucide-shield-alert')).not.toBeNull());
    expect(container.querySelector('svg.lucide-x-circle, svg.lucide-circle-x')).toBeNull();
  });

  it('control: without one, the variant icon shows', () => {
    const { container } = wrap(<Alert variant="info" message="m" />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('svg.lucide-shield-alert')).toBeNull();
  });
});
