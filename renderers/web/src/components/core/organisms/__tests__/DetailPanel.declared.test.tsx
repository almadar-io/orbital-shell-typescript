// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DetailPanel } from '../DetailPanel';
import type { DetailPanelProps } from '../DetailPanel';
import { EventBusProvider } from '../../../../core';

function renderPanel(props: DetailPanelProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EventBusProvider debug={false}>
          <DetailPanel {...props} />
        </EventBusProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const record = {
  id: '1',
  name: 'Apollo',
  status: 'failed',
  budget: 2500,
  progress: 40,
  due: '2026-09-21',
  notes: 'Long prose',
};

describe('DetailPanel declared slots', () => {
  it('uses the declared h3 field as the title and withholds it from the body', () => {
    renderPanel({ entity: record, fields: [{ name: 'name', variant: 'h3' }, { name: 'notes' }] });
    expect(screen.getAllByText('Apollo')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Apollo' })).toBeTruthy();
  });

  it('does not use the first field as the title when none is declared', () => {
    renderPanel({ entity: record, fields: ['name', 'notes'] });
    expect(screen.queryByRole('heading', { name: 'Apollo' })).toBeNull();
    expect(screen.getByText('Apollo')).toBeTruthy();
    expect(screen.getByText('Details')).toBeTruthy();
  });

  it('renders a declared badge with its colorMap colour', () => {
    const { container } = renderPanel({
      entity: record,
      fields: [{ name: 'status', variant: 'badge', colorMap: { failed: 'danger' } }],
    });
    expect(screen.getByText('failed')).toBeTruthy();
    expect(container.querySelector('[class*="danger"], [class*="error"]')).toBeTruthy();
  });

  it('renders an undeclared status field as plain text, not a badge', () => {
    const { container } = renderPanel({ entity: record, fields: ['status'] });
    const node = screen.getByText('failed');
    expect(node.closest('[class*="rounded-full"]')).toBeNull();
    expect(container.querySelector('[class*="danger"]')).toBeNull();
  });

  it('renders a badge with no colorMap entry neutrally', () => {
    const { container } = renderPanel({
      entity: { ...record, status: 'done' },
      fields: [{ name: 'status', variant: 'badge' }],
    });
    expect(screen.getByText('done')).toBeTruthy();
    expect(container.querySelector('[class*="success"]')).toBeNull();
  });

  it('draws a progress bar only for a declared progress field', () => {
    const declared = renderPanel({
      entity: record,
      fields: [{ name: 'progress', variant: 'progress', format: 'percent' }],
    });
    expect(declared.container.querySelector('[role="progressbar"]')).toBeTruthy();
    declared.unmount();
    const undeclared = renderPanel({ entity: record, fields: ['progress'] });
    expect(undeclared.container.querySelector('[role="progressbar"]')).toBeNull();
    expect(screen.getByText('40')).toBeTruthy();
  });

  it('formats a declared currency and leaves an undeclared budget plain', () => {
    const declared = renderPanel({ entity: record, fields: [{ name: 'budget', format: 'currency' }] });
    expect(screen.getByText('$2,500.00')).toBeTruthy();
    declared.unmount();
    renderPanel({ entity: record, fields: ['budget'] });
    expect(screen.getByText('2500')).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('formats a declared date and leaves an undeclared date-named field raw', () => {
    const declared = renderPanel({ entity: record, fields: [{ name: 'due', format: 'date' }] });
    expect(screen.queryByText('2026-09-21')).toBeNull();
    declared.unmount();
    renderPanel({ entity: record, fields: ['due'] });
    expect(screen.getByText('2026-09-21')).toBeTruthy();
  });

  it('shows the close x only for the declared closeEvent', () => {
    const actions = [{ label: 'Close', event: 'DISMISS' as const, variant: 'ghost' as const }];
    const declared = renderPanel({ entity: record, fields: ['name'], actions, closeEvent: 'DISMISS' });
    expect(screen.getByTestId('action-DISMISS')).toBeTruthy();
    declared.unmount();
    renderPanel({
      entity: record,
      fields: ['name'],
      actions: [{ label: 'Close', event: 'CLOSE' }, { label: 'Cancel', event: 'CANCEL' }],
    });
    expect(screen.queryByTestId('action-close')).toBeNull();
    expect(screen.getByText('Close').closest('button')?.getAttribute('data-testid')).toBe('action-CLOSE');
    expect(screen.getByText('Cancel')).toBeTruthy();
  });
});
