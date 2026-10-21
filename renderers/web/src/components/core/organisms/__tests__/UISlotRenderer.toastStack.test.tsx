import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';
import { UISlotComponent } from '../UISlotRenderer';
import { UISlotProvider, useUISlots } from '../../../../providers/UISlotContext';

const TOAST = '[role="alert"], [role="status"]';

interface ToastWrite {
  sourceTrait?: string;
  message: string;
  variant: string;
}

function Writer({ writes }: { writes: ToastWrite[] }) {
  const { render: renderSlot } = useUISlots();
  useEffect(() => {
    for (const w of writes) {
      renderSlot({ target: 'toast', pattern: 'alert', props: { type: 'alert', message: w.message, variant: w.variant }, sourceTrait: w.sourceTrait });
    }
  }, [renderSlot, writes]);
  return null;
}

function mount(writes: ToastWrite[]) {
  return render(
    <UISlotProvider>
      <Writer writes={writes} />
      <UISlotComponent slot="toast" portal position="top-right" />
    </UISlotProvider>,
  );
}

describe('toast slot with several writers', () => {
  beforeEach(() => {
    document.getElementById('ui-slot-portal-root')?.remove();
  });

  it('renders one toast per writer with each message and variant', async () => {
    mount([
      { sourceTrait: 'MapTrait', message: 'Map failed', variant: 'error' },
      { sourceTrait: 'GridTrait', message: 'Grid failed', variant: 'warning' },
    ]);
    expect(await screen.findByText('Map failed')).toBeInTheDocument();
    expect(screen.getByText('Grid failed')).toBeInTheDocument();
    expect(document.querySelectorAll(TOAST).length).toBe(2);
  });

  it('dismissing one stacked toast keeps the other', async () => {
    mount([
      { sourceTrait: 'MapTrait', message: 'Map failed', variant: 'error' },
      { sourceTrait: 'GridTrait', message: 'Grid failed', variant: 'error' },
    ]);
    await screen.findByText('Map failed');
    const mapToast = screen.getByText('Map failed').closest(TOAST);
    const close = mapToast?.querySelector('button');
    expect(close).toBeTruthy();
    if (close) fireEvent.click(close);
    if (mapToast) fireEvent.animationEnd(mapToast);
    await waitFor(() => expect(screen.queryByText('Map failed')).not.toBeInTheDocument());
    expect(screen.getByText('Grid failed')).toBeInTheDocument();
  });

  it('control: a single writer still renders its own toast', async () => {
    mount([{ sourceTrait: 'OnlyTrait', message: 'Only one', variant: 'success' }]);
    expect(await screen.findByText('Only one')).toBeInTheDocument();
    expect(document.querySelectorAll(TOAST).length).toBe(1);
  });
});
