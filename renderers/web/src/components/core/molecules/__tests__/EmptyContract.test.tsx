/**
 * G-CROSS-020: a list/grid/table with no rows renders the EmptyState molecule
 * (Almadar_UX.md §2.5 — icon, specific title, description, create action),
 * one contract across DataGrid, DataList and TableView (DataTable's props).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DataGrid } from '../DataGrid';
import { DataList } from '../DataList';
import { TableView } from '../TableView';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';
import type { EntityRow } from '@almadar/core';
import type { EmptyStateSlotProps } from '../EmptyState';

const withBus = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

interface EmptyProps extends EmptyStateSlotProps {
  entity: readonly EntityRow[];
}

const empty: EmptyProps = {
  entity: [],
  emptyIcon: 'users',
  emptyTitle: 'No employees yet',
  emptyDescription: 'Employees you add will appear here.',
  emptyAction: { label: 'Add employee', event: 'CREATE' },
};

const cases = [
  ['DataGrid', (p: EmptyProps) => <DataGrid {...p} fields={[{ name: 'name' }]} />],
  ['DataList', (p: EmptyProps) => <DataList {...p} fields={[{ name: 'name' }]} />],
  ['TableView', (p: EmptyProps) => <TableView {...p} columns={[{ key: 'name' }]} />],
] as const;

describe.each(cases)('%s empty state', (_name, make) => {
  it('renders the declared icon, title, description and action', async () => {
    const { container } = withBus(make(empty));
    expect(screen.getByText('No employees yet')).toBeTruthy();
    expect(screen.getByText('Employees you add will appear here.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add employee' })).toBeTruthy();
    await waitFor(() => expect(container.querySelector('svg.lucide-users')).not.toBeNull());
  });

  it('the action emits its declared event', () => {
    const seen = vi.fn();
    function Listener() {
      const bus = useEventBus();
      React.useEffect(() => bus.on('UI:CREATE', seen), [bus]);
      return null;
    }
    withBus(<>{make(empty)}<Listener /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Add employee' }));
    expect(seen).toHaveBeenCalled();
  });

  it('control: with no empty props it still renders the generic EmptyState title', () => {
    withBus(make({ entity: [] }));
    expect(screen.getByText(/no items/i)).toBeTruthy();
  });
});

describe.each(cases)('%s empty title from an unset knob', (_name, make) => {
  it('edge: an empty-string title (a knob default) falls back to the generic line', () => {
    withBus(make({ entity: [], emptyTitle: '' }));
    expect(screen.getByText(/no items/i)).toBeTruthy();
  });
});
