/**
 * TableView badge colour comes from the column's declared `colorMap`; the row
 * click comes from `itemClickEvent` alone.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TableView, type TableViewColumn } from '../TableView';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

const Listen: React.FC<{ event: string; spy: (p: unknown) => void }> = ({ event, spy }) => {
  const bus = useEventBus();
  React.useEffect(() => bus.on(event, (e) => spy(e.payload)), [bus, event, spy]);
  return null;
};

const pill = (text: RegExp): string => screen.getByText(text).closest('.rounded-pill')?.className ?? '';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

const rows = [{ id: '1', name: 'Task One', status: 'failed' }];

describe('TableView badge colour', () => {
  it('uses the declared colorMap entry', () => {
    const columns: readonly TableViewColumn[] = [
      { key: 'name', header: 'Name' },
      { key: 'status', header: 'Status', format: 'badge', colorMap: { failed: 'success' } },
    ];
    wrap(<TableView entity={rows} columns={columns} />);
    expect(pill(/failed/i)).toContain('border-success');
  });

  it('control: an unmapped value is neutral, whatever the word', () => {
    const columns: readonly TableViewColumn[] = [
      { key: 'name', header: 'Name' },
      { key: 'status', header: 'Status', format: 'badge' },
    ];
    wrap(<TableView entity={rows} columns={columns} />);
    const cls = pill(/failed/i);
    expect(cls).not.toContain('border-error');
    expect(cls).not.toContain('border-success');
  });
});

describe('TableView row click', () => {
  const columns: readonly TableViewColumn[] = [{ key: 'name', header: 'Name' }];
  const actions = [{ event: 'OPEN', label: 'Open' }];

  it('emits the declared itemClickEvent', () => {
    const spy = vi.fn();
    const { container } = wrap(
      <>
        <Listen event="UI:ROW" spy={spy} />
        <TableView entity={rows} columns={columns} itemActions={actions} itemClickEvent="ROW" />
      </>,
    );
    // The row opens through its one stretched control (title or first column).
    const row = container.querySelector('[data-entity-row]') as HTMLElement;
    fireEvent.click(row.querySelector('[role=cell] [role=button]:not([data-testid])') as HTMLElement);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('control: without itemClickEvent an action never becomes the row click', () => {
    const spy = vi.fn();
    const { container } = wrap(
      <>
        <Listen event="UI:OPEN" spy={spy} />
        <TableView entity={rows} columns={columns} itemActions={actions} />
      </>,
    );
    const row = container.querySelector('[data-entity-row]') as HTMLElement;
    fireEvent.click(row);
    expect(spy).not.toHaveBeenCalled();
    expect(row.className).not.toContain('cursor-pointer');
  });
});

describe('TableView title column is declared', () => {
  const rows = [{ id: '1', name: 'Acme', city: 'Riyadh' }];
  it('a column declared variant h4 heads the stacked card without a label', () => {
    render(
      <EventBusProvider debug={false}>
        <TableView entity={rows} columns={[{ key: 'city', header: 'City' }, { key: 'name', header: 'Name', variant: 'h4' }]} />
      </EventBusProvider>,
    );
    const nameCell = screen.getByText('Acme').closest('[role="cell"]');
    expect(nameCell?.querySelector('[data-stacked-label]')).toBeNull();
  });

  it('control: the first column is not a title by position', () => {
    render(
      <EventBusProvider debug={false}>
        <TableView entity={rows} columns={[{ key: 'city', header: 'City' }, { key: 'name', header: 'Name' }]} />
      </EventBusProvider>,
    );
    expect(screen.getByText('Riyadh').closest('[role="cell"]')?.querySelector('[data-stacked-label]')).not.toBeNull();
  });
});
