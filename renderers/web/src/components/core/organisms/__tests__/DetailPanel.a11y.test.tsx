import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DetailPanel } from '../DetailPanel';
import type { DetailPanelProps } from '../DetailPanel';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

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

const record = { id: '1', name: 'Apollo' };
const actions = [{ label: 'Close', event: 'DISMISS' as const, variant: 'ghost' as const }];

describe('DetailPanel a11y', () => {
  it('the close X has an accessible name and the panel has no axe violations', async () => {
    const { container } = renderPanel({ entity: record, fields: ['name'], actions, closeEvent: 'DISMISS', title: 'Apollo' });
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeTruthy();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: without a closeEvent there is no close X', () => {
    renderPanel({ entity: record, fields: ['name'], actions, title: 'Apollo' });
    expect(screen.queryByRole('button', { name: 'Close panel' })).toBeNull();
  });

  it('forwards A11yProps to the inline root', () => {
    const { container } = renderPanel({ entity: record, fields: ['name'], lang: 'sl', 'aria-label': 'Project' });
    expect(container.querySelector('[aria-label="Project"]')?.getAttribute('lang')).toBe('sl');
  });

  it('the slide-over dialog prefers an explicit aria-label over the title', () => {
    renderPanel({ entity: record, fields: ['name'], slideOver: true, title: 'Apollo', 'aria-label': 'Mission' });
    expect(screen.getByRole('dialog', { name: 'Mission' })).toBeTruthy();
  });
});
