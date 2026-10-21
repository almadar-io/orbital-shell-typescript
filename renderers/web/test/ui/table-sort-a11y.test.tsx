import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { useEventBus } from '../../src/core';
import { TableView } from '../../src/components/core/molecules/TableView';

const rows = [
  { id: '1', name: 'Alpha', amount: 10 },
  { id: '2', name: 'Beta', amount: 20 },
];

function Listen({ event, spy }: { event: string; spy: (p: unknown) => void }) {
  const bus = useEventBus();
  React.useEffect(() => bus.on(event, (e) => spy(e.payload)), [bus, event, spy]);
  return null;
}

describe('TableView sortable headers', () => {
  it('announce sort state and sort from the keyboard', () => {
    const spy = vi.fn();
    render(
      <EventBusProvider debug={false}>
        <Listen event="UI:SORT_BY" spy={spy} />
        <TableView entity={rows} columns={[{ key: 'name', header: 'Name', sortable: true }, { key: 'amount', header: 'Amount' }]} sortEvent="SORT_BY" sortColumn="name" sortDirection="desc" />
      </EventBusProvider>,
    );
    const header = screen.getAllByRole('columnheader').find((h) => h.textContent?.includes('Name'));
    expect(header?.getAttribute('aria-sort')).toBe('descending');
    fireEvent.keyDown(screen.getByRole('button', { name: /Name/ }), { key: 'Enter' });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ column: 'name', direction: 'asc' }));
  });

  it('control: without a sortEvent the header is not a button', () => {
    render(
      <EventBusProvider debug={false}>
        <TableView entity={rows} columns={[{ key: 'name', header: 'Name', sortable: true }]} />
      </EventBusProvider>,
    );
    expect(screen.queryByRole('button', { name: /Name/ })).toBeNull();
  });
});
