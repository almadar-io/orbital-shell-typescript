/**
 * G-UI-056: a clickable record (DataGrid card/row, TableView row) is opened by
 * ONE control and never wraps its own action buttons in another button.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DataGrid } from '../DataGrid';
import { TableView } from '../TableView';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

function Spy({ event, onFire }: { event: string; onFire: (p: unknown) => void }) {
  const bus = useEventBus();
  React.useEffect(() => bus.on(`UI:${event}`, (e) => onFire(e.payload)), [bus, event, onFire]);
  return null;
}
const renderWith = (ui: React.ReactElement, onView?: (p: unknown) => void) =>
  render(
    <EventBusProvider debug={false}>
      {onView && <Spy event="VIEW" onFire={onView} />}
      {ui}
    </EventBusProvider>,
  );

const rows = [{ id: 'p1', name: 'Prairie Quartz', status: 'active' }];
const actions = [{ label: 'Edit', event: 'EDIT', variant: 'primary' as const }, { label: 'Delete', event: 'DELETE', variant: 'danger' as const }];
const noNested = (scope: HTMLElement) => {
  const buttons = within(scope).getAllByRole('button');
  expect(buttons.length).toBeGreaterThan(0);
  for (const b of buttons) expect(b.parentElement?.closest('[role=button]')).toBeNull();
};
const recordOf = (text: string) => screen.getByText(text).closest('[data-entity-row]') as HTMLElement;

describe('DataGrid', () => {
  for (const cols of [1, 3] as const) {
    it(`cols=${cols}: no button wraps the actions, and the title opens the record`, () => {
      const onView = vi.fn();
      renderWith(<DataGrid entity={rows} fields={[{ name: 'name', variant: 'h4' }, { name: 'status', variant: 'badge' }]} cols={cols} itemActions={actions} itemClickEvent="VIEW" />, onView);
      const rec = recordOf('Prairie Quartz');
      expect(rec.getAttribute('role')).not.toBe('button');
      noNested(rec);
      fireEvent.keyDown(within(rec).getByRole('button', { name: /Prairie Quartz/ }), { key: 'Enter' });
      expect(onView).toHaveBeenCalledTimes(1);
    });
  }

  it('edge: custom renderItem cards get a named overlay control outside the actions', () => {
    renderWith(<DataGrid entity={rows} renderItem={(item) => <span>{String(item.name)}</span>} itemActions={actions} itemClickEvent="VIEW" />);
    const rec = recordOf('Prairie Quartz');
    expect(rec.getAttribute('role')).not.toBe('button');
    noNested(rec);
  });

  it('control: without itemClickEvent the title is not a control', () => {
    renderWith(<DataGrid entity={rows} fields={[{ name: 'name', variant: 'h4' }]} cols={3} />);
    expect(screen.queryByRole('button', { name: /Prairie Quartz/ })).toBeNull();
  });
});

describe('TableView', () => {
  const columns = [{ key: 'name', header: 'Name', variant: 'h4' as const }, { key: 'status', header: 'Status', format: 'badge' as const }];

  it('a row holds only cells; the title cell carries the open control', () => {
    const onView = vi.fn();
    renderWith(<TableView entity={rows} columns={columns} itemActions={actions} itemClickEvent="VIEW" />, onView);
    const row = document.querySelector('[role=row][data-entity-row]') as HTMLElement;
    expect(row.getAttribute('tabindex')).toBeNull();
    for (const child of Array.from(row.children)) expect(child.getAttribute('role')).toBe('cell');
    noNested(row);
    fireEvent.keyDown(within(row).getByRole('button', { name: /Prairie Quartz/ }), { key: 'Enter' });
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('edge: with no declared title column, the first column carries the control', () => {
    renderWith(<TableView entity={rows} columns={[{ key: 'name', header: 'Name' }, { key: 'status', header: 'Status' }]} itemClickEvent="VIEW" />);
    expect(screen.getByRole('button', { name: /Prairie Quartz/ })).toBeInTheDocument();
  });

  it('control: without itemClickEvent no row control exists', () => {
    renderWith(<TableView entity={rows} columns={columns} />);
    expect(screen.queryByRole('button', { name: /Prairie Quartz/ })).toBeNull();
  });
});
